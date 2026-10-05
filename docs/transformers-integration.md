# 从真实 tokenizer / collator 导出审计输入

这条示例实际调用 Transformers 4.57.1 的 `PreTrainedTokenizerFast` 和 `DataCollatorForLanguageModeling`，再交给 MoonBit 审计。语料是本仓库自写的三句合成文本，分词和补齐使用真实第三方实现。它验证了一个小型预处理流程，不代表已经验证真实模型训练或生产数据集。

## 直接查看已有结果

完成 README 的源码构建后运行：

```sh
node cli.mjs examples/transformers/batch.jsonl --jsonl --roles text --summary
```

预期退出码为 **3（需复核）**，不是失败：三个样本各有一个 `FIRST_TOKEN_NOT_PREDICTED` 提示，单 token 样本另有一个 `NO_PREDICTION_TARGETS` 提示，共四条；没有错误或未知来源。collator 保留第一个位置的标签，模型内部位移约定下该位置不会产生预测目标。本示例不为得到绿色结果而修改原始输出。

也可以在可视化工作台导入 `batch.jsonl`，将 JSONL 监督角色设为 `text`，查看具体 token。补齐位置的 label 均为 `-100`。

| 记录 | 实际文本 token | 补齐后长度 | 声明监督标签 |
| --- | --- | --- | --- |
| text-long | 8 | 8 | 8 |
| text-short | 4 | 8 | 4 |
| text-single | 1 | 8 | 1 |

总共 24 个位置、13 个声明监督标签；CLI 和界面另显示 10 个位移后预测目标，三个样本分别为 7、3、0。按本项目内部下一词位移契约，三个首位置不作为预测目标，因此有 10 个可用目标；单 token 样本没有这样的目标。这一对应关系现已在[单独的微型模型实验](model-loss-reference.md)中通过实际损失和梯度验证。collator 导出本身仍不调用模型，不能单独替代损失验证。

## 从头重建

以下过程本地已使用 Python 3.14.2 验证。Python 环境是可选的，正常使用 MoonBit 库、CLI 或界面不需要安装它。首次安装依赖需要联网；导出时不下载模型、不访问服务。

```sh
python3 -m venv .venv-reference
.venv-reference/bin/python -m pip install -r integrations/transformers/requirements.txt
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 .venv-reference/bin/python integrations/transformers/export_fixture.py --output-dir artifacts/transformers
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 .venv-reference/bin/python -m unittest discover -s integrations/transformers -p 'test_*.py' -v
node cli.mjs artifacts/transformers/batch.jsonl --jsonl --roles text --summary
```

Windows 下将解释器路径换成 `.venv-reference\Scripts\python.exe`，在 PowerShell 中设置 `$env:HF_HUB_OFFLINE="1"` 和 `$env:TRANSFORMERS_OFFLINE="1"`；Windows 本轮未实测。

环境可能提示未找到 PyTorch/TensorFlow/Flax，这不妨碍本示例使用 NumPy collator；仅重建预处理夹具时不需要训练框架。单独的模型损失实验另需安装 PyTorch。前三个核心依赖固定版本并由导出器核验，传递依赖尚未完整锁定。

导出器使用 `examples/transformers/corpus.jsonl`，根据文本建立确定性 WordLevel 词表，用 WhitespaceSplit 分词。默认不添加特殊 token、不截断、不拼接文档，右侧补齐到 8 的倍数。`mlm=False`；导出器不改写 collator 生成的 input_ids、labels 或 attention_mask。

角色 `text` 来自本示例明确的纯文本用途。每条原始文本保留自己的来源 ID；生成的 Padding 使用独立的 `generated:padding:…` 来源，避免将生成内容冒充原始文本。角色区间覆盖整条纯文本处理记录，包括其生成的 Padding；未监督的补齐位置不会产生角色监督错误。

## 可核对证据

