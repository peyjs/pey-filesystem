// Pey filesystem plugin: wires the environment adapter and the service into
// Bonyan's two-phase lifecycle.
import { createFilesystemError, PLUGIN_NAME, SERVICE_NAME } from './lib/error.js';
import { STORAGE_SERVICE, createService } from './lib/filesystem-service.js';
import { loadEnvironmentAdapter } from './lib/environment-loader.js';

const state = { storage: null };
let savedContext = null;
let lifecycle = null;
let unsubscribe = null;

/**
 * Reports a critical error when the required storage service disappears at
 * runtime. Settlement already handles startup-time absence automatically.
 * @param {object} event Core event envelope.
 * @returns {void}
 */
function handleServiceUnavailable(event) {
  if (event?.data?.serviceName !== STORAGE_SERVICE || !savedContext) {
    return;
  }
  savedContext.reportCriticalError({
    code: 'REQUIRED_DEPENDENCY_LOST',
    message: `Required service ${STORAGE_SERVICE} is no longer available`,
    source: PLUGIN_NAME,
    type: 'critical',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Tears the plugin down: the service refuses every later call, the event
 * subscription is released and no critical report can fire afterwards.
 * Idempotent — running it twice is harmless.
 * @returns {void}
 */
function teardown() {
  state.storage = null;
  lifecycle?.deactivate();
  unsubscribe?.();
  unsubscribe = null;
  savedContext = null;
}

/**
 * Prepares the configured environment adapter and the declared service.
 * @param {object} prepareContext Bonyan preparation context.
 * @returns {Promise<Array>} Service registration.
 * @throws {object} Structured startup error when the Event Bus contract or
 *   the adapter is broken.
 */
export async function prepare(prepareContext) {
  state.storage = null;
  lifecycle = null;
  unsubscribe?.();
  unsubscribe = null;
  savedContext = prepareContext;
  // The runtime dependency-loss safety net needs the Event Bus contract:
  // its absence is a broken host, so it fails loudly at startup instead of
  // silently never reporting a lost required dependency. This is a host
  // wiring failure, not an adapter one — it carries its own code.
  if (typeof prepareContext.events?.subscribe !== 'function') {
    savedContext = null;
    throw createFilesystemError(
      'FILESYSTEM_EVENT_BUS_UNAVAILABLE',
      'Prepare context does not provide an Event Bus',
      { reason: 'missing-event-bus' },
      'startup',
    );
  }
  prepareContext.onDeactivated = () => teardown();
  prepareContext.onShutdown = async () => teardown();

  try {
    const config = prepareContext.config ?? {};
    const adapter = await loadEnvironmentAdapter(
      config.adapter ?? 'BrowserEnvironmentAdapter',
      config.adapterConfig ?? {},
    );
    lifecycle = createService({ adapter, state });
  } catch (error) {
    // The failible step ran before the subscription was taken: release the
    // saved context so a never-activated plugin cannot report a critical
    // dependency loss later, then rethrow for the Core.
    teardown();
    throw error;
  }
  unsubscribe = prepareContext.events.subscribe('core:service-unavailable', handleServiceUnavailable);
  return [{ name: SERVICE_NAME, object: lifecycle.service }];
}

/**
 * Activates the plugin: binds the storage dependency for shadow drafts.
 * @param {Record<string, object>} services Bound declared dependencies.
 * @returns {Promise<void>}
 */
export async function activate(services) {
  const storage = services[STORAGE_SERVICE];
  if (!storage) {
    // Activation failed: the plugin never runs. Release the dependency-loss
    // safety net (and the saved context) here too — the Core only
    // guarantees deactivation hooks for the prepare path, so a
    // never-activated plugin could otherwise report a critical
    // REQUIRED_DEPENDENCY_LOST for a service it never used.
    teardown();
    throw createFilesystemError(
      'FILESYSTEM_STORAGE_UNAVAILABLE',
      `Required service is unavailable: ${STORAGE_SERVICE}`,
      { service: STORAGE_SERVICE },
      'startup',
    );
  }
  state.storage = storage;
}
