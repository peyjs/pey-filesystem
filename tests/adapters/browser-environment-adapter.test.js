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

test('should_collect_flat_files_with_relative_paths', async () => {
  const adapter = createBrowserEnvironmentAdapter({ scope: {} });
  const file = (name, relativePath = '') => ({
    name,
    webkitRelativePath: relativePath,
    text: async () => '',
  });

  const entries = await adapter.collectEntries([
    file('a.md', 'docs/a.md'),
    file('pic.png', 'docs/pic.png'),
    file('b.txt'),
  ]);

  assert.deepEqual(entries.map(({ path }) => path), ['docs/a.md', 'docs/pic.png', 'b.txt']);
  assert.equal(typeof entries[0].file.text, 'function');
});

test('should_ignore_non_file_entries_when_collecting', async () => {
  const adapter = createBrowserEnvironmentAdapter({ scope: {} });
  const file = { name: 'a.md', text: async () => '' };

  assert.deepEqual(await adapter.collectEntries([null, 'nope', file]), [
    { name: 'a.md', path: 'a.md', file },
  ]);
});
