import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');

const React = {
  createElement(type, props, ...children) {
    return { type, props: { ...(props ?? {}), children } };
  },
  useState(value) {
    return [value, () => undefined];
  },
  useEffect() {
    return undefined;
  },
};

function loadClient() {
  let exported;
  const window = {
    __ModuleLoader__: {
      load({ id, factory }) {
        assert.equal(id, 'dsh-memory');
        exported = factory(() => React);
      },
    },
  };
  new Function('window', 'document', 'fetch', 'MutationObserver', source)(window, undefined, undefined, undefined);
  return { exported, window };
}

test('the bundle exports the plugin face', () => {
  const { exported } = loadClient();
  assert.equal(exported.name, 'dsh-memory');
  assert.deepEqual(exported.inject, ['slots']);
  assert.equal(typeof exported.apply, 'function');
  assert.equal(typeof exported.MemoryPanel, 'function');
});

test('apply registers one Settings section labelled Memory', () => {
  const { exported } = loadClient();
  const registrations = [];
  const ctx = {
    slots: {
      inject(name, factory) {
        assert.equal(name, 'settings.section');
        return factory();
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => undefined;
      },
    },
  };
  const dispose = exported.apply(ctx);
  assert.equal(typeof dispose, 'function');
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].options.name, 'settings.section');
  assert.equal(registrations[0].options.id, 'memory');
  assert.equal(registrations[0].options.label(), 'Memory');
  assert.equal(registrations[0].component, exported.MemoryPanel);
});

test('the panel starts in a loading state with its heading', () => {
  const { exported } = loadClient();
  const element = exported.MemoryPanel({});
  const text = JSON.stringify(element);
  assert.match(text, /Memory/u);
  assert.match(text, /Loading/u);
});

test('a fact wraps on any character instead of running out of its row', () => {
  const { exported } = loadClient();
  assert.equal(exported.FACT_TEXT.overflowWrap, 'anywhere');
  assert.equal(exported.FACT_TEXT.wordBreak, 'break-word');
  assert.equal(exported.FACT_TEXT.maxWidth, '100%');
  assert.equal(exported.FACT_TEXT.whiteSpace, 'pre-wrap');
});
