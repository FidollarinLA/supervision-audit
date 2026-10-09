import { writeFile } from 'node:fs/promises';
import { audit_json, audit_jsonl, compare_json } from './web/engine.js';
import { readAuditInput, readAuditStream } from './scripts/read-audit-input.mjs';

const usage = `Usage: node cli.mjs FILE.json [--out REPORT.json] [--summary]
       node cli.mjs FILE.jsonl --jsonl [--roles assistant,tool] [--out REPORT.json] [--summary]
       node cli.mjs AFTER.json --baseline BEFORE.json [--out COMPARISON.json] [--summary]
       preprocess-command | node cli.mjs - --jsonl --roles text [--summary]

Use - for piped stdin in place of FILE or BEFORE, but not both.
--summary  Print a Chinese summary to stderr; stdout remains JSON.
Exit codes: 0 pass/comparison completed, 1 audit failed, 2 input error, 3 review.
Comparison exit 0 does not mean that the new dataset passed its audit.`;

function parseArgs(args) {
  const options = {};
  const valued = new Set(['--roles', '--baseline', '--out']);
  const flags = new Set(['--jsonl', '--summary']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (valued.has(arg) || flags.has(arg)) {
      if (Object.hasOwn(options, arg)) throw new Error(`${arg} must not be repeated`);
      if (valued.has(arg)) {
        const value = args[++i];
        if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
        options[arg] = value;
      } else {
        options[arg] = true;
      }
    } else if (arg.startsWith('-') && arg !== '-') {
      throw new Error(`Unknown option: ${arg}`);
    } else if (options.file) {
      throw new Error('Only one input file is supported; use --baseline for comparison');
    } else {
      options.file = arg;
    }
  }
  if (!options.file) throw new Error(usage);
  if (options.file === '-' && options['--baseline'] === '-') {
    throw new Error('Only one input can read stdin; provide a file for the other side');
  }
  if (options['--baseline'] && options['--jsonl']) {
    throw new Error('--baseline requires JSON documents and cannot be combined with --jsonl');
  }
  if (options['--roles'] && !options['--jsonl']) {
    throw new Error('--roles is only supported with --jsonl; JSON documents declare allowed_roles');
  }
  if (options['--roles']) {
    options.roles = options['--roles'].split(',').map(role => role.trim());
    if (options.roles.some(role => !role)) throw new Error('--roles must contain non-empty comma-separated roles');
  }
  return options;
}

function readInput(path) {
  if (path !== '-') return readAuditInput(path);
  if (process.stdin.isTTY) throw new Error('Use a pipe or input redirection for stdin (-)');
  return readAuditStream(process.stdin);
}

// Presentation only: status, counts and diagnostics come directly from MoonBit.
function summary(result) {
  const status = value => ({ pass: '通过', fail: '失败', review: '需复核' })[value] ?? value;
  if (!result.ok) return `输入错误：${JSON.stringify(result.error)}\n`;
  if (result.comparison) {
    const c = result.comparison;
    return `比较完成：${status(c.before_status)} → ${status(c.after_status)}\n` +
      `新增问题 ${c.new_findings.length}；已解决问题 ${c.resolved_findings.length}。\n` +
      '退出码 0 仅表示比较执行完成，不表示数据通过审计或模型效果改善。\n';
  }
  const r = result.report;
  const lines = [
    `审计结果：${status(r.status)}`,
    `样本 ${r.sample_count}；token ${r.token_count}；声明监督标签 ${r.supervised_tokens}（不等同于实际损失项数量）。`,
    `位移后预测目标 ${r.prediction_targets ?? "无法计算"}（数量不代表目标符合监督策略）。`,
    `错误 ${r.error_count}；提示 ${r.warning_count}；未知证据 ${r.unknown_count}。`,
  ];
  for (const f of r.findings.slice(0, 5)) {
    // JSON quoting keeps user-controlled sample IDs on one terminal line.
    const location = f.token_index == null ? '' : ` token #${f.token_index}`;
    lines.push(`- ${f.code}：样本 ${JSON.stringify(f.sample_id)}${location}`);
  }
  if (r.findings.length > 5) lines.push(`另有 ${r.findings.length - 5} 项，详见完整 JSON 报告。`);
  if (r.status === 'pass') lines.push('仅表示当前支持的契约与所提供证据未发现问题，不保证训练效果。');
  if (r.status === 'review') lines.push('请核对提示和缺失证据；需复核不能视为通过。');
  if (r.status === 'fail') lines.push('请按报告定位并修正数据；修正后重新审计。');
  return lines.join('\n') + '\n';
}

if (process.argv.slice(2).includes('--help')) {
  console.log(usage);
} else {
  try {
    const options = parseArgs(process.argv.slice(2));
    const text = await readInput(options.file);
    const result = JSON.parse(options['--baseline']
      ? compare_json(await readInput(options['--baseline']), text)
      : options['--jsonl']
        ? audit_jsonl(text, JSON.stringify(options.roles ?? ['assistant']))
        : audit_json(text));
    const rendered = JSON.stringify(result, null, 2) + '\n';
    if (options['--out']) await writeFile(options['--out'], rendered);
    else process.stdout.write(rendered);
    if (options['--summary']) process.stderr.write(summary(result));
    process.exitCode = !result.ok ? 2 : result.comparison ? 0 :
      result.report.status === 'fail' ? 1 : result.report.status === 'review' ? 3 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
