// Verifies the Browser environment adapter contract with fake pickers,
// handles and files — no DOM, no real browser.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserEnvironmentAdapter } from '../../adapters/browser-environment-adapter.js';

function fakeFileHandle(name, text, permission = 'granted') {
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

function fakeDirectoryHandle(name, children = []) {
  return {
    kind: 'directory',
    name,
    async *values() {
      yield* children;
    },
  };
}

function rejectsWithCode(promise, code) {
  return assert.rejects(promise, (error) => error?.code === code);
}

test('should_report_missing_pickers_when_scope_has_none', () => {
  const adapter = createBrowserEnvironmentAdapter({ scope: {} });
  assert.deepEqual(adapter.capabilities(), { directoryPicker: false, filePicker: false, writable: false });
});

test('should_report_present_pickers_when_scope_has_them', () => {
  const adapter = createBrowserEnvironmentAdapter({
    scope: { showDirectoryPicker: async () => {}, showOpenFilePicker: async () => {} },
  });
  assert.deepEqual(adapter.capabilities(), { directoryPicker: true, filePicker: true, writable: true });
});

test('should_return_null_when_picking_without_a_picker', async () => {
  const adapter = createBrowserEnvironmentAdapter({ scope: {} });
  assert.equal(await adapter.pickDirectory(), null);
  assert.equal(await adapter.pickFile(), null);
});

test('should_return_entry_when_directory_picked', async () => {
  const handle = fakeDirectoryHandle('docs');
  const adapter = createBrowserEnvironmentAdapter({
    scope: { showDirectoryPicker: async () => handle },
  });

  assert.deepEqual(await adapter.pickDirectory(), { name: 'docs', path: 'docs', handle });
});

test('should_return_null_when_directory_pick_is_cancelled', async () => {
  const adapter = createBrowserEnvironmentAdapter({
    scope: {
      showDirectoryPicker: () => {
        throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      },
    },
  });

  assert.equal(await adapter.pickDirectory(), null);
});

test('should_fail_structured_when_directory_picker_fails', async () => {
  const adapter = createBrowserEnvironmentAdapter({
    scope: {
      showDirectoryPicker: () => {
        throw new Error('boom');
      },
    },
  });

  await rejectsWithCode(adapter.pickDirectory(), 'FILESYSTEM_PICK_FAILED');
});

test('should_unwrap_array_when_file_picked', async () => {
  const handle = fakeFileHandle('note.md', 'hi');
  const adapter = createBrowserEnvironmentAdapter({
    scope: { showOpenFilePicker: async () => [handle] },
  });

  assert.deepEqual(await adapter.pickFile(), { name: 'note.md', path: 'note.md', handle });
});

test('should_return_null_when_file_pick_is_cancelled', async () => {
  const adapter = createBrowserEnvironmentAdapter({
    scope: {
      showOpenFilePicker: () => {
        throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      },
    },
  });

  assert.equal(await adapter.pickFile(), null);
});

test('should_list_every_file_recursively_when_walking', () => {
  const root = fakeDirectoryHandle('root', [
    fakeFileHandle('a.md', 'a'),
    fakeFileHandle('pic.png', 'x'),
    fakeDirectoryHandle('sub', [
      fakeFileHandle('b.markdown', 'b'),
      fakeDirectoryHandle('deep', [fakeFileHandle('c.txt', 'c')]),
    ]),
  ]);
  const adapter = createBrowserEnvironmentAdapter({ scope: {} });

  return adapter.listEntries(root).then((entries) => {
    assert.deepEqual(entries.map(({ path }) => path), ['a.md', 'pic.png', 'sub/b.markdown', 'sub/deep/c.txt']);
    assert.ok(entries.every(({ handle }) => handle?.kind === 'file'));
  });
});

test('should_fail_structured_when_directory_is_not_walkable', async () => {
  const adapter = createBrowserEnvironmentAdapter({ scope: {} });

  await rejectsWithCode(adapter.listEntries(null), 'FILESYSTEM_READ_FAILED');
});

test('should_read_plain_file_when_entry_has_file', async () => {
  const adapter = createBrowserEnvironmentAdapter({ scope: {} });

  assert.equal(
    await adapter.readEntry({ name: 'a.md', path: 'a.md', file: { text: async () => '\uFEFFسلام' } }),
    '\uFEFFسلام',
  );
});

test('should_read_handle_without_request_when_granted', async () => {
  const handle = fakeFileHandle('a.md', 'body');
  const adapter = createBrowserEnvironmentAdapter({ scope: {} });

  assert.equal(await adapter.readEntry({ name: 'a.md', path: 'a.md', handle }), 'body');
  assert.equal(handle.wasRequested(), false);
});

test('should_request_once_when_permission_is_pending', async () => {
  const handle = fakeFileHandle('a.md', 'body', 'prompt');
  const adapter = createBrowserEnvironmentAdapter({ scope: {} });

  assert.equal(await adapter.readEntry({ name: 'a.md', path: 'a.md', handle }), 'body');
  assert.equal(handle.wasRequested(), true);
});

test('should_fail_denied_when_read_is_refused', async () => {
  const handle = fakeFileHandle('a.md', 'body', 'denied');
  const adapter = createBrowserEnvironmentAdapter({ scope: {} });

  await rejectsWithCode(adapter.readEntry({ name: 'a.md', path: 'a.md', handle }), 'FILESYSTEM_PERMISSION_DENIED');
});

test('should_fail_structured_when_entry_is_unreadable', async () => {
  const adapter = createBrowserEnvironmentAdapter({ scope: {} });

  await rejectsWithCode(adapter.readEntry({ name: 'a.md', path: 'a.md' }), 'FILESYSTEM_READ_FAILED');
});

test('should_write_through_handle_when_permitted', async () => {
  const handle = fakeFileHandle('a.md', 'old');
  const adapter = createBrowserEnvironmentAdapter({ scope: {} });

  assert.deepEqual(await adapter.writeEntry({ name: 'a.md', path: 'a.md', handle }, 'new'), {
    name: 'a.md',
    path: 'a.md',
  });
  assert.equal(handle.written(), 'new');
});

test('should_return_null_when_entry_has_no_handle', async () => {
  const adapter = createBrowserEnvironmentAdapter({ scope: {} });

  assert.equal(
    await adapter.writeEntry({ name: 'a.md', path: 'a.md', file: { text: async () => 'x' } }, 'new'),
    null,
  );
});

test('should_fail_denied_when_write_is_refused', async () => {
  const handle = fakeFileHandle('a.md', 'old', 'denied');
  const adapter = createBrowserEnvironmentAdapter({ scope: {} });

  await rejectsWithCode(adapter.writeEntry({ name: 'a.md', path: 'a.md', handle }, 'new'), 'FILESYSTEM_PERMISSION_DENIED');
});

// --- write/close failure matrix, abort, cancellation detection, walk bounds

function writableSpies({ writeFails = false, closeFails = false } = {}) {
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

test('should_succeed_when_write_and_close_both_succeed', async () => {
  const adapter = createBrowserEnvironmentAdapter({ scope: {} });
  const handle = fakeFileHandle('a.md', 'old');
  const spy = writableSpies();
  handle.createWritable = async () => spy.writable;

  const result = await adapter.writeEntry({ name: 'a.md', path: 'a.md', handle }, 'new');
  assert.deepEqual(result, { name: 'a.md', path: 'a.md' });
  assert.deepEqual(spy.calls, { write: 1, close: 1, abort: 0 });
});

test('should_fail_and_abort_when_write_fails_and_close_succeeds', async () => {
  const adapter = createBrowserEnvironmentAdapter({ scope: {} });
  const handle = fakeFileHandle('a.md', 'old');
  const spy = writableSpies({ writeFails: true });
  handle.createWritable = async () => spy.writable;

  // The adapter surfaces the raw failure; the service maps it.
  await assert.rejects(adapter.writeEntry({ name: 'a.md', path: 'a.md', handle }, 'new'), (error) => error === spy.writeError);
  assert.equal(spy.calls.abort, 1);
});

test('should_fail_when_close_fails_after_a_successful_write', async () => {
  const adapter = createBrowserEnvironmentAdapter({ scope: {} });
  const handle = fakeFileHandle('a.md', 'old');
  const spy = writableSpies({ closeFails: true });
  handle.createWritable = async () => spy.writable;

  // A failed close must not surface as a fake success.
  await assert.rejects(adapter.writeEntry({ name: 'a.md', path: 'a.md', handle }, 'new'), (error) => error === spy.closeError);
  assert.equal(spy.calls.abort, 1);
});

test('should_fail_with_the_original_write_error_when_both_fail', async () => {
  const adapter = createBrowserEnvironmentAdapter({ scope: {} });
  const handle = fakeFileHandle('a.md', 'old');
  const spy = writableSpies({ writeFails: true, closeFails: true });
  handle.createWritable = async () => spy.writable;

  // The original write error survives a simultaneous close failure.
  const error = await adapter.writeEntry({ name: 'a.md', path: 'a.md', handle }, 'new').catch((caught) => caught);
  assert.equal(error, spy.writeError);
  assert.equal(spy.calls.abort, 1);
});

test('should_treat_name_based_aborts_as_user_cancellation', async () => {
  // DOMException instances are not `instanceof Error` on some engines.
  const domLike = { name: 'AbortError', message: 'user aborted' };
  const cancelling = createBrowserEnvironmentAdapter({
    scope: { showDirectoryPicker: async () => { throw domLike; } },
  });
  assert.equal(await cancelling.pickDirectory(), null);
});

test('should_bound_the_walk_and_skip_infrastructure_folders', async () => {
  const adapter = createBrowserEnvironmentAdapter({ scope: {} });
  const file = (name) => ({ kind: 'file', name });
  const deep = (level) => {
    if (level === 0) {
      return fakeDirectoryHandle(`d${level}`, [file('bottom.md')]);
    }
    return fakeDirectoryHandle(`d${level}`, [deep(level - 1)]);
  };
  const root = fakeDirectoryHandle('root', [
    file('a.md'),
    fakeDirectoryHandle('.git', [file('config.md')]),
    fakeDirectoryHandle('node_modules', [file('lib.md')]),
    deep(20),
  ]);

  const entries = await adapter.listEntries(root);
  const paths = entries.map(({ path }) => path);
  assert.equal(paths.includes('a.md'), true);
  assert.equal(paths.some((path) => path.startsWith('.git/')), false);
  assert.equal(paths.some((path) => path.startsWith('node_modules/')), false);
  // Depth-capped: the 20-level chain stops at 16.
  assert.equal(paths.some((path) => path.split('/').length > 16), false);
  // Stable order.
  assert.deepEqual([...paths].sort(), paths);
});

test('should_skip_an_unreadable_subfolder_instead_of_aborting_the_walk', async () => {
  const adapter = createBrowserEnvironmentAdapter({ scope: {} });
  const broken = {
    kind: 'directory',
    name: 'locked',
    async *values() {
      throw new Error('not allowed');
    },
  };
  const root = fakeDirectoryHandle('root', [fakeFileHandle('a.md', 'a'), broken]);

  const entries = await adapter.listEntries(root);
  assert.deepEqual(entries.map(({ path }) => path), ['a.md']);
});

test('should_fall_back_to_the_global_scope_when_scope_is_not_an_object', () => {
  const adapter = createBrowserEnvironmentAdapter({ scope: null });
  assert.equal(typeof adapter.capabilities().directoryPicker, 'boolean');
});

test('should_keep_the_permission_failure_cause_on_denial', async () => {
  const adapter = createBrowserEnvironmentAdapter({ scope: {} });
  const handle = {
    kind: 'file',
    name: 'a.md',
    async queryPermission() {
      throw new Error('SecurityError: blocked');
    },
    async requestPermission() {
      throw new Error('SecurityError: still blocked');
    },
    async getFile() {
      return { text: async () => 'x' };
    },
  };

  const error = await adapter.readEntry({ name: 'a.md', path: 'a.md', handle }).catch((caught) => caught);
  assert.equal(error.code, 'FILESYSTEM_PERMISSION_DENIED');
  assert.equal(error.detail.cause, 'SecurityError: blocked');
});
