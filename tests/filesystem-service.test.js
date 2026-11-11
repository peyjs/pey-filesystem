// Verifies pey.filesystem.service over the real browser environment adapter
// driven by a fake scope, with fake handles and files.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserEnvironmentAdapter } from '../adapters/browser-environment-adapter.js';
import { createService, isMarkdownName } from '../lib/filesystem-service.js';
import { fakeDirectoryHandle, fakeFileHandle, rejectsWithCode } from './environment-adapter-fixtures.js';
import { makeRootId } from '../lib/shadow-identity.js';

function createServiceWithScope(scope = {}, state = {}) {
  return createService({ adapter: createBrowserEnvironmentAdapter({ scope }), state }).service;
}

function fakeFile(name, text, relativePath = '') {
  return { name, webkitRelativePath: relativePath, text: async () => text };
}

function abortPicker() {
  throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
}

test('should_shape_a_partial_capability_report_to_the_declared_booleans_when_the_adapter_answers_loosely', async () => {
  // A partial adapter report never leaks through raw: every non-true field
  // reads as false, so the returned shape always matches the manifest.
  const looseAdapter = {
    capabilities: async () => ({ directoryPicker: true, filePicker: 'yes' }),
  };
  const service = createService({ adapter: looseAdapter, state: {} }).service;

  assert.deepEqual(await service.getCapabilities(), { directoryPicker: true, filePicker: false, writable: false });
});

test('should_match_markdown_names_when_the_extension_varies_in_case', () => {
  assert.equal(isMarkdownName('note.md'), true);
  assert.equal(isMarkdownName('NOTE.MARKDOWN'), true);
  assert.equal(isMarkdownName('a.mdown'), true);
  assert.equal(isMarkdownName('b.txt'), true);
  assert.equal(isMarkdownName('image.png'), false);
  assert.equal(isMarkdownName('md'), false);
  assert.equal(isMarkdownName(null), false);
});

test('should_report_missing_pickers_when_probing', async () => {
  const service = createServiceWithScope();
  assert.deepEqual(await service.getCapabilities(), { directoryPicker: false, filePicker: false, writable: false });
});

test('should_report_present_pickers_when_probing', async () => {
  const service = createServiceWithScope({
    showDirectoryPicker: async () => {},
    showOpenFilePicker: async () => {},
  });
  assert.deepEqual(await service.getCapabilities(), { directoryPicker: true, filePicker: true, writable: true });
});

test('should_return_entry_when_directory_picked', async () => {
  const handle = fakeDirectoryHandle('docs');
  const service = createServiceWithScope({ showDirectoryPicker: async () => handle });

  const picked = await service.pickDirectory();
  assert.equal(picked.name, 'docs');
  assert.equal(picked.path, 'docs');
  assert.equal(picked.handle, handle);
  assert.equal(typeof picked.rootId, 'string');
});

test('should_return_null_when_pick_is_unavailable_or_cancelled', async () => {
  const service = createServiceWithScope();
  assert.equal(await service.pickDirectory(), null);
  assert.equal(await service.pickFile(), null);

  const cancelling = createServiceWithScope({
    showDirectoryPicker: abortPicker,
    showOpenFilePicker: abortPicker,
  });
  assert.equal(await cancelling.pickDirectory(), null);
  assert.equal(await cancelling.pickFile(), null);
});

test('should_fail_structured_when_picker_throws', async () => {
  const failing = () => {
    throw new Error('boom');
  };
  const service = createServiceWithScope({ showDirectoryPicker: failing, showOpenFilePicker: failing });

  await rejectsWithCode(service.pickDirectory(), 'FILESYSTEM_PICK_FAILED');
  await rejectsWithCode(service.pickFile(), 'FILESYSTEM_PICK_FAILED');
});

test('should_unwrap_array_when_file_picked', async () => {
  const handle = fakeFileHandle('note.md', 'hi');
  const service = createServiceWithScope({ showOpenFilePicker: async () => [handle] });

  const picked = await service.pickFile();
  assert.equal(picked.name, 'note.md');
  assert.equal(picked.handle, handle);
  assert.equal(typeof picked.rootId, 'string');
});

