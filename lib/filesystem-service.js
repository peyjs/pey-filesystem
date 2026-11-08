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
  shadowIdentity,
  shadowKey,
} from './shadow-identity.js';

const STORAGE_SERVICE = 'pey.storage.service';
const SHADOW_COLLECTION = 'disk-drafts';
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
function mapWithCause(code, message, cause) {
  return createFilesystemError(code, message, { cause: describeCause(cause) });
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

  const service = {
    /**
     * Reports which environment pickers exist and whether picked entries
     * can be written back (only handle-backed entries can).
     * @returns {Promise<object>} `{ directoryPicker, filePicker, writable }`.
     */
    async getCapabilities() {
      assertAvailable();
      try {
        return (await adapter.capabilities()) ?? { directoryPicker: false, filePicker: false, writable: false };
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
        return picked ? { ...picked, rootId: makeRootId() } : null;
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
        return picked ? { ...picked, rootId: makeRootId() } : null;
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
      let entries;
      try {
        entries = await adapter.listEntries(directory?.handle ?? directory);
      } catch (error) {
        if (error?.code === 'FILESYSTEM_READ_FAILED') {
          throw error;
        }
        throw mapWithCause('FILESYSTEM_READ_FAILED', 'Directory walk failed', error);
      }
      if (!Array.isArray(entries)) {
        throw createFilesystemError('FILESYSTEM_READ_FAILED', 'Adapter returned no entry list');
      }
      return entries.filter((entry) => isMarkdownName(entry?.name));
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
          const relativePath = typeof file.webkitRelativePath === 'string' && file.webkitRelativePath.length > 0
            ? file.webkitRelativePath
            : file.name;
          // webkitRelativePath carries the picked root as its first
          // segment; listDirectory paths are relative to that root.
          const slashIndex = relativePath.indexOf('/');
          const path = slashIndex !== -1 ? relativePath.slice(slashIndex + 1) : relativePath;
          return { name: file.name, path, file };
        });
      return entries.filter((entry) => isMarkdownName(entry?.name) && entry.path.length > 0);
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
        throw createFilesystemError('FILESYSTEM_READ_FAILED', 'Entry read produced no text');
      }
      return stripBom(text);
    },

    /**
     * Writes content through the adapter (readwrite-permission round-trip
     * inside). Null when the entry has no writable handle — the caller falls
     * back (e.g. to a download) instead of failing.
     * @param {object} entry `{ name, path, handle? }`.
     * @param {string} content Text to write.
     * @returns {Promise<object|null>} `{ name, path }` or null.
     */
    async writeEntry(entry, content) {
      assertAvailable();
      if (typeof content !== 'string') {
        throw createFilesystemError('FILESYSTEM_WRITE_FAILED', 'Entry content must be text');
      }
      try {
        return (await adapter.writeEntry(entry, content)) ?? null;
      } catch (error) {
        if (error?.code === 'FILESYSTEM_PERMISSION_DENIED') {
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
      const identity = shadowIdentity(rootOrEntry, path);
      assertShadowText(base, 'base');
      assertShadowText(draft, 'draft');
      const storage = requireStorage(state);
      try {
        const record = {
          key: shadowKey(identity.id, path),
          root: identity.label,
          path,
          base,
          draft,
          updatedAt: Date.now(),
        };
        if (identity.hasRootId) {
          record.rootId = identity.id;
        }
        await storage.write(SHADOW_COLLECTION, record);
        // Migration: a pre-1.1.0 draft for the same entry has done its job.
        await storage.delete(SHADOW_COLLECTION, legacyShadowKey(identity.label, path)).catch(() => {});
        return { root: identity.label, path, updatedAt: record.updatedAt };
      } catch (error) {
        if (error?.code === 'FILESYSTEM_STORAGE_UNAVAILABLE' || error?.code === 'FILESYSTEM_INVALID_ENTRY') {
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
      const identity = shadowIdentity(rootOrEntry, path);
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
      const current = await readOne(shadowKey(identity.id, path));
      if (current !== null && current !== undefined) {
        return toShadowView(current);
      }
      // Migration path: a pre-1.1.0 draft lives under the legacy key.
      return toShadowView(await readOne(legacyShadowKey(identity.label, path)));
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
      const identity = shadowIdentity(rootOrEntry, path);
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
      await deleteOne(shadowKey(identity.id, path));
      // The legacy shape is best-effort: its absence must never fail the
      // clear of the modern key.
      await deleteOne(legacyShadowKey(identity.label, path)).catch(() => {});
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
