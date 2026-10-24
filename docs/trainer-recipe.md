# 最小 Trainer 接入配方

把 SupervisionAudit 门禁后的 JSONL 交给 Hugging Face / TRL，不在此训练或评价模型。

## 1. 导出已门禁 JSONL

```sh
node scripts/build.mjs
node prepare.mjs examples/traces/qwen-rendered.json --rendered --emit jsonl --out training.jsonl
python integrations/transformers/load_prepared_jsonl.py training.jsonl
```

`load_prepared_jsonl.py` 会检查：

- `labels[i]` 只能是 `input_ids[i]` 或 `-100`
- `attention_mask` 为 0/1
- 位移后至少有一个有效目标

## 2. 交给 SFTTrainer

```python
from datasets import Dataset
from trl import SFTConfig, SFTTrainer
from transformers import AutoModelForCausalLM, AutoTokenizer
import json

rows = [json.loads(line) for line in open("training.jsonl", encoding="utf-8") if line.strip()]
dataset = Dataset.from_list([
    {
        "input_ids": row["input_ids"],
        "labels": row["labels"],
        "attention_mask": row["attention_mask"],
    }
    for row in rows
])

# 伪代码：请换成你的模型与参数。packing 必须关闭。
# model = AutoModelForCausalLM.from_pretrained(...)
# tokenizer = AutoTokenizer.from_pretrained(...)
# trainer = SFTTrainer(
#     model=model,
#     train_dataset=dataset,
#     args=SFTConfig(packing=False, ...),
# )
```

## 3. 为什么 packing=False

SupervisionAudit / Teich 的 response-only labels 依赖单行边界。packing 会合并样本，破坏监督区间。这与 Teich 文档一致。

## 4. 与 Teich 流程对照

| 步骤 | Teich | SupervisionAudit |
| --- | --- | --- |
| 渲染模板 | `prepare_data` | 可选 Teich 适配层 |
| 生成 labels | `mask_data` | MoonBit `prepare_labels_json` / `prepare_training_json` |
| 超长 | `trim_followups` 等 | `truncate-complete-turns` / `truncate-right` / `reject` |
| 训练 | TRL / Unsloth | 导出 JSONL 后自行接入 |

不要在 Trainer 里再次做 response-only masking，除非你放弃本工具生成的 labels。