test('should_list_markdown_recursively_when_walking', async () => {
  const service = createServiceWithScope();
  const root = fakeDirectoryHandle('root', [
    fakeFileHandle('a.md', 'a'),
    fakeFileHandle('pic.png', 'x'),
    fakeDirectoryHandle('sub', [
      fakeFileHandle('b.markdown', 'b'),
      fakeDirectoryHandle('deep', [fakeFileHandle('c.txt', 'c')]),
    ]),
  ]);

  const entries = await service.listDirectory(root);
  assert.deepEqual(entries.map(({ path }) => path), ['a.md', 'sub/b.markdown', 'sub/deep/c.txt']);
  assert.ok(entries.every(({ handle }) => handle?.kind === 'file'));
});

test('should_accept_a_picked_directory_entry_when_listing', async () => {
  const service = createServiceWithScope();
  const handle = fakeDirectoryHandle('docs', [fakeFileHandle('a.md', 'a'), fakeFileHandle('pic.png', 'x')]);

  const entries = await service.listDirectory({ name: 'docs', path: 'docs', handle });
  assert.deepEqual(entries.map(({ path }) => path), ['a.md']);
});

test('should_fail_structured_when_walk_fails', async () => {
  const service = createServiceWithScope();
  const broken = {
    kind: 'directory',
    name: 'broken',
    async *values() {
      throw new Error('gone');
    },
  };

  await rejectsWithCode(service.listDirectory(broken), 'FILESYSTEM_READ_FAILED');
});

test('should_collect_markdown_with_root_relative_paths_when_a_directory_is_picked', async () => {
  const service = createServiceWithScope();

  const entries = await service.collectEntries([
    fakeFile('a.md', 'a', 'docs/a.md'),
    fakeFile('nested.md', 'n', 'docs/sub/nested.md'),
    fakeFile('pic.png', 'x', 'docs/pic.png'),
    fakeFile('b.txt', 'b'),
  ]);
  assert.deepEqual(entries.map(({ path }) => path), ['a.md', 'sub/nested.md', 'b.txt']);
  assert.equal(typeof entries[0].file.text, 'function');
});

test('should_fail_structured_when_collecting_without_a_file_list', async () => {
  const service = createServiceWithScope();

  await rejectsWithCode(service.collectEntries('not a list'), 'FILESYSTEM_READ_FAILED');
  await rejectsWithCode(service.collectEntries(null), 'FILESYSTEM_READ_FAILED');
});

test('should_read_plain_file_when_entry_has_file', async () => {
  const service = createServiceWithScope();

  const text = await service.readEntry({ name: 'a.md', path: 'a.md', file: fakeFile('a.md', '\uFEFFسلام') });
  assert.equal(text, 'سلام');
});

test('should_read_handle_without_request_when_granted', async () => {
  const service = createServiceWithScope();
  const handle = fakeFileHandle('a.md', 'body');

  const text = await service.readEntry({ name: 'a.md', path: 'a.md', handle });
  assert.equal(text, 'body');
  assert.equal(handle.wasRequested(), false);
});

test('should_request_once_when_permission_is_pending', async () => {
  const service = createServiceWithScope();
  const handle = fakeFileHandle('a.md', 'body', 'prompt');

  const text = await service.readEntry({ name: 'a.md', path: 'a.md', handle });
  assert.equal(text, 'body');
  assert.equal(handle.wasRequested(), true);
});

test('should_fail_denied_when_read_is_refused', async () => {
  const service = createServiceWithScope();
  const handle = fakeFileHandle('a.md', 'body', 'denied');

  await rejectsWithCode(
    service.readEntry({ name: 'a.md', path: 'a.md', handle }),
    'FILESYSTEM_PERMISSION_DENIED',
  );
});

test('should_fail_structured_when_entry_is_unreadable', async () => {
  const service = createServiceWithScope();

  await rejectsWithCode(
    service.readEntry({ name: 'a.md', path: 'a.md' }),
    'FILESYSTEM_READ_FAILED',
  );
});

