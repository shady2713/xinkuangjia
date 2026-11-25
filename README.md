# basic-framework

极简、安全合规的企业与政务中后台基础框架（Spring Boot 3.5 + JDK 17 + Vue 3 + Element Plus）。

## 核心特性

- **后端 3 模块收敛**：`basic-framework-core`（公共技术层）、`basic-framework-system`（核心业务与存储）、`basic-framework-server`（启动装配与契约门禁），默认 HikariCP，无冗余云厂商/定时任务/动态数据源重依赖。
- **前端单包极简重建**：标准单包 Vite + Vue 3 + TypeScript + Element Plus + Pinia + Vue Router + Tailwind CSS + `@lucide/vue`（手写源码约 10,400 行，不含生成类型与单测），1:1 复刻经典 Vben 5 浅色蓝视觉与动效、统一 `<ProTable>`（一屏锁高/Grid 搜索/列显隐） / `<FormDialog>` / `<TableAction>`、`components/stats/*` 统计基座与内置图片裁剪开关的 `<UploadField>`。
- **政企安全合规基线**：SM2（C1C3C2）密码传输加密、anji-plus 滑块验证码、双平台（`super_admin` / `business_admin`）硬隔离、5 档部门数据权限、30 分钟会话超时、登录审计日志与原生 Spring AOP `@OperateLog` 操作审计日志。
- **14 张干净基线表**：覆盖用户、部门、角色、菜单、字典、OAuth2 开放应用与令牌、登录/操作日志及统一文件记录（支持本地磁盘与阿里云 OSS 一键切换）。
- **质量门禁**见 [仓库工程规范](AGENTS.md#required-validation)。

## 快速开始

从 [本地开发启动](docs/开发与标准CRUD范例.md#1-本地一键启动) 初始化回环数据库并启动前后端。

## 文档导航

- [架构说明](docs/架构说明.md)
- [开发与标准 CRUD 范例](docs/开发与标准CRUD范例.md)
- [部署与运维说明](docs/部署与运维说明.md)
