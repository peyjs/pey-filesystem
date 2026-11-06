// Verifies the Browser environment adapter's own specifics (global scope
// fallback) and runs the shared adapter contract suite against it — the
// same suite every future environment adapter (Capacitor, Tauri, …) must
// pass. No DOM, no real browser.

import { createBrowserEnvironmentAdapter } from '../../adapters/browser-environment-adapter.js';
import { runEnvironmentAdapterContractSuite } from '../environment-adapter-contract.js';
import assert from 'node:assert/strict';
import test from 'node:test';

runEnvironmentAdapterContractSuite('browser', ({ scope }) => createBrowserEnvironmentAdapter({ scope }));

test('should_fall_back_to_the_global_scope_when_scope_is_not_an_object', () => {
  const adapter = createBrowserEnvironmentAdapter({ scope: null });
  assert.equal(typeof adapter.capabilities().directoryPicker, 'boolean');
});
