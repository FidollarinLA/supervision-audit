import { audit_json, audit_jsonl, compare_json } from './engine.js';
const $ = id => document.getElementById(id);
const statusName = { pass: '通过', review: '需复核', fail: '发现错误' };
const severityName = { error: '错误', warning: '提示', unknown: '缺少证据' };
const roleName = { user: '用户', assistant: '助手', system: '系统', tool: '工具', text: '预训练文本', unknown: '未知角色', conflict: '角色冲突' };
const stateName = { supervised: '参与监督', ignored: '已忽略', padding: 'Padding', error: '发现问题', unknown: '无法判断' };
const labels = {
  ROLE_POLICY_VIOLATION: ['监督范围错误', '这个位置的角色被当前策略排除，却仍带有训练标签。'],
  PADDING_SUPERVISED: ['Padding 参与训练', 'attention_mask 为 0 的位置仍带有训练标签。'],
  LABEL_TOKEN_MISMATCH: ['标签与 token 不一致', '当前契约要求 label 等于同位置 token ID，或为 -100。'],
  NO_PREDICTION_TARGETS: ['位移后没有预测目标', '只有首位置带标签，内部位移后没有可计算的预测目标；请核对样本长度或监督策略。'],
  NO_SUPERVISION: ['整条样本没有监督信号', '所有标签均为 -100，请确认是否为有意设置。'],
  SUPERVISION_REDUCED: ['监督信号减少', '声明数量少于提供的基线，需核对截断或预处理。'],
  SOURCE_OVERLAP: ['来源区间重叠', '同一个 token 被多个来源区间覆盖。'],
  ROLE_OVERLAP: ['角色区间重叠', '同一个 token 被多个角色区间覆盖。'],
  ROLE_PROVENANCE_MISSING: ['角色证据不足', '角色映射不完整，无法完整验证监督范围。'],
  SOURCE_PROVENANCE_MISSING: ['来源证据不足', '来源映射不完整，无法完整核对文档拼接。'],
  PACKING_CROSS_SOURCE_TARGET: ['跨文档预测目标', '后一个文档的起始 token 未忽略，普通因果注意力会从上一个文档预测它。是否接受该训练行为须由开发者确认；本契约要求隔离该目标。'],
  FIRST_TOKEN_NOT_PREDICTED: ['首个标签不产生预测', '模型内部位移时，位置 0 的标签不参与下一 token 预测。']
};
const PAGE_SIZE = 120;
let result = null, input = null, currentSample = 0, tokenStart = 0;
let baselineText = null, baselineName = '', revision = 0, baselineRevision = 0;
function element(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
function clearComparison() {
  $('comparison-panel').hidden = true;
  $('comparison').replaceChildren();
}
function clearBaseline() {
  // Clearing/replacing a baseline invalidates its pending read independently
  // of edits to the current audit input.
  baselineRevision++;
  baselineText = null; baselineName = ''; $('baseline').value = '';
  clearComparison();
}
function invalidate(message = '输入已修改，请重新运行审计。') {
  revision++;
  result = null; input = null;
  for (const id of ['metrics', 'tokens', 'findings', 'role-track', 'sample', 'sample-overview']) $(id).replaceChildren();
  $('detail').textContent = '请成功运行审计后查看证据。';
  $('ratio').textContent = '—'; $('progress').style.width = '0%';
  $('target-note').textContent = '位移后预测目标：无法计算。';
  $('export').disabled = true;
  $('previous-tokens').disabled = true; $('next-tokens').disabled = true;
  $('token-page').textContent = '';
  clearComparison(); $('notice').textContent = message;
}
function run() {
  try {
    const text = $('input').value;
    if ($('format').value === 'jsonl') {
      const policy = $('policy').value === 'all' ? ['system', 'user', 'assistant', 'tool'] : [$('policy').value || 'assistant'];
      result = JSON.parse(audit_jsonl(text, JSON.stringify(policy)));
      input = result.document;
    } else {
      result = JSON.parse(audit_json(text));
      input = JSON.parse(text);
    }
    if (!result.ok) throw new Error(result.error);
    $('notice').textContent = ''; currentSample = 0; tokenStart = 0;
    $('export').disabled = false;
    render(); renderComparison();
  } catch (error) { invalidate('无法审计：' + error.message); }
}
function render() {
  const report = result.report;
  const cards = [
    ['审计结果', statusName[report.status], '只针对声明的数据契约'],
    ['检查 token', report.token_count, report.sample_count + ' 条样本'],
    ['声明监督标签', report.supervised_tokens, `位移后预测目标：${report.prediction_targets ?? '无法计算'}`],
    ['发现的问题', report.error_count + report.warning_count + report.unknown_count, `${report.error_count} 错误 · ${report.warning_count} 提示 · ${report.unknown_count} 待核实`]
  ];
  $('metrics').replaceChildren(...cards.map(([title, value, sub], i) => {
    const node = element('div', 'metric' + ((i === 0 && report.status !== 'pass') || (i === 3 && report.error_count) ? ' alert' : ''));
    node.append(element('small', '', title), element('strong', '', value), element('p', '', sub));
    return node;
  }));
  $('sample').replaceChildren(...report.samples.map((sample, index) => {
    const option = element('option', '', sample.id); option.value = index; return option;
  }));
  const table = element('table', 'evidence-table');
  const heading = element('tr');
  for (const name of ['样本', 'Token', '声明标签', '位移后目标', '问题', '证据']) heading.append(element('th', '', name));
  table.append(heading);
  for (const [index, sample] of report.samples.entries()) {
    const row = element('tr');
    for (const value of [sample.id, sample.tokens, sample.supervised_tokens, sample.prediction_targets ?? '无法计算', sample.findings.length]) row.append(element('td', '', value));
    const cell = element('td'), button = element('button', 'text-button', '查看 →');
    button.onclick = () => selectSample(index);
    cell.append(button); row.append(cell); table.append(row);
  }
  $('sample-overview').replaceChildren(table);
  renderSample(); renderFindings();
}
function selectSample(index, tokenIndex) {
  currentSample = index; $('sample').value = index;
  tokenStart = tokenIndex == null ? 0 : Math.floor(tokenIndex / PAGE_SIZE) * PAGE_SIZE;
  renderSample(); if (tokenIndex != null) inspect(tokenIndex);
}
function sampleData(id) {
  const matches = input.samples.filter(item => item.id === id);
  return matches.length === 1 ? matches[0] : null;
}
function renderSample() {
  const sample = result?.report.samples[currentSample];
  $('tokens').replaceChildren(); $('role-track').replaceChildren();
  if (!sample) {
    $('detail').textContent = '没有可查看的样本；请查看数据集级别的问题。';
    $('ratio').textContent = '—'; $('progress').style.width = '0%';
    $('target-note').textContent = '位移后预测目标：无法计算。';
    $('token-page').textContent = '';
    $('previous-tokens').disabled = true; $('next-tokens').disabled = true;
    return;
  }
  const data = sampleData(sample.id);
  const end = Math.min(sample.tokens, tokenStart + PAGE_SIZE);
  let prior, groups = [];
  for (const role of sample.roles.slice(tokenStart, end)) {
    if (role !== prior) { groups.push({ role, count: 1 }); prior = role; }
    else groups.at(-1).count++;
  }
  for (const group of groups) {
    const node = element('div', 'role-group ' + group.role, (roleName[group.role] || group.role) + ' · ' + group.count);
    node.style.flex = group.count; $('role-track').append(node);
  }
  for (let index = tokenStart; index < end; index++) {
    const node = element('button', 'token ' + sample.states[index], data?.input_ids[index] ?? '?');
    node.append(element('span', '', '#' + index));
    node.setAttribute('aria-label', 'token ' + index + ' ' + stateName[sample.states[index]]);
    node.onclick = () => inspect(index); $('tokens').append(node);
  }
  $('previous-tokens').disabled = tokenStart === 0;
  $('next-tokens').disabled = end >= sample.tokens;
  $('token-page').textContent = sample.tokens ? `#${tokenStart}–${end - 1} / ${sample.tokens} 个 token` : '空样本';
  $('target-note').textContent = `位移后预测目标：${sample.prediction_targets ?? '无法计算'}。排除首位置标签；含错误目标，需结合审计结果判断。`;
  $('ratio').textContent = (sample.supervised_ratio * 100).toFixed(1) + '%';
  $('progress').style.width = (sample.supervised_ratio * 100) + '%';
  $('detail').textContent = '点击一个 token，查看标签、角色与来源证据。';
}
function inspect(index) {
  const sample = result.report.samples[currentSample];
  const data = sampleData(sample.id);
  if (!data) { $('detail').textContent = '样本 ID 重复或无法定位，不能展示唯一的原始 token 证据。请先修正 ID。'; return; }
  [...$('tokens').children].forEach((node, local) => node.classList.toggle('selected', local + tokenStart === index));
  $('detail').textContent = `位置 #${index} · Token ${data?.input_ids[index]} · Label ${data?.labels[index] ?? '缺失'} · Attention ${data?.attention_mask[index] ?? '缺失'} · ${roleName[sample.roles[index]] || sample.roles[index]} · ${stateName[sample.states[index]]} · 来源 ${sample.source_ids[index]}`;
}
function findingNode(finding) {
  const node = element('article', 'finding'), top = element('div', 'finding-top');
  top.append(element('b', '', labels[finding.code]?.[0] || finding.code), element('span', 'severity ' + (finding.severity === 'error' ? 'error' : 'unknown'), severityName[finding.severity]));
  node.append(top, element('p', '', labels[finding.code]?.[1] || finding.message));
  const button = element('button', '', (finding.sample_id || '数据集') + (finding.token_index != null ? ' / token #' + finding.token_index : ''));
  button.onclick = () => {
    const index = result.report.samples.findIndex(sample => sample.id === finding.sample_id);
    if (index >= 0) { selectSample(index, finding.token_index); $('tokens').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  };
  node.append(button); return node;
}
function renderFindings() {
  if (!result) return;
  const selected = $('filter').value;
  const findings = result.report.findings.filter(item => selected === 'all' || item.severity === selected);
  $('findings').replaceChildren();
  if (!findings.length) {
    const empty = element('div', 'clean-state');
    empty.append(element('span', '', '✓'), element('div', '', selected === 'all' ? '没有发现契约问题' : '此分类没有问题'));
    $('findings').append(empty); return;
  }
  for (const finding of findings.slice(0, 200)) $('findings').append(findingNode(finding));
  if (findings.length > 200) $('findings').append(element('p', 'limit-note', `显示前 200 项，共 ${findings.length} 项。导出报告包含完整结果。`));
}
function renderComparison() {
  clearComparison();
  if (!baselineText || !result) return;
  const response = JSON.parse(compare_json(baselineText, JSON.stringify(input)));
  if (!response.ok) { $('notice').textContent = '基线无法比较：' + response.error; return; }
  const comparison = response.comparison;
  $('comparison-panel').hidden = false;
  const summary = element('div', 'comparison-summary');
  summary.append(element('p', '', `${baselineName}：${statusName[comparison.before_status]} → 当前数据：${statusName[comparison.after_status]}`));
  summary.append(element('strong', '', `${comparison.new_findings.length} 项新增问题 · ${comparison.resolved_findings.length} 项已消失问题`));
  summary.append(element('p', '', '比较要求相同的数据契约与监督策略。数量稳定不代表 token 内容相同，也不代表模型效果不变。'));
  const table = element('table', 'evidence-table'), head = element('tr');
  for (const title of ['样本', '之前的标签', '现在的标签', '变化']) head.append(element('th', '', title));
  table.append(head);
  for (const sample of comparison.samples) {
    const row = element('tr');
    const change = ({ added: '新增样本', removed: '移除样本', stable: '数量稳定', changed: '数量变化' })[sample.change];
    for (const value of [sample.sample_id, sample.before_supervised ?? '—', sample.after_supervised ?? '—', change]) row.append(element('td', '', value));
    table.append(row);
  }
  const scroll = element('div', 'table-scroll'); scroll.append(table);
  const evidence = element('div', 'comparison-evidence');
  for (const [title, findings] of [['新增问题', comparison.new_findings], ['已消失问题', comparison.resolved_findings]]) {
    const column = element('div'); column.append(element('h3', '', title));
    for (const finding of findings.slice(0, 30)) column.append(element('p', '', `${labels[finding.code]?.[0] || finding.code} · ${finding.sample_id || '数据集'}${finding.token_index != null ? ' · #' + finding.token_index : ''}`));
    if (!findings.length) column.append(element('p', '', '没有'));
    if (findings.length > 30) column.append(element('p', '', `另有 ${findings.length - 30} 项；完整差异可通过 CLI 导出。`));
    evidence.append(column);
  }
  $('comparison').replaceChildren(summary, scroll, evidence);
}
async function loadPreset() {
  const ticket = ++revision;
  try {
    const response = await fetch('./examples/' + $('preset').value + '.json');
    if (!response.ok) throw new Error('示例加载失败');
    const data = await response.json();
    if (ticket !== revision) return;
    clearBaseline(); $('format').value = 'json';
    $('input').value = JSON.stringify(data, null, 2); run();
  } catch (error) { if (ticket === revision) invalidate(error.message); }
}
$('run').onclick = run;
$('preset').onchange = loadPreset;
$('input').oninput = () => invalidate();
$('format').onchange = () => invalidate();
$('policy').onchange = () => { if ($('format').value === 'jsonl') invalidate(); };
$('sample').onchange = () => selectSample(Number($('sample').value));
$('filter').onchange = renderFindings;
$('previous-tokens').onclick = () => { if (!result || !tokenStart) return; tokenStart -= PAGE_SIZE; renderSample(); };
$('next-tokens').onclick = () => { if (!result || tokenStart + PAGE_SIZE >= result.report.samples[currentSample]?.tokens) return; tokenStart += PAGE_SIZE; renderSample(); };
$('clear-baseline').onclick = clearBaseline;
$('file').onchange = async () => {
  const file = $('file').files[0]; if (!file) return;
  invalidate('正在读取本地数据…'); const ticket = revision;
  if (file.size > 1048576) { $('notice').textContent = '文件超过 1 MiB，请分批导出。'; return; }
  try {
    const text = await file.text(); if (ticket !== revision) return;
    $('format').value = file.name.toLowerCase().endsWith('.jsonl') ? 'jsonl' : 'json';
    $('input').value = text; run();
  } catch (error) { if (ticket === revision) invalidate('文件读取失败：' + error.message); }
};
$('baseline').onchange = async () => {
  const file = $('baseline').files[0];
  if (!file) { clearBaseline(); return; }
  baselineText = null; baselineName = ''; clearComparison();
  const ticket = revision, baselineTicket = ++baselineRevision;
  const isCurrent = () => ticket === revision && baselineTicket === baselineRevision;
  if (file.size > 1048576) { $('notice').textContent = '基线文件超过 1 MiB。'; return; }
  try {
    const text = await file.text(); if (!isCurrent()) return;
    baselineText = text; baselineName = file.name;
    $('notice').textContent = '';
    if (result) renderComparison(); else $('notice').textContent = '已读取基线，请先运行当前数据。';
  } catch (error) { if (isCurrent()) $('notice').textContent = '基线读取失败：' + error.message; }
};
$('compare-demo').onclick = async () => {
  clearBaseline();
  invalidate('正在载入修复演示…'); const ticket = revision;
  try {
    const responses = await Promise.all(['pretraining-boundary', 'pretraining'].map(name => fetch('./examples/' + name + '.json')));
    if (responses.some(response => !response.ok)) throw new Error('演示加载失败');
    const [before, after] = await Promise.all(responses.map(response => response.json()));
    if (ticket !== revision) return;
    baselineText = JSON.stringify(before); baselineName = '预训练修复前';
    $('format').value = 'json'; $('preset').value = 'pretraining';
    $('input').value = JSON.stringify(after, null, 2); run();
  } catch (error) { if (ticket === revision) invalidate(error.message); }
};
$('export').onclick = () => {
  if (!result) { $('notice').textContent = '请先成功运行审计。'; return; }
  const url = URL.createObjectURL(new Blob([JSON.stringify({ ok: true, report: result.report }, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'supervision-audit-report.json'; anchor.click(); URL.revokeObjectURL(url);
};
await loadPreset();
