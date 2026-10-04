# 模型内部位移与实际损失验证

现在可以将 MoonBit 的审计结果与实际模型计算对照。实验使用 Transformers 4.57.1 和 PyTorch 2.10.0，在 CPU 上随机初始化微型 GPT-2（1 层、16 维、2 个注意力头），关闭 dropout，固定种子。没有下载预训练权重，没有调用付费服务，也没有执行参数更新。

我们把仓库公开合成样本交给模型，运行前向与反向，并在 Python 中用独立的 log-sum-exp 计算交叉熵。判定器不调用 Transformers 或 PyTorch 的损失/位移辅助函数。实际模型损失与独立结果的绝对差须小于等于 `1e-6`；每个 logit 位置是否具有非零梯度，也必须与预期目标位置一致。MoonBit 审计结果由已编译的核心通过 Node 读取，没有在 Python 中另写审计规则。

## 已验证的六种情况

| 实验 | 实际观察及审计对应 |
| --- | --- |
| 三条 tokenizer/collator 记录 | 13 个声明标签对应 10 个损失目标；三个首位置标签不参与预测，MoonBit 保留三个首位置提示，并给单 token 样本增加零目标提示 |
| 屏蔽三个首位置标签 | 声明数量降至 10，模型损失完全不变；首位置与实际预测数量不能混为一谈 |
| 只监督助手回复 | 标签位置 4、5、6 对应 logit 位置 3、4、5；第一个助手目标由前一个用户位置预测，不代表用户内容被当成监督目标 |
| 两份预训练文档拼接 | 标签位置 3 的边界目标被忽略，其前一个 logit 位置 2 没有直接损失梯度；其余有效目标保持参与 |
| 人为损坏 Padding 标签 | 即使对应 attention_mask 为 0，未忽略的标签仍产生额外损失项；MoonBit 报告 `PADDING_SUPERVISED` |
| 单 token 样本独立成批 | 首位置有一个声明标签，但没有位移后的目标；所测实现的平均损失为 NaN，MoonBit 返回需复核而不是通过 |

表中的梯度是**最终输出 logits 相对于损失的梯度**。某个 logit 没有直接损失，不表示对应输入 token、隐藏状态或共享参数都没有梯度，更不能证明跨文档注意力被阻断。对于最后一行，空目标批次的处理由具体训练器决定，这里只记录固定版本模型默认平均损失的实际行为。

## 本地复现

先按 README 构建核心，保证 Node.js 可用。macOS 下：

```sh
npm run build
python3 -m venv .venv-reference
.venv-reference/bin/python -m pip install -r integrations/transformers/requirements-loss.txt
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 .venv-reference/bin/python -m unittest discover -s integrations/transformers/loss_tests -p 'test_*.py' -v
```

Linux CPU 环境先安装预处理依赖，再从官方 CPU 索引安装 PyTorch，可避免安装不需要的 GPU 依赖：

```sh
.venv-reference/bin/python -m pip install -r integrations/transformers/requirements.txt
.venv-reference/bin/python -m pip install torch==2.10.0 --index-url https://download.pytorch.org/whl/cpu
```

随后使用上面的 unittest 命令。安装依赖需要联网；测试执行时禁用 Python socket 连接，并设置离线环境变量，不访问模型服务。实际本地验证环境为 macOS arm64、Python 3.14.2；Ubuntu CPU 检查已加入工作流，但本次本地提交未运行远端 CI。

运行时可能出现使用默认 `ForCausalLMLoss` 的提示，这是所测 GPT-2 包装器选择该损失的方式；测试检查的正是实际默认路径。数值只与本次模型的独立计算对照，不把某次随机初始化的具体损失值作为跨平台快照。

## 适用范围与下一步

这组实验支持 `causal-lm-unshifted-v1` 的内部位移约定，并说明审计诊断与所测模型计算的关系。它没有证明所有模型架构、生产数据集、训练器归一化策略、混合精度或分布式训练都具有相同行为，也没有执行收敛或训练效果评估。assistant-only 与 packing 使用已有合成标签，并未接入真实聊天模板生成器。

CLI 与界面现已同时展示声明标签数和位移后预测目标数；单 token 样本明确提示零目标，无法完整计算时显示“无法计算”。原有声明字段语义保持不变，详见[数据契约](contract.md)。注意力隔离、生产 tokenizer 和截断策略继续作为独立任务。

参考：[Transformers 4.57.1 损失实现](https://github.com/huggingface/transformers/blob/v4.57.1/src/transformers/loss/loss_utils.py)、[GPT-2 实现](https://github.com/huggingface/transformers/blob/v4.57.1/src/transformers/models/gpt2/modeling_gpt2.py)、[PyTorch 官方历史版本安装说明](https://pytorch.org/get-started/previous-versions/)。这些依赖通过公开接口调用，不复制其源代码。
