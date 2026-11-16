// Browser environment adapter for pey.filesystem: File System Access
// primitives (pickers, permission round-trips, handles) plus the plain-File
// fallback surface. Raw platform access only — Markdown filtering, error
// shaping and shadow drafts are the service's decisions.
import { createFilesystemError } from '../lib/error.js';

// Walk limits: a depth cap and a skip-list keep a huge tree from wedging
// the UI, and an unreadable subfolder is skipped instead of aborting the
// whole walk. Depth counts hops below the root (root files sit at 0), so a
// file inside sixteen nested folders is the last one found.
const MAX_WALK_DEPTH = 16;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules']);

/**
 * Returns true when a picker was aborted by the user (cancel), as opposed
 * to a real failure. Name-based: some engines raise DOMException subclasses
 * that are not `instanceof Error`.
 * @param {unknown} error Caught error.
 * @returns {boolean} True for user cancellation.
 */
function isAbort(error) {
  return error?.name === 'AbortError';
}

/**
 * Maps the browser's permission-loss error onto the structured
 * permission-denied error; anything else rides through unchanged so the
 * service can tell "permission was revoked mid-flight" from "the disk
 * failed".
 * @param {unknown} error Caught error.
 * @param {string} message Safe denial message.
 * @returns {object|unknown} The structured denial, or the original error.
 */
function mapPermissionFailure(error, message) {
  if (error?.name === 'NotAllowedError') {
    return createFilesystemError('FILESYSTEM_PERMISSION_DENIED', message, { cause: error?.message ?? String(error) });
  }
  return error;
}

/**
 * Runs the handle permission round-trip: granted stays silent, otherwise
 * one request goes out and anything but granted counts as denied. The
 * first underlying failure is kept for the denial's diagnostic cause.
 * A handle without the permission API is reported as unsupported — the
 * callers decide what "no permission surface" means (reads skip the
 * round-trip; writes read as an unwritable handle).
 * @param {object} handle File System Access handle.
 * @param {string} mode 'read' or 'readwrite'.
 * @returns {Promise<{allowed: boolean, cause: string|undefined, supported: boolean}>} Outcome.
 */
async function ensurePermission(handle, mode) {
  const supported = typeof handle?.queryPermission === 'function' && typeof handle?.requestPermission === 'function';
  if (!supported) {
    return { allowed: false, cause: undefined, supported: false };
  }
  let cause;
  let queried;
  try {
    queried = await handle.queryPermission({ mode });
  } catch (error) {
    cause = error?.message ?? String(error);
  }
  if (queried === 'granted') {
    return { allowed: true, cause: undefined, supported: true };
  }
  let requested;
  try {
    requested = await handle.requestPermission({ mode });
  } catch (error) {
    cause = cause ?? error?.message ?? String(error);
  }
  return { allowed: requested === 'granted', cause, supported: true };
}

/**
 * Creates the browser environment adapter.
 *
 * @param {object} [config={}] Adapter config; `scope` overrides the browser
 *   global for tests (an object carrying the pickers). A non-object scope
 *   falls back to the global.
 * @returns {object} Adapter implementing the environment contract.
 */
