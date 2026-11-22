# 开发与标准 CRUD 范例

## 1. 本地一键启动

```bash
# 1. 生成被 Git 忽略的本地 .env.dev 与后端 .env（含随机 SM2 私钥与库口令），并挂载 .githooks
python -B -X utf8 scripts/runtime/init_local_dev.py --apply

# 2. 启动本机回环 MySQL + Redis（自动导入 14 表基线 SQL）
sh scripts/runtime/start_dev_stack.sh

# 3. 按需生成本地开发演示组织/角色与管理员测试密码（仅允许回环地址）
python -B -X utf8 scripts/runtime/seed_local_dev.py --apply
```

启动应用：
- 后端（端口 `48080`）：在 `后端代码/basic-framework-boot` 执行 `mvn -B -pl basic-framework-server spring-boot:run` 或运行 `scripts/runtime/start_java.ps1`。
- 前端（端口 `5175`）：在 `前端代码/basic-framework-admin` 执行 `pnpm install && pnpm dev` 或运行 `scripts/runtime/start_frontend.ps1`。

## 2. 端到端标准 CRUD 开发切片

新增一个业务功能（以 `Notice` 为例）遵循以下最小闭环：

1. **数据库表**：在 `数据库文件/basic_framework.sql` 增加建表 DDL（逻辑删除唯一索引须包含 `deleted_tag` 列）以及 `system_menu` / `system_role_menu` 菜单权限行。
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
   - `src/views/system/<biz>/index.vue`：使用 `<ProTable>` + `el-table` + `el-dialog` + `v-has-permi`，文件/图片上传使用 `<UploadField :cropper="true|false" />`。

## 3. 质量门禁命令（与 CI 一致）

| 范围 | 命令 | 校验内容 |
| --- | --- | --- |
| 后端 | `cd 后端代码/basic-framework-boot && mvn -B -ntp -Pquality-gate verify` | 编译、单元测试、H2 集成测试、ArchUnit 架构门禁、Schema-DO-RBAC 校验、OpenAPI 零漂移校验、JaCoCo、PMD |
| 前端 | `cd 前端代码/basic-framework-admin && pnpm run quality:gates` | OpenAPI 类型同步校验、`vue-tsc --noEmit`、ESLint、Vitest 单测、Vite 生产构建 |
| 密钥 | GitHub Actions `secrets`（Gitleaks） | 全仓零豁免密钥扫描 |
