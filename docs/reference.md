# pey.filesystem — Reference

Self-contained reference for the `pey.filesystem` platform plugin. The manifest (`manifest.json`) is always the authoritative contract; this document explains it.

## Purpose

Device file and folder access for the host. The portable logic lives here (Markdown filtering, BOM stripping, error shaping, the shadow-draft store); the raw platform primitives (pickers, permission round-trips, walking) sit behind the swappable environment adapter, and the plugin never touches the DOM itself.

## Structure

- `manifest.json` — plugin contract (identity, service, events, config).
- `index.js` — Bonyan two-phase entry point (`prepare` / `activate`): adapter load and wiring.
- `lib/filesystem-service.js` — service implementation (Markdown filter, BOM, errors, shadows).
- `lib/environment-loader.js` — environment-adapter loader and validator.
- `lib/shadow-identity.js` — shadow identity and keys (the modern `(rootId, path)` key and the pre-1.1.0 legacy shapes).
- `lib/error.js` — structured boundary error factory.
- `adapters/browser-environment-adapter.js` — the reference browser adapter (File System Access + plain-file fallback).
- `tests/` — plugin tests, the shared adapter contract suite and its fixtures.
- `docs/reference.md` — this file.
- `CHANGELOG.md` — the plugin's version history.

## Dependencies

- **Required:** `pey.storage.service` — shadow drafts go through its `disk-drafts` store (see Config for the required host configuration).
- **Optional:** none. The environment adapter is internal to the plugin and is not declared as an `adapterType` in the manifest (Bonyan rule: `adapterType` is for infrastructure plugins only).

## Public API

Service: `pey.filesystem.service`. Entry shape everywhere: `{ name, path, handle?, file?, rootId? }`. `pickDirectory`/`pickFile` return handle-backed entries (`path` equals the root name) stamped with a unique `rootId`; `listDirectory` returns handle-backed entries with root-relative paths (`sub/note.md`); `collectEntries` returns file-backed entries with root-relative paths (the first segment of `webkitRelativePath` — the root folder name — is stripped so paths align with `listDirectory`). "Markdown" means an extension of `.md` / `.markdown` / `.mdown` / `.txt`, case-insensitive.

- `getCapabilities()` → `{ directoryPicker, filePicker, writable }` — `writable` only reports the presence of pickers that can return writable handles; whether any given handle is truly writable depends on that handle's permission at write time (`writeEntry` returns `null` for an unwritable entry).
- `pickDirectory()` / `pickFile()` — through the environment adapter; `null` when no picker exists or the user cancels (cancel is detected by the `AbortError` name, not the class) — a result, not an error. Adapter output is shaped to exactly `{ name, path, handle }`; a malformed shape (string/array) is rejected with `FILESYSTEM_PICK_FAILED`. The root identity (`rootId`) is stable: the picked handle (structured-cloneable) is persisted with its rootId by folder name on storage, and a re-pick of the same folder (`handle.isSameEntry`) returns the same rootId so drafts survive a reload and a re-pick. Best-effort: without storage or a comparable handle, the pick falls back to a fresh id.
- `listDirectory(directory)` — the picked folder entry or a raw handle; recursive walking happens in the adapter, Markdown filtering in the service; the result is a flat list with relative paths. A non-object argument is rejected with `FILESYSTEM_READ_FAILED` (`reason: 'not-walkable'`); a walk failure carries `reason: 'walk-failed'`; path-less entries are dropped instead of being published with `undefined`.
- `collectEntries(files)` — flat-list shaping in the service; a non-array input yields `FILESYSTEM_READ_FAILED`. Name-less entries are dropped silently (consistent with the Markdown-only filter). The first-segment strip applies only to `webkitRelativePath`; two entries landing on the same path are rejected with `FILESYSTEM_READ_FAILED` (`reason: 'duplicate-path'`) so a draft can never be silently orphaned.
- `readEntry(entry)` — through the handle (a `read` permission round-trip in the adapter) or the plain file; a leading BOM is stripped in the service; a non-text adapter result is a structured error. A handle without a permission API is read directly; `NotAllowedError` mid-read maps to `FILESYSTEM_PERMISSION_DENIED`.
- `writeEntry(entry, content)` — through the handle (a `readwrite` permission round-trip in the adapter). A failed `write` or `close` fails the operation and the stream is aborted so no half-written file commits; the original error stays in `detail.cause`. When the entry has no writable handle (or no permission API) `null` is returned so the caller falls back (e.g. to a download); on success `{ name, path, rootId? }` is returned (the `rootId` carried from the entry). A non-object entry is rejected with `FILESYSTEM_WRITE_FAILED` (`reason: 'invalid-entry'`), not treated as `null`; an adapter that omits the result is rejected (`reason: 'no-result'`). `NotAllowedError` mid-write maps to `FILESYSTEM_PERMISSION_DENIED`; a failing `abort` never masks the original error.
- `saveShadow(rootOrEntry, path, base, draft)` — persists a shadow draft (the `disk-drafts` store on `pey.storage.service`): the on-disk base plus the current draft; returns `{ root, path, updatedAt }`. The first argument is preferably the picked entry (the stamped `rootId` keeps same-named folders apart); a plain label string is also accepted. `base` and `draft` must be strings (`FILESYSTEM_INVALID_ENTRY`) — they are never silently coerced to `''`; an entry without a `name` is rejected as well.
- `readShadow(rootOrEntry, path)` — the shadow record or `null`; the path is normalized (`./`, `//`, `..`). Pre-1.1.0 drafts are read through both legacy key shapes: the 1.1.0 label-scoped shape and the 1.0.0 webkitdirectory shape (the label repeated as the first path segment) — a read-only fallback into the shared label space; a draft saved under a label is found through the same route.
- `clearShadow(rootOrEntry, path)` — removes the shadow (e.g. after an explicit save to disk); clearing a non-existent record is a no-op success. In label mode both legacy key shapes are cleared too (migration); in rootId mode only this folder's modern key is cleared — a same-named folder's legacy key is never touched.