test('should_write_through_handle_when_permitted', async () => {
  const service = createServiceWithScope();
  const handle = fakeFileHandle('a.md', 'old');

  const result = await service.writeEntry({ name: 'a.md', path: 'a.md', handle }, 'new');
  assert.deepEqual(result, { name: 'a.md', path: 'a.md' });
  assert.equal(handle.written(), 'new');
});

test('should_return_null_when_entry_has_no_handle', async () => {
  const service = createServiceWithScope();

  assert.equal(
    await service.writeEntry({ name: 'a.md', path: 'a.md', file: fakeFile('a.md', 'x') }, 'new'),
    null,
  );
});

test('should_fail_denied_when_write_is_refused', async () => {
  const service = createServiceWithScope();
  const handle = fakeFileHandle('a.md', 'old', 'denied');

  await rejectsWithCode(
    service.writeEntry({ name: 'a.md', path: 'a.md', handle }, 'new'),
    'FILESYSTEM_PERMISSION_DENIED',
  );
});

test('should_fail_structured_when_write_throws', async () => {
  const service = createServiceWithScope();
  const handle = fakeFileHandle('a.md', 'old');
  handle.createWritable = async () => {
    throw new Error('disk gone');
  };

  await rejectsWithCode(
    service.writeEntry({ name: 'a.md', path: 'a.md', handle }, 'new'),
    'FILESYSTEM_WRITE_FAILED',
  );
});

test('should_fail_structured_when_content_is_not_text', async () => {
  const service = createServiceWithScope();
  const handle = fakeFileHandle('a.md', 'old');

  await rejectsWithCode(
    service.writeEntry({ name: 'a.md', path: 'a.md', handle }, null),
    'FILESYSTEM_WRITE_FAILED',
  );
});

function createStorage() {
  const records = new Map();
  return {
    records,
    async read(collection, key) {
      if (collection !== 'disk-drafts' || !records.has(key)) {
        throw Object.assign(new Error('missing'), { code: 'RECORD_NOT_FOUND' });
      }
      return records.get(key);
    },
    async write(collection, record) {
      if (collection !== 'disk-drafts') {
        throw new Error('unknown collection');
      }
      records.set(record.key, record);
    },
    async delete(collection, key) {
      records.delete(key);
    },
  };
}

test('should_save_and_read_shadow_when_storage_is_bound', async () => {
  const service = createServiceWithScope({}, { storage: createStorage() });

  const saved = await service.saveShadow('docs', 'a.md', 'base', 'draft');
  assert.equal(saved.root, 'docs');
  assert.equal(saved.path, 'a.md');
  assert.equal(typeof saved.updatedAt, 'number');

  const shadow = await service.readShadow('docs', 'a.md');
  assert.equal(shadow.base, 'base');
  assert.equal(shadow.draft, 'draft');
});

test('should_return_exactly_the_declared_shape_when_reading_a_shadow_that_leaks_storage_fields', async () => {
  // The storage record carries internal bookkeeping (key, rootId); the
  // service must shape the output to exactly the fields the manifest
  // declares — no implementation detail leaks through the boundary.
  const records = new Map();
  const storage = {
    async read(collection, key) {
      return records.get(key) ?? null;
    },
    async write(collection, record) {
      records.set(record.key, record);
    },
    async delete(collection, key) {
      records.delete(key);
    },
  };
  const service = createServiceWithScope({}, { storage });
  const entry = { name: 'docs', path: 'docs', rootId: makeRootId() };

  await service.saveShadow(entry, 'a.md', 'base', 'draft');
  const stored = [...records.values()][0];
  assert.ok('key' in stored && 'rootId' in stored, 'the storage record itself keeps its bookkeeping');

  const shadow = await service.readShadow(entry, 'a.md');
  assert.deepEqual(shadow, { root: 'docs', path: 'a.md', base: 'base', draft: 'draft', updatedAt: shadow.updatedAt });
  assert.equal(typeof shadow.updatedAt, 'number', 'updatedAt is pinned to the declared numeric type');
});

test('should_return_null_when_shadow_is_missing', async () => {
  const service = createServiceWithScope({}, { storage: createStorage() });

  assert.equal(await service.readShadow('docs', 'nope.md'), null);
});

