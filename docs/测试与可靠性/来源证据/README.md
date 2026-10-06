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
- [复核与重生成](#复核与重生成)
- [已知限制与暂缓工作](#已知限制与暂缓工作)

## 索引内容

| 文件 | 内容 |
| --- | --- |
| [d12-source-index.json](d12-source-index.json) | 174 条 D12-174 候选记录；顶层 `manifest` 记录派生依据与指纹，`records` 为逐条清单记录 |
| [README.md](README.md) | 本说明 |

索引中的每条记录对应一个本地对象（`local_path` 唯一），记录上游定位、上游内容指纹、历史依据、比对依据、作者判断、许可关联与逐项复核。规则只对主张来源证据的 public 类型读取这些记录；没有来源说明的类型继续走准确作者路径。

## 派生规则

- 来源账本：`registry-d12.tsv`（997 行 × 67 列），SHA-256 `5b3e12f2853eec00a31dc69f6c01defb182e9a716b5fe74df22e5b598a4c7e67`。
- 选取口径：`d12_verdict` 为“已按 D12 格式写入来源说明并撤回无依据署名”（136 条）或“证据不足，保持原状并登记阻断”（38 条）的 D12-174 候选，共 174 条；其余 823 条“不适用（非 D12-174 候选）”不进入索引，主张来源例外时按“清单没有逐项记录”拒绝。
- 重复列名：账本表头有 11 个重名（D10 列与 D12 扩展列同名）。两侧取值在 997 行上完全一致，派生时只保留唯一列名并在 `manifest.duplicate_columns` 登记，避免“后列覆盖前列”的隐式优先级。
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

显式配置优先于默认位置：命令行参数 `--evidence-registry`/`--evidence-snapshots` 高于 `JAVA_COMMENT_EVIDENCE_REGISTRY`/`JAVA_COMMENT_EVIDENCE_SNAPSHOTS`，环境变量高于本目录默认值。显式配置不可读时退出非零，不静默回落到默认位置。

## 复核与重生成

- 门禁每次都会报告本次采用的清单路径、SHA-256 与记录数；报告中的指纹应与本目录文件一致。
- 账本更新后必须重新派生本索引并保留整改前事实、变更理由与候选指纹；不得直接编辑记录。
- 索引只承载可复算的来源数据，不承载维护会话日志；上游正文与许可结论按裁决在仓库外单独处置。

## 已知限制与暂缓工作

- 索引只覆盖 D12-174 候选；823 条“不适用”对象与 431 口径未核实对象维持阻断，不由本索引授权。
- 固定地址取回依赖到 `raw.githubusercontent.com` 的网络可达性；离线复核必须显式提供受控快照目录。
- 上游文件正文与许可结论按裁决留在仓库外，本目录不提供许可验收结论。
- 规则校验结构、版本、指纹与映射一致性；有区分力的对应与身份贡献仍需人工逐项复核。
