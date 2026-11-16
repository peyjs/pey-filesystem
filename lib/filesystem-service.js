// Pey filesystem service: Markdown-focused file access over the plugin's
// environment adapter, plus browser-side shadow drafts on pey.storage.
//
// The service owns the decisions (which files matter, BOM handling, error
// shapes, shadow storage); the adapter owns the platform primitives
// (pickers, permissions, handles). The plugin never touches the DOM.
import { createFilesystemError, PLUGIN_NAME, SERVICE_NAME } from './error.js';
import {
  assertShadowText,
  legacyShadowKey,
  makeRootId,
  normalizeShadowPath,
  shadowIdentity,
  shadowKey,
} from './shadow-identity.js';

const STORAGE_SERVICE = 'pey.storage.service';
const SHADOW_COLLECTION = 'disk-drafts';
const PICKED_ROOTS_COLLECTION = 'picked-roots';
const SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE';

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.txt'];

/**
 * Checks whether a filename is a readable Markdown document.
 * @param {unknown} name Filename to check.
 * @returns {boolean} True for .md/.markdown/.mdown/.txt (case-insensitive).
 */
export function isMarkdownName(name) {
  if (typeof name !== 'string') {
    return false;
  }
  const lower = name.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Builds a safe, non-sensitive cause string for error details: adapter and
 * platform error messages are kept for diagnosis, never shown to users.
 * @param {unknown} error Caught error.
 * @returns {string|undefined} Cause description, or undefined when absent.
 */
function describeCause(error) {
  if (error === undefined || error === null) {
    return undefined;
  }
  if (typeof error?.message === 'string' && error.message.length > 0) {
    return error.message;
  }
  return String(error);
}

/**
 * Builds a structured error carrying the original failure in its detail,
 * so one-code-at-the-boundary never loses diagnostic information.
 * @param {string} code Stable error code.
 * @param {string} message Log-safe message.
 * @param {unknown} cause Original error.
 * @returns {Error} Structured error with `detail.cause`.
 */
function mapWithCause(code, message, cause, detail = {}) {
  return createFilesystemError(code, message, { ...detail, cause: describeCause(cause) });
}

/**
 * Strips a leading byte-order mark from file text.
 * @param {unknown} text Raw file text.
 * @returns {string} Text without BOM.
 */
function stripBom(text) {
  return typeof text === 'string' ? text.replace(/^\uFEFF/, '') : '';
}

/**
 * Returns the bound storage service or fails clearly before activation.
 * @param {object} state References bound in prepare/activate ({ storage }).
 * @returns {object} Bound pey.storage.service.
 */
function requireStorage(state) {
  if (!state.storage) {
    throw createFilesystemError(
      'FILESYSTEM_STORAGE_UNAVAILABLE',
      `Required service is unavailable: ${STORAGE_SERVICE}`,
      { service: STORAGE_SERVICE },
    );
  }
  return state.storage;
}

/**
 * Shapes a stored shadow record into exactly the fields the manifest
 * declares for readShadow — the storage record's key/rootId bookkeeping
 * (implementation detail) never leaks through the service boundary.
 * @param {object|null} record Stored shadow record or null.
 * @returns {object|null} `{ root, path, base, draft, updatedAt }` or null.
 */
function toShadowView(record) {
  if (record === null || record === undefined) {
    return null;
  }
  return {
    root: record.root,
    path: record.path,
    base: record.base,
    draft: record.draft,
    updatedAt: record.updatedAt,
  };
}

/**
 * Creates the filesystem service over an environment adapter. Shadow methods
 * need the bound storage; entry methods delegate to the adapter and shape
 * the outcome. The service is stateful across the plugin lifecycle: after
 * `deactivate()` every method refuses with SERVICE_UNAVAILABLE.
 * @param {object} options Service dependencies.
 * @param {object} options.adapter Validated environment adapter.
 * @param {object} [options.state] Activation-bound references ({ storage }).
 * @returns {{service: object, deactivate: Function}} Service and lifecycle control.
 */
export function createService({ adapter, state: refs }) {
  const state = refs ?? {};
  if (!adapter) {
    throw createFilesystemError('FILESYSTEM_ADAPTER_INVALID', 'Environment adapter is required', {}, 'startup');
  }

  let available = true;

  /**
   * Refuses the call when the plugin is no longer active.
   * @returns {void}
   * @throws {object} SERVICE_UNAVAILABLE.
   */
  function assertAvailable() {
    if (!available) {
      throw createFilesystemError(SERVICE_UNAVAILABLE, 'Filesystem service is unavailable');
    }
  }

  /**
   * Shapes the adapter's pick output into exactly the declared entry fields.
   * The adapter is configurable third-party code: a malformed shape (a bare
   * string, an array, a missing name) must fail the pick as a structured
   * error — spreading a raw value would fabricate an entry object out of
   * garbage and hand it to the caller.
   * @param {unknown} picked Adapter pick outcome (non-null).
   * @returns {object} `{ name, path, handle }`.
   * @throws {object} FILESYSTEM_PICK_FAILED.
   */
  function shapePickedEntry(picked) {
    if (typeof picked !== 'object' || Array.isArray(picked)) {
      throw createFilesystemError('FILESYSTEM_PICK_FAILED', 'Environment picker returned an invalid entry', { reason: 'not-an-entry' });
    }
    return {
      name: typeof picked.name === 'string' ? picked.name : '',
      path: typeof picked.path === 'string' ? picked.path : (typeof picked.name === 'string' ? picked.name : ''),
      handle: picked.handle,
    };
  }

  /**
   * Resolves a STABLE root id for the picked entry: drafts must survive a
   * re-pick and a page reload, and the File System Access handle is
   * structured-cloneable, so the picked root's identity is persisted by
   * folder name on pey.storage and a re-pick of the SAME folder
   * (`handle.isSameEntry`) reuses the minted id instead of orphaning its
   * drafts. Best-effort: without storage, without a comparable handle, or
   * on registry failures the call falls back to a fresh id — a pick must
   * never fail over draft bookkeeping.
   * @param {object} entry Shaped picked entry ({ name, path, handle }).
   * @returns {Promise<string>} Root id (reused or freshly minted).
   */
  async function resolveRootId(entry) {
    const storage = state.storage;
    if (!storage || typeof entry.handle?.isSameEntry !== 'function' || entry.name.length === 0) {
      return makeRootId();
    }
    let stored = null;
    try {
      stored = (await storage.read(PICKED_ROOTS_COLLECTION, entry.name)) ?? null;
    } catch {
      stored = null;
    }
    if (stored && typeof stored.rootId === 'string' && stored.rootId.length > 0 && stored.handle) {
      try {
        if (await entry.handle.isSameEntry(stored.handle)) {
          try {
            await storage.write(PICKED_ROOTS_COLLECTION, { key: entry.name, name: entry.name, rootId: stored.rootId, handle: entry.handle });
          } catch {
            // The reuse decision stands even when the refresh cannot persist.
          }
          return stored.rootId;
        }
      } catch {
        // An isSameEntry failure falls through to a fresh id.
      }
    }
    const rootId = makeRootId();
    try {
      await storage.write(PICKED_ROOTS_COLLECTION, { key: entry.name, name: entry.name, rootId, handle: entry.handle });
    } catch {
      // Draft bookkeeping is best-effort; the pick itself succeeded.
    }
    return rootId;
  }

  const service = {
    /**
     * Reports which environment pickers exist and whether picked entries
     * can be written back (only handle-backed entries can).
     * @returns {Promise<object>} `{ directoryPicker, filePicker, writable }`.
     */
    async getCapabilities() {
      assertAvailable();
      try {
        // Shaped to exactly the fields the manifest declares: a partial or
        // malformed adapter report reads as "no" for every non-true field,
        // never leaking an undeclared shape through the boundary.
        const report = (await adapter.capabilities()) ?? {};
        return {
          directoryPicker: report.directoryPicker === true,
          filePicker: report.filePicker === true,
          writable: report.writable === true,
        };
      } catch (error) {
        if (error?.code === 'FILESYSTEM_ADAPTER_INVALID') {
          throw error;
        }
        throw mapWithCause('FILESYSTEM_ADAPTER_INVALID', 'Capability report failed', error);
      }
    },

    /**
     * Opens the environment directory picker. Null when no picker exists or
     * the user cancels — cancellation is an outcome, not a failure.
     * @returns {Promise<object|null>} `{ name, path, handle }` or null.
     */
    async pickDirectory() {
      assertAvailable();
      try {
        const picked = (await adapter.pickDirectory()) ?? null;
        if (picked === null) {
          return null;
        }
        const entry = shapePickedEntry(picked);
        return { ...entry, rootId: await resolveRootId(entry) };
      } catch (error) {
        if (error?.code === 'FILESYSTEM_PICK_FAILED') {
          throw error;
        }
        throw mapWithCause('FILESYSTEM_PICK_FAILED', 'Directory picker failed', error);
      }
    },

    /**
     * Opens the environment file picker. Null when no picker exists or
     * the user cancels.
     * @returns {Promise<object|null>} `{ name, path, handle, rootId }` or null.
     */
    async pickFile() {
      assertAvailable();
      try {
        const picked = (await adapter.pickFile()) ?? null;
        if (picked === null) {
          return null;
        }
        const entry = shapePickedEntry(picked);
        return { ...entry, rootId: await resolveRootId(entry) };
      } catch (error) {
        if (error?.code === 'FILESYSTEM_PICK_FAILED') {
          throw error;
        }
        throw mapWithCause('FILESYSTEM_PICK_FAILED', 'File picker failed', error);
      }
    },

    /**
     * Walks a picked directory through the adapter and keeps only Markdown
     * entries — which files matter is this service's decision, not the
     * platform's.
     * @param {object} directory Picked directory entry or raw handle.
     * @returns {Promise<Array>} `{ name, path, handle }` Markdown entries.
     */
    async listDirectory(directory) {
      assertAvailable();
      // A non-object argument is a caller mistake, not a walk failure: the
      // reasoned error lets the consumer tell "wrong input" from "the walk
      // itself failed".
      if (directory === null || typeof directory !== 'object') {
        throw createFilesystemError('FILESYSTEM_READ_FAILED', 'A picked directory entry is required', { reason: 'not-walkable' });
      }
      let entries;
      try {
        entries = await adapter.listEntries(directory.handle ?? directory);
      } catch (error) {
        if (error?.code === 'FILESYSTEM_READ_FAILED') {
          throw error;
        }
        throw mapWithCause('FILESYSTEM_READ_FAILED', 'Directory walk failed', error, { reason: 'walk-failed' });
      }
      if (!Array.isArray(entries)) {
        throw createFilesystemError('FILESYSTEM_READ_FAILED', 'Adapter returned no entry list', { reason: 'no-entry-list' });
      }
      // A name without a usable path cannot own a shadow key and would read
      // back as garbage — dropped, not published with an undefined path.
      return entries.filter((entry) => typeof entry?.path === 'string' && entry.path.length > 0 && isMarkdownName(entry?.name));
    },

    /**
     * Collects a flat file list (e.g. from a webkitdirectory input) into
     * entries and keeps only Markdown ones. Pure data shaping owned by this
     * service — no environment capability involved. The path is normalized
     * relative to the picked root (the leading folder segment of
     * webkitRelativePath is dropped), matching listDirectory's paths.
     * @param {Array} files Flat file list.
     * @returns {Promise<Array>} `{ name, path, file }` Markdown entries.
     */
    async collectEntries(files) {
      assertAvailable();
      if (!Array.isArray(files)) {
        throw createFilesystemError('FILESYSTEM_READ_FAILED', 'A flat file list is required');
      }
      const entries = files
        .filter((file) => file && typeof file.name === 'string')
        .map((file) => {
          const hasRelativePath = typeof file.webkitRelativePath === 'string' && file.webkitRelativePath.length > 0;
          const relativePath = hasRelativePath ? file.webkitRelativePath : file.name;
          // Only webkitRelativePath carries the picked root as its first
          // segment; a plain name is already the path — stripping a segment
          // there corrupted the name/path pair.
          const slashIndex = relativePath.indexOf('/');
          const path = hasRelativePath && slashIndex !== -1 ? relativePath.slice(slashIndex + 1) : relativePath;
          return { name: file.name, path, file };
        });
      const markdown = entries.filter((entry) => isMarkdownName(entry?.name) && entry.path.length > 0);
      // Two entries landing on the same path cannot both own the shadow key:
      // the second save would silently ERASE the first draft, so the
      // ambiguity fails loudly instead of destroying data.
      const seen = new Set();
      for (const entry of markdown) {
        if (seen.has(entry.path)) {
          throw createFilesystemError('FILESYSTEM_READ_FAILED', 'Two entries resolve to the same path', { reason: 'duplicate-path', path: entry.path });
        }
        seen.add(entry.path);
      }
      return markdown;
    },

    /**
     * Reads entry text through the adapter (permission round-trip inside)
     * and strips a leading byte-order mark.
     * @param {object} entry `{ name, path, handle?, file? }`.
     * @returns {Promise<string>} File text without BOM.
     */
    async readEntry(entry) {
      assertAvailable();
      let text;
      try {
        text = await adapter.readEntry(entry);
      } catch (error) {
        if (error?.code === 'FILESYSTEM_PERMISSION_DENIED') {
          throw error;
        }
        throw mapWithCause('FILESYSTEM_READ_FAILED', 'Entry read failed', error);
      }
      if (typeof text !== 'string') {
        throw createFilesystemError('FILESYSTEM_READ_FAILED', 'Entry read produced no text', { reason: 'no-text' });
      }
      return stripBom(text);
    },

    /**
     * Writes content through the adapter (readwrite-permission round-trip
     * inside). Null when the entry has no writable handle — the caller falls
     * back (e.g. to a download) instead of failing. A non-object entry is a
     * caller mistake and fails with a reasoned error instead of masquerading
     * as "nothing to write"; the result carries the entry's rootId so the
     * same file's shadow is addressable right after the write.
     * @param {object} entry `{ name, path, handle?, rootId? }`.
     * @param {string} content Text to write.
     * @returns {Promise<object|null>} `{ name, path, rootId? }` or null.
     */
    async writeEntry(entry, content) {
      assertAvailable();
      if (entry === null || typeof entry !== 'object') {
        throw createFilesystemError('FILESYSTEM_WRITE_FAILED', 'A writable entry is required', { reason: 'invalid-entry' });
      }
      if (typeof content !== 'string') {
        throw createFilesystemError('FILESYSTEM_WRITE_FAILED', 'Entry content must be text', { reason: 'content-not-text' });
      }
      try {
        const result = await adapter.writeEntry(entry, content);
        if (result === undefined) {
          // An adapter contract violation must not masquerade as the "no
          // writable handle" null that triggers the caller's download fallback.
          throw createFilesystemError('FILESYSTEM_WRITE_FAILED', 'Adapter produced no write result', { reason: 'no-result' });
        }
        if (result === null) {
          return null;
        }
        return typeof entry.rootId === 'string' && entry.rootId.length > 0
          ? { ...result, rootId: entry.rootId }
          : result;
      } catch (error) {
        if (error?.code === 'FILESYSTEM_PERMISSION_DENIED' || error?.code === 'FILESYSTEM_WRITE_FAILED') {
          throw error;
        }
        throw mapWithCause('FILESYSTEM_WRITE_FAILED', 'Entry write failed', error);
      }
    },

    /**
     * Persists a browser-side working copy of a device entry (disk bytes
     * untouched): the disk content at open (base) plus the current draft.
     * The first argument is preferably the picked entry (its minted rootId
     * keeps same-named folders distinct); a plain folder label string also
     * works. A pre-1.1.0 draft for the same entry is removed on save.
     * @param {object|string} rootOrEntry Picked entry or folder label.
     * @param {string} path Entry relative path.
     * @param {string} base Disk content the draft started from.
     * @param {string} draft Current unsaved text.
     * @returns {Promise<object>} `{ root, path, updatedAt }`.
     */
    async saveShadow(rootOrEntry, path, base, draft) {
      assertAvailable();
      const normalizedPath = normalizeShadowPath(path);
      const identity = shadowIdentity(rootOrEntry, normalizedPath);
      assertShadowText(base, 'base');
      assertShadowText(draft, 'draft');
      const storage = requireStorage(state);
      try {
        const record = {
          key: shadowKey(identity.id, normalizedPath),
          root: identity.label,
          path: normalizedPath,
          base,
          draft,
          updatedAt: Date.now(),
        };
        if (identity.hasRootId) {
          record.rootId = identity.id;
        }
        await storage.write(SHADOW_COLLECTION, record);
        // Migration of the pre-1.1.0 drafts happens ONLY in label mode: the
        // legacy keys are label-scoped (the 1.0.0 format could not tell
        // same-named folders apart), so an entry save with a rootId must
        // never delete another same-named folder's old draft — that
        // cross-folder delete was a data-loss bug.
        if (!identity.hasRootId) {
          await storage.delete(SHADOW_COLLECTION, legacyShadowKey(identity.label, normalizedPath)).catch(() => {});
          // The 1.0.0 webkitdirectory shape kept the picked root as the
          // first path segment; its key repeats the label.
          await storage.delete(SHADOW_COLLECTION, legacyShadowKey(identity.label, `${identity.label}/${normalizedPath}`)).catch(() => {});
        }
        return { root: identity.label, path: normalizedPath, updatedAt: record.updatedAt };
      } catch (error) {
        if (error?.code === 'FILESYSTEM_STORAGE_UNAVAILABLE') {
          throw error;
        }
        throw mapWithCause('FILESYSTEM_STORAGE_UNAVAILABLE', 'Shadow save failed', error);
      }
    },

    /**
     * Reads the stored working copy for an entry, or null when none exists.
     * A pre-1.1.0 draft (old key shape) is still found and returned.
     * @param {object|string} rootOrEntry Picked entry or folder label.
     * @param {string} path Entry relative path.
     * @returns {Promise<object|null>} Shadow record or null.
     */
    async readShadow(rootOrEntry, path) {
      assertAvailable();
      const normalizedPath = normalizeShadowPath(path);
      const identity = shadowIdentity(rootOrEntry, normalizedPath);
      const storage = requireStorage(state);
      const readOne = async (key) => {
        try {
          return await storage.read(SHADOW_COLLECTION, key);
        } catch (error) {
          if (error?.code === 'RECORD_NOT_FOUND') {
            return null;
          }
          if (error?.code === 'FILESYSTEM_STORAGE_UNAVAILABLE') {
            throw error;
          }
          throw mapWithCause('FILESYSTEM_STORAGE_UNAVAILABLE', 'Shadow read failed', error);
        }
      };
      const current = await readOne(shadowKey(identity.id, normalizedPath));
      if (current !== null && current !== undefined) {
        return toShadowView(current);
      }
      // Migration path: pre-1.1.0 drafts live under legacy keys — the 1.1.0
      // shape (label + root-relative path) and the 1.0.0 shape (label +
      // FULL webkitRelativePath, i.e. the label repeated as the first path
      // segment). The legacy space is label-scoped by design (the 1.0.0
      // format could not tell same-named folders apart), so the read-only
      // fallback consults the label space in both modes; nothing is ever
      // deleted or overwritten here.
      const legacy = await readOne(legacyShadowKey(identity.label, normalizedPath));
      if (legacy !== null && legacy !== undefined) {
        return toShadowView(legacy);
      }
      return toShadowView(await readOne(legacyShadowKey(identity.label, `${identity.label}/${normalizedPath}`)));
    },

    /**
     * Deletes the stored working copy (e.g. after an explicit disk save
     * made it redundant). Deleting a missing draft is a successful no-op;
     * both key shapes are cleared.
     * @param {object|string} rootOrEntry Picked entry or folder label.
     * @param {string} path Entry relative path.
     * @returns {Promise<void>}
     */
    async clearShadow(rootOrEntry, path) {
      assertAvailable();
      const normalizedPath = normalizeShadowPath(path);
      const identity = shadowIdentity(rootOrEntry, normalizedPath);
      const storage = requireStorage(state);
      const deleteOne = async (key) => {
        try {
          await storage.delete(SHADOW_COLLECTION, key);
        } catch (error) {
          if (error?.code === 'RECORD_NOT_FOUND') {
            return; // deleting a missing draft is a successful no-op
          }
          if (error?.code === 'FILESYSTEM_STORAGE_UNAVAILABLE') {
            throw error;
          }
          throw mapWithCause('FILESYSTEM_STORAGE_UNAVAILABLE', 'Shadow clear failed', error);
        }
      };
      await deleteOne(shadowKey(identity.id, normalizedPath));
      // Label mode owns the shared label space: both pre-1.1.0 key shapes
      // clear with it. RootId mode never touches the legacy keys — they
      // belong to whatever same-named folder wrote them, and a cross-folder
      // delete was a data-loss bug.
      if (!identity.hasRootId) {
        await deleteOne(legacyShadowKey(identity.label, normalizedPath)).catch(() => {});
        await deleteOne(legacyShadowKey(identity.label, `${identity.label}/${normalizedPath}`)).catch(() => {});
      }
    },
  };

  return {
    service,
    deactivate() {
      available = false;
    },
  };
}

export { PLUGIN_NAME, STORAGE_SERVICE };
