// Reusable environment-adapter contract suite for pey.filesystem.
//
// Every adapter implementation (current and future — Capacitor, Tauri, …)
// must pass this suite; requirement §4 makes passing it the bar for adding
// an environment. The suite drives the adapter only through its public
// contract methods and the shared fixture shapes.
//
// Usage: runEnvironmentAdapterContractSuite('label', ({ scope }) => adapter).

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fakeDirectoryHandle,
  fakeFileHandle,
  rejectsWithCode,
  writableSpies,
} from './environment-adapter-fixtures.js';

/**
 * Runs the whole adapter contract suite against one factory.
 * @param {string} label Suite label (implementation name).
 * @param {Function} createAdapter `({ scope }) => adapter`.
 * @returns {void}
 */
export function runEnvironmentAdapterContractSuite(label, createAdapter) {
  test(`[${label}] should_report_picker_capabilities_when_probed`, () => {
    const missing = createAdapter({ scope: {} });
    assert.deepEqual(missing.capabilities(), { directoryPicker: false, filePicker: false, writable: false });

    const present = createAdapter({
      scope: { showDirectoryPicker: async () => {}, showOpenFilePicker: async () => {} },
    });
    assert.deepEqual(present.capabilities(), { directoryPicker: true, filePicker: true, writable: true });
  });

  test(`[${label}] should_return_null_when_picking_without_a_picker`, async () => {
    const adapter = createAdapter({ scope: {} });
    assert.equal(await adapter.pickDirectory(), null);
    assert.equal(await adapter.pickFile(), null);
  });

  test(`[${label}] should_return_the_entry_when_a_directory_is_picked`, async () => {
    const handle = fakeDirectoryHandle('docs');
    const adapter = createAdapter({ scope: { showDirectoryPicker: async () => handle } });

    assert.deepEqual(await adapter.pickDirectory(), { name: 'docs', path: 'docs', handle });
  });

  test(`[${label}] should_return_null_when_a_pick_is_cancelled`, async () => {
    const abort = () => {
      throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
    };
    const directory = createAdapter({ scope: { showDirectoryPicker: abort } });
    const file = createAdapter({ scope: { showOpenFilePicker: abort } });

    assert.equal(await directory.pickDirectory(), null);
    assert.equal(await file.pickFile(), null);
  });

  test(`[${label}] should_fail_structured_with_the_original_cause_when_a_picker_fails_for_real`, async () => {
    const boom = () => {
      throw new Error('boom');
    };
    const directory = createAdapter({ scope: { showDirectoryPicker: boom } });
    const file = createAdapter({ scope: { showOpenFilePicker: boom } });

    const directoryError = await directory.pickDirectory().catch((caught) => caught);
    assert.equal(directoryError.code, 'FILESYSTEM_PICK_FAILED');
    assert.equal(directoryError.detail.cause, 'boom', 'the platform failure stays in detail.cause');
    const fileError = await file.pickFile().catch((caught) => caught);
    assert.equal(fileError.code, 'FILESYSTEM_PICK_FAILED');
    assert.equal(fileError.detail.cause, 'boom', 'the platform failure stays in detail.cause');
  });

  test(`[${label}] should_unwrap_the_array_when_a_file_is_picked`, async () => {
    const handle = fakeFileHandle('note.md', 'hi');
    const adapter = createAdapter({ scope: { showOpenFilePicker: async () => [handle] } });

    assert.deepEqual(await adapter.pickFile(), { name: 'note.md', path: 'note.md', handle });
  });

  test(`[${label}] should_list_every_file_recursively_when_walking`, async () => {
    const root = fakeDirectoryHandle('root', [
      fakeFileHandle('a.md', 'a'),
      fakeFileHandle('pic.png', 'x'),
      fakeDirectoryHandle('sub', [
        fakeFileHandle('b.markdown', 'b'),
        fakeDirectoryHandle('deep', [fakeFileHandle('c.txt', 'c')]),
      ]),
    ]);
    const adapter = createAdapter({ scope: {} });

    const entries = await adapter.listEntries(root);
    assert.deepEqual(entries.map(({ path }) => path), ['a.md', 'pic.png', 'sub/b.markdown', 'sub/deep/c.txt']);
    assert.ok(entries.every(({ handle }) => handle?.kind === 'file'));
  });

  test(`[${label}] should_fail_structured_when_the_root_is_not_walkable`, async () => {
    const adapter = createAdapter({ scope: {} });

    await rejectsWithCode(adapter.listEntries(null), 'FILESYSTEM_READ_FAILED');
  });

  test(`[${label}] should_read_plain_files_and_handles_when_reading_entries`, async () => {
    const adapter = createAdapter({ scope: {} });

    assert.equal(
      await adapter.readEntry({ name: 'a.md', path: 'a.md', file: { text: async () => '\uFEFFسلام' } }),
      '\uFEFFسلام',
    );
    const granted = fakeFileHandle('a.md', 'body');
    assert.equal(await adapter.readEntry({ name: 'a.md', path: 'a.md', handle: granted }), 'body');
    assert.equal(granted.wasRequested(), false);
  });

  test(`[${label}] should_request_permission_once_when_it_is_pending`, async () => {
    const handle = fakeFileHandle('a.md', 'body', 'prompt');
    const adapter = createAdapter({ scope: {} });

    assert.equal(await adapter.readEntry({ name: 'a.md', path: 'a.md', handle }), 'body');
    assert.equal(handle.wasRequested(), true);
  });

  test(`[${label}] should_fail_denied_when_read_or_write_is_refused`, async () => {
    const adapter = createAdapter({ scope: {} });
    const readDenied = fakeFileHandle('a.md', 'body', 'denied');
    const writeDenied = fakeFileHandle('a.md', 'old', 'denied');

    await rejectsWithCode(adapter.readEntry({ name: 'a.md', path: 'a.md', handle: readDenied }), 'FILESYSTEM_PERMISSION_DENIED');
    await rejectsWithCode(adapter.writeEntry({ name: 'a.md', path: 'a.md', handle: writeDenied }, 'new'), 'FILESYSTEM_PERMISSION_DENIED');
  });

  test(`[${label}] should_fail_structured_when_an_entry_is_unreadable`, async () => {
    const adapter = createAdapter({ scope: {} });

    await rejectsWithCode(adapter.readEntry({ name: 'a.md', path: 'a.md' }), 'FILESYSTEM_READ_FAILED');
  });

  test(`[${label}] should_write_through_the_handle_when_permitted`, async () => {
    const adapter = createAdapter({ scope: {} });
    const handle = fakeFileHandle('a.md', 'old');

    assert.deepEqual(await adapter.writeEntry({ name: 'a.md', path: 'a.md', handle }, 'new'), {
      name: 'a.md',
      path: 'a.md',
    });
    assert.equal(handle.written(), 'new');
  });

  test(`[${label}] should_return_null_when_writing_an_entry_without_a_handle`, async () => {
    const adapter = createAdapter({ scope: {} });

    assert.equal(
      await adapter.writeEntry({ name: 'a.md', path: 'a.md', file: { text: async () => 'x' } }, 'new'),
      null,
    );
  });

  test(`[${label}] should_cover_the_write_close_failure_matrix_with_abort`, async () => {
    const adapter = createAdapter({ scope: {} });

    const success = fakeFileHandle('a.md', 'old');
    const ok = writableSpies();
    success.createWritable = async () => ok.writable;
    await adapter.writeEntry({ name: 'a.md', path: 'a.md', handle: success }, 'new');
    assert.deepEqual(ok.calls, { write: 1, close: 1, abort: 0 });

    const writeFail = fakeFileHandle('a.md', 'old');
    const writeSpy = writableSpies({ writeFails: true });
    writeFail.createWritable = async () => writeSpy.writable;
    await assert.rejects(
      adapter.writeEntry({ name: 'a.md', path: 'a.md', handle: writeFail }, 'new'),
      (error) => error === writeSpy.writeError,
    );
    assert.equal(writeSpy.calls.abort, 1);

    const closeFail = fakeFileHandle('a.md', 'old');
    const closeSpy = writableSpies({ closeFails: true });
    closeFail.createWritable = async () => closeSpy.writable;
    await assert.rejects(
      adapter.writeEntry({ name: 'a.md', path: 'a.md', handle: closeFail }, 'new'),
      (error) => error === closeSpy.closeError,
    );
    assert.equal(closeSpy.calls.abort, 1);

    const bothFail = fakeFileHandle('a.md', 'old');
    const bothSpy = writableSpies({ writeFails: true, closeFails: true });
    bothFail.createWritable = async () => bothSpy.writable;
    const error = await adapter.writeEntry({ name: 'a.md', path: 'a.md', handle: bothFail }, 'new').catch((caught) => caught);
    assert.equal(error, bothSpy.writeError, 'the original write error survives a simultaneous close failure');
    assert.equal(bothSpy.calls.abort, 1);
  });

  test(`[${label}] should_treat_name_based_aborts_as_user_cancellation`, async () => {
    // DOMException instances are not `instanceof Error` on some engines.
    const domLike = { name: 'AbortError', message: 'user aborted' };
    const cancelling = createAdapter({ scope: { showDirectoryPicker: async () => { throw domLike; } } });

    assert.equal(await cancelling.pickDirectory(), null);
  });

  test(`[${label}] should_bound_the_walk_and_skip_infrastructure_folders`, async () => {
    const adapter = createAdapter({ scope: {} });
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

  test(`[${label}] should_skip_an_unreadable_subfolder_instead_of_aborting_the_walk`, async () => {
    const adapter = createAdapter({ scope: {} });
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

  test(`[${label}] should_keep_the_permission_failure_cause_on_denial`, async () => {
    const adapter = createAdapter({ scope: {} });
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
}
