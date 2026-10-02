import { spawnSync } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
const result = spawnSync(process.env.MOON || resolve(homedir(), '.moon/bin/moon'), ['build', '--target', 'js', '--release'], { cwd: new URL('../', import.meta.url), stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
await mkdir(new URL('../web/', import.meta.url), { recursive: true });
await copyFile(new URL('../_build/js/release/build/supervision_audit.js', import.meta.url), new URL('../web/engine.js', import.meta.url));
console.log('MoonBit audit engine built.');
