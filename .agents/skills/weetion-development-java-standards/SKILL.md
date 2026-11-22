---
name: weetion-development-java-standards
description: 在 basic-framework 3 模块 Java 后端（core/system/server）及 14 表 SQL 中设计、修改或评审代码时使用。
---

# Java 后端工程规范（v2.0 三模块架构）

## 模块边界
- `basic-framework-core`：技术基础层，严禁反向依赖 `com.basicframework.module..` 或 `com.basicframework.server..`。
- `basic-framework-system`：业务核心层，同模块内直接注入 Service，不新增无意义的伪微服务 `api/*` 包装层；仅实现 `core` 所需的 SPI（`OAuth2TokenCommonApi` / `PermissionCommonApi` / `DictDataCommonApi` / `OperateLogCommonApi`）。
- `basic-framework-server`：启动装配与契约/架构测试入口。

## 硬性约束（由 ArchUnit & SchemaDoRbacParityTest 自动门禁）
1. **分层与模型隔离**：Controller 不得依赖 Mapper/DAL，HTTP 端点签名不得暴露 `dal.dataobject.*`（含泛型参数）。
2. **授权完备性**：所有 HTTP 端点必须显式标注 `@PreAuthorize`（禁止 `permitAll()` / `true` 绕过）或加入 `FootgunRules.PERMIT_ALL_ALLOWLIST`；对应权限码须登记于 `数据库文件/basic_framework.sql` 的 `system_menu` 并绑定超管角色。
3. **双平台隔离与 fail-closed**：用户、角色、菜单、部门写操作须校验同平台归属，登录操作员上下文缺失时必须拒绝（fail-closed），修改/删除须显式校验 `id != null`。
4. **事务与软删除**：`@Transactional` 必须显式指定 `rollbackFor = Exception.class`；带业务唯一索引的软删除表必须继承 `UniqueBaseDO` 并在唯一索引中包含 `deleted_tag`。
5. **审计与日志**：关键写接口标注原生 `@OperateLog`；统一使用 SLF4J，禁止 `System.out`/`printStackTrace`/旧日志 API；业务模块抛 `ServiceException`，不抛裸 `RuntimeException`。
6. **契约同步**：变更接口或 VO 后，同步运行 `mvn -B -ntp verify -Pquality-gate -Dopenapi.update=true` 与前端 `pnpm api:gen`。

## 必跑验证
```bash
cd 后端代码/basic-framework-boot
mvn -B -ntp -Pquality-gate verify
```
