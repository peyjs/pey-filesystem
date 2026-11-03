// Verifies the environment-adapter loader: unknown, incomplete and broken
// adapters all fail with distinct structured startup errors.

import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEnvironmentAdapter } from '../lib/environment-loader.js';

const GOOD_ADAPTER = {
  capabilities: () => ({ directoryPicker: false, filePicker: false, writable: false }),
  pickDirectory: async () => null,
  pickFile: async () => null,
  listEntries: async () => [],
  readEntry: async () => '',
  writeEntry: async () => null,
};

test('should_load_and_validate_a_known_good_adapter', async () => {
  const adapter = await loadEnvironmentAdapter('FakeAdapter', {}, {
    FakeAdapter: async () => GOOD_ADAPTER,
  });
  assert.equal(adapter, GOOD_ADAPTER);
});

test('should_reject_an_unknown_adapter_with_a_startup_error', async () => {
  const error = await loadEnvironmentAdapter('NoSuchAdapter', {}, {}).catch((caught) => caught);
  assert.equal(error.code, 'FILESYSTEM_ADAPTER_NOT_FOUND');
  assert.equal(error.type, 'startup');
});

test('should_reject_a_non_string_identifier', async () => {
  const error = await loadEnvironmentAdapter(undefined, {}, {}).catch((caught) => caught);
  assert.equal(error.code, 'FILESYSTEM_ADAPTER_NOT_FOUND');
});

test('should_reject_an_adapter_missing_a_contract_method', async () => {
  const incomplete = { ...GOOD_ADAPTER };
  delete incomplete.writeEntry;

  const error = await loadEnvironmentAdapter('FakeAdapter', {}, {
    FakeAdapter: async () => incomplete,
  }).catch((caught) => caught);
  assert.equal(error.code, 'FILESYSTEM_ADAPTER_INVALID');
  assert.equal(error.type, 'startup');
});

test('should_reject_a_broken_adapter_factory_with_its_own_code', async () => {
  const error = await loadEnvironmentAdapter('BrokenAdapter', {}, {
    BrokenAdapter: async () => {
      throw new Error('wasm failed');
    },
  }).catch((caught) => caught);
  assert.equal(error.code, 'FILESYSTEM_ADAPTER_INITIALIZATION_FAILED');
  assert.equal(error.type, 'startup');
});

test('should_survive_a_null_loader_registry_argument', async () => {
  const adapter = await loadEnvironmentAdapter('BrowserEnvironmentAdapter', {}, null);
  assert.equal(typeof adapter.capabilities, 'function');
});
