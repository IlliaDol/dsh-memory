/**
 * Package-shape checks for dsh-memory.
 */

import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

assert.equal(pkg.type, 'module');
assert.equal(pkg.main, 'lib/index.js');
assert.equal(pkg.exports['./client'], './lib/client.js');
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
assert.equal(pkg.dsh.client.platform, 'web');
assert.equal(pkg.dependencies, undefined, 'no runtime dependencies');

for (const file of ['lib/index.js', 'lib/client.js', 'lib/store.js', 'cordis.patch.yml', 'README.md', 'LICENSE']) {
  const info = await stat(join(root, file));
  assert.ok(info.size > 0, `${file} is empty`);
}

const client = await readFile(join(root, 'lib', 'client.js'), 'utf8');
assert.match(client, /window\.__ModuleLoader__\.load\(\{/u);
assert.match(client, /id: 'dsh-memory'/u);
assert.match(client, /'settings\.section'/u);
assert.match(client, /label: \(\) => 'Memory'/u);

const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8');
assert.match(patch, /name: dsh-memory/u);

console.log('package shape ok');
