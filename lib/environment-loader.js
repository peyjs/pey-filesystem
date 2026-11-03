// Loads and validates the configured environment adapter for pey.filesystem.

import { createFilesystemError } from './error.js';

const ADAPTER_METHODS = ['capabilities', 'pickDirectory', 'pickFile', 'listEntries', 'readEntry', 'writeEntry'];

const ADAPTER_ERROR_CODES = Object.freeze({
  INITIALIZATION_FAILED: 'FILESYSTEM_ADAPTER_INITIALIZATION_FAILED',
  INVALID: 'FILESYSTEM_ADAPTER_INVALID',
  NOT_FOUND: 'FILESYSTEM_ADAPTER_NOT_FOUND',
});

const DEFAULT_ADAPTER_LOADERS = Object.freeze({
  BrowserEnvironmentAdapter: async (adapterConfig) => {
    const { createBrowserEnvironmentAdapter } = await import('../adapters/browser-environment-adapter.js');
    return createBrowserEnvironmentAdapter(adapterConfig);
  },
});

function startupError(code, message) {
  return createFilesystemError(code, message, {}, 'startup');
}

function validateAdapter(adapter) {
  const isValid = adapter !== null
    && typeof adapter === 'object'
    && ADAPTER_METHODS.every((methodName) => typeof adapter[methodName] === 'function');

  if (!isValid) {
    throw startupError(
      ADAPTER_ERROR_CODES.INVALID,
      'Configured environment adapter does not implement the required contract',
    );
  }
}

/**
 * Loads, creates, and validates a configured environment adapter.
 *
 * @param {string} identifier Configured adapter identifier.
 * @param {object} [adapterConfig={}] Adapter-specific configuration.
 * @param {Record<string, Function>} [adapterLoaders] Adapter factories.
 * @returns {Promise<object>} Validated environment adapter instance.
 * @throws {object} Standard startup error for unknown, failed, or invalid adapters.
 */
export async function loadEnvironmentAdapter(
  identifier,
  adapterConfig = {},
  adapterLoaders = DEFAULT_ADAPTER_LOADERS,
) {
  const loaders = adapterLoaders ?? DEFAULT_ADAPTER_LOADERS;
  const adapterLoader = typeof identifier === 'string' ? loaders[identifier] : undefined;

  if (typeof adapterLoader !== 'function') {
    throw startupError(
      ADAPTER_ERROR_CODES.NOT_FOUND,
      'Configured environment adapter is not supported',
    );
  }

  let adapter;

  try {
    adapter = await adapterLoader(adapterConfig);
  } catch (error) {
    if (error?.code && String(error.code).startsWith('FILESYSTEM_ADAPTER_')) {
      throw error;
    }
    throw startupError(
      ADAPTER_ERROR_CODES.INITIALIZATION_FAILED,
      'Configured environment adapter could not be initialized',
    );
  }

  validateAdapter(adapter);
  return adapter;
}