test('should_clear_shadow_when_asked', async () => {
  const storage = createStorage();
  const service = createServiceWithScope({}, { storage });

  await service.saveShadow('docs', 'a.md', 'base', 'draft');
  await service.clearShadow('docs', 'a.md');
  assert.equal(await service.readShadow('docs', 'a.md'), null);
});

test('should_fail_storage_unavailable_when_unbound', async () => {
  const service = createServiceWithScope();

  await rejectsWithCode(service.saveShadow('docs', 'a.md', 'b', 'd'), 'FILESYSTEM_STORAGE_UNAVAILABLE');
  await rejectsWithCode(service.readShadow('docs', 'a.md'), 'FILESYSTEM_STORAGE_UNAVAILABLE');
  await rejectsWithCode(service.clearShadow('docs', 'a.md'), 'FILESYSTEM_STORAGE_UNAVAILABLE');
});

test('should_keep_same_named_roots_shadows_independent_when_roots_are_picked_twice', async () => {
  const storage = createStorage();
  const service = createServiceWithScope({
    showDirectoryPicker: async () => fakeDirectoryHandle('docs'),
  }, { storage });

  // Two picks of two different folders that happen to share a name.
  const first = await service.pickDirectory();
  const second = await service.pickDirectory();
  assert.notEqual(first.rootId, second.rootId);

  await service.saveShadow(first, 'notes.md', 'base-one', 'draft-one');
  await service.saveShadow(second, 'notes.md', 'base-two', 'draft-two');

  const one = await service.readShadow(first, 'notes.md');
  const two = await service.readShadow(second, 'notes.md');

  assert.equal(one.draft, 'draft-one');
  assert.equal(two.draft, 'draft-two');

  // Clearing one root's draft leaves the other untouched.
  await service.clearShadow(first, 'notes.md');
  assert.equal(await service.readShadow(first, 'notes.md'), null);
  assert.equal((await service.readShadow(second, 'notes.md')).draft, 'draft-two');
});

test('should_keep_label_string_shadows_working_and_distinct_when_labels_carry_newlines', async () => {
  const storage = createStorage();
  const service = createServiceWithScope({}, { storage });

  const saved = await service.saveShadow('docs', 'a.md', 'base', 'draft');
  assert.deepEqual(saved, { root: 'docs', path: 'a.md', updatedAt: saved.updatedAt });
  assert.equal((await service.readShadow('docs', 'a.md')).draft, 'draft');

  await service.saveShadow('a\nb', 'c', 'base1', 'draft1');
  await service.saveShadow('a', 'b\nc', 'base2', 'draft2');

  assert.equal((await service.readShadow('a\nb', 'c')).draft, 'draft1');
  assert.equal((await service.readShadow('a', 'b\nc')).draft, 'draft2');
});

test('should_reject_invalid_shadow_identity_and_text_when_arguments_are_malformed', async () => {
  const storage = createStorage();
  const service = createServiceWithScope({}, { storage });

  await rejectsWithCode(service.saveShadow(undefined, 'a.md', 'b', 'd'), 'FILESYSTEM_INVALID_ENTRY');
  await rejectsWithCode(service.saveShadow('docs', '', 'b', 'd'), 'FILESYSTEM_INVALID_ENTRY');
  await rejectsWithCode(service.saveShadow('docs', 'a.md', 42, 'd'), 'FILESYSTEM_INVALID_ENTRY');
  await rejectsWithCode(service.saveShadow('docs', 'a.md', 'b', null), 'FILESYSTEM_INVALID_ENTRY');
  await rejectsWithCode(service.readShadow(undefined, 'a.md'), 'FILESYSTEM_INVALID_ENTRY');
  await rejectsWithCode(service.clearShadow('docs', null), 'FILESYSTEM_INVALID_ENTRY');
  assert.equal(storage.records.size, 0);
});

