#!/usr/bin/env node
// Push HEAD's changed files onto a remote parent via Git Data API (HTTPS:443 git push workaround).
import {execFileSync} from 'node:child_process';

const parent = process.argv[2];
const message = process.argv[3];
if (!parent || !message) {
  console.error('Usage: node scripts/api-push-head.mjs <parent-sha> <message>');
  process.exit(1);
}
const repo = 'FidollarinLA/supervision-audit';
const run = (cmd, args, input) =>
  execFileSync(cmd, args, {encoding: 'buffer', input, maxBuffer: 64 * 1024 * 1024});
const ghJson = (method, path, body) => {
  const args = ['api', '-X', method, path];
  let input;
  if (body !== undefined) {
    args.push('--input', '-');
    input = Buffer.from(JSON.stringify(body));
  }
  return JSON.parse(run('gh', args, input).toString('utf8'));
};

const names = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], {
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .filter(Boolean);
const treeItems = [];
for (const path of names) {
  const line = execFileSync('git', ['ls-tree', 'HEAD', '--', path], {encoding: 'utf8'}).trim();
  const parts = line.split(/\s+/);
  const mode = parts[0];
  const shaLocal = parts[2];
  const blobBuf = execFileSync('git', ['cat-file', 'blob', shaLocal]);
  const blob = ghJson('POST', `repos/${repo}/git/blobs`, {
    content: blobBuf.toString('base64'),
    encoding: 'base64',
  });
  if (blob.sha !== shaLocal) throw new Error(`sha mismatch ${path}: ${blob.sha} vs ${shaLocal}`);
  console.log('ok', path);
  treeItems.push({path, mode, type: 'blob', sha: blob.sha});
}
const parentCommit = ghJson('GET', `repos/${repo}/git/commits/${parent}`);
const tree = ghJson('POST', `repos/${repo}/git/trees`, {
  base_tree: parentCommit.tree.sha,
  tree: treeItems,
});
const localTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {encoding: 'utf8'}).trim();
if (tree.sha !== localTree) throw new Error(`tree mismatch local=${localTree} remote=${tree.sha}`);
const commit = ghJson('POST', `repos/${repo}/git/commits`, {
  message,
  tree: tree.sha,
  parents: [parent],
});
ghJson('PATCH', `repos/${repo}/git/refs/heads/main`, {sha: commit.sha, force: false});
console.log('remote', commit.sha);
