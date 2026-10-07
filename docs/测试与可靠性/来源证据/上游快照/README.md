---
description: "D7 授权纳入版本控制的最小固定上游证据快照：收录范围、逐字节保留声明、归属声明、完整许可证材料与哈希清单的消费方式。"
kind: package-reference
---

# 最小固定上游证据快照

## 摘要

本目录是[待有权者决定事项](../../待有权者决定事项.md) D7 获授权后纳入版本控制的**最小**上游证据快照：只收录来源判定真正要消费的上游字节，逐字节原样保留，不做任何改写。机器可读的哈希清单在 [上游快照清单.json](上游快照清单.json)，检查器与门禁每次加载受控证据时逐条复算。

收录范围、字节数与复算结论都由清单登记，任何一条对不上都以退出码 2 受控失败，不静默回落到按固定地址联网取回。

## 目录

- [收录范围](#scope)
- [目录结构](#layout)
- [原始声明与逐字节保留](#verbatim)
- [归属声明与许可证材料](#license)
- [哈希清单与门禁消费](#manifest)
- [A1 本地比较输入的仓内副本](#baseline)
- [已知限制与暂缓工作](#limits)

-----

<a id="scope"></a>

## 收录范围

受控索引共 186 条记录，全部声明了 `upstream_sha256`。收录口径不是「挑一部分好看的」，而是「判词消费上游字节的全部记录」：

| 口径 | 记录数 | 互不相同的上游文件数 |
| --- | --- | --- |
| 已验收记录（判词为「已按 D12 格式写入来源说明并撤回无依据署名」18 条 + 「A1（E1-author-only）成立」11 条） | 29 | 29 |
| 已登记阻断记录（「证据不足，保持原状并登记阻断」77 条 + 「复核回退」58 条 + 「需补证」22 条） | 157 | 157 |
| 显式声明证据分支的记录（`E1-author-only` 12 条 + `C2-independent-content` 4 条） | 16 | 全部落在前两行内 |
| **并集** | **186** | **186** |

**为什么已登记阻断也要收录**：按[裁决 D15](../../裁决-D15-已登记阻断与发布门禁.md) §72/§115，「已登记阻断」不允许成为跳过绑定材料校验的理由——全量入口在扫描之后会独立复算这 157 条记录的绑定材料实测字节。因此「只收录已验收记录」会留下一批 157 条记录在断网时变成「证据不可得」（本轮实测：只收录 29 个文件时断网复核对 162 条输出 `evidence-unavailable`、退出码 2）。

本机实测与该口径一致：`check_full_java_comments.py --maintenance` 与 `check_staged_java_comments.py --validate-evidence-branches` 两条入口合计消费 **186 个互不相同**的上游文件，与上表逐条相等，既不多收也不漏收。

**「最小」的确切含义**：上游 `ruoyi-vue-pro` 在该固定提交上共 **8744** 个文件，本快照只收录其中 **186 个**（408 823 字节），即来源判定真正读到的那些；其余 7600 余个文件一律不纳入。收录量由「判定必需」决定，不由「上游有什么」决定。

-----

<a id="layout"></a>

## 目录结构

```text
上游快照/
├── README.md                                   本说明
├── 上游快照清单.json                            机器可读哈希清单（199 条）
├── ruoyi-vue-pro@ac022b15…/                    上游固定提交的原样文件树
│   ├── LICENSE                                 上游许可证原文（逐字节）
│   └── <186 个上游 .java 文件>                  逐字节原样，路径未重命名
└── 本地基线/f13229e0…/                         A1 契约的本地比较输入（12 个）
    └── <12 个本仓库整改前 .java 文件>           逐字节原样
```

目录名 `ruoyi-vue-pro@<commit>` 是检查器 `_resolve_snapshot` 认定的固定提交布局；快照根目录本身通过 `DEFAULT_EVIDENCE_SNAPSHOTS` 成为仓库内默认受控快照位置。

-----

<a id="verbatim"></a>

## 原始声明与逐字节保留

- 186 个上游文件与 12 个本地基线文件都**逐字节**复制，未做换行、缩进、编码或路径改写；上游仓库相对路径原样保留（唯一的目录变化是整体移入本快照根目录）。
- 186 个上游文件**均不含版权头或许可证头**（对 `copyright` / `license` / `SPDX` 的全文检索命中为 0），因此本快照没有删除任何原始版权或许可证声明；这一事实同时登记在清单的 `retention` 段。
- 其中 **11 个文件含上游原始作者声明**（`@author 芋道源码` 10 个、`@author HUIHUI` 1 个），按原样保留，未改写、未删除。这正是 `E1-author-only` 分支要排除后逐行比较的对象，改写会使 12 条 A1 契约的比较失效。
- 上游仓库在该固定提交上只有一个许可证文件 `LICENSE`，无 `COPYING`／`NOTICE`，已在清单 `upstream` 段登记。

-----

<a id="license"></a>

## 归属声明与许可证材料

### 归属声明

| 项 | 值 |
| --- | --- |
| 上游项目 | `ruoyi-vue-pro` |
| 上游权利人标识 | `YunaiV/ruoyi-vue-pro` |
| 上游仓库地址 | <https://github.com/YunaiV/ruoyi-vue-pro.git> |
| 固定提交 | `ac022b15a094cf9cf82903d429b9729e72309da5` |
| 许可证标识 | MIT |
| 许可证文件来源 | <https://github.com/YunaiV/ruoyi-vue-pro/blob/ac022b15a094cf9cf82903d429b9729e72309da5/LICENSE> |
| 许可证文件本地副本 | [ruoyi-vue-pro@ac022b15…/LICENSE](ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5/LICENSE) |
| 许可证文件 SHA-256 | `772daf1f82a50025a74e4066050490d875feba62a49cf0ecefa1b4cc824e9a07` |
| 许可证版权声明 | `Copyright (c) 2021 ruoyi-vue-pro` |

**归属与再分发边界**：本快照是上游 MIT 作品的**逐字节副本**，MIT 的「在所有副本或实质性部分中保留版权声明和许可声明」条件由同目录的 `LICENSE` 原文满足；186 个上游 `.java` 文件本身不含版权头，因此不存在被一并搬运的声明义务。纳入本快照**不等于**本仓库已为其自有代码选择许可证，也不等于 Java 后端整体派生关系已完成声明——那仍是[待有权者决定事项](../../待有权者决定事项.md) 中未决的权利问题，见[上游来源与许可证证据](../../../部署/上游来源与许可证证据.md)。

### 许可证材料随快照交付的强制

检查器加载受控证据时执行两条硬性核对，任一不成立即拒绝：

1. 哈希清单必须至少包含一条 `kind = license` 的条目，且该文件存在、字节数与 SHA-256 与清单一致；
2. 受控索引记录的 `license_sha256` 必须被清单中的许可证条目逐个覆盖——把许可证条目删掉，或换成别的许可证文件，都会被拒绝。

-----

<a id="manifest"></a>

## 哈希清单与门禁消费

[上游快照清单.json](上游快照清单.json)（`manifest_schema = d12-upstream-snapshot/v1`）逐条登记：

| 字段 | 含义 |
| --- | --- |
| `path` | 相对受控快照根目录的路径 |
| `kind` | `upstream-source`（上游来源文件）／`local-baseline`（A1 本地比较输入）／`license`（许可证原文） |
| `bytes` | 文件字节数 |
| `sha256` | 文件原始字节的 SHA-256 |
| `upstream_commit` | 上游固定提交（40 位完整 SHA） |
| `upstream_file_url` | 原始取回地址，固定在同一提交上 |
| `declared_upstream_sha256` / `declared_baseline_sha256` | 受控索引登记的声明指纹 |
| `matches_declared_upstream_sha256` / `matches_declared_baseline_sha256` | 实测是否与声明一致 |
| `records` | 该上游文件对应的受控索引记录 |

消费入口（全部经由 `load_evidence_registry`，无需额外环境变量）：

| 入口 | 复算行为 |
| --- | --- |
| `scripts/code/java/check_staged_java_comments.py`（含 `--validate-evidence-branches`） | 加载时复算清单，写入报告的 `evidence.snapshot_manifest` |
| `scripts/code/java/check_full_java_comments.py` | 同上，并在非 JSON 输出中打印复算结论 |
| `scripts/code/java/check_worktree_java_comments.py` | 继承上述默认位置 |
| `scripts/workflow/check_staged_quality.py` | 通过 `evidence_cli_arguments` 自动追加 `--evidence-snapshots` |
| `scripts/workflow/run_checks.py` | 通过 `evidence_environment` 自动导出 `JAVA_COMMENT_EVIDENCE_SNAPSHOTS` |

清单缺失时（外部受控快照、旧夹具）沿用既有行为：受控快照优先，缺失才按固定地址取回；**清单存在就不允许静默取回**，缺文件、字节或指纹不符、许可证缺位都按硬失败拒绝。

-----

<a id="baseline"></a>

## A1 本地比较输入的仓内副本

12 条 `E1-author-only` 契约把本地比较输入绑定在整改前基线提交 `f13229e05381563dce9bae877a67e4ce98182642` 的 git blob 上。该输入是本仓库自己的历史，因此**断网不影响**（`git show` 是本地对象读取）；完整历史下随时可取，浅克隆、历史改写或压缩合并后才取不回。

本快照按最小集合一并纳入这 12 个文件的仓内副本，并登记在哈希清单的 `local-baseline` 条目里，使后一类情形仍在仓内可复现。**契约本身未改写**：契约没有声明 `snapshot_path`，比较路径仍按 `git show` 取回并在比较前复算声明指纹；仓内副本由哈希清单持续复算，并由 `scripts/tests/test_java_author_evidence.py` 断言与 git blob 逐字节一致（本地历史可达时），不可达时仍按契约指纹校验。核实结论与实际命令见[验收矩阵](../../R01-R17-验收矩阵.md)。

-----

<a id="limits"></a>

## 已知限制与暂缓工作

1. **索引 `license_path` 的登记值不可解析**：受控索引把许可证位置登记为 `yudao/LICENSE@ac022b15…`，而既有取回实现按 `<仓库名>@<提交>/<上游路径>` 定位，该取值不是任何可解析形态，历史上从未被任何入口消费。本快照按上游树的真实位置交付许可证并在清单中登记同一指纹；是否把索引 `license_path` 改成可解析形态，属有权者裁决事项。
2. **本快照不覆盖全部 186 条记录的上游正文**：157 条记录的判词不依赖上游正文，其上游字节仍未纳入。若将来其中任何一条被改判为已验收，必须先扩充本清单再改判，不得先改判后补快照。
3. **快照是本仓库 Java 后端的一部分**：目录内 `.java` 文件位于 `docs/` 之下，不在 `JAVA_SOURCE_ROOT` 内，因此不会被全量注释检查扫描为纳管源码；它们只是证据材料。