# SupervisionAudit 复审材料参考

> AI 辅助整理，供本人核对；不能冒充要求本人独立撰写的最终报名答案。

新定位：MoonBit 训练数据准备与监督验证工作台。原始多轮 messages/tools → 标准化与调用配对 → 可选 Teich/HF 原生模板及分词 → MoonBit 六类训练内容选择/labels → 门禁 → 训练 JSONL 与 token 证据。

实际场景：多轮对话 SFT 数据准备；函数调用与工具返回训练策略；collator 变更后的训练前门禁及回归比较。默认 Qwen 演示 45 个目标，final-only 24 个，工具返回默认 0 个。

对标：固定 Teich 609412f 源码、实际公开 prepare_data/mask_data API；23 组 labels 一致、7 组空目标双方拒绝、2 个故障门禁。共享格式化元数据，MoonBit 标签实现独立，不宣称完全替代 Teich。原生 Qwen 普通对话/工具模板与自定义推理模板分别验证。

生态交付：preparation 新包支持 JS/Wasm GC/native，旧 v1 根包/CLI 管道保留。核心各 54、Node 63、独立归档消费者各 4、实际浏览器 8 检查通过。未正式发布新包、未虚构外部用户收益或官方通过。

边界、来源和证据：[复审对应说明](docs/review-response-2026-10-13.md)，[准备合同](docs/training-preparation.md)。通知所给重新提交期限是 2026 年 10 月 31 日，报名表请本人依据实际理解独立更新。
