# SupervisionAudit 报名材料参考（2026-10-21）

> AI 辅助整理的事实与提纲，供本人核对后独立填写官方表格。不能冒充本人最终申报回答。

## 建议项目名称与一句话

- 名称：SupervisionAudit
- 一句话：以 MoonBit 为核心的训练数据准备与监督验证工作台；对标 Teich 的模板渲染与掩码流程，在训练前生成可追溯 labels 并门禁错误监督。

## 建议定位（粘贴前请改成自己的话）

SupervisionAudit 面向需要准备对话微调与工具调用训练数据的开发者，以及需要检查预训练/预处理结果的训练团队。主路径不是“只审计现成标签”，而是：

原始 messages/tools → 标准化 → Teich/HF 原生模板与分词 → MoonBit 监督策略与 labels → 长度策略 → 审计门禁 → 训练 JSONL 与 token 证据 → 可选接入 Hugging Face Dataset / SFTTrainer。

## 核心功能

1. 多轮对话与工具轨迹标准化（调用 ID 配对、required 参数存在性）
2. 固定版本 Teich 原生模板适配与真实 tokenizer 偏移
3. 六类监督策略与 MoonBit labels（与 Teich `mask_data` 对照）
4. 序列长度：`reject` / `truncate-right` / `truncate-complete-turns`（对标 trim_followups 意图）
5. 训练前审计门禁、修复比较、逐 token 证据工作台（`/audit.html`）
6. 多源轨迹混合与已门禁 JSONL 的 HF Dataset 加载辅助
7. 产品入口 `/` + `npm run demo:reviewer` 五分钟复现证据
8. 原有预训练拼接 / Padding / shift 检查继续可用

## 应用场景

1. 准备多轮 SFT 数据并检查每个训练目标
2. 准备工具调用数据，默认不训练工具返回
3. 超长样本按完整回答轮截断，避免 silent mid-turn cut
4. 混合多份轨迹后导出，再交给 `SFTTrainer`（`packing=False`）

## 与 Teich 关系

- 对标：Teich `prepare_data` / `mask_data` / `trim_followups`
- 验证：固定提交 `609412f`；23 组 labels 一致、7 组空目标双方拒绝、2 组故障门禁
- 边界：不替代 agent 生成与完整 Teich Studio；MoonBit 负责合同、标签、长度门禁与证据

## 证据链接

- 仓库：https://github.com/FidollarinLA/supervision-audit
- 产品定位：docs/PRODUCT.md
- 初审对应：docs/review-response-2026-10-13.md
- 长度控制：docs/review-response-2026-10-18.md
- 本轮补强：docs/review-response-2026-10-21.md
- 使用说明：docs/training-preparation.md
- Trainer 配方：docs/trainer-recipe.md
- 评审演示：`npm run demo:reviewer` → artifacts/reviewer-demo/evidence.json

## 诚实边界

未完成正式 Mooncakes 新版本宣称、外部用户收益测量、全部模型模板、多模态与 agent 执行。演示数据可复现，不代表生产训练效果。重新提交截止：2026-10-31 前（以组委会通知为准）。
