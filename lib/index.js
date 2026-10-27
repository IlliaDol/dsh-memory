/**
 * dsh-memory, node half.
 *
 * Adds three things to a dsh profile:
 *   1. a Memory section in the assembled system prompt, built from a list;
 *   2. a `memory` tool so the model can add, revise or delete its own entries;
 *   3. an authenticated /api/dsh-memory/items route for the Settings panel.
 *
 * The store is a small JSON document under `$DSH_HOME`, not a second
 * AGENTS.md: each fact is its own row, which is the whole point.
 *
 * @module dsh-memory
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { MemoryStore, renderMemory, MAX_ITEMS, MAX_TEXT } from './store.js';

/** Cordis plugin name; also the module-loader id of the client bundle. */
export const name = 'dsh-memory';

/** The prompt section is the plugin; everything else is optional. */
export const inject = ['systemPrompt'];

/** Authenticated route the Settings panel talks to. */
export const API_PATH = '/api/dsh-memory/items';

/**
 * Plugin configuration.
 * @typedef {object} Config
 * @property {string} [file] memory document; defaults to $DSH_HOME/memory.json
 * @property {boolean} [tool] set false to keep only the panel and the prompt section
 */

/**
 * Locate `$DSH_HOME`.
 * @returns {string} absolute home directory
 */
export function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  return fromEnv !== undefined && fromEnv.trim() !== '' ? resolve(fromEnv) : join(homedir(), '.dsh');
}

/**
 * Build the model tool.
 * @param {MemoryStore} store memory store
 * @returns {any} tool definition
 */
