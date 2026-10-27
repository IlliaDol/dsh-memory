import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

/**
 * The smallest host that behaves like cordis for this plugin.
 * @param {object} options overrides
 * @returns {{ctx: any, log: any}} fake context and what it recorded
 */
function host(options = {}) {
  const log = { sections: [], tools: [], routes: [] };
  const services = {
    tools: { register: (tool) => { log.tools.push(tool); return () => undefined; } },
    connection: { fetch: { register: (route) => { log.routes.push(route); return () => undefined; } } },
  };
  const ctx = {
    systemPrompt: {
      getSectionOrder: options.getSectionOrder ?? (() => 500),
      section: options.section ?? ((section) => { log.sections.push(section); }),
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
  return { ctx, log };
}

/** Seed a store file without going through the store. */
async function seed(file, text) {
  await writeFile(file, JSON.stringify({
    v: 1,
    items: [{
      id: 'mem_abcdef01',
      text,
      source: 'user',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    }],
  }, null, 2), 'utf8');
}

test('the first assembly of a cold process already contains memory', async () => {
  const { file, cleanup } = await fixture();
  try {
    await seed(file, 'Ships on Fridays.');
    const { ctx, log } = host();
    apply(ctx, { file });

    // No tick, no await: this is the assembly the harness performs on turn one,
    // and it used to run before the store had ever been read.
    const text = log.sections[0].text();
    assert.match(text, /Ships on Fridays/u);
    assert.match(text, /^## Memory/u);
  } finally {
    await cleanup();
  }
});

test('a fact written by another profile appears on the next assembly', async () => {
  const { file, cleanup } = await fixture();
  try {
    await seed(file, 'First fact.');
    const { ctx, log } = host();
    apply(ctx, { file });
    assert.match(log.sections[0].text(), /First fact/u);

    // A second MemoryStore is a second process: no shared listener, no cache.
    const other = new MemoryStore(file);
    await other.add('Added from the web profile.');

    assert.match(log.sections[0].text(), /web profile/u);
  } finally {
    await cleanup();
  }
});

test('clearing the store empties the next assembly', async () => {
  const { file, cleanup } = await fixture();
  try {
    await seed(file, 'Temporary fact.');
    const { ctx, log } = host();
    apply(ctx, { file });
    assert.match(log.sections[0].text(), /Temporary fact/u);

    await new MemoryStore(file).clear();
    assert.equal(log.sections[0].text(), '');
  } finally {
    await cleanup();
  }
});

test('a host that cannot place or accept the section still gets the tool and the route', async () => {
  const { file, cleanup } = await fixture();
  try {
    const { ctx, log } = host({
      getSectionOrder: () => { throw new Error('unknown section anchor'); },
      section: () => { throw new Error('duplicate section name'); },
    });
    apply(ctx, { file });
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(log.sections.length, 0);
    assert.equal(log.tools[0]?.name, 'memory');
    assert.equal(log.routes[0]?.path, API_PATH);
  } finally {
    await cleanup();
  }
});