test('should_still_find_pre_110_drafts_and_migrate_them_when_a_new_shadow_is_saved', async () => {
  const storage = createStorage();
  // A pre-1.1.0 draft under the legacy key shape.
  storage.records.set('docs\na.md', { key: 'docs\na.md', root: 'docs', path: 'a.md', base: 'old-base', draft: 'old-draft', updatedAt: 1 });
  const service = createServiceWithScope({}, { storage });

  const legacy = await service.readShadow('docs', 'a.md');
  assert.equal(legacy.draft, 'old-draft');

  await service.saveShadow('docs', 'a.md', 'base', 'new-draft');
  const migrated = await service.readShadow('docs', 'a.md');
  assert.equal(migrated.draft, 'new-draft');
  assert.equal(storage.records.has('docs\na.md'), false);
});

test('should_clear_both_key_shapes_and_tolerate_missing_drafts_when_a_shadow_is_cleared', async () => {
  const storage = createStorage();
  storage.records.set('docs\na.md', { key: 'docs\na.md', root: 'docs', path: 'a.md', base: '', draft: 'x', updatedAt: 1 });
  const service = createServiceWithScope({}, { storage });

  // A legacy-only draft is cleared through the modern call.
  await service.clearShadow('docs', 'a.md');
  assert.equal(storage.records.size, 0);

  // Clearing again (nothing there) succeeds silently.
  await service.clearShadow('docs', 'a.md');
  assert.equal(await service.readShadow('docs', 'a.md'), null);
});

test('should_return_null_when_storage_answers_undefined', async () => {
  const service = createServiceWithScope({}, {
    storage: { async read() { return undefined; }, async write() {}, async delete() {} },
  });

  assert.equal(await service.readShadow('docs', 'a.md'), null);
});

// --- adapter-output validation and cause preservation ---------------------

function stubAdapter(overrides = {}) {
  return {
    capabilities: async () => ({ directoryPicker: false, filePicker: false, writable: false }),
    pickDirectory: async () => null,
    pickFile: async () => null,
    listEntries: async () => [],
    readEntry: async () => 'text',
    writeEntry: async () => ({ name: 'a.md', path: 'a.md' }),
    ...overrides,
  };
}

test('should_fail_structured_when_the_adapter_returns_no_entry_list', async () => {
  const service = createService({ adapter: stubAdapter({ listEntries: async () => null }), state: {} }).service;

  await rejectsWithCode(service.listDirectory({}), 'FILESYSTEM_READ_FAILED');
});

test('should_fail_structured_when_the_adapter_returns_no_text', async () => {
  const service = createService({ adapter: stubAdapter({ readEntry: async () => 42 }), state: {} }).service;

  await rejectsWithCode(service.readEntry({ name: 'a.md', path: 'a.md' }), 'FILESYSTEM_READ_FAILED');
});

test('should_default_capabilities_when_the_adapter_answers_nothing', async () => {
  const service = createService({ adapter: stubAdapter({ capabilities: async () => undefined }), state: {} }).service;

  assert.deepEqual(await service.getCapabilities(), { directoryPicker: false, filePicker: false, writable: false });
});

test('should_map_capability_failures_to_a_structured_error_when_the_adapter_breaks', async () => {
  const service = createService({ adapter: stubAdapter({ capabilities: async () => { throw new Error('scope gone'); } }), state: {} }).service;

  await rejectsWithCode(service.getCapabilities(), 'FILESYSTEM_ADAPTER_INVALID');
});

test('should_keep_the_original_error_as_cause_when_mapping', async () => {
  const service = createService({ adapter: stubAdapter({
    writeEntry: async () => { throw new Error('disk quota exceeded'); },
  }), state: {} }).service;

  const error = await service.writeEntry({ name: 'a.md', path: 'a.md' }, 'new').catch((caught) => caught);
  assert.equal(error.code, 'FILESYSTEM_WRITE_FAILED');
  assert.equal(error.detail.cause, 'disk quota exceeded');
});

// --- integration: the full pick → list → read → shadow → write → clear path

