// Pey filesystem service: Markdown-focused file access over the plugin's
// environment adapter, plus browser-side shadow drafts on pey.storage.
//
// The service owns the decisions (which files matter, BOM handling, error
// shapes, shadow storage); the adapter owns the platform primitives
// (pickers, permissions, handles). The plugin never touches the DOM.
import { createFilesystemError, SERVICE_NAME } from './error.js';

const STORAGE_SERVICE = 'pey.storage.service';
const SHADOW_COLLECTION = 'disk-drafts';

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
 * Strips a leading byte-order mark from file text.
 * @param {string} text Raw file text.
 * @returns {string} Text without BOM.
 */
function stripBom(text) {
  return typeof text === 'string' ? text.replace(/^\uFEFF/, '') : '';
}

/**
 * Builds the shadow key for an entry (folder label plus relative path).
 * @param {string} root Folder label the entry was opened from.
 * @param {string} path Entry relative path.
 * @returns {string} Storage key.
 */
function shadowKey(root, path) {
  return `${root}\n${path}`;
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
 * Creates the filesystem service over an environment adapter. Shadow methods
 * need the bound storage; entry methods delegate to the adapter and shape
 * the outcome.
 * @param {object} options Service dependencies.
 * @param {object} options.adapter Validated environment adapter.
 * @param {object} [options.state] Activation-bound references ({ storage }).
 * @returns {object} Service implementation.
 */
export function createService({ adapter, state = {} }) {
  if (!adapter) {
    throw createFilesystemError('FILESYSTEM_ADAPTER_INVALID', 'Environment adapter is required', {}, 'startup');
  }

  return {
    /**
     * Reports which environment pickers exist and whether picked entries
     * can be written back (only handle-backed entries can).
     * @returns {Promise<object>} `{ directoryPicker, filePicker, writable }`.
     */
    async getCapabilities() {
      return adapter.capabilities();
    },

    /**
     * Opens the environment directory picker. Null when no picker exists or
     * the user cancels — cancellation is an outcome, not a failure.
     * @returns {Promise<object|null>} `{ name, path, handle }` or null.
     */
    async pickDirectory() {
      return adapter.pickDirectory();
    },

    /**
     * Opens the environment file picker. Null when no picker exists or the
     * user cancels.
     * @returns {Promise<object|null>} `{ name, path, handle }` or null.
     */
    async pickFile() {
      return adapter.pickFile();
    },

    /**
     * Walks a picked directory through the adapter and keeps only Markdown
     * entries — which files matter is this service's decision, not the
     * platform's.
     * @param {object} directory Picked directory entry or raw handle.
     * @returns {Promise<Array>} `{ name, path, handle }` Markdown entries.
     */
    async listDirectory(directory) {
      let entries;
      try {
        entries = await adapter.listEntries(directory?.handle ?? directory);
      } catch (error) {
        if (error?.code === 'FILESYSTEM_READ_FAILED') {
          throw error;
        }
        throw createFilesystemError('FILESYSTEM_READ_FAILED', 'Directory walk failed');
      }
      return entries.filter((entry) => isMarkdownName(entry?.name));
    },

    /**
     * Collects a flat file list (e.g. from a webkitdirectory input) through
     * the adapter and keeps only Markdown entries.
     * @param {Array} files Flat file list.
     * @returns {Promise<Array>} `{ name, path, file }` Markdown entries.
     */
    async collectEntries(files) {
      const entries = await adapter.collectEntries(files);
      return entries.filter((entry) => isMarkdownName(entry?.name));
    },

    /**
     * Reads entry text through the adapter (permission round-trip inside)
     * and strips a leading byte-order mark.
     * @param {object} entry `{ name, path, handle?, file? }`.
     * @returns {Promise<string>} File text without BOM.
     */
    async readEntry(entry) {
      let text;
      try {
        text = await adapter.readEntry(entry);
      } catch (error) {
        if (error?.code === 'FILESYSTEM_PERMISSION_DENIED') {
          throw error;
        }
        throw createFilesystemError('FILESYSTEM_READ_FAILED', 'Entry read failed');
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
      if (typeof content !== 'string') {
        throw createFilesystemError('FILESYSTEM_WRITE_FAILED', 'Entry content must be text');
      }
      try {
        return await adapter.writeEntry(entry, content);
      } catch (error) {
        if (error?.code === 'FILESYSTEM_PERMISSION_DENIED') {
          throw error;
        }
        throw createFilesystemError('FILESYSTEM_WRITE_FAILED', 'Entry write failed');
      }
    },

    /**
     * Persists a browser-side working copy of a device entry (disk bytes
     * untouched): the disk content at open (base) plus the current draft.
     * @param {string} root Folder label the entry was opened from.
     * @param {string} path Entry relative path.
     * @param {string} base Disk content the draft started from.
     * @param {string} draft Current unsaved text.
     * @returns {Promise<object>} `{ root, path, updatedAt }`.
     */
    async saveShadow(root, path, base, draft) {
      try {
        const record = {
          key: shadowKey(root, path),
          root,
          path,
          base: typeof base === 'string' ? base : '',
          draft: typeof draft === 'string' ? draft : '',
          updatedAt: Date.now(),
        };
        await requireStorage(state).write(SHADOW_COLLECTION, record);
        return { root, path, updatedAt: record.updatedAt };
      } catch (error) {
        if (error?.code === 'FILESYSTEM_STORAGE_UNAVAILABLE') {
          throw error;
        }
        throw createFilesystemError('FILESYSTEM_STORAGE_UNAVAILABLE', 'Shadow save failed');
      }
    },

    /**
     * Reads the stored working copy for an entry, or null when none exists.
     * @param {string} root Folder label the entry was opened from.
     * @param {string} path Entry relative path.
     * @returns {Promise<object|null>} Shadow record or null.
     */
    async readShadow(root, path) {
      try {
        return await requireStorage(state).read(SHADOW_COLLECTION, shadowKey(root, path));
      } catch (error) {
        if (error?.code === 'RECORD_NOT_FOUND') {
          return null;
        }
        if (error?.code === 'FILESYSTEM_STORAGE_UNAVAILABLE') {
          throw error;
        }
        throw createFilesystemError('FILESYSTEM_STORAGE_UNAVAILABLE', 'Shadow read failed');
      }
    },

    /**
     * Deletes the stored working copy (e.g. after an explicit disk save
     * made it redundant).
     * @param {string} root Folder label the entry was opened from.
     * @param {string} path Entry relative path.
     * @returns {Promise<void>}
     */
    async clearShadow(root, path) {
      try {
        await requireStorage(state).delete(SHADOW_COLLECTION, shadowKey(root, path));
      } catch (error) {
        if (error?.code === 'FILESYSTEM_STORAGE_UNAVAILABLE') {
          throw error;
        }
        throw createFilesystemError('FILESYSTEM_STORAGE_UNAVAILABLE', 'Shadow clear failed');
      }
    },
  };
}

export { STORAGE_SERVICE };
