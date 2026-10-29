#!/usr/bin/env node
// Fail CI/local if moonc is older than the contest floor (0.10.16).
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {resolve} from 'node:path';

const floor = {major: 0, minor: 10, patch: 16};
const moon = process.env.MOON || resolve(homedir(), '.moon/bin/moon');
const text = execFileSync(moon, ['version', '--all'], {encoding: 'utf8'});
const match = text.match(/moonc\s+v(\d+)\.(\d+)\.(\d+)/);
if (!match) {
  console.error('Could not parse moonc version from:\n' + text);
  process.exit(1);
}
const [major, minor, patch] = match.slice(1).map(Number);
const ok =
  major > floor.major ||
  (major === floor.major && minor > floor.minor) ||
  (major === floor.major && minor === floor.minor && patch >= floor.patch);
console.log(`moonc v${major}.${minor}.${patch} (floor v${floor.major}.${floor.minor}.${floor.patch})`);
if (!ok) {
  console.error('moonc is below the acceptance floor 0.10.16; upgrade the official MoonBit toolchain.');
  process.exit(1);
}
