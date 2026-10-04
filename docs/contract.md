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

## 纯文本预训练与 JSONL 可视化

普通语料使用 `text` 角色并将 `allowed_roles` 设置为 `["text"]`。`text` 是调用者声明的语料类型，不由工具从 token 推测。来源 segments 仍需由预处理流程提供。不要为缺失的角色或来源补造区间。

`audit_jsonl(text, policy_text)` 返回 `{ok, document, report}`；document 是 MoonBit 实际审计的标准化输入，界面直接使用它定位原始 token。原有 report 字段继续保留。document 的缺失角色与来源标准化为空数组，缺失 ID 按原始行号生成。

本契约采用“忽略后一个来源首个目标”的拼接策略。对其他允许跨文档目标的训练策略，这一诊断不适合作为通用质量结论。忽略边界目标也不会阻断后续 token 的跨文档注意力；本工具尚不分析注意力隔离矩阵。


## 声明标签与位移后预测目标

`supervised_tokens` 与 `supervised_ratio` 保留原来的声明标签语义。`Report` 和 `SampleReport` 新增 `prediction_targets : Int?`：在当前契约下，统计位置 `1..n-1` 中 label 不为 `-100` 的数量，排除首位置。此计数由 MoonBit 核心计算，CLI 与界面只显示结果。

- 正常的右侧 Padding 被 `-100` 忽略，不计入目标；如果 Padding 标签被错误地保留，仍计入，同时报告 `PADDING_SUPERVISED`。角色与边界策略错误也不会让这个目标自动从模型损失中消失。因此“有 N 个目标”不等于“有 N 个合法目标”。
- 角色或来源缺失不妨碍计算已知的标签位置数，但审计仍需复核。这不是对缺失证据的验证。
- 空样本、长度不一致、无效 token ID / attention 值、label 不满足同位 token 或 `-100` 时，样本计数为 `None`。不支持契约、空数据集、任一样本计数未知或资源限制导致部分样本未检查时，总数也为 `None`。
- MoonBit 默认 JSON 编码会**省略** `None` 字段，不能把缺失字段当成零；界面和 CLI 显示“无法计算”。旧版本报告也可能没有此字段。
- 仅首位置有标签时，计数为 `0`，新增 `NO_PREDICTION_TARGETS` 提示；所有标签都忽略时沿用 `NO_SUPERVISION`，避免重复提示。这些样本仍为需复核。

固定版本微型模型的损失与梯度对应验证见 [模型损失实验](model-loss-reference.md)。该计数按本契约计算，不能用于证明其他模型、注意力机制或损失归一化实现的行为。

兼容性：JSON 新字段为增量信息，旧计数字段与比较中的 before/after_supervised 语义不变。MoonBit 公开报告结构增加成员，直接构造 `Report` / `SampleReport` 字面量的源码调用方需补充 `prediction_targets`；调用 `audit` 获取报告的用法不变。报告版本字段仍是独立待办。
