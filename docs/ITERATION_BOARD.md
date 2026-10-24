# 持续迭代看板（过审导向）

## 已完成（本机）
- 定位：准备+验证工作台；Teich 对标；完整轮次/混合/Trainer 接入
- 入口：/ 产品页；/prepare.html 主路径；/audit.html 门禁
- 评审：npm run demo:reviewer → artifacts/reviewer-demo/
- 准备页策略预设下拉：`traces/presets.json` → assistant-all / final-only / tools-and-answers；手改勾选回落自定义

## 下一刀（按过审杠杆排序）
1. 本人独立更新报名表（截止 10/31；AI 不代写终稿）
2. 改仓库 Description（工作台，非纯审计）— push 后核对
3. 远端 CI 绿灯 + HEAD SHA 核对
4. 可选：第二模板 Zephyr 准备演示
5. 可选：外部试用记录（不要虚构）

## 不做
- 堆无验收功能、冒充 Teich 全量替代、代写本人终稿
