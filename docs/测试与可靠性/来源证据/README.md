---
description: "D12 来源例外的受控来源索引：派生规则、八个证据字段组、上游内容复取与门禁消费方式，含 D7 轮纳入版本控制的最小上游证据快照入口。"
kind: package-reference
---

# D12 来源证据索引

## 摘要

本目录存放 `type-author` 来源例外的受控来源索引，供提交路径、工作区路径、全量路径与 CI 使用同一份证据输入。索引是派生数据：只登记对象、指纹、比对依据与复核结论，**记录本身不内嵌上游文件正文**。上游正文的逐字节副本按 D7 授权单独存放在同目录的[上游快照](上游快照/README.md)，由机器可读哈希清单逐条复算。索引由 D10/D12 账本派生，禁止手工新增或改写记录；工具指纹等机械重绑沿用既有口径登记在 `manifest`。

## 目录

- [索引内容](#索引内容)
- [派生规则](#派生规则)
- [八个证据字段组](#八个证据字段组)
- [上游内容来源](#上游内容来源)
- [门禁消费方式](#门禁消费方式)
- [索引字段重绑与账本重放](#索引字段重绑与账本重放)
- [证据分支契约](#证据分支契约)
- [D16 逐条复核材料（只准备材料，不判定）](#d16-逐条复核材料只准备材料不判定)
- [复核与重生成](#复核与重生成)
- [已知限制与暂缓工作](#已知限制与暂缓工作)

## 索引内容

| 文件 | 内容 |
| --- | --- |
| [d12-source-index.json](d12-source-index.json) | 186 条 D12-174 候选记录；**索引当前判词分布**为 18 条已应用来源说明、11 条 A1 恢复署名、58 条复核回退、22 条需补证、77 条证据不足阻断；顶层 `manifest` 记录派生依据与指纹，`records` 为逐条清单记录 |
| [上游快照](上游快照/README.md) | D7 轮纳入版本控制的最小固定上游证据快照：186 个上游文件、12 个 A1 本地比较输入、1 份许可证原文与机器可读哈希清单 |
| [成员同一性契约schema](成员同一性契约schema.json) | E2-member-identity 分支的受控契约 schema：`M0`／`MT` 两个入口、21 项契约必填字段、18 项成员登记必填字段、成员种类、差异类别、13 项归因成因，以及各语义字段的最小字数；附整文件与规范化两项可复算指纹 | | [成员同一性成员清单](成员同一性成员清单.json) | E2-member-identity 分支的受控成员清单：样板排除表（getter/setter、空方法、普通字段、无初始化器字段、无锚点成员）、区分力门槛（最少锚点数、最少 token 数、惯用字符串模式）、4 条契约冲突对象（C 类，逐条登记待签认问题与必要验证方向）与 5 条本分支不可关闭对象（B 类）；附整文件与规范化两项可复算指纹 | | [代码同一性变换集](代码同一性变换集.json) | E1-code-identity 分支获准的确定性规范化与变换集：N1 与 T1–T5 的精确定义、适用范围、执行顺序，以及整文件／transforms／normalizations 三项可复算指纹 || [代码同一性复核队列](代码同一性复核队列.json) | 45 条候选的逐条严格比较读数与待复核状态；只登记事实，`verdict` 一律为 `null`，不是批准名单 || [代码同一性逐条复核材料](代码同一性逐条复核材料.md) | 42 条严格比较成立候选的逐条复核材料：对象标识、严格比较读数与变换发生点、逐行差异归因、注释逐字原文与指纹、作者与来源事实、契约影响标记位置、复现命令与未解决问题；判定列留空待独立复核方填写 || [代码同一性通配符导入扩展材料](代码同一性通配符导入扩展材料.md) | D16 §84 要求的扩展材料：Java 版本与编译依赖的逐字节固定、3 条对象的导入集合逐条对应、未使用／冲突／同名类型反例实测，以及标注为待裁决的候选规则草案（未实施、未登记进变换集） || [README.md](README.md) | 本说明 |

索引中的每条记录对应一个本地对象（`local_path` 唯一），记录上游定位、上游内容指纹、历史依据、比对依据、作者判断、许可关联与逐项复核。规则只对主张来源证据的 public 类型读取这些记录；没有来源说明的类型继续走准确作者路径。

## 派生规则

- 来源账本：`registry-d12b.tsv`（997 数据行 × 73 列，schema `d12-registry/v3`），SHA-256 `986b40a03f5d8d26c7d1977f5e659e24d22a928a44bbb29f9c18715892afd94e`，与 `manifest.source_ledger_sha256`／`source_ledger_columns`／`source_ledger_records` 一致。索引由 `.bf-local/d10fix/derive_index_from_ledger.py` 从该账本重放，再按当前工作树重绑指纹。
- 选取口径：`d12_verdict` 属于 D12-174 候选且 `scope=backend-prod`，共 186 条；其余 811 条“不适用（非 D12-174 候选）”不进入索引，主张来源例外时按“清单没有逐项记录”拒绝。
- **账本判词与索引判词不是同一快照**：账本实测分布为 92 条“已按 D12 格式写入来源说明并撤回无依据署名”、6 条“已按 D12 格式写入来源说明（D10b 改判）”、11 条“A1（E1-author-only）成立，恢复上游证据支持的作者”、77 条“证据不足，保持原状并登记阻断”（合计 186）；索引在 D14 §132 独立逐项复核与 D15 逐项核实后更新为 18／11／58／22／77。两侧在 `d12_verdict` 上相差 81 条、一致 105 条（`manifest.ledger_replay` 的 `differing_fields`／`identical_fields`）。该差异如实登记，索引**不**声称与账本逐字节同快照。
- 重复列名：账本表头仍有 11 个重名（D10 列与 D10b 更新列同名）。派生取**末列**（D10b 更新值），并把选定记录上“首列与末列取值不同”的条数登记在 `manifest.duplicate_column_mismatches`（实测：`author_status` 12、`evidence_points`／`evidence_route`／`local_sha256_after` 各 17、`open_gap`／`review_by` 各 61、`review_conclusion` 65）。该差异必须如实登记，不能表述成“两侧一致”。
- 逐类型证据：账本有 12 条记录没有 `type_evidence`（11 条 A1 恢复署名 + 1 条改判），索引沿用 D10b 构建的同路径逐类型证据，登记在 `manifest.synthesized_type_evidence`。
- 本索引的中立指纹：见 `manifest.records_sha256`（逐条记录规范化 JSON 的 SHA-256）。
- **本索引文件的当前整文件 SHA-256：`6b325a13587a31449393bc148680ca6d3b1ec7dce4ca477cc0ddfc2f5391f905`**（`records` = 186，`manifest.records_sha256` = `8b202ef64a96e5981afff1f3754336fd2318b6e448f5d0547529963ae2ba8d4d`）。本值与检查器各入口实际报告的 `evidence.registry_sha256` 一致（2026-10-07 实测：`--validate-evidence-branches` 退出 0／`checked 16`／`findings 0`；`check_full_java_comments.py --maintenance` 退出 0／`checked 904`／`hard_failures 0`／`registered_blockers 162`）。此前登记的三个值——`39f539cf…`（D7 轮后）、`5b96faac…`（2026-10-06 复算轮后）与更早的 `282735c3…`——是本仓库文档中若干历史运行记录（如 D12/D14 复算更正、本机 `run_checks` 探针、云端 run）当时**实际读到**的指纹，记录本身依然为真；`5b96faac… → 39f539cf…` 的变化只来自 D7 轮对 12 条 E1 记录 `author_only_contract.tool.sha256` 的机械重绑（见[工具指纹重绑](#工具指纹重绑与结构点重定位n1fix-轮)），`manifest.records_sha256` 随之由 `2a23d7ff…` 重算为 `48d0da82…`。**`39f539cf… → 6b325a13…`** 的变化只来自 2026-10-07 的两处机械改动：186 条记录的 `license_path`（含 12 条 `license_binding` 自由文本）改为可解析形态（`manifest.license_path_fix`，见[已知限制](#已知限制与暂缓工作)），以及随规则实现新增许可证定位复算判据而对 12 条 A1 `tool.sha256` 的机械重绑（现值 `f39bc764…`，轨迹见 `manifest.branch_route_ownership_fix.tool_sha_rebind_history`）。判词（`d12_verdict`）、`evidence_branch`／`evidence_route` 与逐项复核结论一律未改写。

## 八个证据字段组

| 字段组 | 索引字段 |
| --- | --- |
| 本地对象 | `local_path`、`scope`、`baseline_commit`、`local_sha256_before`、`local_sha256_after`、`author_lines_before`、`author_line_after`，以及 `type_evidence.types[]` 的限定名、嵌套关系、绑定 JavaDoc 指纹与上游类型 |
| 上游定位 | `upstream_repo_url`、`upstream_path`、`upstream_commit`、`upstream_file_url`、`upstream_repo_id`、`upstream_commit_fixed` |
| 上游内容 | `upstream_sha256`、`upstream_fetched_at`、`upstream_refetch`、`upstream_author_lines`、`upstream_author_scan` |
| 历史依据 | `history_basis`、`open_gap`、`type_evidence.history`（登记引入版本时） |
| 比对依据 | `comparison_inputs`、`normalization_rules`、`tool_versions`、`evidence_route`、`evidence_points`、`d12_correspondence_points` |
| 作者判断 | `author_status`、`author_reason`、`local_modification_facts`、`retraction_reason`、`d12_verdict`、`d12_blocker_reason` |
| 许可关联 | `license_path`、`license_sha256`、`license_copyright`、`license_url`、`license_binding` |
| 复核记录 | `review_by`、`review_date`、`review_conclusion`、`independent_review`，以及 `type_evidence.types[]` 的逐项复核 |

## 上游内容来源

索引只保存固定地址与指纹。**上游正文的逐字节副本已按 D7 授权纳入版本控制**，位于
[上游快照](上游快照/README.md)；机器可读的哈希清单是 [上游快照清单.json](上游快照/上游快照清单.json)。
规则按以下顺序取得上游内容：

1. **仓内受控快照优先**：`docs/测试与可靠性/来源证据/上游快照`（`DEFAULT_EVIDENCE_SNAPSHOTS`）在目录存在时自动生效，不需要设置任何环境变量；`JAVA_COMMENT_EVIDENCE_SNAPSHOTS` 或 `--evidence-snapshots` 可显式指向别处。固定提交的对应文件必须先通过 `upstream_sha256` 复算与无作者声明检查。
   - **快照哈希清单强制复算**：仓内快照根目录存在 `上游快照清单.json` 时，加载受控证据即逐条复算每个文件的字节数与 SHA-256，并要求清单至少包含一条 `license` 条目且覆盖受控索引登记的 `license_sha256`。文件缺失、字节或指纹不符、许可证材料缺位都以 `EvidenceError` 拒绝（退出码 2），诊断指向具体条目与具体路径，**不回落到联网取回**。
   - 快照根目录没有哈希清单时（外部受控快照、旧夹具）沿用既有行为，不做完整性复算。
2. **固定地址取回**：仓内快照没有对应文件时按 `upstream_file_url` 取回。地址必须固定在登记提交上，且路径与 `upstream_path` 一致；取回内容复算 SHA-256，不符即拒绝。
3. **取不回与内容不符是两件事**：**取不回**（网络不可达、HTTP 错误、超时）由全量入口记录失败地址，该记录若**全部**原因都来自取不回即进入独立的“证据不可得”集合（`evidence-unavailable`），报告写明固定地址与原因并以退出码 **2** 受控失败；**内容不符**（指纹或内容与登记不一致）仍是硬失败。判据与阈值不因故障而放宽；同一条记录若还有真实内容问题，硬失败与证据不可得并存。

> D7 已获有权者授权：**不必等待整个项目根许可证选择，先把最小固定上游证据快照纳入版本控制**，
> 并保留原始声明、完整许可证与哈希清单。实际收录 **186 个上游文件 + 12 个 A1 本地比较输入 + 1 份许可证原文**
> （上游仓库在该提交上共 8744 个文件），收录口径与逐条复算方式见[上游快照说明](上游快照/README.md)。仓内快照缺位时仍可按固定地址联网取回。
>
> **登记在案的差异**：[待有权者决定事项](../待有权者决定事项.md) D7 条目本轮未在授权范围内，
> 其正文仍写着「本轮未 vendored 任何上游快照」，与本目录的实测状态不符，须由该文件的属主按授权更新。

`upstream_file_url` 使用 `github.com` 的 `blob` 固定提交地址；规则转换为 `raw.githubusercontent.com` 的同提交内容地址。

## 门禁消费方式

| 入口 | 默认证据输入 |
| --- | --- |
| 提交路径 `scripts/workflow/check_staged_quality.py` | 本目录 `d12-source-index.json` + `上游快照/`（两者都相对仓库根解析），由 `evidence_cli_arguments` 自动追加 `--evidence-snapshots` |
| CI `scripts/workflow/run_checks.py` 的 Java 注释检查 | 同上，由 `evidence_environment` 自动导出 `JAVA_COMMENT_EVIDENCE_SNAPSHOTS` |
| 全量入口 `scripts/code/java/check_full_java_comments.py` | 同上，并在 JSON 与非 JSON 输出中报告清单路径、SHA-256、记录数与快照哈希清单复算结论 |
| 工作区入口 `scripts/code/java/check_worktree_java_comments.py` | 继承上述环境变量与默认位置 |
| 分支复核 `scripts/code/java/check_staged_java_comments.py --validate-evidence-branches` | 复算清单中所有显式声明证据分支的记录；未声明分支的记录不由该入口判定 |

显式配置优先于默认位置：命令行参数 `--evidence-registry`/`--evidence-snapshots` 高于 `JAVA_COMMENT_EVIDENCE_REGISTRY`/`JAVA_COMMENT_EVIDENCE_SNAPSHOTS`，环境变量高于本目录默认值。显式配置不可读时退出非零，不静默回落到默认位置。仓内快照只在目录真实存在时启用，外部受控快照与既有夹具的「未配置快照」语义不变。

### 三态验收与当前实测分布

按[裁决 D15](../裁决-D15-已登记阻断与发布门禁.md)，全量入口输出 `quality-check/v2` 报告，硬失败、已验收来源
（含独立 A1 分支）与已登记阻断分列；维护完成态用独立状态 `completed-with-registered-blockers`，**不再写成 `passed`**。
未显式选择维护模式时保持严格拒绝。本轮实测（命令与退出码见[验收矩阵](../R01-R17-验收矩阵.md)第二十二节）：

| 项 | 严格模式 | 显式维护模式 |
| --- | --- | --- |
| 进程退出码 | 1 | 0 |
| `status` | `failed` | `completed-with-registered-blockers` |
| 扫描 Java 文件 | 904 | 904 |
| 已验收（声明） | 31（来源说明 20 + 作者标签 11） | 同左 |
| 已登记阻断（声明） | 162（来源说明 129 + 作者标签 33） | 同左 |
| 硬失败 / 未覆盖 / 证据不可得 | 0 / 0 / 0 | 0 / 0 / 0 |

**记录口径与声明口径不同**：186 条记录中已验收 29 条、已登记阻断 157 条；声明口径为 31 与 162。
「已登记阻断」表示缺口被正确识别与纳管，**不表示来源关系、作者身份或交付义务已通过**。

`run_checks` 与 `ci_gate` 在发布阶段会取回并复核本轮来源验收报告；存在适用阻断时汇总退出 1、
`status=blocked`、`release_verified=false`。

## 索引字段重绑与账本重放

索引内部字段必须随最终字节重绑，不能停留在整改前版本。以下六类字段的定义与最终字节绑定：

| 字段 | 定义 |
| --- | --- |
| `local_sha256_after`、`type_evidence.file.local_sha256_final` | 当前文件**原始字节** SHA-256 |
| `type_evidence.types[].declaration_line` | 类型名 token 所在物理行（1 起） |
| `type_evidence.types[].javadoc_start_line` / `javadoc_end_line` | 绑定 JavaDoc 的 `/**` 与 `*/` 所在物理行 |
| `type_evidence.types[].javadoc_sha256` | 绑定 JavaDoc 文本 SHA-256 |
| `manifest.records_sha256` | `records` 规范化 JSON（`sort_keys`、`ensure_ascii=false`）SHA-256 |

对 `d12_correspondence_points[].local_lines`，重定位逐点按真实文件内容核对：直接命中 → 在候选整改前版本上逐行对齐并要求映射行含该片段（签名点要求首末名落在重定位后的首末行）→ 当前文件唯一内容匹配或旧内容邻近上下文严格胜出；不使用统一偏移量。记录自由文本里的「本地 L… / 上游 L…」按上游行号对归属到具体点后同步替换，无法归属时保持原样并登记。

重绑与重定位是**可重复运行**的机械步骤，工具与账本、快照同处置于仓库外（`.bf-local/d10fix/`，不进入仓库）：

```bash
bash .bf-local/d10fix/rebind_pipeline.sh [账本路径]   # 从账本重放 → 行号重定位 → 六类字段重绑 → 写入 manifest → 复核对齐
```

仓库内的回归守卫由 `scripts/tests/test_java_author_evidence.py` 的同名字段一致性用例承担：它按当前工作树复算六类字段与对应点定位，任何漂移都会使测试失败。索引绑定的是**某个工作树状态**；测试文件或其他会话再次改动已登记对象后，必须重跑上述流水线再验收。

**账本重放规则**：索引由账本重放派生，重放输入与结果登记在 `manifest` 与 `ledger_replay`：

1. 用 CSV 规则读账本，取 `d12_verdict` 属于 D12-174 候选且 `scope=backend-prod` 的 186 行（同名重复列取末列并登记首末不一条数）；
2. `d12_correspondence_points` 必须是有效 JSON；账本缺少 `type_evidence` 的 12 行沿用 D10b 构建的同路径逐类型证据；
3. 按当前工作树重绑六类指纹与行号字段、并重算 `manifest.records_sha256`；
4. 复核六类字段与工作树逐条一致、对应点能在当前文件定位。

`ledger_replay` 记录的实测事实：账本是**混合快照**——`ledger_local_sha_matches_worktree` 12 条已更新到最终态、`ledger_local_sha_matches_revision` 169 条仍是 `daf4d23^`（D13 路径续行前）的字节、两者都不是 0 条，186 条全部与工作树不一致（`ledger_local_sha_compared = 186`、`ledger_local_sha_matches_neither = 0`）；索引一律按工作树重绑，因此与账本在 `d12_verdict` 上差 81 条、在 `local_sha256_after` 上差 174 条、在 `type_evidence` 上差 186 条（其中 12 条账本为空）。索引**不**声称与账本逐字节同一快照；差异字段、重放输入与命令都如实登记。

> **范围声明（不要把 `differing_fields` 读成“只有 3 个字段不同”）**：上面这段只登记了 `d12_verdict`、`local_sha256_after`、`type_evidence` 三个**重点**比较字段，它们是 `manifest.ledger_replay` 的 `differing_fields`，不是账本与索引之间的全部差异字段。独立**全字段重放**（62 个字段全覆盖，行键 `local_path`，重名列取末列，标量按字符串比对、`type_evidence` 按 JSON 语义叶子比对；只比较账本与索引共有的 186 条）实测：**共 18 个字段存在差异，其余 44 个字段完全一致**。除上述 3 个外，另 15 个差异字段已登记在 `manifest.ledger_replay.additional_differing_fields`（只放字段名与差异条数，无任何新证据判断）：
>
> | 字段 | 差异条数 | 字段 | 差异条数 | 字段 | 差异条数 |
> | --- | --- | --- | --- | --- | --- |
> | `local_bytes_after` | 185 | `local_bytes_final` | 174 | `d12_correspondence_points` | 169 |
> | `evidence_points` | 168 | `open_gap` | 125 | `d12_blocker_reason` | 107 |
> | `b1_review` | 98 | `independent_review` | 98 | `local_modification_facts` | 98 |
> | `review_conclusion` | 98 | `author_only_contract` | 12 | `counter_evidence_conclusion` | 1 |
> | `evidence_branch` | 1 | `evidence_route` | 1 | `review_by` | 1 |
>
> 两表合计 18 个即全部差异字段。其中差异**仅 1 条**的 `counter_evidence_conclusion`、`evidence_branch`、`evidence_route`、`review_by` 四个字段**全部落在 `ApiEncrypt.java` 这一条记录上**（账本侧 `evidence_branch`/`counter_evidence_conclusion` 为空、`evidence_route` 为“路线 3”、`review_by` 为 D10b 会话署名；索引侧为 `E1-author-only`、“路线 2”与 d15ev/d10review2 署名）——方向与 `manifest.d15ev_execution.verdict_change` 登记的“`ApiEncrypt` 改判为 accepted 并落 `evidence_branch = E1-author-only`”一致，**索引是较新的一侧**；如实登记该差异，不对其作任何改判。`author_only_contract` 的 12 条中，11 条是 11 条 A1 记录的 `author_only_contract.tool.sha256` 单叶子差异，第 12 条是 `ApiEncrypt.java` 账本该字段为空。重放方法与读数登记在 `manifest.ledger_replay.full_field_replay`，`type_evidence` 的逐路径叶子构成见同节 `differing_type_evidence_fields`（本轮实测与之逐项一致）。

## 证据分支契约

`evidence_branch` 是按记录显式声明的版本化启用开关：未声明分支的记录沿用原有充分路线的结构校验，本规则不改判任何已有条目；一旦声明分支，就必须满足该分支的全部必需字段与判据，否则对应来源例外被拒绝。机械校验与语义复核分工明确：机器只确认结构与可判定的不合格形状，有区分力的对应与身份贡献仍以记录中绑定的逐项复核结论为准。

| 分支 | 归属路线 | 判据要点 |
| --- | --- | --- |
| `E1-author-only` | 路线 2 | 固定双方完整原始输入（本地基线提交或受控快照相对路径 + 上游固定提交，均绑定 SHA-256）；逐条登记 `excluded_author_declarations`（文件、输入指纹、行区间、逐字原文、声明种类、所属注释/类型、对应关系）；只可排除独立 `@author` 行与经识别为纯作者身份/角色的紧随行，其余行与混合作者事实的一行都拒绝；仅排除后按 R1–R4 逐行全等、剩余内容非空；原始差异逐处归因；`tool.sha256` 必须等于当前规则实现指纹，`remaining` 的双方指纹与行数必须与实测一致 |
| `C2-independent-content` | 路线 3 | `content_points[]` 至少两点，双方同一固定上游文件、片段指纹、双方行号、所属类型与字段/行为、语料绑定与 `discrimination_reason` 齐全；另需 `independence_reason` 与反证结论。重复片段、互为包含、同一字段/行为复述、双方行号重合、通用校验串/自动生成描述/常见示例值与结构点一律拒绝 |

`E1-author-only` 允许上游声明作者（这正是该分支的适用场景）：其上游输入只复核固定字节指纹，不套用“上游必须无作者”的来源说明门槛；上游作者的保留或恢复仍按 D10/D12 各自条件处理。

**当前账本的字段形状缺口**：`registry-d12b.tsv` 里 11 条 A1 记录只在 `d12_correspondence_points` 里写了 `kind: E1-author-only（D14 路线 2 新分支）` 与 `excluded_upstream`，**没有** D14 §67–§73 要求的 `evidence_branch`、`author_only_contract`（双方输入指纹、`excluded_author_declarations`、R1–R4 映射表与顺序、`remaining`、`attribution`、工具指纹、复核字段）与反证结论。因此分支入口对当前索引实测 `checked: 0`：契约未声明即不启用机械复算。要让这 11 项被本规则真正复算，账本须按 D14 schema 补齐上述字段；补齐后 `--validate-evidence-branches` 会逐项复算，负对照见 `scripts/tests/test_java_author_evidence.py` 与仓库外 `a1_negcontrol_probe.py`。

> 上段是 D12-174 交付时的历史状态。D10close 轮已按 D14 §60–§73 在同一 v3 账本内补齐 `evidence_branch` 与 `author_only_contract`，分支入口对当前索引实测 `checked: 15 / findings: 0`；账本指纹与列数见 `manifest.source_ledger_sha256`/`source_ledger_columns`。历史文本保留，最新状态以本目录索引与 `manifest` 为准。

> **复算更正（2026-10-06，HEAD `1a51cc84a4ff000a58cdd42349b22925ac31208e`）**：上段的 `checked: 15 / findings: 0` 已被复算轮真实重跑更新为 **`checked: 16 / findings: 0`**，退出码 0（`python3 -B -X utf8 scripts/code/java/check_staged_java_comments.py --validate-evidence-branches`，`registry_sha256` = `282735c352a312f4fb22b3cad3f823e3ab6c531fef90287c89fe77e6e98b9b82`、`records` = 186）。当前索引 `evidence_branch` 分布实测为 `E1-author-only` 12 条 + `C2-independent-content` 4 条 = 16 条声明分支，多出的 1 条是 `ApiEncrypt.java`——它由[裁决 D15](../裁决-D15-已登记阻断与发布门禁.md)逐项核实轮改判为 accepted 并落 `evidence_branch = E1-author-only`（索引 `manifest.d15ev_execution.verdict_change`，`accepted: 1`）。证据全文见仓库外 `.bf-local/recompute/证据.md`。

### N1：分支↔路线归属校验（n1fix 轮）

分支是版本化契约的启用开关，同时约束记录必须归属的证据路线：`E1-author-only` 只允许路线 2、`C2-independent-content` 只允许路线 3。来源说明路径（`_route_reasons`）与分支入口（`_validate_declared_branches`）**共用同一实现** `_branch_route_reasons`，归属不符时两个入口给出逐字相同的诊断并拒绝，归属不成立时不再叠加分支判据（与来源说明入口的早返回口径一致）。

此前 `--validate-evidence-branches` 只对 `C2-independent-content` 复算内容点判据，不校验 `evidence_route` 是否归属路线 3，因此**没有来源说明**的 C2 记录在分支入口漏检（全量入口按来源说明路径会拒绝）。修法即补上这一校验。负对照（C2 写成路线 2、E1 写成路线 3、缺失 `evidence_route`、合法归属）在 `scripts/tests/test_java_author_evidence.py` 用真实 CLI 固化为退出码与诊断断言。

### 工具指纹重绑与结构点重定位（n1fix 轮）

- **工具指纹重绑**：证据分支契约的 `tool.sha256` 必须等于当前规则实现指纹；每轮规则实现改动都会改动同一文件 `scripts/code/java/check_staged_java_comments.py`，因此声明 `E1-author-only` 的 12 条记录（11 条 A1 + D15 §107 改判的 `ApiEncrypt.java`）的 `author_only_contract.tool.sha256` 按同一口径机械重绑，**当前实测值为 `037ce2f6…`**，完整重绑轨迹为 `1a06a625…`（D10close 基线）→ `2839dddd…`（n1fix：N1 分支↔路线归属修法）→ `5fbbf43d…`（同一实现文件被并行会话继续修改）→ `dffc690f…`（d10review2：D14 §132 来源说明验收状态 + §112 内容点绑定判据落地）→ `b396db67…`（d15impl：裁决 D15 落地）→ `037ce2f6…`（D7：仓内受控快照默认解析 + 快照哈希清单逐条复算），逐步明细登记在 `manifest.branch_route_ownership_fix.tool_sha_rebind_history`，汇总值与轨迹说明在同节 `tool_sha_rebind.after` / `after_trace`。`manifest.records_sha256` 随之重算为 `48d0da82…`。
  - **D7 轮的重绑理由**：把最小固定上游证据快照纳入版本控制需要在同一实现文件里新增「仓库内受控快照默认位置」与「快照哈希清单逐条复算」，整文件指纹因此变化。A1 比较实现的八个函数（`_comment_body_line`、`_exclusion_reason`、`_a1_normalize`、`_a1_raw_changed_lines`、`_a1_compare`、`_a1_baseline_bytes`、`_author_only_contract_reasons`、`_content_independent_reasons`）经 `git diff` 与 AST 源码段逐项比对**确认一行未改**；本轮按可复现口径（`ast.get_source_segment` 源码段的 UTF-8 字节 SHA-256）重新登记逐函数指纹，上一轮登记的取值口径已不可复现，故不沿用旧值并在该处如实标注。
  - **冻结账本分歧**：声明账本 `registry-d12b.tsv`（SHA-256 `986b40a0…`）仍保留重绑前的 `1a06a625…`，从该账本完整重放会在这一个嵌套字段上产生旧值；`ledger_replay` 的比较字段不含 `author_only_contract`，其余重放关系不变，该差异已按上节范围声明登记在 `additional_differing_fields`（12 条）。
- **结构点行号重定位**：上一轮 155 个无 `fragment` 的结构/说明点中有 6 个未定位。n1fix 轮逐点重定位——按记录 `size` 枚举双方 R5 归一化序列里长度恰为 `size` 的完全相同窗口，并用记录 `head` 锚定起点（容忍账本端定长截断）；注释剥离按 Java 词法识别字符串/字符字面量，`FileController.java` 第 11 点上一轮未命中即来自把 `@GetMapping("/…/**")` 里的 `/**` 误当块注释起点。结果见 `manifest.structural_point_localization`：155 点中 **144 定位 + 11 条作者声明说明点，0 个不可定位**，逐点行号在同节 `items[]`。

## D16 逐条复核材料（只准备材料，不判定）

裁决 D16（仓库外原件 `.bf-local/d16/裁决-D16.md`，仓内未收录该裁决文档）§114 授权的是「实施者之外的负责方逐条复核」。本目录的两份材料把该复核所需的读数准备到可直接开工的程度：

| 文件 | 内容 | 谁填写 |
| --- | --- | --- |
| [代码同一性逐条复核材料.md](代码同一性逐条复核材料.md) / `.json` | 42 条严格比较成立候选（41 个文件）的八项要素：对象标识（含嵌套类型与所属模块）、严格比较读数与逐条变换发生点、原始差异逐行归因、注释绑定逐字原文与指纹、署名与作者处理、契约影响的具体命中位置、单条复现命令、未解决问题 | `reviewer_verdict`／`reviewer`／`review_date`／`review_reason` **留空**，由独立复核方填写 |
| [代码同一性通配符导入扩展材料.md](代码同一性通配符导入扩展材料.md) / `.json` | 3 条通配符导入对象的 D16 §84 前置材料：Java 版本与完整编译依赖的逐字节固定、导入集合逐条对应（以固定 JDK 的 `src.zip` 为类型索引）、未使用／冲突／同名类型反例的实测读数、候选规则草案与风险清单 | 同上；候选规则草案标注「待裁决」，**未实施、未登记进变换集** |

口径与边界：

- 严格比较读数一律由规则实现 [check_staged_java_comments.py](../../../scripts/code/java/check_staged_java_comments.py) 自身的词法、变换、序列化与差异行统计函数产出；材料生成器不另写比较实现。
- 逐类型 JavaDoc 指纹按规则实现的 `_attached_javadoc` 口径复算，与索引 `type_evidence` 登记值逐条一致。
- 作者结论只覆盖**固定提交文件的逐字节副本实测扫描**；固定提交之外的上游版本一律写「未核实」，不按项目名或所有者补造。
- 契约影响只给机械命中的具体行号与权威核对命令，不写「无影响」这类结论。
- 材料生成器 [build_d16_review_package.py](../../../scripts/tools/build_d16_review_package.py) 不进入任何门禁组；`--verify-item`／`--verify-wildcard` 可让复核方按本机当前工作树复算并与材料比对，任一读数不符即非零退出。

## 复核与重生成
- 门禁每次都会报告本次采用的清单路径、SHA-256 与记录数；报告中的指纹应与本目录文件一致。
- 账本更新后必须重新派生本索引并保留整改前事实、变更理由与候选指纹；不得直接编辑记录。
- 索引只承载可复算的来源数据，不承载维护会话日志；上游正文的逐字节副本按 D7 授权进入[上游快照](上游快照/README.md)，许可验收结论仍不由本目录给出。
- 复核最终版本时至少实际验证：六类字段与工作树逐条一致、对应点能在所声明的输入版本上定位、尾部空白负对照按 D13 被拒、声明分支的比较能被复算、快照哈希清单逐条复算通过。

## 已知限制与暂缓工作

- 索引只覆盖 D12-174 候选 186 条；账本中其余 **811** 条“不适用（非 D12-174 候选）”对象不由本索引授权。D12 裁决另有“431 个未核实或冲突项”的口径，与本账本 997 行不是同一范围，二者都不得被本索引当作已验收。
- 固定地址取回仍依赖到 `raw.githubusercontent.com` 的网络可达性，但**只作为仓内快照缺位时的回退**；仓内快照已覆盖全部 186 条记录的实际消费集合，实测可完全离线复核。
- **收录量随判据变化**：裁决 D15 §72/§115 要求已登记阻断逐条复算绑定材料实测字节，因此 157 条已登记阻断记录同样需要上游字节，快照从最初的 29 个文件扩到 186 个（上游仓库共 8744 个文件）。今后任何新增或放宽的「消费上游字节」的判据，都必须同步扩充快照与哈希清单，否则断网复核会按「证据不可得」失败。
- **索引 `license_path` 现为可解析形态并被检查器真实消费**：186 条记录统一登记 `ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5/LICENSE`（2026-10-07 实测，186/186 同一取值），即 `resolve_license_relative_path` 解析的 `<仓库名>@<40 位提交>/<上游相对路径>` 形态；加载受控证据时逐条复算定位、清单条目指纹与快照内文件实际字节，任一不符即以退出码 2 拒绝。把它改回历史形态 `yudao/LICENSE@<commit>` 时，`check_staged_java_comments.py --validate-evidence-branches`、`check_full_java_comments.py --maintenance`、`check_worktree_java_comments.py`、`check_staged_quality.py`、`run_checks.py --group comments` 五个真实 CLI 全部以退出码 2 报「`license_path` 不是可解析形态」。`ci_gate` 只按整文件指纹绑定索引、不解析该字段。改前取值与理由仍登记在索引 `manifest.license_path_fix`。
- 12 条 A1 契约的本地比较输入仍按 `git show <整改前基线提交>:<路径>` 取回。完整历史下随时可得（本机实测可达），但浅克隆、历史改写或对象回收会取不回；仓内已按最小集合纳入这 12 个文件的副本并纳入哈希清单，作为仓内可复现来源，详见[上游快照说明](上游快照/README.md#a1-本地比较输入的仓内副本)。
- 上游快照与许可材料的存在**不表示**本仓库已为其自有代码选择许可证，也不表示 Java 后端整体派生关系已完成声明义务；那仍属[待有权者决定事项](../待有权者决定事项.md) 的未决事项。
- 规则校验结构、版本、指纹与映射一致性；有区分力的对应与身份贡献仍需人工逐项复核。
- 155 个结构/A1 说明点（原 138 个 P3 结构点 + 11 条 A1 记录 + 6 条改判记录的说明点）没有 `fragment`，其行号记录在 D10 的 R1–R6 归一化比对空间或 A1 比较空间，不是当前文件的物理行号；D10close 轮完成 138 个 P3 结构点的 head 匹配定位，n1fix 轮把剩余 6 个逐点重定位（0 个不可定位），两次结果都登记在 `manifest.structural_point_localization`。
- 14 处记录自由文本的「本地 L… / 上游 L…」引用既不属于任何对应点、也与记录声明的作者行原文不符（集中在 11 条 A1 记录与 3 条改判/结构点记录），无法用当前文件内容复算；未做猜测性改写，登记在 `manifest.relocalization.record_text_unattributed_records`，须由账本产出方修正。
- 索引六类字段绑定某个工作树状态；并行会话改动已登记对象后必须重跑重绑流水线，否则字段一致性用例会失败。
