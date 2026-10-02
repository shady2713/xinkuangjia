# Java 变更验证选择

按变更选择 Java 验证入口，业务范围遵循[项目测试策略](../../../../docs/测试与可靠性/测试策略.md)，质量工具见[脚本索引](../../../../docs/开发指南/脚本使用索引.md)。

## 从变更选择范围

沿用目标模块的 JUnit 5 与 Maven Surefire，按变更选择下表对应项。

| 变化 | 所需证据 |
| --- | --- |
| Java 局部业务、Controller 或 Mapper | 目标模块测试；新增或修改行为覆盖正常、关键边界与失败路径 |
| 跨模块 API、DTO 或公共组件 | 提供方及受影响消费者测试，必要时扩大聚合验证 |
| ORM、事务、拦截器、序列化 | 能观察实际机制的切片或隔离集成测试，不能仅靠 Mock |
| 配置字段、默认值或校验 | 绑定测试及缺失、非法组合行为 |
| 自动配置、扫描或模块装配 | 最小上下文测试与受影响 server 聚合编译 |
| 环境变量或部署注入关系 | 核对 Java、环境样例、Compose 与脚本消费方；展开受影响 Compose，不输出真实秘密 |
| SQL、迁移或实际部署 | 按[数据库约定](sql.md#对应验证)或[部署流程](../../../../docs/部署/部署说明.md)验证，Maven 成功不能替代 |
| 仅修改 Java 注释、行为不变 | 语义复核与工作区注释门禁，不自动要求模块业务测试 |
| 仅 Skill 或 Markdown | 文档、引用、结构、元数据及编码检查，无需 Maven 构建 |

编写或修改涉及共享状态、并发、时钟、子进程或资源清理的测试时，按问题读取[测试可靠性](../../../../docs/测试与可靠性/测试可靠性.md)的相关章节；排查已有偶发失败时读取[偶发失败诊断](../../../../docs/测试与可靠性/偶发失败诊断.md)。

## Maven 入口与结果判读

在 `后端代码/basic-framework-boot` 执行，实际模块、Profile、插件参数以[源 POM](../../../../后端代码/basic-framework-boot/pom.xml)及目标模块为准。以下沿用现有入口，替换目标模块和测试类后核对实际执行范围。

目标模块及必要依赖：

```powershell
mvn -q -pl basic-framework-module-infra -am test
```

局部诊断或回归定位：

```powershell
mvn -q -pl basic-framework-server -am "-Dtest=LocalEnvironmentConfigurationTest" "-Dsurefire.failIfNoSpecifiedTests=false" test
```

该参数允许上游模块没有同名测试，也可能掩盖目标未选中；查看目标 Surefire 报告，确认指定类执行且数量非零。不能只凭退出码认定回归通过。

需要聚合测试时使用 `mvn -q test`；仅验证编译与打包可使用 `mvn -q -DskipTests package`，但必须标明未运行测试。

质量门禁入口为 `mvn -q -Pquality-gate verify`。按任务风险和项目要求执行，读取实际 PMD 与 JaCoCo 报告、目标模块阈值及排除项；规则见 [PMD 配置](../../../../后端代码/basic-framework-boot/config/pmd/basic-framework-ruleset.xml)。

## 工作区检查与交付

修改 Java 后执行[工作区注释门禁](java-comments.md#修改后复核)，其他改动按脚本索引选择实际入口。检查版本、失败处理和交付报告遵循[根规则](../../../../AGENTS.md#required-validation)。
