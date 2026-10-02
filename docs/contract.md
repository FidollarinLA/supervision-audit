# 数据契约与检查边界

输入示例见 `examples/healthy.json`。顶层包含 contract、allowed_roles、samples。样本包含 id、input_ids、labels、attention_mask、spans、segments；original_supervised_tokens 为可选整数或 null。

- spans：start/end/role，role 为 system/user/assistant/tool。
- segments：start/end/source_id。描述已分词样本中的来源边界，不是未经验证的文本来源推断。
- labels[i] 只能等于 input_ids[i] 或 -100。模型内部执行 causal shift；不能传入已提前位移的 labels。
- 策略仅要求监督 token 不落在排除角色中，不强制每个允许角色 token 都参与训练。
- attention_mask 仅为一维 0/1。第二个及后续来源首个 token 的 label 必须为 -100，防止普通因果注意力从上一来源预测它。这里不支持其他注意力隔离机制；需要在独立契约中实现。
- 位置 0 的非忽略标签发出提示，因为内部位移后该位置没有预测；汇总仍统计声明标签数。

检查包括长度、token ID、mask、label、区间边界、区间重叠、角色策略、来源覆盖、全忽略样本、监督数量变化、空或重复 ID。不能证明来源元数据真实，不能检查词表上界，因为契约没有 vocab_size。监督变化不自动等同于截断错误。

## 资源上限

桥接输入最多 1,048,576 个 UTF-16 code units；界面文件最多 1 MiB。每文档 200 样本、100,000 token；每样本 10,000 token、10,000 个角色区间、10,000 个来源区间，区间展开总工作量最多 100,000。超过限制拒绝相关输入/样本，报告含错误，不能作为完整通过结果使用。

## 结果

pass：在支持契约内没有发现问题或缺失证据。
fail：发现明确契约错误。
review：仅有提示或证据缺失，需要人工核查。

JSON 中可选证据 token_index 缺失表示样本或文档级问题。ID 稳定是比较前提；重复 ID 被拒绝。比较要求两个输入的 contract 和 allowed_roles 相同（包括数组顺序），返回新增/消失的问题和数量变化。stable 表示数量相同，不能解释成内容相同。

## JSONL

每行包含 input_ids、labels、attention_mask；id、spans、segments、original_supervised_tokens 可选。缺少 id 时按物理行号生成 row-N；缺少 spans 或 segments 时保留未知证据状态。空行忽略，损坏行使整个导入失败。该适配器接收预处理后的训练记录，不执行 tokenizer、模板生成或训练器逻辑。
