# SupervisionAudit

用 MoonBit 检查 AI 训练预处理输出中的监督标签、角色区间和样本来源，定位到每个 token。核心是独立实现的确定性库；命令行与本地查看器调用同一套 MoonBit 判断。

**状态：0.1.0 可运行原型，尚未完成赛事验收或 Mooncakes 发布。** 示例是合成故障数据，不代表已验证真实模型效果。GitHub: https://github.com/FidollarinLA/supervision-audit

## 运行可视化界面

需要官方 MoonBit 工具链、Node.js 22 或以上，无 npm 运行依赖。

```sh
npm run build
npm run dev
```

打开 http://127.0.0.1:4317 。六种场景可切换；支持文件导入、输入编辑、问题筛选、token 证据定位、JSON 报告导出及基线比较。数据在浏览器内处理，文件不上传至服务器。

## 命令行

```sh
npm run build
node cli.mjs examples/healthy.json
node cli.mjs examples/preprocessed.jsonl --jsonl --roles assistant
node cli.mjs examples/healthy.json --baseline examples/role-leak.json
node cli.mjs examples/healthy.json --out report.json
```

退出码：0 通过；1 有错误；2 输入或命令错误；3 需要复核。比较模式成功执行返回 0，并不表示某版本更好。

## 数据契约

当前仅支持 `causal-lm-unshifted-v1`：模型在内部做下一 token 位移；labels 与 input_ids 等长，标签为同位置 token ID 或 -100。attention_mask 是逐 token 的 0/1 掩码，**不支持 block-diagonal attention 或其他隔离机制**。详见 [数据契约](docs/contract.md)。

`allowed_roles` 明确设置监督策略；user、system、tool 也可以合法参与训练。缺少角色或来源映射会返回 `review`，不会猜测通过。所有区间是 token 索引的左闭右开区间，不是字符偏移。

审计不执行模型训练，不证明模型效果，不验证 tokenizer 的语义正确性。监督数量是声明标签数量，位置 0 的标签不产生内部位移后的预测。比较中的 `stable` 仅指 token/监督数量稳定，不等于内容不变。

## MoonBit 库接口

公开接口包括 `audit(Document) -> Report`、`compare(Report, Report) -> Comparison`；JavaScript 桥接为 `audit_json`、`audit_jsonl` 和 `compare_json`。接口文件为 [pkg.generated.mbti](pkg.generated.mbti)。

仓库尚未发布至 Mooncakes。源码引用可将模块放在工作区，或先以桥接接口验证；不要运行尚未存在的包安装命令。

## 验证

```sh
moon check --target js --deny-warn
moon test --target js --deny-warn
moon test --target wasm-gc --deny-warn
moon test --target native --deny-warn
moon info
moon fmt
npm run build
npm test
```

测试包括正常/异常数据、不同监督策略、无来源时的边界行为、输入错误、拼接目标和版本比较。独立 JavaScript 判定器验证 128 组固定种子策略组合。CI 在公开仓库执行上述检查。

## 结构与后续工作

- `audit.mbt`：数据契约、逐 token 审计、JSON 桥接。
- `adapters.mbt`：已分词训练记录的 JSONL 导入。
- `comparison.mbt`：按样本 ID 比较声明覆盖与问题证据。
- `web/`：可视化界面，调用编译后的 MoonBit 核心。
- `examples/`、`test/`：可复现实例与桥接测试。
- [架构与迭代路线](docs/architecture.md)、[验收准备](docs/acceptance.md)。

优先迭代真实训练流程适配和参考结果对照，再做流式处理与更多契约。所有新增工作保留在本项目中。

## 来源与许可证

Apache-2.0。项目独立编写，没有移植 Teich 代码。功能邻近项目、依赖与测试来源见 [来源说明](THIRD_PARTY.md)。不宣称全球首创，不以搜索未发现代替完整查重。