test('should_run_the_full_entry_lifecycle_and_keep_the_draft_until_a_disk_save_clears_it', async () => {
  const storage = createStorage();
  const scope = {
    showDirectoryPicker: async () => fakeDirectoryHandle('docs', [fakeFileHandle('note.md', '\uFEFFمتن روی دیسک')]),
  };
  const service = createServiceWithScope(scope, { storage });

  // Pick → list → read:
  const picked = await service.pickDirectory();
  const entries = await service.listDirectory(picked);
  assert.deepEqual(entries.map(({ path }) => path), ['note.md']);
  const text = await service.readEntry(entries[0]);
  assert.equal(text, 'متن روی دیسک');

  // The draft survives while the disk save has not happened:
  await service.saveShadow(picked, 'note.md', text, 'متن ویرایش‌شده');
  assert.equal((await service.readShadow(picked, 'note.md')).draft, 'متن ویرایش‌شده');

  // A failed disk write keeps the draft intact:
  const failing = fakeFileHandle('note.md', text);
  failing.createWritable = async () => { throw new Error('disk gone'); };
  await rejectsWithCode(
    service.writeEntry({ name: 'note.md', path: 'note.md', handle: failing }, 'متن جدید'),
    'FILESYSTEM_WRITE_FAILED',
  );
  assert.equal((await service.readShadow(picked, 'note.md')).draft, 'متن ویرایش‌شده');

  // A successful disk write makes the draft redundant:
  const okHandle = fakeFileHandle('note.md', text);
  await service.writeEntry({ name: 'note.md', path: 'note.md', handle: okHandle }, 'متن جدید');
  await service.clearShadow(picked, 'note.md');
  assert.equal(await service.readShadow(picked, 'note.md'), null);
});

// --- real storage failures in the shadow methods ---------------------------

test('should_fail_structured_when_storage_rejects_the_shadow_save', async () => {
  const failingStorage = {
    read: async () => {
      throw Object.assign(new Error('missing'), { code: 'RECORD_NOT_FOUND' });
    },
    write: async () => {
      throw new Error('quota exceeded');
    },
    delete: async () => {},
  };
  const service = createService({ adapter: stubAdapter({}), state: { storage: failingStorage } }).service;

  await rejectsWithCode(
    service.saveShadow({ rootId: 'root-1', name: 'docs' }, 'a.md', 'base', 'draft'),
    'FILESYSTEM_STORAGE_UNAVAILABLE',
  );
});

test('should_fail_structured_when_storage_rejects_the_shadow_read', async () => {
  const failingStorage = {
    read: async () => {
      throw new Error('indexeddb gone');
    },
    write: async () => {},
    delete: async () => {},
  };
  const service = createService({ adapter: stubAdapter({}), state: { storage: failingStorage } }).service;

  await rejectsWithCode(
    service.readShadow({ rootId: 'root-1', name: 'docs' }, 'a.md'),
    'FILESYSTEM_STORAGE_UNAVAILABLE',
  );
});

test('should_fail_structured_when_storage_rejects_the_shadow_clear', async () => {
  const failingStorage = {
    read: async () => {
      throw Object.assign(new Error('missing'), { code: 'RECORD_NOT_FOUND' });
    },
    write: async () => {},
    delete: async () => {
      throw new Error('indexeddb gone');
    },
  };
  const service = createService({ adapter: stubAdapter({}), state: { storage: failingStorage } }).service;

  await rejectsWithCode(
    service.clearShadow({ rootId: 'root-1', name: 'docs' }, 'a.md'),
    'FILESYSTEM_STORAGE_UNAVAILABLE',
  );
});

test('should_keep_errors_mapped_when_the_shadow_save_causes_a_coded_failure', async () => {
  // The adapter passthrough branch: a coded storage failure rides through
  // unchanged instead of being double-wrapped.
  const coded = Object.assign(new Error('storage down'), { code: 'FILESYSTEM_STORAGE_UNAVAILABLE' });
  const failingStorage = {
    read: async () => {
      throw Object.assign(new Error('missing'), { code: 'RECORD_NOT_FOUND' });
    },
    write: async () => {
      throw coded;
    },
    delete: async () => {},
  };
  const service = createService({ adapter: stubAdapter({}), state: { storage: failingStorage } }).service;

  await assert.rejects(
    () => service.saveShadow({ rootId: 'root-1', name: 'docs' }, 'a.md', 'base', 'draft'),
    (error) => error === coded,
  );
});
