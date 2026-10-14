// Explanations of core codes, not a second audit implementation.
const entries = {
  EXPECTED_TARGET_MISSING: ['应监督目标被忽略', '提供的 causal-target-mask-v1 在该位置为 1，但 labels 为 -100。', '核对预期来源；确认任务后按同位置 token 恢复标签。pad=eos 时按 attention 位置区分正文 EOS 与 Padding。', '预期掩码是调用者证据；本工具不证明来源真实，也不评估模型效果。'],
  UNEXPECTED_TARGET: ['多出的监督目标', '内部位移后，该非 -100 标签落在调用者预期掩码的 0 位置。', '核对模板标头、generation 区间及左 Padding 首个内容目标；按实际任务确认后修改标签。', '不把某种模板或 Padding 策略当作所有任务的通用规则。'],
  INVALID_EXPECTED_SUPERVISION: ['预期监督证据无效', '要求 causal-target-mask-v1、非空 source、同长度 0/1 mask 和对齐数组。', '从独立原始输入与任务策略导出预期位置，修正版本、来源及长度后重跑。', '无效证据不会用于判断遗漏/多出的位置；来源字符串不能证明真实性。'],
  EXPECTED_SUPERVISION_CONFLICT: ['预期位置与契约冲突', '预期目标不能位于位置 0、Padding、冲突来源、排除的已知角色或严格拼接边界。', '核对预期生成器与选择的角色/边界策略；明确任务后重新导出，保留可追溯证据。', '不猜测正确策略；缺失来源或角色仍需复核。'],
  NO_EFFECTIVE_TARGETS: ['标签没有有效预测位置', '有非 -100 标签，但 labels[1:] 没有任何损失目标。', '核对是否只保留了 label[0]；检查截断和 collator，确认样本是否应参与损失。', '不把无目标损失视为 0，也不自动补造监督位置。'],
  LABEL_TOKEN_MISMATCH: ['标签与 token 不一致', '未位移契约要求 labels[i] 等于 input_ids[i] 或 -100。', '核对 collator 是否提前 shift；从同位置 token 重建标签并保留有意忽略的位置。', '不能判断 tokenizer 语义或模型内部是否确实位移。'],
  PADDING_SUPERVISED: ['Padding 参与训练', 'attention_mask[i] 为 0，但 labels[i] 不为 -100。', '核对 Padding 位置，将其标签设为 -100；pad=eos 时按位置处理，避免误删正文 EOS。', 'attention_mask 不是损失掩码，也不能证明注意力隔离。'],
  ROLE_POLICY_VIOLATION: ['监督范围错误', '非忽略标签落在 allowed_roles 排除的已知角色内。', '检查 chat template 的角色映射与 generation 区间，按任务核对监督标签。', '单靠角色范围检查不能判断全部遗漏；完整性需另有独立预期证据。'],
  PACKING_CROSS_SOURCE_TARGET: ['跨文档预测目标', 'mask-cross-source 策略下，后一个来源首个 token 仍带训练标签。', '任务要求忽略跨文档目标时设置 -100；有意跨文档预测时明确选择 allow-cross-source。', '忽略边界目标不能隔离跨文档注意力。'],
  FIRST_TOKEN_NOT_PREDICTED: ['首个标签不产生预测', '模型内部位移时，位置 0 的标签没有前一个 logit。', '核对 labels[1:] 与 logits[:-1] 的损失实现；明确首个标签的用途。', '仅确认本契约下该位置不进入损失，不评估实际模型实现。'],
  NO_SUPERVISION: ['整条样本没有监督信号', '样本内所有标签均为 -100。', '确认是否有意跳过；否则检查截断、模板掩码及 collator。', '没有外部预期掩码，无法推断哪些位置应恢复监督。'],
  SUPERVISION_REDUCED: ['监督信号减少', '非 -100 标签数小于 original_supervised_tokens。', '核对基线来源、截断和模板变化，确认减少是否符合任务。', '基线是调用者声明，数量减少不证明模型效果下降。'],
  ROLE_PROVENANCE_MISSING: ['角色证据不足', '角色区间未覆盖全部 token。', '从真实模板或预处理步骤导出 token 级角色区间，再复核。', '不能猜测缺失角色，相关位置保留未知。'],
  SOURCE_PROVENANCE_MISSING: ['来源证据不足', '来源区间未覆盖全部 token。', '导出拼接前文档 ID 与分词后的来源区间。', '不能从 token 内容猜测来源或验证全部拼接边界。'],
  ROLE_OVERLAP: ['角色区间重叠', '同一 token 被多个角色区间覆盖。', '修正左闭右开区间，核对截断后的偏移。', '冲突位置不能认定为唯一角色。'],
  SOURCE_OVERLAP: ['来源区间重叠', '同一 token 被多个来源区间覆盖。', '核对拼接记录，修正来源区间和文档 ID。', '冲突位置不能认定为唯一来源。'],
  LENGTH_MISMATCH: ['数组长度不一致', 'input_ids、labels、attention_mask 长度必须相同。', '检查 Padding/截断是否同时应用于三组数组，重新导出。', '长度冲突后不能完整验证逐位置对齐。'],
  SPAN_OUT_OF_BOUNDS: ['角色区间越界', '角色区间必须位于样本内，且 start < end。', '使用 token 左闭右开索引，重新计算截断后的角色区间。', '无效区间不能提供可靠角色证据。'],
  SEGMENT_INVALID: ['来源区间无效', '来源区间必须有效，source_id 不能是空字符串。', '补充真实来源 ID，核对 token 左闭右开索引。', '无效区间不能提供可靠来源证据。'],
  UNKNOWN_ROLE: ['角色名称无效', '角色仅支持 text/system/user/assistant/tool。', '按真实输入语义映射角色；无法映射时保留缺失证据。', '不能替调用者决定自定义角色语义。'],
  INVALID_TOKEN_ID: ['Token ID 无效', 'Token ID 必须为非负整数。', '核对 tokenizer 导出，避免把忽略标签混入 input_ids。', '非负不代表 ID 位于模型词表内。'],
  INVALID_ATTENTION: ['Attention 值无效', '当前仅支持逐 token 的 0/1 attention_mask。', '导出兼容的逐 token 掩码；需要其他契约时停止本次判断。', '不支持 block-diagonal 或其他注意力结构。'],
  INVALID_BASELINE: ['监督基线无效', 'original_supervised_tokens 必须非负，且不能小于当前声明的监督数量。', '重新提供可追溯的基线数量或移除不可靠基线。', '基线真实性仍需调用者核对。'],
  INVALID_BOUNDARY_POLICY: ['拼接策略无效', '仅支持 mask-cross-source 与 allow-cross-source。', '按训练目标选择受支持的策略并重新运行。', '任一策略均不验证跨文档注意力隔离。'],
  UNSUPPORTED_CONTRACT: ['契约不支持', '仅支持 causal-lm-unshifted-v1。', '确认未提前位移的 causal-LM 标签；其他任务须使用相应工具。', '不把其他契约的数据视为已验证。'],
  EMPTY_POLICY: ['监督策略为空', 'allowed_roles 至少需要一个受支持的角色。', '明确选择纯文本 text 或对话所需角色后重跑。', '不自动猜测训练任务。'],
  INVALID_POLICY_ROLE: ['策略角色无效', 'allowed_roles 仅支持 text/system/user/assistant/tool。', '核对角色拼写及实际任务策略。', '不自动映射未知角色。'],
  RESOURCE_LIMIT: ['达到资源上限', '输入或展开区间超过本工具的预算。', '减少重叠区间，分批导出；保留样本和来源 ID 后分别审计。', '未完成的部分不能认定为通过。'],
  INVALID_SAMPLE_ID: ['样本 ID 无效', '样本 ID 不能为空或重复。', '为每条记录导出稳定、唯一的 ID 后重跑。', '重复 ID 无法关联唯一原始证据或可靠修复差异。'],
  EMPTY_SAMPLE: ['样本为空', '样本至少需要一个 token。', '核对过滤和截断，明确移除空记录或重新导出。', '无法推断原本应有的内容。'],
  EMPTY_DATASET: ['数据集为空', '审计文档没有样本。', '核对导出步骤和输入文件。', '空数据集不能证明训练数据已验证。']
};
export function explainFinding(finding) {
  const [title, basis, fix, limits] = entries[finding.code] || [finding.code, finding.message, '核对预处理步骤及契约后重新运行。', '此代码没有专用解释，请保留原始诊断并查看契约。'];
  return { title, basis, fix, limits };
}
