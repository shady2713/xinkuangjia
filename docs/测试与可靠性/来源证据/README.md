---
description: "D12 来源例外的受控来源索引：派生规则、八个证据字段组、上游内容复取与门禁消费方式。"
kind: package-reference
---

# D12 来源证据索引

## 摘要

本目录存放 `type-author` 来源例外的受控来源索引，供提交路径、工作区路径、全量路径与 CI 使用同一份证据输入。索引是派生数据：只登记对象、指纹、比对依据与复核结论，不包含任何上游文件正文。索引由 D10/D12 账本派生，禁止手工新增或改写记录。

## 目录

- [索引内容](#索引内容)
- [派生规则](#派生规则)
- [八个证据字段组](#八个证据字段组)
- [上游内容来源](#上游内容来源)
- [门禁消费方式](#门禁消费方式)
- [索引字段重绑与账本重放](#索引字段重绑与账本重放)
- [证据分支契约](#证据分支契约)
- [复核与重生成](#复核与重生成)
- [已知限制与暂缓工作](#已知限制与暂缓工作)

## 索引内容

| 文件 | 内容 |
| --- | --- |
| [d12-source-index.json](d12-source-index.json) | 186 条 D12-174 候选记录（136 条已应用来源说明、6 条 D10b 改判、11 条 A1 恢复署名、33 条证据不足阻断）；顶层 `manifest` 记录派生依据与指纹，`records` 为逐条清单记录 |
| [README.md](README.md) | 本说明 |

索引中的每条记录对应一个本地对象（`local_path` 唯一），记录上游定位、上游内容指纹、历史依据、比对依据、作者判断、许可关联与逐项复核。规则只对主张来源证据的 public 类型读取这些记录；没有来源说明的类型继续走准确作者路径。

## 派生规则

- 来源账本：`registry-d12b.tsv`（997 行 × 67 列，schema `d12-registry/v3`），SHA-256 `3660cc02fa2261088ec546c6c3a0d089040c6559a5ef48f9b1ae8e5ccd6e1a90`。索引由 `.bf-local/d10fix/derive_index_from_ledger.py` 从该账本重放，再按当前工作树重绑指纹。
- 选取口径：`d12_verdict` 属于 D12-174 候选且 `scope=backend-prod`，共 186 条——136 条“已按 D12 格式写入来源说明并撤回无依据署名”、6 条“已按 D12 格式写入来源说明（D10b 改判）”、11 条“A1（E1-author-only）成立，恢复上游证据支持的作者”、33 条“证据不足，保持原状并登记阻断”；其余 811 条“不适用（非 D12-174 候选）”不进入索引，主张来源例外时按“清单没有逐项记录”拒绝。
- 重复列名：账本表头仍有 11 个重名（D10 列与 D10b 更新列同名）。派生取**末列**（D10b 更新值），并把选定记录上“首列与末列取值不同”的条数登记在 `manifest.duplicate_column_mismatches`（实测：`author_status` 12、`evidence_points`/`evidence_route`/`local_sha256_after`/`open_gap`/`review_by`/`review_conclusion` 各 17）。该差异必须如实登记，不能表述成“两侧一致”。
- 逐类型证据：账本有 12 条记录没有 `type_evidence`（11 条 A1 恢复署名 + 1 条改判），索引沿用 D10b 构建的同路径逐类型证据，登记在 `manifest.synthesized_type_evidence`。
- 本索引的中立指纹：见 `manifest.records_sha256`（逐条记录规范化 JSON 的 SHA-256）。

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

索引只保存固定地址与指纹，不保存正文。规则按以下顺序取得上游内容：

1. **受控快照优先**：`JAVA_COMMENT_EVIDENCE_SNAPSHOTS` 或 `--evidence-snapshots` 指向的快照目录中，固定提交的对应文件必须先通过 `upstream_sha256` 复算与无作者声明检查。
2. **固定地址取回**：快照缺失时按 `upstream_file_url` 取回。地址必须固定在登记提交上，且路径与 `upstream_path` 一致；取回内容复算 SHA-256，不符即拒绝。
3. **取不回即拒绝**：无法取回或指纹不符时给出具体原因并非零退出，不回退到无条件放行。

`upstream_file_url` 使用 `github.com` 的 `blob` 固定提交地址；规则转换为 `raw.githubusercontent.com` 的同提交内容地址。受控快照与网络取回都不可用时，需要显式配置快照才能离线复核。

## 门禁消费方式

| 入口 | 默认证据输入 |
| --- | --- |
| 提交路径 `scripts/workflow/check_staged_quality.py` | 本目录 `d12-source-index.json`，快照未配置时按固定地址取回 |
| CI `scripts/workflow/run_checks.py` 的 Java 注释检查 | 同上，路径相对被检查仓库根目录解析 |
| 全量入口 `scripts/code/java/check_full_java_comments.py` | 同上，并在 JSON 与非 JSON 输出中报告清单路径、SHA-256 与记录数 |
| 工作区入口 `scripts/code/java/check_worktree_java_comments.py` | 继承上述环境变量与默认位置 |
| 分支复核 `scripts/code/java/check_staged_java_comments.py --validate-evidence-branches` | 复算清单中所有显式声明证据分支的记录；未声明分支的记录不由该入口判定 |

显式配置优先于默认位置：命令行参数 `--evidence-registry`/`--evidence-snapshots` 高于 `JAVA_COMMENT_EVIDENCE_REGISTRY`/`JAVA_COMMENT_EVIDENCE_SNAPSHOTS`，环境变量高于本目录默认值。显式配置不可读时退出非零，不静默回落到默认位置。

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

`ledger_replay` 记录的实测事实：账本是**混合快照**——`ledger_local_sha_matches_worktree` 62 条已更新到最终态、`ledger_local_sha_matches_revision` 169 条仍是 `daf4d23^`（D13 路径续行前）的字节、两者都不是 0 条；索引一律按工作树重绑，因此与账本在 `local_sha256_after` 上差 124 条、在 `type_evidence` 上差 141 条（其中 12 条账本为空）。索引**不**声称与账本逐字节同一快照；差异字段、重放输入与命令都如实登记。

## 证据分支契约

`evidence_branch` 是按记录显式声明的版本化启用开关：未声明分支的记录沿用原有充分路线的结构校验，本规则不改判任何已有条目；一旦声明分支，就必须满足该分支的全部必需字段与判据，否则对应来源例外被拒绝。机械校验与语义复核分工明确：机器只确认结构与可判定的不合格形状，有区分力的对应与身份贡献仍以记录中绑定的逐项复核结论为准。

| 分支 | 归属路线 | 判据要点 |
| --- | --- | --- |
| `E1-author-only` | 路线 2 | 固定双方完整原始输入（本地基线提交或受控快照相对路径 + 上游固定提交，均绑定 SHA-256）；逐条登记 `excluded_author_declarations`（文件、输入指纹、行区间、逐字原文、声明种类、所属注释/类型、对应关系）；只可排除独立 `@author` 行与经识别为纯作者身份/角色的紧随行，其余行与混合作者事实的一行都拒绝；仅排除后按 R1–R4 逐行全等、剩余内容非空；原始差异逐处归因；`tool.sha256` 必须等于当前规则实现指纹，`remaining` 的双方指纹与行数必须与实测一致 |
| `C2-independent-content` | 路线 3 | `content_points[]` 至少两点，双方同一固定上游文件、片段指纹、双方行号、所属类型与字段/行为、语料绑定与 `discrimination_reason` 齐全；另需 `independence_reason` 与反证结论。重复片段、互为包含、同一字段/行为复述、双方行号重合、通用校验串/自动生成描述/常见示例值与结构点一律拒绝 |

`E1-author-only` 允许上游声明作者（这正是该分支的适用场景）：其上游输入只复核固定字节指纹，不套用“上游必须无作者”的来源说明门槛；上游作者的保留或恢复仍按 D10/D12 各自条件处理。

**当前账本的字段形状缺口**：`registry-d12b.tsv` 里 11 条 A1 记录只在 `d12_correspondence_points` 里写了 `kind: E1-author-only（D14 路线 2 新分支）` 与 `excluded_upstream`，**没有** D14 §67–§73 要求的 `evidence_branch`、`author_only_contract`（双方输入指纹、`excluded_author_declarations`、R1–R4 映射表与顺序、`remaining`、`attribution`、工具指纹、复核字段）与反证结论。因此分支入口对当前索引实测 `checked: 0`：契约未声明即不启用机械复算。要让这 11 项被本规则真正复算，账本须按 D14 schema 补齐上述字段；补齐后 `--validate-evidence-branches` 会逐项复算，负对照见 `scripts/tests/test_java_author_evidence.py` 与仓库外 `a1_negcontrol_probe.py`。

## 复核与重生成
- 门禁每次都会报告本次采用的清单路径、SHA-256 与记录数；报告中的指纹应与本目录文件一致。
- 账本更新后必须重新派生本索引并保留整改前事实、变更理由与候选指纹；不得直接编辑记录。
- 索引只承载可复算的来源数据，不承载维护会话日志；上游正文与许可结论按裁决在仓库外单独处置。
- 复核最终版本时至少实际验证：六类字段与工作树逐条一致、对应点能在所声明的输入版本上定位、尾部空白负对照按 D13 被拒、声明分支的比较能被复算。

## 已知限制与暂缓工作

- 索引只覆盖 D12-174 候选；823 条“不适用”对象与 431 口径未核实对象维持阻断，不由本索引授权。
- 固定地址取回依赖到 `raw.githubusercontent.com` 的网络可达性；离线复核必须显式提供受控快照目录。
- 上游文件正文与许可结论按裁决留在仓库外，本目录不提供许可验收结论。
- 规则校验结构、版本、指纹与映射一致性；有区分力的对应与身份贡献仍需人工逐项复核。
- 155 个结构/A1 说明点（原 138 个 P3 结构点 + 11 条 A1 记录 + 6 条改判记录的说明点）没有 `fragment`，其行号记录在 D10 的 R1–R6 归一化比对空间或 A1 比较空间，不是当前文件的物理行号，本轮未重定位，如实登记在 `manifest.relocalization.structural_points_out_of_scope`。
- 14 处记录自由文本的「本地 L… / 上游 L…」引用既不属于任何对应点、也与记录声明的作者行原文不符（集中在 11 条 A1 记录与 3 条改判/结构点记录），无法用当前文件内容复算；未做猜测性改写，登记在 `manifest.relocalization.record_text_unattributed_records`，须由账本产出方修正。
- 索引六类字段绑定某个工作树状态；并行会话改动已登记对象后必须重跑重绑流水线，否则字段一致性用例会失败。
