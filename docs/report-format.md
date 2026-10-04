# 导出报告的版本与兼容约定

报告现在带有明确的格式版本，便于脚本、归档服务和后续工具判断如何读取。版本由 MoonBit 核心生成，命令行与浏览器导出直接保留；不是界面临时添加的信息。

| 输出内容 | 版本所在位置 | 当前值 |
| --- | --- | --- |
| JSON / JSONL 审计结果 | `report.schema_version` | `supervision-audit/report/v1` |
| 前后数据比较结果 | `comparison.schema_version` | `supervision-audit/comparison/v1` |
| 直接调用 MoonBit `audit` / `compare` | 返回结构的 `schema_version` | 对应上述格式 |
| 文件、解析或命令错误 | 无有效报告或比较对象 | 不应据此推断版本或审计通过 |

格式版本与输入的 `contract` 不同：`causal-lm-unshifted-v1` 描述训练标签的含义，`schema_version` 描述输出如何组织。也不要将它与 Mooncakes 模块版本或实际代码提交号混用；本字段不标识精确构建，不构成报告真实性证明。

## v1 的读取规则

1. 首先检查外层 `ok`。`ok: false` 时处理 `error`，不要尝试把缺失的报告当成零问题。
2. 根据所需结果类型，读取 `report` 或 `comparison`，核对完整的版本字符串。比较执行成功不等于当前数据通过审计。
3. 审计状态仍为 `pass`、`review` 或 `fail`。检查结果应以状态、错误及缺失证据共同解释，不能仅凭字段存在或版本匹配认定通过。
4. `supervised_tokens` 保持声明标签数；`prediction_targets` 为可选的位移后目标数。字段缺失表示未提供或无法计算，不能补成零。
5. `findings[].token_index` 缺失表示样本/文档级问题。新增诊断代码仍可能出现在同一格式版本中，消费端应保留未知代码及说明，并按 `severity`、整体状态处理。
6. 比较中的 `before_supervised`、`after_supervised`、`supervised_delta` 保持原来的声明数量含义。`stable` 不是内容一致或模型效果一致的证明。

一个只接收当前审计格式的读取示例：

```js
const result = JSON.parse(text);
if (result.ok !== true) throw new Error(result.error ?? '没有有效报告');
const report = result.report;
if (report?.schema_version !== 'supervision-audit/report/v1') {
  throw new Error('未知或旧版报告，需要显式选择兼容处理方式');
}
if (!['pass', 'review', 'fail'].includes(report.status)) {
  throw new Error('未知审计状态');
}
const targetDisplay = report.prediction_targets ?? '无法计算';
```

这只是版本分流示例，不是完整的 JSON 校验器。处理外部文件时仍需验证实际使用字段的类型和范围，不能因为文件自带版本字符串就信任其内容。

## 旧报告与升级

2026-10-05 加入此字段之前保存的报告没有格式标记，应视为旧版/未版本化数据，而不是自动视为 v1。保留原文件；需要当前结果时，使用原始 JSON/JSONL 重新审计。只有报告、没有原始数据时，可以做明确标为旧版的只读展示，但不能补造预测计数或宣称已经按当前规则复核。

不要简单往旧文件中插入版本字符串。旧结果可能缺少计数、诊断或证据，添加字符串不会补齐这些信息。当前比较入口接收原始审计输入文档，不接收归档报告；CLI 和界面尚不提供报告迁移或历史报告导入功能。

兼容约定：同一 v1 可以新增可选字段或诊断代码；不删除/改名既有字段，不改变既有字段和状态的定义。破坏这些约定时使用新主版本，消费端应先拒绝自动解释，再选择显式兼容路径。诊断修复和新增检查可能改变同一输入的审计结论，因此格式相同不代表运行结果永远相同。

MoonBit 源码调用方若直接构造 `Report` 或 `Comparison` 字面量，需要补充新的 `schema_version` 字段；通过 `audit` / `compare` 获取返回值的调用方式不变。本次没有更改训练输入契约或已有 JSON 字段。
