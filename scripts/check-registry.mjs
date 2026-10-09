// Verify the published package without a local workspace or path dependency.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { resolve, join } from 'node:path';

const moon = process.env.MOON || resolve(homedir(), '.moon/bin/moon');
const name = 'FidollarinLA/supervision_audit', version = '0.1.0';
const temp = await mkdtemp(join(tmpdir(), 'supervision-audit-registry-'));
const run = args => execFileSync(moon, args, { cwd: temp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  const metadata = JSON.parse(run(['view', `${name}@${version}`, '--json']));
  if (metadata.status !== 'success') throw new Error('Published version could not be verified');
  await writeFile(join(temp, 'moon.mod'), `name = "local/registry_consumer"\nimport { "${name}@${version}" }\n`);
  await writeFile(join(temp, 'moon.pkg'), `import { "${name}" @audit, "moonbitlang/core/json" } for "test"\n`);
  await writeFile(join(temp, 'consumer_test.mbt'), await readFile(new URL('../test/consumer.mbt.fixture', import.meta.url)));
  process.stdout.write(run(['update']));
  for (const target of ['js', 'wasm-gc', 'native']) {
    process.stdout.write(`${target}: ` + run(['test', '--target', target, '--deny-warn']));
  }
  console.log(`Verified registry ${name}@${version} in an independent temporary module on 3 backends. No source/workspace override or registry mutation.`);
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
