# 本地包复现与 MoonBit 接入

模块名为 `FidollarinLA/supervision_audit`，版本 `0.1.0`，许可证为 Apache-2.0。2026-10-09 已发布至 Mooncakes，`moon view` 确认该版本可用且未撤回；独立临时模块从注册表安装后在 JS、Wasm GC、native 调用公开接口通过。发布源码对应仓库提交 `f804060`；后续文档和验证脚本更新不改变该版本核心。

## 从注册表安装

在自己的模块 `moon.mod` 加入依赖：

```moonbit
import { "FidollarinLA/supervision_audit@0.1.0" }
```

在调用代码所在目录的 `moon.pkg` 加入：

```moonbit
import { "FidollarinLA/supervision_audit" @audit }
```

运行 `moon update` 刷新索引，再运行 `moon check` / `moon test` 解析并下载依赖。示例见下方消费者夹具。无需把本仓库加入 `moon.work`；新发布版本在旧索引中可能暂不可见，不能以本地路径替代后宣称安装成功。

从本仓库执行 `npm run check:registry` 可复现安装验证。脚本先查精确版本，创建独立临时模块、刷新索引，再在三个后端运行三项消费者测试，最终清理临时目录。它不发布或登录、不使用本地工作区或路径依赖；需要网络，刷新会更新本机注册表缓存。这仍是本机安装验证，不代表其他用户已经试用。

## 一条命令验证交付包

在本项目的 Git 检出目录运行：

```sh
npm run check:package
```

需要 Node.js 22+、MoonBit、Git、`unzip` 及 MoonBit native 后端所需 C 编译器。可用 `MOON=/path/to/moon` 指定工具链。脚本按以下顺序执行：

1. `moon package --frozen` 生成临时归档，不调用 `publish`、`login` 或注册表更新。
2. 检查归档：必须包含核心源码、模块/包配置、公开接口、README、许可证及来源说明；拒绝未受 Git 跟踪的文件、异常路径和明确排除的开发文件。新源文件应审查后暂存或提交，否则检查会失败。
3. 解压实际归档到临时目录；建立另一个模块 `local/package_consumer`，通过 `moon.work` 引用归档内的库。消费者不会引用当前工作树的库目录或已有构建产物。
4. JS、Wasm GC、native 各运行三项消费者测试：类型化报告与错误修复比较；JSON、JSONL 和 JSON 比较入口；特殊来源 ID 与重叠诊断。验证通过、失败、缺少证据三个状态及报告版本和预测目标数。
5. 无论成功失败都清理此次创建的临时目录；不改变用户原有构建产物。

脚本只检查打包路径和关键交付项，不是敏感内容扫描器；受 Git 跟踪也不代表文件必然适合公开。发布前仍须人工复核内容。

`.moonignore` 保留 `.gitignore` 中的生成物排除规则，额外排除申报草稿、内部工作记录和开发指令；文档中指向内部记录的 README 链接改为仓库链接。规则依据 [MoonBit 模块配置文档](https://docs.moonbitlang.com/en/latest/toolchain/moon/module.html#publishing-files-with-moonignore)：同目录存在 `.moonignore` 时，打包使用它替代 `.gitignore`。

## 在自己的本地模块使用

需要修改库源码时，可将库源码和自己的模块加入同一个工作区。目录示例：

```text
workspace/
  moon.work
  supervision-audit/  # 库源码或解压后的归档
  my-tool/
    moon.mod
    moon.pkg
    ...
```

`moon.work`：

```moonbit
members = ["supervision-audit", "my-tool"]
```

`my-tool/moon.mod`：

```moonbit
name = "local/my_tool"
import { "FidollarinLA/supervision_audit@0.1.0" }
```

`my-tool/moon.pkg`（正常源码使用）：

```moonbit
import { "FidollarinLA/supervision_audit" @audit }
```

在源码中用 `@audit.audit(document)` 得到类型化报告。只在黑盒测试中使用时，应将包导入标记为 `for "test"`，避免空主包产生未使用导入警告；完整调用样例见 [消费者夹具](../test/consumer.mbt.fixture)。库不会替调用方构造真实角色或来源证据。

工作区依赖由本地源码解析，声明版本不会触发注册表安装，参见[官方本地模块说明](https://tour.moonbitlang.com/basics/module-and-package/index.html)。因此本验证不能证明 Mooncakes 下载、版本解析、外部网络环境或第三方用户复现成功。

本次本地工具链：moon 0.1.20260920、moonc v0.10.14+7d59c7ec9，macOS arm64。注册表验证与本地归档验证分开运行，不能把其中一项当成另一项的证据。
