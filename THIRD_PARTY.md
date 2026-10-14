# 实现、参考与数据来源

本项目使用 AI 辅助开发，由参赛者负责理解、核查和维护。MoonBit 审计代码独立编写，没有复制或移植其他训练审计项目的实现。

运行依赖为 MoonBit 官方核心库（Apache-2.0）；Node.js 仅作为构建、文件 I/O 和本地静态服务器运行时。前端不使用第三方组件、字体、图标、统计或遥测服务。

功能对照：Teich（https://github.com/TeichAI/teich ，Apache-2.0）覆盖数据格式化、response masking 和训练审计。本项目采用相邻问题定义，但不宣称其能力缺失、也不宣称全球首创。当前没有移植其代码或模板。

MoonBit 生态邻近组件：tokenizers-moonbit（https://github.com/howtomakeaname/tokenizers-moonbit）、moonjinja（https://github.com/ZSeanYves/moonjinja）。当前并不依赖或复制这些项目。

examples/ 的 token ID、区间和故障全部为本项目合成，没有来自真实用户对话或受限模型。独立判定测试也是合成测试；不能以这些结果声称已完成真实模型验证。

标准许可证正文采用 Apache License 2.0。后续引入真实模型导出、第三方夹具、代码或数据时须记录其链接、许可证、版本和授权范围。


可选预处理集成（2026-10-04）：`integrations/transformers/` 调用 Transformers 4.57.1、Tokenizers 0.22.1 和 NumPy 2.3.4 的公开接口，不复制其实现；仅用于重建测试夹具，不是 MoonBit 核心或 Web 运行依赖。上游分别为 [Transformers](https://github.com/huggingface/transformers/tree/v4.57.1)（Apache-2.0）、[Tokenizers](https://github.com/huggingface/tokenizers/tree/v0.22.1)（Apache-2.0）和 [NumPy](https://github.com/numpy/numpy/tree/v2.3.4)（BSD-3-Clause；二进制发行包可能另含依赖许可，见安装包内说明）。不将这些依赖的许可证改称为本仓库许可证。

`examples/transformers/corpus.jsonl` 是本仓库自写的三句合成文本，随项目采用 Apache-2.0；`batch.jsonl` 是真实分词器和 collator 生成的数组，来源、参数、词表及内容散列见同目录 `manifest.json`。没有下载模型权重、外部语料或真实用户数据；真实预处理调用不等于真实训练质量验证。

`examples/transformers/truncate-left/` 与 `truncate-right/` 复用上述语料和依赖，通过公开 tokenizer 截断参数生成；各自清单记录截断方向、长度及原始 token 保留区间，没有新增外部数据来源或复制实现代码。

可选模型损失实验另调用 [PyTorch 2.10.0](https://github.com/pytorch/pytorch/tree/v2.10.0)（BSD 风格许可证及其依赖许可，见上游 LICENSE）。微型 GPT-2 从 Transformers 配置在本地随机初始化，不下载模型权重，不复制上游实现；独立交叉熵判定器由本仓库编写。仅执行前向、反向观察，不更新参数、不宣称训练质量或收敛。


2026-10-13 训练数据准备：可选适配层实际使用 [Teich 固定提交 609412fcb5649268b6de3f789fc0d59c4dce0585](https://github.com/TeichAI/teich/tree/609412fcb5649268b6de3f789fc0d59c4dce0585)（Apache-2.0）的公开 prepare_data/mask_data API。完整源码仅放忽略目录或按 requirements 安装，不复制入 MoonBit 核心；源码 Git blob 锁记录在 integrations/teich/reference-lock.json。格式化/候选范围由 Teich 提供，MoonBit 标签实现独立编写，对照共享范围不称为独立的端到端格式化实现。原有“未移植代码”仍适用于 MoonBit 核心，已增加明确的可选 Teich 依赖。

examples/traces 的对话、函数声明、工具返回与推理内容为项目原创合成输入，按 Apache-2.0；不是外部用户或生产语料。Qwen 原生模板派生记录沿用此前固定 Qwen tokenizer/config 的 Apache-2.0 来源，不分发词表或权重。推理模板为项目自定义 ChatML/WordLevel，仅验证策略，不冒称模型原生模板。teich-label-reference.json 是实际公开 mask_data API 的测试输出，保留固定版本及生成脚本。新增可选依赖 datasets、pandas、rich、typer、zstandard 等按各官方发行许可安装，未将第三方包代码放入库/前端运行包。具体验证与责任划分见 docs/training-preparation.md。