- `corpus.jsonl`：本仓库原创合成文本，随仓库采用 Apache-2.0。
- `batch.jsonl`：实际 tokenizer / collator 运行结果，可直接由现有 JSONL 接口读取。
- `manifest.json`：核心依赖版本、语料 SHA-256、词表、collator 参数和标签变换记录（为空）。
- Python 测试：禁用 socket 连接后重建结果，与已提交夹具逐字节对照；不匹配依赖版本时拒绝导出。
- Node 测试：核对 MoonBit 的计数、三个首位置提示，以及注入 Padding 标签错误、提前位移标签、删除来源信息后的审计结果。Padding 拥有单独来源，因此篡改其首个标签也会产生边界目标诊断。

## 左右截断与监督减少

另有两个可复现批次：`truncate-right/batch.jsonl` 和 `truncate-left/batch.jsonl`。它们调用同一 tokenizer 的真实截断功能，将文本截到最多 4 个 token，再用原 collator 右侧补齐到 8 的倍数。`max_length=4` 是截断后的文本长度上限，不是最终补齐张量的长度。

```sh
.venv-reference/bin/python integrations/transformers/export_fixture.py --output-dir artifacts/truncate-right --max-length 4 --truncation-side right
.venv-reference/bin/python integrations/transformers/export_fixture.py --output-dir artifacts/truncate-left --max-length 4 --truncation-side left
node cli.mjs examples/transformers/truncate-right/batch.jsonl --jsonl --roles text --summary
```

左截断删除开头，保留末尾；右截断删除末尾，保留开头。导出器同时实际运行未截断 collator，计算每条记录的 `original_supervised_tokens`（分别为 8、4、1，包含首标签）。MoonBit 用这个已声明基线检查监督减少，不推测被删除的内容。

| 处理方式 | 长文本保留的原始 token 区间 | 全批声明标签 | 全批预测目标 |
| --- | --- | --- | --- |
| 不截断 | `[0,8)` | 13 | 10 |
| 右截断到 4 | `[0,4)` | 9 | 6 |
| 左截断到 4 | `[4,8)` | 9 | 6 |

两种截断的预期退出码均为 **3**：原来的四条提示继续保留，长文本新增 `SUPERVISION_REDUCED`，明确从 8 个声明标签减为 4 个；无错误或未知来源。这不是对截断策略正确与否的判断。微型 GPT-2 实验分别核对两种输入的独立交叉熵和梯度位置，确认各有 6 个损失目标，不比较或承诺训练质量。

每个新清单的 `truncation` 记录方向、上限和原始 token 的左闭右开保留范围；样本中的 spans/segments 则使用截断后从零开始的坐标。导出器核对实际 tokenizer 输出与原序列的相应连续片段一致，保留原 source_id，Padding 仍使用生成来源。原始 token 区间是随附清单证据，当前审计核心和界面不会自动加载清单或将它当作来源真实性证明。

默认未截断夹具逐字节保持原样；两种新夹具也有禁止 socket 连接的重建测试。`--max-length` 只接受 1–128 的整数；默认不截断。`label_transformations: []` 表示没有改写 collator 标签，不表示 tokenizer 未截断。删除基线后，核心不会报告它无法知道的监督减少。两边截断即使数量一致，实际 token 内容也不同；修复比较中的 `stable` 仅指数量稳定。

本示例只覆盖独立纯文本文档的 WordLevel 分词、左右截断和右侧补齐，不覆盖生产 BPE 词表、对话模板、assistant-only masking、跨文档 packing、左侧 Padding、滑窗/stride、特殊 token 截断或注意力隔离。这些能力不能从本示例推断。

参考：[固定版本 Data Collator 文档](https://huggingface.co/docs/transformers/v4.57.1/en/main_classes/data_collator)、[固定版本实现源码](https://github.com/huggingface/transformers/blob/v4.57.1/src/transformers/data/data_collator.py)。本仓库调用依赖公开接口，没有复制其实现。

截断参数参考：[Transformers 4.57.1 Padding and truncation](https://huggingface.co/docs/transformers/v4.57.1/en/pad_truncation)。
