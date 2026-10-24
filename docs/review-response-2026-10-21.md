# 2026-10-21 复审补强：扩大准备链路，明确 Teich 对标边界

本文件对应组委会初审意见「独立审计工具 / 定位与功能边界过窄 / 应参考 Teich」。在 10-13 准备工作台与 10-18 长度控制之上，本轮继续扩大**可运行**能力，并写清与 Teich 的职责分工。材料供核对；最终报名页须由参赛者按本人理解独立填写。

## 定位（请以此更新报名表）

**SupervisionAudit：以 MoonBit 为核心的训练数据准备与监督验证工作台。**

不是“只读已有 labels 的审计器”。主路径是：

原始多轮 messages / tools → MoonBit 标准化 → 固定版本 Teich/HF 原生模板与分词 → MoonBit 六类监督策略与 labels → 序列长度策略 → 审计门禁 → 训练 JSONL / token 证据 →（可选）HF Dataset 接入。

预训练 Padding / 拼接审计、修复比较、Trainer 前向门禁仍是同一产品的训练前验证能力，不是全部产品。

## 逐项回应

| 初审意见 | 本轮与既有交付 | 可检查入口 |
| --- | --- | --- |
| 只做独立审计，范围过窄 | 首页改为产品入口；准备页为主路径；审计迁至 `/audit.html` 作为门禁；另有长度策略、多源混合、训练 JSONL、HF 加载与评审演示 | `/`、`/prepare.html`、`/audit.html`、`npm run demo:reviewer` |
| 需求与应用价值有限 | 四个可运行场景：多轮 SFT 准备、工具调用策略、完整轮次长度控制、混合轨迹后进 Trainer | 下方场景；默认 Qwen 演示可复现 |
| 参考 Teich，明确边界 | 固定 Teich `609412f`；格式化走 Teich；MoonBit 独立 labels；完整轮次截断对标 `trim_followups` 意图 | [Teich 对照](review-response-2026-10-13.md)、本文件职责表 |
| 作为对标与验证辅助 | 23 组 labels 一致、7 组空目标双方拒绝、2 组故障门禁；冻结前缀回归 | `python integrations/teich/verify.py`、`test/sequence.test.mjs` |
| 说明核心功能与价值 | MoonBit 提供可复用数据合同、策略标签、长度门禁与证据；Python 仅可选模板/分词/Dataset | `preparation/` 包、三后端测试、浏览器准备流 |

## 四个可运行场景

1. **多轮对话微调准备。** 校验 raw traces → 模板分词 → 选择监督内容 → 导出 JSONL → 证据页核对目标。
2. **工具调用训练策略。** 默认训练调用与回答、忽略工具返回；`final-only` 可排除调用；误把工具返回标成目标会被门禁拒绝。
3. **超长样本的明确取舍。** `reject` / `truncate-right` / `truncate-complete-turns` 三选一；完整轮次模式拒绝切在回答中间，并报告去掉了哪些后续轮的目标。
4. **混合后接入训练器。** `mix-traces` 合成多源行 → 同一准备门禁 → `load_prepared_jsonl.py` 校验后交给 `SFTTrainer`（`packing=False`）。不宣称模型效果。

## 与 Teich 的边界（更新）

| 能力 | Teich | SupervisionAudit |
| --- | --- | --- |
| Agent 轨迹生成 / 原生事件导入 | 支持多 provider / Studio | 不执行 agent；接收显式 OpenAI 风格轨迹 |
| Hub 混合与比例采样 | `prepare_data` 源混合 | 本地 `mix-traces` 显式 `take` + `seed` |
| 模板格式化与 typed spans | `prepare_data` | 可选适配层实际调用固定 Teich 提交 |
| 超长处理 | `oversized_policy` 如 `trim_followups` | MoonBit `truncate-complete-turns` / `truncate-right` / `reject` |
| labels / mask | `mask_data` | MoonBit 独立实现，并与 Teich 输出对照 |
| 训练前审计与证据 | 官方预览/审计 | MoonBit 契约审计、期望目标、比较工作台 |
| 运行时 | Python 数据生态 | MoonBit JS/Wasm GC/native 库 + 离线 CLI/浏览器 |

不替代完整 Teich。价值是 **MoonBit 可复用核心 + 可检查的准备/门禁链路 + 与成熟框架的可验证互操作**。

## 建议报名表述（提纲，非代写终稿）

- **一句话：** MoonBit 训练数据准备与监督验证工作台，对标 Teich 的模板/掩码流程并提供可复现门禁。
- **核心功能：** 轨迹标准化、Teich 模板适配、六类监督标签、长度策略（含完整轮次）、审计门禁、JSONL 导出、多源混合、HF Dataset 接入、预训练边界审计。
- **应用价值：** 让 SFT/工具调用数据在训练前可生成、可核对、可拒绝错误标签，降低手写 masking 与 silent truncation 风险。
- **边界：** 不做 agent 执行、不训练模型、不覆盖全部模板/多模态；Qwen 原生与自定义推理模板范围分开记录。

## 验证命令

```sh
node scripts/build.mjs
npm run demo:reviewer
moon test --target js --deny-warn -p FidollarinLA/supervision_audit/preparation
node --test test/sequence.test.mjs test/mix-traces.test.mjs test/preparation.test.mjs test/reviewer-demo.test.mjs
node scripts/verify-preparation-browser.mjs
python integrations/transformers/load_prepared_jsonl.py path/to/training.jsonl
# 浏览器：http://127.0.0.1:4317/ → 训练数据准备 → 监督审计门禁
```

远端 GitHub 描述若仍写 “supervision auditing only”，请同步改为准备与验证工作台；仓库代码以本机提交与 Actions 为准。重新提交截止日期以通知为准（2026-10-31 前）。

本机验证（2026-10-21）：preparation 包 JS 后端 33/33；`test/sequence.test.mjs` + `test/mix-traces.test.mjs` 8/8；`load_prepared_jsonl.py` 对默认 Qwen JSONL 输出 2 行 / 45 目标。当前环境最新官方 moonc 0.10.16 在 Windows 上触发 `\\?\` 路径 ICE，故用已有 0.1.20260920 工具链做逻辑回归；源码保持 Int32，供 CI / 0.1.20261012+ 正式构建。推送后以 GitHub Actions 为准。
