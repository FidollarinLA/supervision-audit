#!/usr/bin/env node
// One-command local acceptance self-check (not an official pass certificate).
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const moon = process.env.MOON || resolve(homedir(), '.moon/bin/moon');
const node = process.execPath;

function run(label, cmd, args) {
  process.stdout.write(`\n== ${label} ==\n`);
  const result = spawnSync(cmd, args, {cwd: root, encoding: 'utf8', env: {...process.env, MOON: moon}});
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    console.error(`FAIL: ${label}`);
    process.exit(result.status || 1);
  }
}

run('moonc >= 0.10.16', node, [join(root, 'scripts/assert-moonc-version.mjs')]);
run('acceptance-gate tests (incl. Mooncakes 0.1.0 view)', node, ['--test', join(root, 'test/acceptance-gate.test.mjs')]);
run('reviewer demo', node, [join(root, 'scripts/reviewer-demo.mjs')]);
run('registration facts', node, [join(root, 'scripts/registration-facts.mjs')]);

console.log(`
ACCEPT self-check passed (local evidence only).
Next for Mooncakes 0.1.1: moon login && npm run publish:mooncakes
See docs/ACCEPTANCE_GATE.md
`);
