# 开发与标准 CRUD 范例

## 1. 本地一键启动

```bash
# 1. 生成被 Git 忽略的本地 .env.dev 与后端 .env（含随机 SM2 私钥与库口令），并挂载 .githooks
python -B -X utf8 scripts/runtime/init_local_dev.py --apply

# 2. 启动本机回环 MySQL + Redis（自动导入 14 表基线 SQL）
sh scripts/runtime/start_dev_stack.sh

# 3. 可选：仅向本机回环数据库写入合成测试数据（不得用于生产或共享库）
python -B -X utf8 scripts/runtime/seed_local_dev.py --apply
```

需要使用本地超管登录时，在运行种子命令前通过受保护环境注入 BCrypt 哈希 `SEED_ADMIN_PASSWORD_HASH`，并加 `--require-password-change` 保留首改标志。

启动应用（后端、前端各用一个终端，均从仓库根目录开始）：
- 后端（端口 `48080`，终端 A）：干净 Maven 缓存下 `basic-framework-server` 依赖 `basic-framework-system` 与 `basic-framework-core`，须先聚合打包，再在后端目录运行 JAR（后端 `.env` 须含 `SPRING_PROFILES_ACTIVE=local`，见部署说明第 1 节）：
  ```bash
  cd 后端代码/basic-framework-boot
  mvn -B -ntp clean package -DskipTests
  java -jar basic-framework-server/target/basic-framework-server.jar
  ```
  Windows：在仓库根目录执行 `scripts/runtime/start_java.ps1 -Build`（启动器要求 `local`，HTTP 监听地址取决于 `server.address`）。
- 前端（端口 `5175`，终端 B）：`cd 前端代码/basic-framework-admin && pnpm install && pnpm dev`，或运行 `scripts/runtime/start_frontend.ps1`。

## 2. 端到端标准 CRUD 开发切片

新增一个业务功能（以 `Notice` 为例）遵循以下最小闭环：

Role CRUD change example: [role change task card](需求卡/role-platform.md).

1. **数据库表**：新增表须同时交付两部分：
   - **(a) 基线**：在 `数据库文件/basic_framework.sql` 增加建表 DDL（逻辑删除唯一索引须包含 `deleted_tag` 列）及 `system_menu` / `system_role_menu` 菜单权限行。同时审查 `scripts/runtime/bootstrap-empty-schema.sh` 的 14 表约定（剔除的 `DROP TABLE` 行数）与各文档中的"14 张表"表述。
   - **(b) 迁移**：为已有 schema 单独提供按序编号、经过演练测试的迁移脚本。不得对已有库执行引导脚本或基线 SQL。
2. **后端代码（位于 `basic-framework-system`）**：
   - `dal/dataobject/`：继承 `BaseDO`（含业务唯一键时继承 `UniqueBaseDO`）。
   - `dal/mysql/`：继承 `BaseMapperX<T>`，查询条件封装在 `LambdaQueryWrapperX`。
   - `service/`：接口 + 实现，写方法使用 `@Transactional(rollbackFor = Exception.class)`，关键写操作加 `@OperateLog(...)`。
   - `controller/admin/`：入参/出参严格使用 `*ReqVO` / `*RespVO`（禁止暴露 DO），每个端点显式标注 `@PreAuthorize("@ss.hasPermission('...')")`。
3. **OpenAPI 单一事实源同步（前后端零漂移）**：
   ```bash
   # 更新前端 openapi.json 快照
   cd 后端代码/basic-framework-boot
   mvn -B -ntp verify -Pquality-gate -Dopenapi.update=true

   # 生成前端 TypeScript 契约类型 src/api/generated/api-types.d.ts
   cd ../../前端代码/basic-framework-admin
   pnpm api:gen
   ```
4. **前端代码（位于 `前端代码/basic-framework-admin/src/`）**：
   - `src/api/system/<biz>.ts`：引用 `OpenApiSchemas` 类型并封装 `request.get/post/put/delete`。
   - `src/views/system/<biz>/index.vue`：使用 `<ProTable>` + `el-table` + `<TableAction>` + `<FormDialog>` / `<DetailDialog>` + `v-has-permi`，字段限制复用 `FIELD_LIMITS`，文件/图片上传使用 `<UploadField :cropper="true|false" />`，统计卡片与图表复用 `src/components/stats/*`。

## 3. 质量门禁

从 [仓库质量门禁](../AGENTS.md#required-validation) 执行适用检查。提交评审时附运行结果与所验 SHA，托管扫描范围见 [评审指南](review.md)。
