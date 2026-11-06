import assert from 'node:assert/strict';

// Shared fixture builders for environment-adapter tests: fake handles,
// directories, writables and rejection helpers. These shapes are the
// adapter contract's own data language, so every implementation's suite
// drives the same fixtures.

/**
 * Builds a fake file handle with permission state and a writable.
 * @param {string} name File name.
 * @param {string} text File content.
 * @param {string} permission Initial permission state.
 * @returns {object} Fake handle with inspection helpers.
 */
export function fakeFileHandle(name, text, permission = 'granted') {
  const state = { permission, written: null, requested: false };
  return {
    kind: 'file',
    name,
    written: () => state.written,
    wasRequested: () => state.requested,
    async queryPermission() {
      return state.permission;
    },
    async requestPermission() {
      state.requested = true;
      if (state.permission !== 'denied') {
        state.permission = 'granted';
      }
      return state.permission;
    },
    async getFile() {
      return { text: async () => text };
    },
    async createWritable() {
      return {
        write: async (content) => {
          state.written = content;
        },
        close: async () => {},
      };
    },
  };
}

/**
 * Builds a fake directory handle over child entries.
 * @param {string} name Directory name.
 * @param {Array} children Child handles.
 * @returns {object} Fake directory handle.
 */
export function fakeDirectoryHandle(name, children = []) {
  return {
    kind: 'directory',
    name,
    async *values() {
      yield* children;
    },
  };
}

/**
 * Builds a writable whose write/close can be made to fail, with call spies.
 * @param {object} [options] Failure switches.
 * @param {boolean} [options.writeFails] Make write throw.
 * @param {boolean} [options.closeFails] Make close throw.
 * @returns {object} `{ writable, calls, writeError, closeError }`.
 */
export function writableSpies({ writeFails = false, closeFails = false } = {}) {
  const calls = { write: 0, close: 0, abort: 0 };
  const writeError = new Error('disk full');
  const closeError = new Error('close failed');
  const writable = {
    write: async () => {
      calls.write += 1;
      if (writeFails) {
        throw writeError;
      }
    },
    close: async () => {
      calls.close += 1;
      if (closeFails) {
        throw closeError;
      }
    },
    abort: async () => {
      calls.abort += 1;
    },
  };
  return { writable, calls, writeError, closeError };
}

/**
 * Asserts the promise rejects with the given structured code.
 * @param {Promise} promise Promise under test.
 * @param {string} code Expected error code.
 * @returns {Promise} Assertion promise.
 */
export function rejectsWithCode(promise, code) {
  return assert.rejects(promise, (error) => error?.code === code);
}

