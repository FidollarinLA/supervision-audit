// Presentation of statuses emitted by MoonBit; no new audit decision or score.
export function expectationCoverage(report) {
  const counts = {matched: 0, mismatch: 0, invalid: 0, 'not-provided': 0, unknown: 0};
  for (const sample of report.samples) {
    const status = Object.hasOwn(counts, sample.expectation_status) ? sample.expectation_status : 'unknown';
    counts[status]++;
  }
  counts.unknown += Math.max(0, report.sample_count - report.samples.length);
  const limited = counts.invalid + counts['not-provided'] + counts.unknown;
  const tone = counts.mismatch ? 'difference' : limited || !report.sample_count ? 'limited' : 'matched';
  const title = {difference: '预期监督存在差异', limited: '监督完整性覆盖不全', matched: '预期监督位置一致'}[tone];
  const text = `按所提供预期：一致 ${counts.matched}，差异 ${counts.mismatch}，未提供 ${counts['not-provided']}，无效 ${counts.invalid}，无法核对 ${counts.unknown}。` +
    (limited || !report.sample_count ? '未覆盖的样本不能排除遗漏或多余监督；pass 只表示支持的检查未发现问题。' :
      '位置检查不认证预期来源，也不证明其他训练逻辑正确。');
  return {title, text, tone, counts};
}
