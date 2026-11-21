## 变更切片与目标

- 关联需求或问题：
- 本次单一职责范围（一事一 PR）：
- 非目标与排除范围：

## 调用方与契约同步

- [ ] 已核对前后端接口路径、DTO/VO 模型、权限码或环境变量消费方，未直接暴露持久化 DO。
- [ ] 如涉及脚本、环境变量、工作区清单或架构规则变化，已同步对应 README、`docs/开发指南/脚本使用索引.md` 或架构文档。
- [ ] 如涉及业务项目非机械性决策变化，已补充或更新对应的 Agent Note（纯局部机械性修改可豁免）。

## 纠错即门禁与反例证明

- [ ] 如本次包含缺陷修复或审查纠偏，已将规则接入既有测试、ESLint、ArchUnit 或文档检查入口。
- 反例证明说明（未修复或故意注入坏样本时的失败现象）：

## 实际验证证据

- 受验版本（PR 编号、分支与 `head SHA`）：
- 统一验收证据（可用 `python -B -X utf8 scripts/workflow/verify_slice.py --base main --pr #<编号> --evidence-md <路径>` 汇出）：
- 后端验证（如 `mvn -B -ntp -Pquality-gate verify` 及实际通过数）：
- 前端验证（如 `pnpm run quality:gates`、`pnpm run test:e2e:ci`）：
- 仓库与暂存门禁（如 `python -B -X utf8 -m pytest scripts/tests`、`check_staged_quality.py`）：
- 未执行或跳过项及原因：

## 独立审查与托管合并门禁承接

- 核对 `acceptance-proof-<attempt>` 中的实际受验 SHA、PR head、基线、测试计数及未执行项。附件变更同时核对 `attachment-integration-summary-<attempt>` 的同一 PR head、合并 SHA、服务版本及结果。
- 默认单维护者模式。由独立只读审查后，仓库所有者以单条 PR 评论签收实际报告。多人模式还需要符合条件的非作者维护者在本 head 上的 GitHub `APPROVED`，并由同一维护者签收当前 head 和 base。使用当前 PR 编号及两个完整 SHA。

```text
pr-review-receipt v1 type=pass pr=<number> head=<sha> base=<sha> review=<link-or-id> access=readonly
```

- 若变更涉及受保护的扫描器或规则文件，用相同格式另签 `type=security-rules`。head 或 base 更新后重新审核和签收。签收后重新运行 CI 全部作业，或编辑 PR 正文触发一次完整运行。
- [ ] 已核对上方证据与当前 PR，并确认托管严格状态检查要求分支为最新基线。多人模式同时核对 GitHub 原生审批和关键目录的 CODEOWNERS 评审。
- 若必须在单个 PR 交付多环节修复且触发切片大小门禁，在正文以独立一行填写 `[slice-override]: <原因>`。

## 风险与回滚方式

- 兼容性或运行期风险：
- 回滚方案（数据库/配置/代码）：