export function createMemoryTool(store) {
  return {
    name: 'memory',
    description: [
      'Manage durable facts about the user that should survive across sessions.',
      'Each fact is a separate item with an id, so one can be removed without rewriting the rest.',
      'Use it when the user says "remember", "forget", or states a lasting preference or constraint.',
      'The fact must be the user\'s own words: copy the sentence they said and keep it verbatim — no paraphrase, no summary, no added detail.',
      'Never store passwords, API keys, tokens, private file contents or anything the user did not ask to keep.',
    ].join(' '),
    parameters: {
      action: {
        type: 'string',
        enum: ['list', 'add', 'update', 'remove', 'clear'],
        description: 'list shows every item with ids. add appends one fact. update replaces one item text. remove deletes one by id. clear deletes everything.',
      },
      text: {
        type: 'string',
        description: `The fact, in one or two sentences (max ${MAX_TEXT} characters). Required on add and update.`,
      },
      id: {
        type: 'string',
        description: 'Item id (mem_ + 8 hex). Required on update and remove.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          count: { type: 'integer', required: true },
          items: { type: 'array', items: { type: 'object' } },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    isConcurrencySafe: (args) => args.action === 'list',
    async execute(args) {
      const action = typeof args?.action === 'string' ? args.action : 'list';
      if (action === 'list') {
        const items = await store.list();
        return {
          action,
          count: items.length,
          items: items.map((item) => ({ id: item.id, text: item.text })),
          message: items.length === 0
            ? 'Memory is empty.'
            : `${items.length} item${items.length === 1 ? '' : 's'}:\n${items.map((item) => `- ${item.id}: ${item.text}`).join('\n')}`,
        };
      }
      if (action === 'add') {
        const { item, duplicate } = await store.add(String(args?.text ?? ''), 'model');
        return {
          action,
          count: (await store.list()).length,
          message: duplicate ? `Already remembered as ${item.id}.` : `Remembered as ${item.id}.`,
        };
      }
      if (action === 'update') {
        const item = await store.update(String(args?.id ?? ''), String(args?.text ?? ''));
        return { action, count: (await store.list()).length, message: `Updated ${item.id}.` };
      }
      if (action === 'remove') {
        const removed = await store.remove(String(args?.id ?? ''));
        return {
          action,
          count: (await store.list()).length,
          message: removed ? `Deleted ${args?.id}.` : `No item ${args?.id ?? '(missing id)'}.`,
        };
      }
      const removed = await store.clear();
      return { action: 'clear', count: 0, message: `Deleted ${removed} item${removed === 1 ? '' : 's'}.` };
    },
  };
}

/**
 * The `/remember` and `/forget` slash commands.
 *
 * A tool call is written by whichever model is driving the chat, so a fact
 * saved that way is that model's sentence about the user, not the user's. The
 * command path takes `rawInput` straight from the composer: what the user typed
 * is what gets stored, and no model is involved at all.
 * @param {MemoryStore} store memory store
 * @returns {any[]} command definitions
 */
export function createMemoryCommands(store) {
  return [
    {
      definitionId: 'dsh-memory/remember',
      name: 'remember',
      description: 'Save a fact to memory exactly as typed',
      input: { hint: '[<fact>]' },
      async handler(invocation) {
        const text = String(invocation?.rawInput ?? '').trim();
        if (text.length === 0) {
          const items = await store.list();
          return {
            kind: 'success',
            text: items.length === 0
              ? 'Memory is empty. Use /remember <fact>.'
              : `${items.length} item${items.length === 1 ? '' : 's'}:\n${items.map((item) => `- ${item.id}: ${item.text}`).join('\n')}\nUse /forget <id> to delete one.`,
          };
        }
        const { item, duplicate } = await store.add(text, 'user');
        return {
          kind: 'success',
          text: duplicate ? `Already remembered as ${item.id}.` : `Remembered as ${item.id}: ${text}`,
        };
      },
    },
    {
      definitionId: 'dsh-memory/forget',
      name: 'forget',
      description: 'Delete a remembered fact by id',
      input: { hint: '<id>' },
      async handler(invocation) {
        const id = String(invocation?.rawInput ?? '').trim();
        if (id.length === 0) {
          return { kind: 'error', text: 'Usage: /forget <id>. /remember with no argument lists the ids.' };
        }
        const removed = await store.remove(id);
        return removed
          ? { kind: 'success', text: `Deleted ${id}.` }
          : { kind: 'error', text: `No item ${id}. /remember with no argument lists the ids.` };
      },
    },
  ];
}

/**
 * The HTTP handler behind the Settings panel. Runs on the host's authenticated
 * /api channel, so the browser is already trusted by the time it runs.
 * @param {MemoryStore} store memory store
 * @param {Request} request fetch request
 * @returns {Promise<Response>} JSON response
 */
export async function handleApi(store, request) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

  try {
    if (request.method === 'GET') {
      return json({ items: await store.list(), limit: MAX_ITEMS, maxText: MAX_TEXT });
    }
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid JSON body' }, 400);
    }
    const action = typeof body?.action === 'string' ? body.action : '';
    if (action === 'add') await store.add(String(body?.text ?? ''), 'user');
    else if (action === 'update') await store.update(String(body?.id ?? ''), String(body?.text ?? ''));
    else if (action === 'remove') await store.remove(String(body?.id ?? ''));
    else if (action === 'clear') await store.clear();
    else return json({ error: `unknown action: ${action}` }, 400);

    return json({ items: await store.list(), limit: MAX_ITEMS, maxText: MAX_TEXT });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}

/**
 * Register the prompt section, the tool and the API route.
 * @param {any} ctx cordis context
 * @param {Config} [config] plugin configuration
 * @returns {void} nothing
 */
export function apply(ctx, config = {}) {
  const file = typeof config.file === 'string' && config.file.length > 0
    ? resolve(config.file)
    : join(dshHome(), 'memory.json');
  const store = new MemoryStore(file);

  /**
   * Prompt projection.
   *
   * The registry accepts a string or a string-returning function, never a
   * promise, so the list cannot be hydrated by an awaited read at load: an
   * async read loses that race whenever the first assembly beats it, and the
   * session then starts with no memory in the prompt at all. Reading the
   * document on demand is what makes the section correct on the first turn of a
   * fresh process. The signature check is what makes it stay correct: a write
   * from the web profile, a hand edit, or a delete shows up on the next
   * assembly without restarting the app.
   */
  let cache = { signature: undefined, items: [] };
  const snapshot = () => {
    const signature = store.signatureSync();
    if (signature !== cache.signature) {
      cache = { signature, items: store.listSync() };
      // One line per change, and one at load: enough to tell from the host log
      // whether a session really started with memory, and how much of it.
      console.info(`[dsh-memory] prompt section: ${cache.items.length} item(s)`);
    }
    return cache.items;
  };
  // A write made in this process must be visible even where the filesystem's
  // timestamp is too coarse to change the signature.
  ctx.effect(() => store.onChange(() => {
    cache = { signature: undefined, items: cache.items };
  }), 'dsh-memory: prompt invalidation');

  let order = 400;
  try {
    if (typeof ctx.systemPrompt?.getSectionOrder === 'function') {
      const planPolicy = ctx.systemPrompt.getSectionOrder('PLAN_POLICY');
      if (Number.isFinite(planPolicy)) order = Math.max(1, planPolicy - 100);
    }
  } catch {
    // A renamed or missing anchor is not worth losing the whole plugin over.
  }

  try {
    ctx.systemPrompt.section({
      name: 'memory:items',
      order,
      text: () => renderMemory(snapshot()).text,
    });
  } catch (error) {
    console.error('[dsh-memory] could not register the prompt section:', error instanceof Error ? error.message : error);
  }

  if (config.tool !== false) {
    ctx.inject(['tools'], (scope) => {
      scope.effect(() => scope.tools.register(createMemoryTool(store)), 'dsh-memory: memory tool');
    });
  }

  // The model-free path: /remember stores the composer text verbatim.
  ctx.inject(['commands'], (scope) => {
    if (typeof scope.commands?.register !== 'function') return;
    for (const command of createMemoryCommands(store)) {
      scope.effect(() => scope.commands.register({
        definitionId: command.definitionId,
        name: command.name,
        description: command.description,
        input: command.input,
        handler: command.handler,
      }), `dsh-memory: /${command.name}`);
    }
  });

  // Writes stay on the authenticated channel. A plugin prefix route would be
  // reachable by any local page; this one is behind the host's browser-trust
  // fence, which is why the panel never needs a token of its own.
  ctx.inject(['connection'], (scope) => {
    const fetch = scope.get('connection')?.fetch;
    if (typeof fetch?.register !== 'function') {
      console.warn('[dsh-memory] this host has no connection.fetch registry; the Settings panel will report the memory API as unavailable');
      return;
    }
    const register = fetch.register.bind(fetch);
    scope.effect(() => register({
      path: API_PATH,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: async (request) => handleApi(store, request),
    }), 'dsh-memory: items route');
  });

  console.info(`[dsh-memory] host active; file=${file}`);
}

export { MemoryStore, renderMemory, MAX_ITEMS, MAX_TEXT } from './store.js';