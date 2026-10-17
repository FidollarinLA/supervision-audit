# 2026-10-18 迭代：从训练数据准备到可核查的长度控制

项目继续定位为 **MoonBit 训练数据准备与监督验证工作台**。上轮已实现原始多轮对话/工具轨迹 → 固定 Teich/HF 模板与真实分词 → 六类标签策略 → 训练 JSONL → 审计与 token 证据；本轮补足训练器有最大序列长度时的交付行为。此文是 AI 辅助整理的工程证据，不是报名表要求本人撰写的一页申报书。

## 三个完整工作流

1. **对话微调数据准备。** 开发者输入带来源的 messages，用目标 tokenizer 渲染，选择助手回答并导出 labels；遇到超出训练器上下文长度的样本时默认拒绝，而非隐式截断。产物是可下载的训练 JSONL 和可再次审计的文档。
2. **工具调用数据与长度策略。** 默认训练助手调用和回答，工具返回作为上下文；开发者明确选择右截断后，界面显示实际移除的 token 和训练目标。示例将工具轨迹从 216 裁至 192 token，移除 24 token / 12 目标，全批由 45 降至 33 目标。不能把这个减少当作效果优化；它可能删去最终回答，需按任务决定是否使用。
3. **训练前回归与门禁。** 同步裁剪来源区间、labels、attention mask 和 expected mask，重新审计，再交给保留 labels 的 collator；校验实际随机小模型的损失位置和 logit 梯度。若任何样本截断后没有有效目标，整批不导出；若 collator 将工具返回改为监督目标，下游 MoonBit 门禁返回 fail。

## 与成熟框架的关系

保留固定 Teich `609412fcb5649268b6de3f789fc0d59c4dce0585` 的公开 `prepare_data/mask_data` 对照。上轮 23 组完整标签一致、7 组空目标双方拒绝和2个注入故障门禁仍是完整标签验证；本轮另外将其冻结标签按显式 token 上限取前缀，82 组输出一致、56 组无有效目标的前缀拒绝。这是**完整 Teich 标签前缀对照**，没有运行或声称 Teich 具有相同的截断功能。

格式化和候选区间由 Teich 提供，MoonBit 实现标签组装、长度策略和审计。原生 Qwen 普通对话/工具模板与项目自定义推理模板分开验证，不扩大为任意模型、多模态或 agent 执行框架。[完整职责对照](review-response-2026-10-13.md)。

## 可复现证据

```sh
node scripts/build.mjs
node --test test/*.test.mjs
node scripts/verify-preparation-browser.mjs
python -m unittest discover -s integrations/transformers/loss_tests -p test_prepared_export.py -v
```

本地 MoonBit 0.1.20261012 的 JS/Wasm GC 核心各 57 项通过；Node 68/68；实际 Edge 浏览器 9 项、无 pageerror，并验证 390px 布局、拒绝/截断/空目标门禁、下载与核心逐项一致。新增三项实际 JSONL → collator → 随机 GPT-2 参考测试通过，包含完整 45 与截断 33 目标的损失/梯度对应、截断数量、注入工具返回故障。参考模型将 token ID 双射映射到小词表，仅验证未 shift labels、Padding、损失和梯度位置，不验证 Qwen 词嵌入语义或模型质量。本地 PyTorch 为 2.8.0+cpu、Transformers 4.57.1；CI 使用现有固定 CPU PyTorch 2.10.0。

Windows 本机缺少新版 native 后端要求的 MSVC 工具，native 和归档消费者以对应提交的 Linux/macOS 远端检查为准。旧提交 `cc61638` 的[远端 Check #13](https://github.com/FidollarinLA/supervision-audit/actions/runs/38598058674)已全部通过；它不证明本轮新增代码通过，新结果请核对[当前 PR](https://github.com/FidollarinLA/supervision-audit/pull/1)的具体提交检查。

核心范围与局限：右侧 token 截断，可能破坏完整消息/工具调用；未实现按轮次截断、左截断、padding、packing 或模型训练服务。原有 v1 根包接口保留；本轮是源码更新，未发布新 Mooncakes 版本，未声称外部用户收益或官方验收通过。

## 报名更新状态

2026-10-18 实际打开[官方十月报名表](https://bxup9uklfcb.feishu.cn/share/base/form/shrcnWUMlgpbwHaXgzV7HmNhNhg)：页面允许最多三次提交、重复修改；查看原提交记录需要本人飞书登录。新项目申报书字段要求一页 Markdown、至少三个完整预期场景、说明来源/许可证、仓库不少于十个有效 commits，并明确“不要使用 AI 编写”。应编辑 SupervisionAudit 的原答卷，保留本人确认的个人资料和承诺；不能把更新代码、AI 工程证据或草稿 PR 当作已经重新提交表格。
