// Shadow identity and key rules for the pey.filesystem plugin.
//
// Identity comes from the picked entry (its minted rootId keeps same-named
// folders distinct); keys pair (id, path) injectively. The pre-1.1.0 key
// shape is kept only for reading and clearing old drafts.

import { createFilesystemError } from './error.js';

/**
 * Builds the collision-safe shadow key for an identity pair. The folder
 * label is display-only; the key pairs (id, path) injectively, so two
 * same-named folders minted their own root ids can never overwrite each
 * other's drafts.
 * @param {string} id Root identity (minted rootId or the label string).
 * @param {string} path Entry relative path.
 * @returns {string} Storage key.
 */
function shadowKey(id, path) {
  return JSON.stringify([id, path]);
}

/**
 * Builds the pre-1.1.0 shadow key, kept only for reading old drafts.
 * @param {string} root Folder label.
 * @param {string} path Entry relative path.
 * @returns {string} Legacy storage key.
 */
function legacyShadowKey(root, path) {
  return `${root}\n${path}`;
}

/**
 * Mints a unique-per-session root identity for a picked entry. The
 * platform offers no stable folder id, so identity is minted at pick time
 * and the caller carries it (the entry) into the shadow methods.
 * @returns {string} Root id.
 */
function makeRootId() {
  return `root-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Resolves the shadow identity from the first argument: either a picked
 * entry (preferred — its minted rootId makes same-named folders distinct)
 * or a plain folder label string.
 * @param {object|string} rootOrEntry Picked entry with rootId, or label.
 * @param {unknown} path Entry relative path.
 * @returns {{id: string, label: string, hasRootId: boolean}} Identity.
 * @throws {object} FILESYSTEM_INVALID_ENTRY.
 */
function shadowIdentity(rootOrEntry, path) {
  if (rootOrEntry !== null && typeof rootOrEntry === 'object') {
    if (typeof rootOrEntry.rootId !== 'string' || rootOrEntry.rootId.length === 0) {
      throw createFilesystemError('FILESYSTEM_INVALID_ENTRY', 'A shadow needs an entry with a rootId or a non-empty root label');
    }
    if (typeof path !== 'string' || path.length === 0) {
      throw createFilesystemError('FILESYSTEM_INVALID_ENTRY', 'A shadow needs a non-empty root and path');
    }
    return {
      id: rootOrEntry.rootId,
      label: typeof rootOrEntry.name === 'string' ? rootOrEntry.name : '',
      hasRootId: true,
    };
  }
  if (typeof rootOrEntry !== 'string' || rootOrEntry.length === 0 || typeof path !== 'string' || path.length === 0) {
    throw createFilesystemError('FILESYSTEM_INVALID_ENTRY', 'A shadow needs a non-empty root and path');
  }
  return { id: rootOrEntry, label: rootOrEntry, hasRootId: false };
}

/**
 * Validates a required text argument of the shadow methods.
 * @param {unknown} value Argument value.
 * @param {string} name Argument name for the message.
 * @returns {void}
 * @throws {object} FILESYSTEM_INVALID_ENTRY.
 */
function assertShadowText(value, name) {
  if (typeof value !== 'string') {
    throw createFilesystemError('FILESYSTEM_INVALID_ENTRY', `Shadow ${name} must be text`);
  }
}

export {
  assertShadowText,
  legacyShadowKey,
  makeRootId,
  shadowIdentity,
  shadowKey,
};
