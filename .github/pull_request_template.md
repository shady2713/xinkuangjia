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

- 后端验证（如 `mvn -B -ntp -Pquality-gate verify` 及实际通过数）：
- 前端验证（如 `CI=true pnpm lint`、`pnpm check:type`、`pnpm test:unit`、`pnpm build:ele`）：
- 仓库与暂存门禁（如 `python -B -X utf8 -m pytest scripts/tests`、`check_staged_quality.py`）：
- 未执行或跳过项及原因：

## 风险与回滚方式

- 兼容性或运行期风险：
- 回滚方案（数据库/配置/代码）：
