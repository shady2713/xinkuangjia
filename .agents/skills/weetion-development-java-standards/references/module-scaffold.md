# 新建业务模块与全栈契约对齐指南

在 `basic-framework-boot` 中新增独立业务模块（例如 `basic-framework-module-order`）时按本清单落地，确保 Maven 聚合、组件扫描、HTTP 契约门禁、权限表达式与真实 SQL 切片测试一次到位。

## 目录与 Maven 聚合接入

优先在仓库根运行 `python -B -X utf8 scripts/scaffold/new_java_module.py --name <biz> --apply` 生成标准模块目录、错误码号段与 POM 注册；手工调整时核对下列结构：

1. 在 `后端代码/basic-framework-boot/` 下创建模块目录 `basic-framework-module-<biz>`，包根固定为 `com.basicframework.module.<biz>`（`BasicFrameworkServerApplication` 默认扫描 `com.basicframework.module`）。
2. 在三处 POM 与错误码登记表同步，不把业务规则塞入 `core` 或 `server`：
   - 根 `后端代码/basic-framework-boot/pom.xml` 的 `<modules>` 增加 `<module>basic-framework-module-<biz></module>`。
   - `basic-framework-dependencies/pom.xml` 的 `<dependencyManagement>` 登记模块坐标与 `${revision}`。
   - `basic-framework-server/pom.xml` 的 `<dependencies>` 引入该模块，使其随主进程打包发布。
   - `ServiceErrorCodeRange` 登记模块专属百万级错误码号段。

```text
basic-framework-module-<biz>/
├── pom.xml
└── src/
    ├── main/java/com/basicframework/module/<biz>/
    │   ├── api/                 # 供其他模块调用的接口与 DTO（无跨模块需求可暂缓）
    │   ├── controller/admin/    # 管理端 REST 入口（自动挂载 /admin-api 前缀）
    │   │   └── <feature>/vo/    # SaveReqVO、PageReqVO、RespVO
    │   ├── convert/             # MapStruct 或 BeanUtils 转换
    │   ├── dal/
    │   │   ├── dataobject/      # 继承 BaseDO 的持久化实体（严禁直接出现在 Controller 入参或返回签名）
    │   │   └── mysql/           # 继承 BaseMapperX 的 Mapper
    │   ├── enums/               # 错误码 ErrorCodeConstants 与业务枚举
    │   └── service/             # 业务接口与 ServiceImpl（异常统一走 ServiceExceptionUtil）
    └── test/
        ├── java/com/basicframework/module/<biz>/
        └── resources/sql/       # H2 MySQL 模式切片建表脚本
```

## 门禁约束与契约对齐检查表

- **HTTP 模型隔离（ArchUnit 强门禁）**：Controller 上所有带 `@RequestMapping` 派生注解的方法，参数与返回类型（包括 `CommonResult<T>`、`PageResult<T>` 的泛型实参）必须为 VO 或基础类型，不得暴露 `dal.dataobject.*DO`。
- **异常与日志（ArchUnit 强门禁）**：`com.basicframework.module..` 禁止直接 `throw new RuntimeException(...)` 或使用 `java.util.logging`，统一使用 `ServiceExceptionUtil.exception(...)` 与 SLF4J `@Slf4j`。
- **公开端点白名单（ArchUnit 强门禁）**：默认全部管理接口受登录与 `@PreAuthorize("@ss.hasPermission('<biz>:<resource>:<action>')")` 保护；禁止类级 `@PermitAll`，确需公开的方法必须同步登记至 `FootgunRules.PERMIT_ALL_ALLOWLIST`。
- **前后端契约与三处标识对齐**：
  1. 后端 `@PreAuthorize("@ss.hasPermission('order:contract:create')")`；
  2. 数据库 `basic_framework.sql` 的建表 DDL（含唯一索引表的 `deleted_tag`）及 `system_menu` 菜单行的 `component`、按钮行的 `permission`（由 `SchemaDoRbacParityTest` 强制核对）；
  3. 更新 `OpenApiContractSnapshotTest` 快照并在前端执行 `pnpm api:gen`，确保 `apps/web-ele/src/api/<biz>/` 请求路径、毫秒时间戳、`Long` 主键类型和按钮 `v-access:code` 完整同步。

## 持久化 SQL 切片验证

新增或修改 `LambdaQueryWrapperX` 或自定义 SQL 时，参考 [ConfigMapperTest](../../../../后端代码/basic-framework-boot/basic-framework-module-infra/src/test/java/com/basicframework/module/infra/dal/mysql/config/ConfigMapperTest.java) 使用 `h2`（`MODE=MySQL;DATABASE_TO_LOWER=TRUE;NON_KEYWORDS=VALUE,KEY,USER`）编写毫秒级 Mapper 切片测试，覆盖插入审计字段、分页过滤和逻辑删除边界，避免仅靠 Mockito 漏检列名拼写与 SQL 语法错误。
