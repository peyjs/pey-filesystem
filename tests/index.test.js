// Verifies pey.filesystem entry point (prepare/activate wiring).
import assert from 'node:assert/strict';
import test from 'node:test';
import { activate, prepare } from '../index.js';

function createPrepareContext() {
  const subscribed = [];
  return {
    context: {
      config: {},
      events: {
        subscribe: (type, handler) => {
          subscribed.push([type, handler]);
          return () => {};
        },
        publish: () => ({ success: true }),
      },
      onShutdown: null,
      onDeactivated: null,
      reportCriticalError: () => {},
    },
    subscribed,
  };
}

function createStorage() {
  return {
    async read() {
      return null;
    },
    async write() {},
    async delete() {},
  };
}

test('should_register_service_when_prepared', async () => {
  const { context } = createPrepareContext();
  const provided = await prepare(context);
  assert.deepEqual(provided.map(({ name }) => name), ['pey.filesystem.service']);
  assert.equal(typeof context.onShutdown, 'function');
  assert.equal(typeof context.onDeactivated, 'function');
});

test('should_fail_startup_with_dedicated_code_when_event_bus_is_missing', async () => {
  // A missing Event Bus is a broken host wiring, not an adapter problem:
  // it carries its own startup code instead of FILESYSTEM_ADAPTER_INVALID.
  const { context } = createPrepareContext();
  delete context.events;
  await assert.rejects(
    prepare(context),
    (error) => error?.code === 'FILESYSTEM_EVENT_BUS_UNAVAILABLE'
      && error?.type === 'startup'
      && error?.source === 'pey.filesystem'
      && error?.detail?.reason === 'missing-event-bus',
  );
});

test('should_not_stay_subscribed_when_activation_lacks_storage', async () => {
  // The Core only guarantees deactivation hooks for the prepare path: a
  // failed activation must tear its own safety net down, or a
  // never-activated plugin could report a critical dependency loss later.
  const { context, subscribed } = createPrepareContext();
  const reported = [];
  context.reportCriticalError = (error) => reported.push(error);
  let released = false;
  const innerSubscribe = context.events.subscribe.bind(context.events);
  context.events.subscribe = (type, handler) => {
    const unsubscribe = innerSubscribe(type, handler);
    return () => {
      released = true;
      unsubscribe();
    };
  };
  await prepare(context);

  await assert.rejects(activate({}), (error) => error?.code === 'FILESYSTEM_STORAGE_UNAVAILABLE');

  assert.equal(released, true, 'a failed activation must release the safety net subscription');
  assert.deepEqual(subscribed.map(([type]) => type), ['core:service-unavailable']);
  assert.deepEqual(reported, []);
});

test('should_not_stay_subscribed_when_adapter_load_fails_during_prepare', async () => {
  // The dependency-loss safety net is taken after the failible adapter
  // load: a prepare that throws must leave no subscription (and no saved
  // context) behind for a plugin that never activated.
  const { context, subscribed } = createPrepareContext();
  context.config = { adapter: 'AdapterThatDoesNotExist' };
  await assert.rejects(prepare(context));
  assert.deepEqual(subscribed, [], 'a failed prepare must not leave the safety net subscribed');
});

test('should_fail_clearly_when_storage_is_missing', async () => {
  const { context } = createPrepareContext();
  await prepare(context);
  await assert.rejects(activate({}), /pey\.storage\.service/);
});

test('should_fail_shadow_calls_when_called_before_activation', async () => {
  const { context } = createPrepareContext();
  const provided = await prepare(context);
  const service = provided[0].object;
  await assert.rejects(
    service.saveShadow('root', 'a.md', 'base', 'draft'),
    (error) => error?.code === 'FILESYSTEM_STORAGE_UNAVAILABLE',
  );
});

test('should_report_critical_when_storage_is_lost', async () => {
  const { context, subscribed } = createPrepareContext();
  const reported = [];
  context.reportCriticalError = (error) => {
    reported.push(error);
  };
  await prepare(context);
  await activate({ 'pey.storage.service': createStorage() });
  const handler = subscribed.find(([type]) => type === 'core:service-unavailable')?.[1];
  assert.equal(typeof handler, 'function');
  handler({ data: { serviceName: 'other.service' } });
  assert.deepEqual(reported, []);
  handler({ data: { serviceName: 'pey.storage.service' } });
  assert.equal(reported.length, 1);
  assert.equal(reported[0].code, 'REQUIRED_DEPENDENCY_LOST');
  assert.equal(reported[0].type, 'critical');
  assert.equal(reported[0].source, 'pey.filesystem');
});

test('should_throw_structured_startup_error_when_activation_lacks_storage', async () => {
  const { context } = createPrepareContext();
  await prepare(context);

  const error = await activate({}).catch((caught) => caught);
  assert.equal(error.code, 'FILESYSTEM_STORAGE_UNAVAILABLE');
  assert.equal(error.type, 'startup');
  assert.equal(error.source, 'pey.filesystem');
});

test('should_refuse_every_method_when_the_plugin_has_deactivated_or_shut_down', async () => {
  const { context } = createPrepareContext();
  const provided = await prepare(context);
  const service = provided[0].object;
  await activate({ 'pey.storage.service': createStorage() });

  context.onDeactivated();

  for (const call of [
    () => service.getCapabilities(),
    () => service.pickDirectory(),
    () => service.pickFile(),
    () => service.listDirectory({}),
    () => service.readEntry({}),
    () => service.writeEntry({ name: 'a.md', path: 'a.md', file: fakeTextFile() }, 'x'),
    () => service.saveShadow('docs', 'a.md', 'b', 'd'),
    () => service.readShadow('docs', 'a.md'),
    () => service.clearShadow('docs', 'a.md'),
  ]) {
    await assert.rejects(call, (error) => error?.code === 'SERVICE_UNAVAILABLE');
  }
});

function fakeTextFile() {
  return { name: 'a.md', text: async () => 'x' };
}

test('should_refuse_every_method_after_shutdown_when_the_core_uses_its_hook', async () => {
  const { context } = createPrepareContext();
  const provided = await prepare(context);
  const service = provided[0].object;

  await context.onShutdown();

  await assert.rejects(() => service.getCapabilities(), (error) => error?.code === 'SERVICE_UNAVAILABLE');
  await assert.rejects(() => service.readShadow('docs', 'a.md'), (error) => error?.code === 'SERVICE_UNAVAILABLE');
});

test('should_release_the_event_subscription_when_deactivation_runs_without_a_double_release', async () => {
  const unsubscribed = [];
  const { context } = createPrepareContextWithUnsubscribe(unsubscribed);
  await prepare(context);

  context.onDeactivated();
  await context.onShutdown();

  // The first teardown releases the subscription; the second is a no-op.
  assert.equal(unsubscribed.length, 1);
});

test('should_survive_repeated_teardown_and_reprepare_when_the_core_restarts_the_plugin', async () => {
  const unsubscribed = [];
  const { context } = createPrepareContextWithUnsubscribe(unsubscribed);
  await prepare(context);
  context.onDeactivated();
  await context.onShutdown();
  assert.equal(unsubscribed.length, 1);

  const providedAgain = await prepare(context);
  assert.equal(unsubscribed.length, 1);
  assert.equal(typeof providedAgain[0].object.getCapabilities, 'function');
});

function createPrepareContextWithUnsubscribe(unsubscribed) {
  const { context } = createPrepareContext();
  const originalSubscribe = context.events.subscribe;
  context.events.subscribe = (type, handler) => {
    const off = originalSubscribe(type, handler);
    return () => {
      unsubscribed.push(type);
      off?.();
    };
  };
  return { context };
}
