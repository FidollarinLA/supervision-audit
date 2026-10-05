// Local release rehearsal only: never publish, log in, or modify the registry.
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const moon = process.env.MOON || resolve(homedir(), '.moon/bin/moon');
const run = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const temp = await mkdtemp(join(tmpdir(), 'supervision-audit-package-'));
try {
  const manifest = await readFile(join(root, 'moon.mod'), 'utf8');
  const name = manifest.match(/^name\s*=\s*"([\w/-]+)"/m)?.[1];
  const version = manifest.match(/^version\s*=\s*"([\d.]+)"/m)?.[1];
  if (!name || !version) throw new Error('Unsupported module name/version; inspect moon.mod');
  process.stdout.write(run(moon, ['package', '--frozen', '--target-dir', join(temp, 'build')], root));
  const archive = join(temp, 'build/publish', `${name.replaceAll('/', '-')}-${version}.zip`);
  const entries = run('unzip', ['-Z1', archive], root).trim().split('\n');
  const tracked = new Set(run('git', ['ls-files', '-z'], root).split('\0'));
  for (const entry of entries) {
    if (!tracked.has(entry) || entry.split('/').some(part => part === '..' || part.startsWith('.')) || entry.includes('\\')) {
      throw new Error(`Unexpected archive entry: ${entry}. Commit/stage intended source files and inspect packaging rules.`);
    }
    if (/^(?:AGENTS\.md|PROJECT_PROPOSAL_DRAFT\.md|docs\/(?:WORKLOG\.md|proposal-editing-notes\.md|review-.*)|artifacts\/|node_modules\/|_build\/|web\/engine\.js)/.test(entry)) {
      throw new Error(`Development/generated file leaked into package: ${entry}`);
    }
  }
  for (const required of ['moon.mod', 'moon.pkg', 'LICENSE', 'README.md', 'THIRD_PARTY.md', 'pkg.generated.mbti', 'audit.mbt', 'adapters.mbt', 'comparison.mbt']) {
    if (!entries.includes(required)) throw new Error(`Missing package file: ${required}`);
  }
  const library = join(temp, 'library'), consumer = join(temp, 'consumer');
  await mkdir(library); await mkdir(consumer);
  run('unzip', ['-q', archive, '-d', library], root);
  await writeFile(join(temp, 'moon.work'), 'members = ["library", "consumer"]\n');
  await writeFile(join(consumer, 'moon.mod'), `name = "local/package_consumer"\nimport { "${name}@${version}" }\n`);
  await writeFile(join(consumer, 'moon.pkg'), `import { "${name}" @audit, "moonbitlang/core/json" } for "test"\n`);
  await writeFile(join(consumer, 'consumer_test.mbt'), await readFile(join(root, 'test/consumer.mbt.fixture')));
  for (const target of ['js', 'wasm-gc', 'native']) {
    process.stdout.write(`${target}: ` + run(moon, ['test', '--frozen', '--package', 'local/package_consumer', '--target', target, '--deny-warn'], consumer));
  }
  console.log(`Verified ${entries.length} tracked archive files and an independent consumer on 3 backends. No registry publication or installation was tested.`);
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
