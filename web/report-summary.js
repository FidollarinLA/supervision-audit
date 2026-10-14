import { explainFinding } from './finding-help.js';
import { expectationCoverage } from './expectation-coverage.js';

export function reportSummary(result) {
  if (!result.ok) return `无法审计/比较：${result.error}`;
  if (result.comparison) {
    const c = result.comparison;
    return `比较完成：${c.before_status} → ${c.after_status}；新增 ${c.new_findings.length}，消失 ${c.resolved_findings.length}。比较成功不代表新数据通过或模型效果改善。`;
  }
  const r = result.report;
  const lines = [`审计 ${r.status} | ${r.sample_count} 样本 / ${r.token_count} token | 标签 ${r.supervised_tokens} / 位移后目标 ${r.effective_target_count}`,
    `错误 ${r.error_count} · 提示 ${r.warning_count} · 缺少证据 ${r.unknown_count}`,
    `报告 ${r.report_schema} | ${r.contract} | ${r.boundary_policy}`];
  if (r.findings.length) {
    const counts = new Map();
    for (const f of r.findings) counts.set(f.code, (counts.get(f.code) || 0) + 1);
    const ordered = [...counts].sort((a, b) => b[1] - a[1]);
    lines.push('问题代码：' + ordered.slice(0, 5).map(([code, count]) => `${code}=${count}`).join('，') + (ordered.length > 5 ? `（另 ${ordered.length - 5} 类见完整报告）` : ''));
    const first = r.findings.find(f => f.severity === 'error') || r.findings[0];
    const help = explainFinding(first);
    lines.push(`首项：${first.code} · ${first.sample_id || '数据集'}${first.token_index == null ? '' : ' #' + first.token_index}`,
      `依据：${help.basis}`, `建议（请核对）：${help.fix}`, `无法判断：${help.limits}`);
  }
  lines.push('位移后目标包含故障标签，不表示全部合法；忽略边界目标不隔离注意力。');
  const coverage = expectationCoverage(r);
  lines.push(coverage.title + '：' + coverage.text);
  return lines.join('\n');
}
