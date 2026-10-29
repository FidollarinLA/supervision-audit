# 评审 10 分钟包（可核对）

不是官方通过证明。用于快速打开仓库后核对产品面与数字。

## 打开什么

| 步骤 | 入口 |
| --- | --- |
| 1 | `npm run build` → `npm run demo:reviewer` → `npm run facts:registration` |
| 2 | `npm run dev` → [http://127.0.0.1:4317/](http://127.0.0.1:4317/) |
| 3 | 首页验收清单 → 准备页 →（可选）审计门禁 |
| 4 | [ACCEPTANCE_GATE.md](ACCEPTANCE_GATE.md) 对照官方九条 |

## 应看到的数字

| 场景 | 期望 |
| --- | --- |
| Qwen + assistant-all | 45 训练目标 |
| Qwen + final-only | 24 训练目标 |
| 准备页「对比预设目标数」 | Qwen：45 / 24 / 45；推理演示：199 / 78 / 155 |
| 右截断 max=192 | 33 目标（演示夹具） |
| 完整轮次 max=200 | 通过门禁（默认 Qwen 夹具） |
| Zephyr 风格演示 | `zephyr-typed-v1`，1 目标（自写 WordLevel） |
| 多源混合演示 | 准备页「加载多源混合演示」→ 2 行（`mix-traces` seed=7 冻结输出） |

## 文档

- [PRODUCT.md](PRODUCT.md) 定位
- [architecture.md](architecture.md) 分层
- [review-response-2026-10-21.md](review-response-2026-10-21.md) Teich 边界
- [acceptance.md](acceptance.md) 自查入口

## 本人事项

官方报名终稿须参赛者独立撰写（可用 `artifacts/registration-facts/facts.json` 引数字）。不代写、不虚构外部试用。
