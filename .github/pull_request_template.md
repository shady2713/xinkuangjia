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

- 托管 `main` 分支保护当前强制五项必过状态检查（`backend (Maven quality-gate)`、`frontend (unit + typecheck + lint + build)`、`docs + comments`、`pytest (scripts/tests)`、`secrets scan (staged-equivalent)`）；单人维护模式下 GitHub 平台 `required_pull_request_reviews` 为 `null`（不支持作者自审）。
- 独立审查承接方式：在合入前须以本 PR 与上述同一 `head SHA` 验收证据完成独立复核（独立审查者、独立只读审查子代理或维护者显式签收）；进入多人协作模式时，应同步开启 GitHub 分支保护的 `required_pull_request_reviews`。
- [ ] 已确认上述验收证据对应的 `head SHA` 与当前 PR 最新提交一致，且无未说明的跳过项。

## 风险与回滚方式

- 兼容性或运行期风险：
- 回滚方案（数据库/配置/代码）：
