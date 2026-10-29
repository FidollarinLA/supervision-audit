#!/usr/bin/env node
// Publish the current moon.mod version. Requires an interactive `moon login` first.
import {execFileSync, spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const moon = process.env.MOON || resolve(homedir(), '.moon/bin/moon');
const run = (args, opts = {}) => execFileSync(moon, args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts});

const manifest = readFileSync(join(root, 'moon.mod'), 'utf8');
const name = manifest.match(/^name\s*=\s*"([\w/-]+)"/m)?.[1];
const version = manifest.match(/^version\s*=\s*"([\d.]+)"/m)?.[1];
if (!name || !version) throw new Error('moon.mod missing name/version');

const who = spawnSync(moon, ['whoami'], {cwd: root, encoding: 'utf8'});
const identity = (who.stdout || who.stderr || '').trim();
if (who.status !== 0 || /not logged in/i.test(identity) || !identity) {
  console.error('Not logged in to Mooncakes. Run: moon login');
  console.error('Then re-run: npm run publish:mooncakes');
  process.exit(1);
}
console.log('Logged in as: ' + identity.split(/\r?\n/)[0]);

process.stdout.write(run(['info']));
process.stdout.write(run(['fmt']));
console.log(run(['package', '--frozen']));
console.log(run(['publish', '--frozen']));
const view = JSON.parse(run(['view', `${name}@${version}`, '--json']));
if (view.status !== 'success') {
  console.error('Publish finished but moon view did not return success for ' + name + '@' + version);
  process.exit(1);
}
console.log(`Published and verified ${name}@${version} on Mooncakes.`);
