# 持续迭代看板（过审导向）

定时：本地每 2 小时一轮至 **2026-10-27 14:00**（`AGENT_LOOP_TICK_final-review`）。

## 已完成（本机）
- 定位：准备+验证工作台；Teich 对标；完整轮次/混合/Trainer 接入
- 入口：/ 产品页；/prepare.html 主路径；/audit.html 门禁
- 评审：npm run demo:reviewer → artifacts/reviewer-demo/
- 准备页策略预设下拉：`traces/presets.json` → assistant-all / final-only / tools-and-answers；手改勾选回落自定义
- 第二模板族：`zephyr-typed-v1` + 准备页「加载 Zephyr 风格演示」（自写 WordLevel）
- Hub 评审验收清单（ACCEPTANCE CHECKLIST）
- 报名事实卡：`npm run facts:registration` → `artifacts/registration-facts/facts.json`
- 架构文档对齐工作台分层（`docs/architecture.md`）
- 准备页长度策略一键演示（右截断 192 / 完整轮次 200）
- 评审收口包 `docs/REVIEWER_PACK.md` + facts 长度数字
- 远端 tip：推送本轮后更新；仓库 Description 已为工作台表述
- 定时循环：至 **2026-10-27 14:00** 停止（本 tick 为截止前最后实质增量）

## 下一刀（按过审杠杆排序）
1. 本人独立更新报名表（截止 10/31；用 facts.json / REVIEWER_PACK 自引数字，AI 不代写终稿）
2. 可选：外部试用记录（不要虚构）

## 不做
- 堆无验收功能、冒充 Teich 全量替代、代写本人终稿、虚构 Zephyr Hub 词表
