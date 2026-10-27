import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore, renderMemory, normalizeText, MEMORY_ID_RE, MAX_TEXT } from '../lib/store.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-'));
  const file = join(root, 'memory.json');
  return { store: new MemoryStore(file), file, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('add stores a normalized item and returns it', async () => {
  const { store, file, cleanup } = await fixture();
  try {
    const { item, duplicate } = await store.add('  Prefers   pnpm.\n\n\nNever npm.  ');
    assert.equal(duplicate, false);
    assert.match(item.id, MEMORY_ID_RE);
    assert.equal(item.text, 'Prefers pnpm.\n\nNever npm.');
    const state = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(state.items.length, 1);
  } finally {
    await cleanup();
  }
});

test('an exact duplicate is refused, case-insensitively', async () => {
  const { store, cleanup } = await fixture();
  try {
    const first = await store.add('Prefers pnpm.');
    const second = await store.add('prefers PNPM.');
    assert.equal(second.duplicate, true);
    assert.equal(second.item.id, first.item.id);
    assert.equal((await store.list()).length, 1);
  } finally {
    await cleanup();
  }
});

test('list is newest first', async () => {
  const { store, cleanup } = await fixture();
  try {
    const a = await store.add('First fact');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = await store.add('Second fact');
    const listed = await store.list();
    assert.deepEqual(listed.map((item) => item.id).slice(0, 2), [b.item.id, a.item.id]);
  } finally {
    await cleanup();
  }
});

test('update replaces text and remove deletes one row', async () => {
  const { store, cleanup } = await fixture();
  try {
    const { item } = await store.add('Old text');
    const updated = await store.update(item.id, 'New text');
    assert.equal(updated.text, 'New text');
    assert.equal(await store.remove(item.id), true);
    assert.equal(await store.remove(item.id), false);
    assert.equal((await store.list()).length, 0);
  } finally {
    await cleanup();
  }
});

test('malformed ids and empty text are refused', async () => {
  const { store, cleanup } = await fixture();
  try {
    await assert.rejects(() => store.add('   '), /empty/u);
    await assert.rejects(() => store.add('x'.repeat(MAX_TEXT + 1)), /ceiling/u);
    await assert.rejects(() => store.update('../etc/passwd', 'x'), /malformed/u);
    assert.equal(await store.remove('nope'), false);
  } finally {
    await cleanup();
  }
});

test('concurrent adds keep every item', async () => {
  const { store, cleanup } = await fixture();
  try {
    await Promise.all(Array.from({ length: 12 }, (_value, index) => store.add(`Fact ${index}`)));
    assert.equal((await store.list()).length, 12);
  } finally {
    await cleanup();
  }
});

test('clear empties the file, reports the count and keeps a copy', async () => {
  const { store, file, cleanup } = await fixture();
  try {
    await store.add('One');
    await store.add('Two');
    assert.equal(await store.clear(), 2);
    assert.deepEqual(await store.list(), []);

    // The pre-clear document is beside the store, so one click is undoable.
    const backup = JSON.parse(await readFile(`${file}.bak`, 'utf8'));
    assert.deepEqual(backup.items.map((item) => item.text).sort(), ['One', 'Two']);
  } finally {
    await cleanup();
  }
});

test('a corrupt file reads as empty instead of throwing', async () => {
  const { store, file, cleanup } = await fixture();
  try {
    await writeFile(file, '{not json', 'utf8');
    assert.deepEqual(await store.list(), []);
    await store.add('Recovered');
    assert.equal((await store.list()).length, 1);
  } finally {
    await cleanup();
  }
});

test('a byte-order mark in the file does not hide every fact', async () => {
  const { store, file, cleanup } = await fixture();
  try {
    const document = JSON.stringify({
      v: 1,
      items: [{ id: 'mem_abcdef01', text: 'Saved by Notepad.', createdAt: '2026-10-01T00:00:00.000Z' }],
    });
    await writeFile(file, `\uFEFF${document}`, 'utf8');

    assert.equal((await store.list()).length, 1);
    assert.equal(store.listSync().length, 1);
    await store.add('And one more.');
    assert.equal((await store.list()).length, 2);
    // The store always rewrites its own document without the mark.
    assert.notEqual((await readFile(file, 'utf8')).charCodeAt(0), 0xFEFF);
  } finally {
    await cleanup();
  }
});

test('the synchronous view tracks the file and its signature', async () => {
  const { store, file, cleanup } = await fixture();
  try {
    assert.equal(store.signatureSync(), null);
    assert.deepEqual(store.listSync(), []);

    const { item } = await store.add('One fact.');
    const signature = store.signatureSync();
    assert.equal(typeof signature, 'string');
    assert.deepEqual(store.listSync().map((entry) => entry.id), [item.id]);

    await store.add('Another fact.');
    assert.notEqual(store.signatureSync(), signature);
    assert.equal(store.listSync().length, 2);

    await rm(file, { force: true });
    assert.equal(store.signatureSync(), null);
    assert.deepEqual(store.listSync(), []);
  } finally {
    await cleanup();
  }
});

test('two processes writing at once keep both items', async () => {
  const { file, cleanup } = await fixture();
  try {
    const desktop = new MemoryStore(file);
    const web = new MemoryStore(file);
    await Promise.all([
      desktop.add('From the desktop app.'),
      web.add('From the web profile.'),
    ]);
    const texts = (await desktop.list()).map((item) => item.text).sort();
    assert.deepEqual(texts, ['From the desktop app.', 'From the web profile.']);
  } finally {
    await cleanup();
  }
});

test('the prompt projection is capped and says what it dropped', async () => {
  const many = Array.from({ length: 40 }, (_value, index) => ({
    id: `mem_${String(index).padStart(8, '0')}`,
    text: `${index} `.padEnd(400, 'x'),
    createdAt: new Date().toISOString(),
  }));
  const rendered = renderMemory(many);
  assert.ok(rendered.text.length <= 8200);
  assert.equal(rendered.dropped, many.length - rendered.included);
  assert.match(rendered.text, /^## Memory/u);
  assert.match(rendered.text, /memory.*tool/u);
});

test('an empty memory contributes no prompt section', () => {
  assert.deepEqual(renderMemory([]), { text: '', included: 0, dropped: 0 });
});

test('normalizeText collapses spaces and keeps paragraph breaks', () => {
  assert.equal(normalizeText('a  b\n\n\n\nc'), 'a b\n\nc');
});