export function createBrowserEnvironmentAdapter(config = {}) {
  const scope = config.scope !== null && typeof config.scope === 'object' ? config.scope : globalThis;

  return {
    /**
     * Reports which environment pickers exist and whether picked entries
     * can be written back (only handle-backed entries can).
     * @returns {object} `{ directoryPicker, filePicker, writable }`.
     */
    capabilities() {
      const directoryPicker = typeof scope.showDirectoryPicker === 'function';
      const filePicker = typeof scope.showOpenFilePicker === 'function';
      return { directoryPicker, filePicker, writable: directoryPicker || filePicker };
    },

    /**
     * Opens the environment directory picker. Null when no picker exists or
     * the user cancels.
     * @returns {Promise<object|null>} `{ name, path, handle }` or null.
     */
    async pickDirectory() {
      if (typeof scope.showDirectoryPicker !== 'function') {
        return null;
      }
      try {
        const handle = await scope.showDirectoryPicker();
        if (!handle) {
          return null;
        }
        return { name: handle?.name ?? '', path: handle?.name ?? '', handle };
      } catch (error) {
        if (isAbort(error)) {
          return null;
        }
        throw createFilesystemError('FILESYSTEM_PICK_FAILED', 'Directory picker failed', { cause: error?.message ?? String(error) });
      }
    },

    /**
     * Opens the environment file picker. Null when no picker exists or the
     * user cancels.
     * @returns {Promise<object|null>} `{ name, path, handle }` or null.
     */
    async pickFile() {
      if (typeof scope.showOpenFilePicker !== 'function') {
        return null;
      }
      try {
        const picked = await scope.showOpenFilePicker();
        const handle = Array.isArray(picked) ? picked[0] ?? null : picked;
        if (!handle) {
          return null;
        }
        return { name: handle?.name ?? '', path: handle?.name ?? '', handle };
      } catch (error) {
        if (isAbort(error)) {
          return null;
        }
        throw createFilesystemError('FILESYSTEM_PICK_FAILED', 'File picker failed', { cause: error?.message ?? String(error) });
      }
    },

    /**
     * Walks a directory handle recursively and returns every file entry with
     * its relative path and own file handle. Flat and unfiltered — which
     * files matter is the service's decision. Bounded: depth is capped and
     * well-known infrastructure folders are skipped; an unreadable subfolder
     * is skipped rather than aborting the whole walk. The result is sorted
     * by path so the order is stable across environments.
     * @param {object} directory Directory handle to walk.
     * @returns {Promise<Array>} `{ name, path, handle }` entries.
     */
    async listEntries(directory) {
      if (!directory || typeof directory.values !== 'function') {
        throw createFilesystemError('FILESYSTEM_READ_FAILED', 'Directory entry is not walkable');
      }
      const entries = [];
      const walk = async (dir, prefix, depth, isRoot) => {
        if (depth > MAX_WALK_DEPTH) {
          return;
        }
        try {
          for await (const child of dir.values()) {
            if (child?.kind === 'file') {
              entries.push({ name: child.name, path: prefix ? `${prefix}/${child.name}` : child.name, handle: child });
            } else if (child?.kind === 'directory' && !SKIPPED_DIRECTORIES.has(child.name)) {
              await walk(child, prefix ? `${prefix}/${child.name}` : child.name, depth + 1, false);
            }
          }
        } catch (error) {
          // An unreadable subfolder contributes nothing; an unreadable ROOT
          // is a real failure — the caller asked to walk exactly that.
          if (isRoot) {
            throw error;
          }
          return;
        }
      };
      await walk(directory, '', 0, true);
      entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
      return entries;
    },

    /**
     * Reads entry text through its handle (read-permission round-trip) or
     * its plain file. No BOM handling here — that is the service's rule.
     * @param {object} entry `{ name, path, handle?, file? }`.
     * @returns {Promise<string>} File text.
     */
    async readEntry(entry) {
      if (entry?.file && typeof entry.file.text === 'function') {
        return entry.file.text();
      }
      if (entry?.handle && typeof entry.handle.getFile === 'function') {
        const permission = await ensurePermission(entry.handle, 'read');
        if (permission.supported && !permission.allowed) {
          throw createFilesystemError('FILESYSTEM_PERMISSION_DENIED', 'Read permission denied', { cause: permission.cause });
        }
        // Without a permission surface the read is attempted directly: a
        // handle that can read needs no round-trip, and a real failure
        // surfaces with its own cause instead of an unexplained denial.
        try {
          const file = await entry.handle.getFile();
          return await file.text();
        } catch (error) {
          throw mapPermissionFailure(error, 'Read permission denied');
        }
      }
      throw createFilesystemError('FILESYSTEM_READ_FAILED', 'Entry has nothing readable');
    },

    /**
     * Writes content through the entry handle (readwrite-permission
     * round-trip). Null when the entry has no writable handle — the caller
     * falls back (e.g. to a download) instead of failing. A failed write or
     * a failed close is a failed operation: the stream is aborted so no
     * half-written file commits, and the original error surfaces for the
     * service to map.
     * @param {object} entry `{ name, path, handle? }`.
     * @param {string} content Text to write.
     * @returns {Promise<object|null>} `{ name, path }` or null.
     */
    async writeEntry(entry, content) {
      if (!entry?.handle || typeof entry.handle.createWritable !== 'function') {
        return null;
      }
      const permission = await ensurePermission(entry.handle, 'readwrite');
      if (!permission.supported) {
        // No permission surface means the handle can never be granted
        // write access: an unwritable handle, not a denied request — the
        // caller falls back instead of surfacing a denial.
        return null;
      }
      if (!permission.allowed) {
        throw createFilesystemError('FILESYSTEM_PERMISSION_DENIED', 'Write permission denied', { cause: permission.cause });
      }
      let writable = null;
      try {
        writable = await entry.handle.createWritable();
        await writable.write(content);
        await writable.close();
        writable = null;
      } catch (error) {
        if (writable) {
          try {
            await writable.abort?.();
          } catch {
            // An abort that is missing, rejects, or throws synchronously
            // must never mask the ORIGINAL write error.
          }
        }
        throw mapPermissionFailure(error, 'Write permission denied');
      }
      return { name: entry.name, path: entry.path };
    },
  };
}
