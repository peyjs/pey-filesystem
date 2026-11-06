// Unit tests for lib/shadow-identity.js — identity resolution, the
// collision-safe key shape and the pre-1.1.0 legacy key.

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertShadowText, legacyShadowKey, makeRootId, shadowIdentity, shadowKey } from '../lib/shadow-identity.js';

test('should_resolve_the_identity_from_a_picked_entry_when_one_is_given', () => {
  const identity = shadowIdentity({ rootId: 'root-1', name: 'docs' }, 'a.md');

  assert.deepEqual(identity, { id: 'root-1', label: 'docs', hasRootId: true });
});

test('should_resolve_the_identity_from_a_label_string_when_no_entry_is_given', () => {
  const identity = shadowIdentity('docs', 'a.md');

  assert.deepEqual(identity, { id: 'docs', label: 'docs', hasRootId: false });
});

test('should_reject_the_identity_when_the_entry_has_no_root_id_or_the_path_is_empty', () => {
  assert.throws(() => shadowIdentity({ name: 'docs' }, 'a.md'), (error) => error.code === 'FILESYSTEM_INVALID_ENTRY');
  assert.throws(() => shadowIdentity({ rootId: 'root-1' }, ''), (error) => error.code === 'FILESYSTEM_INVALID_ENTRY');
  assert.throws(() => shadowIdentity('', 'a.md'), (error) => error.code === 'FILESYSTEM_INVALID_ENTRY');
  assert.throws(() => shadowIdentity(null, 'a.md'), (error) => error.code === 'FILESYSTEM_INVALID_ENTRY');
});

test('should_pair_id_and_path_injectively_when_building_the_modern_key', () => {
  // The JSON pair keeps same-named folders and same-named paths distinct.
  const first = shadowKey('root-1', 'a/b.md');
  const second = shadowKey('root-1/a', 'b.md');

  assert.notEqual(first, second);
  assert.equal(shadowKey('root-1', 'a.md'), JSON.stringify(['root-1', 'a.md']));
});

test('should_keep_modern_keys_injective_when_paths_or_labels_carry_separators', () => {
  // The legacy `root\npath` shape can collide ('docs'+'a\nb.md' vs
  // 'docs\na'+'b.md') — exactly why 1.1.0 moved to the JSON pair, which
  // is injective. The modern key never collides with the legacy one.
  assert.equal(legacyShadowKey('docs', 'a\nb.md'), legacyShadowKey('docs\na', 'b.md'), 'the known legacy ambiguity');
  assert.notEqual(shadowKey('docs', 'a\nb.md'), shadowKey('docs\na', 'b.md'));
  assert.notEqual(shadowKey('docs', 'a.md'), legacyShadowKey('docs', 'a.md'));
});

test('should_reject_non_text_shadow_arguments_when_validating', () => {
  assert.throws(() => assertShadowText(5, 'base'), (error) => error.code === 'FILESYSTEM_INVALID_ENTRY');
  assert.doesNotThrow(() => assertShadowText('', 'base'), 'an empty string is still text');
});

test('should_mint_distinct_root_ids_when_called_repeatedly', () => {
  assert.notEqual(makeRootId(), makeRootId());
  assert.match(makeRootId(), /^root-/);
});