## Events

No domain events are published. The plugin listens to the system event `core:service-unavailable` during `prepare` so that a lost `pey.storage.service` is reported as a critical `REQUIRED_DEPENDENCY_LOST`; the report is deferred to a microtask so the core's delivery pass can finish first, and the subscription is released on shutdown/deactivation and on a repeated `prepare()`.

## Errors Reference

`source` is always `pey.filesystem`; mapped errors keep the original cause in `detail.cause`.

| Code | Situation | Type |
|---|---|---|
| `FILESYSTEM_PICK_FAILED` | The picker threw a non-cancel error, or the adapter's pick output was malformed. | operational |
| `FILESYSTEM_READ_FAILED` | Walking/reading/collecting impossible (non-object argument, duplicate paths, non-list/non-text adapter output, or an entry with nothing readable). | operational |
| `FILESYSTEM_WRITE_FAILED` | Writing impossible (non-text content, non-object entry, missing adapter result, or a failed `write`/`close`). | operational |
| `FILESYSTEM_PERMISSION_DENIED` | The user did not grant permission (query/request failures and `NotAllowedError`; cause in `detail.cause`). | operational |
| `FILESYSTEM_INVALID_ENTRY` | Invalid shadow-method input (empty root/path, non-text `base`/`draft`, name-less entry). | operational |
| `FILESYSTEM_STORAGE_UNAVAILABLE` | The storage service is unavailable or the `disk-drafts` store is not configured (shadow methods). | operational |
| `FILESYSTEM_ADAPTER_NOT_FOUND` / `FILESYSTEM_ADAPTER_INVALID` / `FILESYSTEM_ADAPTER_INITIALIZATION_FAILED` | Startup: the configured adapter could not be loaded, is incomplete, or failed to initialize. | startup |
| `FILESYSTEM_ADAPTER_INVALID` | Also used in `getCapabilities` with `type: 'operational'` (runtime capability-report failure); the code family is shared, the distinction is the `type`. | operational |
| `FILESYSTEM_EVENT_BUS_UNAVAILABLE` | The prepare context does not support the `core:service-unavailable` event (`detail.reason: 'missing-event-bus'`); a broken host wiring, not an adapter problem. | startup |
| `SERVICE_UNAVAILABLE` | Called after deactivation/shutdown. | operational |

## Config

| Key | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `adapter` | `string` | No | `'BrowserEnvironmentAdapter'` | The environment adapter to load. |
| `adapterConfig` | `object` | No | `{}` | Adapter config; `scope` overrides the browser global for tests (a non-object value falls back to the global). |

Host requirement for shadows: the storage service only accepts stores declared in its own config, so the host must declare the `disk-drafts` store in `bootstrap.json`:

```json
{
  "config": {
    "pey.storage": {
      "stores": [
        { "name": "disk-drafts", "keyPath": "key" }
      ]
    }
  }
}
```

Without it, `saveShadow` fails with `FILESYSTEM_STORAGE_UNAVAILABLE` (the original `STORE_NOT_FOUND` message stays in `detail.cause`). If the store is created with another `keyPath`, writes appear to succeed but the record is never read back by the `key` key — so `keyPath` must be exactly `key`.

## Business Rules

- After deactivation or shutdown every service method — including `getCapabilities` and the pickers — refuses with `SERVICE_UNAVAILABLE`; cleanup is idempotent and the `core:service-unavailable` subscription is released, so no critical report can fire afterwards.
- The plugin never reads or writes anything before the user picks it; "Markdown" is resolved by extension only.
- Shadow drafts are keyed by the collision-free pair `(root identity, path)`, so labels containing newline characters and same-named folders cannot collide; a label is a display identity only — using it means a shared shadow space among same-named folders (documented as such).
- Because File System Access gives no stable folder identity, the unique `rootId` is minted at pick time and persisted with the folder's handle so it survives reloads; a re-pick reuses it via `handle.isSameEntry`.
- Legacy (label-scoped) drafts are migrated on read and on save in label mode; entry mode never deletes legacy keys of a same-named folder.
- Directory walking is bounded: folders up to depth 16 are walked (root = depth 0; deeper files are skipped without any signal), `.git` and `node_modules` are skipped, an unreadable subfolder is skipped (an unreadable root is a failure), and the output is sorted by path for a stable order.

## Constraints

- The adapter implements six methods (`capabilities`, `pickDirectory`, `pickFile`, `listEntries`, `readEntry`, `writeEntry`); flat-list collection is pure data shaping and happens in the service, never in an adapter.
- The plugin does not render, interpret, or transform file content; it reads and writes text only.
- Do not use the pickers' `null` result as an error — it is the documented cancel/no-picker outcome; branch on structured error codes instead.
- Shadow storage is the plugin's private `disk-drafts` store; do not write its records by hand from the host.
