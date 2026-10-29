# 赛事验收对照（9 条）

本文对照官方验收指南做仓库自查，**不是**官方已通过证明。证据以公开 GitHub / CI / Mooncakes 为准。

| # | 验收要求 | 本仓库证据 | 状态 |
| --- | --- | --- | --- |
| 1 | MoonBit 为主要实现语言；moonc ≥ 0.10.16 | 核心判断在 `*.mbt` / `preparation/*.mbt`；JS 仅 I/O 与呈现（见 [architecture.md](architecture.md)、[AGENTS.md](../AGENTS.md)）。CI 安装官方工具链并断言 `moonc` 主版本 ≥ 0.10.16；本机已用 moonc v0.10.16 核对。 | 具备 |
| 2 | GitHub 公开可访问，提交清晰 | https://github.com/FidollarinLA/supervision-audit （public，Apache-2.0）；`main` 有实质功能提交与 Actions 记录。 | 具备 |
| 3 | 源码结构清晰，能完成声明的核心功能 | 根包审计/比较；`preparation/` 标签与长度门禁；`web/` 工作台；`cli.mjs` / `prepare.mjs`。 | 具备 |
| 4 | README：目标、安装、使用、示例，可复现 | [README.md](../README.md) 含克隆、`npm run build` / `dev`、CLI 与准备示例；`npm run demo:reviewer` 可离线复现数字。 | 具备 |
| 5 | CI 覆盖检查、构建、测试 | [.github/workflows/check.yml](../.github/workflows/check.yml)：`moon check/test`（js/wasm-gc/native）、`moon info`/`fmt`、`npm run build`/`test`、Teich/浏览器准备、可选 Python 参考。 | 具备 |
| 6 | 至少一个可运行示例 | `examples/`、`examples/traces/`；`npm run demo:reviewer`；浏览器 Qwen 演示。 | 具备 |
| 7 | 完整测试覆盖核心路径 | MoonBit 多后端测试 + `npm test` + preparation/sequence/policy-compare + Teich 对照 + 浏览器准备工作流。 | 具备 |
| 8 | 发布到 mooncakes.io | 已发布 [`FidollarinLA/supervision_audit@0.1.0`](https://mooncakes.io/docs/FidollarinLA/supervision_audit@0.1.0)；`moon view FidollarinLA/supervision_audit@0.1.0` 可查。源码版本见 `moon.mod`（后续小版本发布需 `moon login` 后执行 `npm run publish:mooncakes`）。 | 具备（0.1.0 在线） |
| 9 | OSI 认可许可证；第三方合规 | [LICENSE](../LICENSE) Apache-2.0；来源与 Teich/HF 边界见 [THIRD_PARTY.md](../THIRD_PARTY.md)。 | 具备 |

## 评审最短复现

```sh
# 需官方 MoonBit 工具链（moonc ≥ 0.10.16）与 Node.js 22+
git clone https://github.com/FidollarinLA/supervision-audit.git
cd supervision-audit
npm run build
npm test
npm run demo:reviewer
npm run facts:registration
npm run check:registry   # 核对 Mooncakes 0.1.0 可安装
npm run dev              # http://127.0.0.1:4317/
```

## 本人仍须确认

- 官方验收入口的提交/勾选（如有）由参赛者本人完成；仓库持续开发即可，无需再交表格（以赛方最新通知为准）。
- 不代写报名终稿；不虚构外部试用。
