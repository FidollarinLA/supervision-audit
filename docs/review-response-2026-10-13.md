# 初审意见对应的实现与复审证据

本文件记录已实现的产品调整和可复现证据，供参赛者核对。不是官方通过证明，也不是要求本人独立撰写的最终报名答案。

## 定位

**SupervisionAudit：以 MoonBit 为核心的训练数据准备与监督验证工作台。** 服务于准备对话微调与工具调用训练数据的开发者，以及需要检查预训练数据预处理结果的训练团队。

入口已从“只能读取已有标签”扩展到“原始 messages / tools”。交付包含标准化校验、模型模板适配、带类型的训练策略、MoonBit 标签生成、训练 JSONL 输出、审计门禁和逐 token 证据。CLI 可从原始对话一步运行；浏览器在本地检查轨迹、选择策略、生成训练文件，并继续查看证据。

## 逐项对应评审意见

| 初审意见 | 实际调整 | 可检查证据 |
| --- | --- | --- |
| 独立审计工具，范围过窄 | 增加原始轨迹标准化与标签生成；审计成为准备流程中的门禁 | preparation/preparation.mbt、prepare.mjs、/prepare.html；[使用说明](training-preparation.md) |
| 需求与应用价值有限 | 提供多轮 SFT、工具调用训练、训练前 CI 三个具体工作流 | 下方场景；原始输入 → 实际分词 → 可下载 JSONL → token 证据 |
| 参考成熟框架，明确边界 | 固定 Teich 源码版本；使用其原生格式化能力，声明 MoonBit 的职责和未覆盖模块 | [源码锁](../integrations/teich/reference-lock.json)、[职责对照](#与-teich-的职责对照) |
| 作为对标和验证辅助 | 运行 Teich 公开 prepare_data/mask_data API，逐 token 比较另一套 MoonBit 标签实现 | [32 项机器记录](measurements/teich-preparation-2026-10-13.json)、[冻结参考](../examples/traces/teich-label-reference.json) |
| 说明核心功能与价值 | 核心负责可靠的数据契约与可追溯的训练目标，同一实现可被 MoonBit 程序、CLI、浏览器复用 | 三后端核心测试、独立包消费者、实际浏览器下载等值检查 |

## 三个已经能运行的使用场景

1. **准备多轮对话微调数据。** 开发者提供完整 messages 和来源 ID，校验后用目标 tokenizer 的模板渲染。选择助手回答等监督内容，生成 unshifted labels 和训练 JSONL；在证据页检查每个目标。改变策略会清除旧输出，空有效目标拒绝交付。
2. **准备工具调用训练数据。** 原始轨迹包含函数声明、助手调用和 tool 返回。MoonBit 校验函数名称、required 参数存在性、唯一调用 ID 与结果配对。默认训练助手调用及回答，工具返回作为上下文；final-only 可排除调用。实际 Qwen 演示默认 45 目标，final-only 24 目标，工具返回默认 0 目标。
3. **接入训练前门禁与预处理回归。** 通过门禁的训练文件附带审计文档；团队修改 collator 后，用文档中的目标集合检查漏标或多标，再通过已有安全版本比较复核。新增工具返回误标故障被门禁拦截。原有预训练文档拼接、Padding、shift、Trainer 前向门禁继续可用。

场景价值是减少手写 masking 的接入工作、使训练目标和来源可检查，并在运行训练前拒绝已检测出的错误。尚无真实外部用户的工时或算力收益测量，不写成量化收益。

## 与 Teich 的职责对照

| 流程 | Teich 的官方能力 | 本次 SupervisionAudit 的明确范围 |
| --- | --- | --- |
| Agent 数据生成与原生事件读取 | 多 provider 生成与 trace loader/converter | 不实现 agent 执行；接收显式 OpenAI 风格文本 messages/tools |
| 模板格式化与候选区间 | prepare_data 与多模型格式化 | 可选适配层实际调用 Teich；本轮验证固定 Qwen ChatML 原生模板 |
| 训练目标选择与 labels | mask_data 的类型策略与 token 对齐 | MoonBit 独立生成六类策略标签；实际运行 Teich API 对照 |
| 审计与诊断 | 官方 SFT 审计与预览 | 原有 MoonBit 契约/期望目标/Padding/来源/边界检查、修复比较及证据工作台 |
| 复用与执行入口 | Python 数据生态、Studio、Trainer 接入 | MoonBit JS/Wasm GC/native 库、离线 CLI 与浏览器；Python 只用于可选模型格式化/分词 |

Teich 已经覆盖相邻流程，本项目不宣称首创或全面替代。项目价值在于可复用的 MoonBit 数据合同和标签/门禁核心、浏览器证据流程，以及与成熟 Python 工具的可验证互操作。

## 复审演示与验收方法

启动后打开 `/prepare.html`：校验原始轨迹 → 默认准备 → 查看 45 个目标且工具返回为 0 → 关闭“工具调用”后准备并下载 → 一键查看 token 证据。再运行 `python integrations/teich/verify.py` 核对真实 Teich 输出。详细命令、来源和边界见[完整准备说明](training-preparation.md)。

本机已验证 23 组标签一致、7 组空目标双方拒绝、2 个故障门禁；核心每后端 54 测试（既有 26 + preparation 28），Node 63 项全部通过；实际浏览器 8 项流程通过。新增 CI 配置不等于远端 CI 已通过。

通知给出的重新提交期限是 **2026 年 10 月 31 日**。参赛者应在最新版仓库可检查后，根据本人实际理解独立更新报名表中的定位、核心功能、使用场景和证据链接。不要把 AI 整理的本文件冒充本人独立写作，最终复审与验收由组委会决定。
