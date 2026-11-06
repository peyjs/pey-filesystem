// Unit tests for lib/error.js — the pey.filesystem boundary error factory.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFilesystemError } from '../lib/error.js';

test('should_build_standard_structured_error_when_called_with_code_and_message', () => {
  const error = createFilesystemError('FILESYSTEM_READ_FAILED', 'The directory is not readable', { cause: 'boom' });

  assert.equal(error.code, 'FILESYSTEM_READ_FAILED');
  assert.equal(error.source, 'pey.filesystem');
  assert.equal(error.type, 'operational');
  assert.deepEqual(error.detail, { cause: 'boom' });
  assert.ok(!Number.isNaN(Date.parse(error.timestamp)));
});

test('should_accept_the_startup_type_when_the_loader_fails', () => {
  const error = createFilesystemError('FILESYSTEM_ADAPTER_NOT_FOUND', 'x', {}, 'startup');

  assert.equal(error.type, 'startup');
});

test('should_pass_the_given_code_and_type_through_when_built', () => {
  // Unlike some sibling factories this one does not validate the code —
  // every call site is plugin-internal, so the shape is guaranteed there.
  const error = createFilesystemError('anything', 'x');

  assert.equal(error.code, 'anything');
});
