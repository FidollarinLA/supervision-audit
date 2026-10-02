# 实现、参考与数据来源

本项目使用 AI 辅助开发，由参赛者负责理解、核查和维护。MoonBit 审计代码独立编写，没有复制或移植其他训练审计项目的实现。

运行依赖为 MoonBit 官方核心库（Apache-2.0）；Node.js 仅作为构建、文件 I/O 和本地静态服务器运行时。前端不使用第三方组件、字体、图标、统计或遥测服务。

功能对照：Teich（https://github.com/TeichAI/teich ，Apache-2.0）覆盖数据格式化、response masking 和训练审计。本项目采用相邻问题定义，但不宣称其能力缺失、也不宣称全球首创。当前没有移植其代码或模板。

MoonBit 生态邻近组件：tokenizers-moonbit（https://github.com/howtomakeaname/tokenizers-moonbit）、moonjinja（https://github.com/ZSeanYves/moonjinja）。当前并不依赖或复制这些项目。

examples/ 的 token ID、区间和故障全部为本项目合成，没有来自真实用户对话或受限模型。独立判定测试也是合成测试；不能以这些结果声称已完成真实模型验证。

标准许可证正文采用 Apache License 2.0。后续引入真实模型导出、第三方夹具、代码或数据时须记录其链接、许可证、版本和授权范围。
