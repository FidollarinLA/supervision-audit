import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const moon = process.env.MOON || resolve(homedir(), '.moon/bin/moon');

test('acceptance gate doc maps all nine contest criteria', () => {
  const text = readFileSync(join(root, 'docs/ACCEPTANCE_GATE.md'), 'utf8');
  for (const needle of [
    'moonc ≥ 0.10.16',
    'GitHub 公开',
    '源码结构清晰',
    'README',
    'CI 覆盖',
    '可运行示例',
    '完整测试',
    'mooncakes.io',
    'Apache-2.0',
  ]) {
    assert.match(text, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.equal(existsSync(join(root, 'LICENSE')), true);
  assert.match(readFileSync(join(root, 'LICENSE'), 'utf8'), /Apache License/);
  assert.match(readFileSync(join(root, 'README.md'), 'utf8'), /moonc\s*≥\s*0\.10\.16|moonc >= 0\.10\.16|v0\.10\.16/);
});

test('moonc version floor script accepts the local toolchain', () => {
  const run = spawnSync(process.execPath, [join(root, 'scripts/assert-moonc-version.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: {...process.env, MOON: moon},
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /moonc v0\.10\.\d+/);
});

test('published Mooncakes 0.1.0 remains queryable', () => {
  const run = spawnSync(moon, ['view', 'FidollarinLA/supervision_audit@0.1.0', '--json'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.status, 'success');
  assert.equal(payload.result.version, '0.1.0');
  assert.equal(payload.result.yanked, false);
});
