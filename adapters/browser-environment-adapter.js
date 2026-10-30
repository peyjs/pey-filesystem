// Browser environment adapter for pey.filesystem: File System Access
// primitives (pickers, permission round-trips, handles) plus the plain-File
// fallback surface. Raw platform access only — Markdown filtering, error
// shaping and shadow drafts are the service's decisions.
import { createFilesystemError } from '../lib/error.js';

/**
 * Returns true when a picker was aborted by the user (cancel), as opposed
 * to a real failure.
 * @param {unknown} error Caught error.
 * @returns {boolean} True for user cancellation.
 */
function isAbort(error) {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Runs the handle permission round-trip: granted stays silent, otherwise
 * one request goes out and anything but granted counts as denied.
 * @param {object} handle File System Access handle.
 * @param {string} mode 'read' or 'readwrite'.
 * @returns {Promise<boolean>} True when the operation may proceed.
 */
async function ensurePermission(handle, mode) {
  const queried = await handle.queryPermission?.({ mode }).catch(() => undefined);
  if (queried === 'granted') {
    return true;
  }
  const requested = await handle.requestPermission?.({ mode }).catch(() => undefined);
  return requested === 'granted';
}

/**
 * Creates the browser environment adapter.
 *
 * @param {object} [config={}] Adapter config; `scope` overrides the browser
 *   global for tests (an object carrying the pickers).
 * @returns {object} Adapter implementing the environment contract.
 */
export function createBrowserEnvironmentAdapter(config = {}) {
  const scope = config.scope ?? globalThis;

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
        throw createFilesystemError('FILESYSTEM_PICK_FAILED', 'Directory picker failed');
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
        throw createFilesystemError('FILESYSTEM_PICK_FAILED', 'File picker failed');
      }
    },

    /**
     * Walks a directory handle recursively and returns every file entry with
     * its relative path and own file handle. Flat and unfiltered — which
     * files matter is the service's decision.
     * @param {object} directory Directory handle to walk.
     * @returns {Promise<Array>} `{ name, path, handle }` entries.
     */
    async listEntries(directory) {
      if (!directory || typeof directory.values !== 'function') {
        throw createFilesystemError('FILESYSTEM_READ_FAILED', 'Directory entry is not walkable');
      }
      const entries = [];
      const walk = async (dir, prefix) => {
        for await (const child of dir.values()) {
          if (child?.kind === 'file') {
            entries.push({ name: child.name, path: prefix ? `${prefix}/${child.name}` : child.name, handle: child });
          } else if (child?.kind === 'directory') {
            await walk(child, prefix ? `${prefix}/${child.name}` : child.name);
          }
        }
      };
      await walk(directory, '');
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
        if (!await ensurePermission(entry.handle, 'read')) {
          throw createFilesystemError('FILESYSTEM_PERMISSION_DENIED', 'Read permission denied');
        }
        const file = await entry.handle.getFile();
        return file.text();
      }
      throw createFilesystemError('FILESYSTEM_READ_FAILED', 'Entry has nothing readable');
    },

    /**
     * Writes content through the entry handle (readwrite-permission
     * round-trip). Null when the entry has no writable handle — the caller
     * falls back (e.g. to a download) instead of failing.
     * @param {object} entry `{ name, path, handle? }`.
     * @param {string} content Text to write.
     * @returns {Promise<object|null>} `{ name, path }` or null.
     */
    async writeEntry(entry, content) {
      if (!entry?.handle || typeof entry.handle.createWritable !== 'function') {
        return null;
      }
      if (!await ensurePermission(entry.handle, 'readwrite')) {
        throw createFilesystemError('FILESYSTEM_PERMISSION_DENIED', 'Write permission denied');
      }
      const writable = await entry.handle.createWritable();
      try {
        await writable.write(content);
      } finally {
        await writable.close().catch(() => {});
      }
      return { name: entry.name, path: entry.path };
    },

    /**
     * Collects a flat file list (e.g. from a webkitdirectory input) into
     * entries, keeping each file for reading. Unfiltered — which files
     * matter is the service's decision.
     * @param {Array} files Flat file list.
     * @returns {Promise<Array>} `{ name, path, file }` entries.
     */
    async collectEntries(files) {
      const list = Array.isArray(files) ? files : [];
      return list
        .filter((file) => file && typeof file.name === 'string')
        .map((file) => ({
          name: file.name,
          path: typeof file.webkitRelativePath === 'string' && file.webkitRelativePath.length > 0
            ? file.webkitRelativePath
            : file.name,
          file,
        }));
    },
  };
}
