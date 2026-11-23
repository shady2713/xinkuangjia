# basic-framework

极简、安全合规的企业与政务中后台基础框架（Spring Boot 3.5 + JDK 17 + Vue 3 + Element Plus）。

## 核心特性

- **后端 3 模块收敛**：`basic-framework-core`（公共技术层）、`basic-framework-system`（核心业务与存储）、`basic-framework-server`（启动装配与契约门禁），默认 HikariCP，无冗余云厂商/定时任务/动态数据源重依赖。
- **前端单包极简重建**：标准单包 Vite + Vue 3 + TypeScript + Element Plus + Pinia + Vue Router + Tailwind CSS（手写源码约 6,900 行），保留经典浅色蓝主题视觉、统一 `<ProTable>` 与内置图片裁剪开关的 `<UploadField>`。
- **政企安全合规基线**：SM2（C1C3C2）密码传输加密、anji-plus 滑块验证码、双平台（`super_admin` / `business_admin`）硬隔离、5 档部门数据权限、30 分钟会话超时、登录审计日志与原生 Spring AOP `@OperateLog` 操作审计日志。
- **14 张干净基线表**：覆盖用户、部门、角色、菜单、字典、OAuth2 开放应用与令牌、登录/操作日志及统一文件记录（支持本地磁盘与阿里云 OSS 一键切换）。
- **确定性质量门禁**：后端 ArchUnit + Schema-DO-RBAC 一致性 + OpenAPI 零漂移快照 + JaCoCo + PMD；前端 OpenAPI 类型校验 + `vue-tsc` + ESLint + Vitest + Vite 构建；全仓零豁免 Gitleaks 密钥扫描。

## 快速开始

```bash
# 终端 A（仓库根目录）
# 1. 初始化本地配置（生成被 Git 忽略的 .env.dev 与后端 .env，新生成文件含 SPRING_PROFILES_ACTIVE=local）
python -B -X utf8 scripts/runtime/init_local_dev.py --apply

# 2. 启动本地 MySQL + Redis
sh scripts/runtime/start_dev_stack.sh

# 3. 启动后端（48080）：干净 Maven 缓存须先聚合打包（server 依赖 system 与 core），再在后端目录运行 JAR
cd 后端代码/basic-framework-boot
mvn -B -ntp clean package -DskipTests
java -jar basic-framework-server/target/<server 可执行 JAR>
```

```bash
# 终端 B（仓库根目录）
# 4. 启动前端（5175）
cd 前端代码/basic-framework-admin
pnpm install && pnpm dev
```

Windows：后端可在仓库根目录执行 `scripts/runtime/start_java.ps1 -Build`（保持其仅回环的 `local` profile）。

## 文档导航

- [架构说明](docs/架构说明.md)
- [开发与标准 CRUD 范例](docs/开发与标准CRUD范例.md)
- [部署与运维说明](docs/部署与运维说明.md)
