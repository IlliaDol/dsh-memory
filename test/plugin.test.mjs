import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../lib/store.js';
import { createMemoryTool, handleApi, apply, name, inject, API_PATH } from '../lib/index.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-api-'));
  const file = join(root, 'memory.json');
  return { store: new MemoryStore(file), file, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('the plugin declares its name, required service and route', () => {
  assert.equal(name, 'dsh-memory');
  assert.deepEqual(inject, ['systemPrompt']);
  assert.equal(API_PATH, '/api/dsh-memory/items');
});

test('the tool adds, lists, updates and removes', async () => {
  const { store, cleanup } = await fixture();
  try {
    const tool = createMemoryTool(store);
    const added = await tool.execute({ action: 'add', text: 'Prefers pnpm.' });
    assert.match(added.message, /Remembered/u);
    const listed = await tool.execute({ action: 'list' });
    assert.equal(listed.count, 1);
    assert.match(listed.message, /mem_/u);
    const id = listed.items[0].id;
    const updated = await tool.execute({ action: 'update', id, text: 'Prefers pnpm everywhere.' });
    assert.match(updated.message, /Updated/u);
    const removed = await tool.execute({ action: 'remove', id });
    assert.equal(removed.count, 0);
    assert.match(removed.message, /Deleted/u);
  } finally {
    await cleanup();
  }
});

test('the HTTP handler reads, adds, removes and rejects bad input', async () => {
  const { store, cleanup } = await fixture();
  try {
    const get = await handleApi(store, new Request('http://x/api/dsh-memory/items'));
    const initial = await get.json();
    assert.deepEqual(initial.items, []);
    assert.equal(initial.limit, 300);

    const add = await handleApi(store, new Request('http://x/api/dsh-memory/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'add', text: 'Uses PowerShell.' }),
    }));
    assert.equal(add.status, 200);
    const afterAdd = await add.json();
    assert.equal(afterAdd.items.length, 1);

    const remove = await handleApi(store, new Request('http://x/api/dsh-memory/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'remove', id: afterAdd.items[0].id }),
    }));
    assert.equal((await remove.json()).items.length, 0);

    const bad = await handleApi(store, new Request('http://x/api/dsh-memory/items', { method: 'POST', body: 'nope' }));
    assert.equal(bad.status, 400);
    const unknown = await handleApi(store, new Request('http://x/api/dsh-memory/items', {
      method: 'POST',
      body: JSON.stringify({ action: 'explode' }),
    }));
    assert.equal(unknown.status, 400);
  } finally {
    await cleanup();
  }
});

test('apply registers the prompt section, the tool and the route', async () => {
  const { file, cleanup } = await fixture();
  try {
    const log = { sections: [], tools: [], routes: [] };
    const services = {
      tools: { register: (tool) => { log.tools.push(tool); return () => undefined; } },
      connection: {
        fetch: {
          register: (route) => { log.routes.push(route); return () => undefined; },
        },
      },
    };
    const ctx = {
      systemPrompt: {
        getSectionOrder: () => 500,
        section: (section) => { log.sections.push(section); },
      },
      effect: (work) => {
        const dispose = work();
        return typeof dispose === 'function' ? dispose : () => undefined;
      },
      inject(names, callback) {
        const scope = {
          ...services,
          get: (key) => services[key],
          effect: (work) => {
            const dispose = work();
            return typeof dispose === 'function' ? dispose : () => undefined;
          },
        };
        if (names.some((entry) => services[entry] !== undefined)) callback(scope);
      },
    };
    apply(ctx, { file });
    await new Promise((resolve) => setTimeout(resolve, 40));

    assert.equal(log.sections.length, 1);
    assert.equal(log.sections[0].name, 'memory:items');
    assert.equal(typeof log.sections[0].text, 'function');
    assert.equal(log.tools[0].name, 'memory');
    assert.equal(log.routes[0].path, API_PATH);
    assert.deepEqual(log.routes[0].methods, ['GET', 'POST']);
  } finally {
    await cleanup();
  }
});

test('an empty memory produces an empty section, a filled one produces bullets', async () => {
  const { file, cleanup } = await fixture();
  try {
    const sections = [];
    const tools = [];
    const services = { tools: { register: (tool) => { tools.push(tool); return () => undefined; } } };
    const ctx = {
      systemPrompt: { getSectionOrder: () => 500, section: (section) => { sections.push(section); } },
      effect: (work) => {
        const dispose = work();
        return typeof dispose === 'function' ? dispose : () => undefined;
      },
      inject(names, callback) {
        const scope = {
          ...services,
          get: (key) => services[key],
          effect: (work) => {
            const dispose = work();
            return typeof dispose === 'function' ? dispose : () => undefined;
          },
        };
        if (names.some((entry) => services[entry] !== undefined)) callback(scope);
      },
    };
    apply(ctx, { file });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(sections[0].text(), '');

    // The tool writes through the plugin's own store, so its change listener
    // refreshes the prompt projection before the next assembly.
    await tools[0].execute({ action: 'add', text: 'Remembers the launch is on Friday.' });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.match(sections[0].text(), /launch is on Friday/u);
  } finally {
    await cleanup();
  }
});
