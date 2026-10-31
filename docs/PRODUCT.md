# 产品定位与过审叙事

面向 MoonBit 开源大赛评审与复审材料。事实可核对；报名表最终文字须由参赛者本人填写。

## 一句话

**SupervisionAudit 是以 MoonBit 为核心的训练数据准备与监督验证工作台**；对标 Teich 的模板渲染与掩码流程，在训练前生成可追溯 labels，并拒绝错误监督。

## 不是什么 / 是什么

| 不是 | 是 |
| --- | --- |
| 只能读取现成 labels 的独立审计小工具 | 从原始轨迹到训练 JSONL 的准备链路 |
| Teich 的完整替代品 | MoonBit 可复用合同 + 与 Teich 的可验证互操作 |
| 自动提升模型效果的训练器 | 训练前数据合同、策略、长度与门禁 |

## 用户与价值

- **SFT / 工具调用数据准备者：** 少写手写 masking，明确训练了哪些内容。
- **训练前质量负责人：** collator / 截断变更后，用同一期望目标做回归门禁。
- **MoonBit 生态贡献：** 核心判断在 MoonBit，可被 JS / Wasm GC / native / 浏览器复用。

## 主路径（评审应看到的产品面）

1. 打开 `http://127.0.0.1:4317/` 产品入口（不是审计页）
2. 进入「训练数据准备」
3. 运行默认 Qwen 演示 → 45 目标 → 下载 JSONL
4. 切换策略预设 final-only → 24 目标，或点「对比预设目标数」一次看清差异；可选「Zephyr 风格演示」验证第二模板族
5. 一键进入审计门禁查看 token 证据
6. CLI：`npm run accept`（moonc/Mooncakes/演示自检）→ `npm run demo:reviewer` 产出 `artifacts/reviewer-demo/evidence.json`（含验收指针与 zephyr_typed_demo）

## 与 Teich 的边界（对外口径）

- Teich：模板格式化、typed spans、Python 数据生态
- SupervisionAudit：标准化、策略 labels、长度策略（含完整轮次）、审计门禁、浏览器证据、MoonBit 库
- 验证：固定 Teich 提交交叉核对 labels；不复制 Teich 标签实现

## 本阶段不做

Agent 执行、多模态、全模板覆盖、正式宣称生产收益、用 AI 稿冒充本人报名终稿。

分层、运行时与合同见 [architecture.md](architecture.md)。产品 backlog 见 [ITERATION_BOARD.md](ITERATION_BOARD.md)。
