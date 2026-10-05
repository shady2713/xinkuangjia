---
description: '说明 basic-framework 管理前端的目录、依赖安装、运行配置、启动与生产交付要求，供页面开发和后端联调时查阅。'
kind: package-reference
---

# basic-framework 管理前端

## 摘要

使用 Vue 3、TypeScript、Vite、Element Plus 和 Vben 组件运行系统管理与基础设施界面，应用源码位于 `apps/web-ele/src`。前端通过 Java API 获取用户、菜单、权限和业务数据，业务开发在现有工作区增加页面与接口模块。

## 目录

- [目录结构](#目录结构)
- [环境与依赖](#环境与依赖)
- [配置说明](#配置说明)
- [本地启动](#本地启动)
- [常用验证](#常用验证)
- [生产交付](#生产交付)
- [开发机制](#开发机制)
- [已知限制与暂缓工作](#已知限制与暂缓工作)

## 目录结构

页面、共享组件和工具分属不同层；修改公共包时要检查实际消费方。

| 路径                  | 职责                                 |
| --------------------- | ------------------------------------ |
| `apps/web-ele/src`    | 系统、基础设施页面，认证、路由和 API |
| `apps/web-ele/docker` | 浏览器运行时配置与生产 Nginx 模板    |
| `packages`            | 组件、布局、权限、请求、状态和主题   |
| `internal`            | Vite、TypeScript、Lint 与工作区配置  |
| `scripts`             | 工程、质量、测试和交付工具           |

## 环境与依赖

Node.js 要求 `>=20.19.0`，pnpm 要求 `>=10.0.0`，包管理器固定 `pnpm@10.28.2`，以 [package.json](package.json)为准。

以下命令在本目录执行：

```powershell
pnpm install --frozen-lockfile
```

[工作区 catalog](pnpm-workspace.yaml)与[锁文件](pnpm-lock.yaml)共同管理版本，使用 workspace 依赖连接共享包。安装后 postinstall 生成当前目录的工具入口；使用 `--ignore-scripts` 或复制过工具缓存时，先运行 `pnpm -r --if-present run stub`，再启动或检查，避免生成文件引用旧工程绝对路径。

## 配置说明

构建参数变化需要重新启动或构建；运行时参数变化需要刷新页面。

| 文件 | 用途 |
| --- | --- |
| [应用基础配置](apps/web-ele/.env) | Vite 通用参数、构建标题 |
| [开发配置](apps/web-ele/.env.development) | 端口 5175、公共路径 /、API 前缀 /admin-api |
| [本机模板](apps/web-ele/.env.local.example) | 可选复制为同目录 .env.development.local，覆盖本机 API 地址；含 `VITE_DEV_API_TARGET` 开发代理目标 |
| [生产配置](apps/web-ele/.env.production) | /admin/ 公共路径、hash 路由 |
| [Vite 配置](apps/web-ele/vite.config.mts) | /admin-api 默认代理到 http://127.0.0.1:48080/admin-api，可用 `VITE_DEV_API_TARGET` 覆盖（不必改源文件） |
| [运行时配置](apps/web-ele/docker/app.config.js) | API、验证码、上传方式和固定界面偏好 |
| [Nginx 模板](apps/web-ele/docker/nginx.conf) | 生产静态资源、管理 API、OAuth2 代理 |

开发直接加载 `docker/app.config.js`；生产页面读取生成的 `_app.config.js`，应用 Dockerfile 再以同一配置源覆盖该文件。开发非空 `VITE_GLOB_API_URL` 优先于运行时 API 地址；生产 API 地址由运行时配置提供。前端值全部发送到浏览器，不得存放服务端密码、私钥或服务 Token。

## 本地启动

先启动 Java 与中间件，再运行开发服务器。

```powershell
pnpm dev:ele
```

默认访问 http://localhost:5175；实际端口以终端为准。也可从仓库根运行 `pwsh -File scripts/runtime/start_frontend.ps1`；没有 PowerShell 时用 `bash scripts/runtime/start_frontend.sh`。API 使用同源 `/admin-api`，Vite 代理保留后端同名前缀；后端不在 48080 时用 `VITE_DEV_API_TARGET` 覆盖代理目标（见本机模板），页面能打开但接口失败时检查 Java 端口、代理目标与请求回包。

## 常用验证

按变更选择最小验证，发布时执行所需工程门禁与业务验收。

| 命令 | 用途 |
| --- | --- |
| `pnpm check:type` | 应用、`packages/**` 与 `internal/**` 各包按自身 tsconfig 的 TypeScript/Vue 类型检查 |
| `python -B -X utf8 scripts/quality/check_crud.py <api-path> <views-path>` | 完整 CRUD 的文件、导入边界、应用类型与模块 ESLint；环境缺失不能通过 |
| `pnpm lint` | ESLint、Prettier、Stylelint 检查；不加 --format 不自动修复 |
| `pnpm quality:comments` | 当前变更中文职责注释检查；干净工作区上对象数为 0，只能证明改动触及的声明 |
| `pnpm quality:comments:all` | 全库注释审计（`node scripts/check-quality.mjs web --all`）；**当前为红灯，尚未清零，因此没有接入阻断门禁**。实测检查 1520+ 项、4300+ 条问题（工作区并发改动会小幅波动），其中约 1441 条落在调用实参位置的匿名回调（如 `computed(...)`、`.filter(...)` 内的箭头函数），按现有规则必须把注释写在实参列表内部才能消除，属于待校准的规则边界；其余为真实的模块头与具名声明缺注释。修正顺序与现状见[脚本索引](../../docs/开发指南/脚本使用索引.md#质量检查) |
| `pnpm quality:workspace` | workspace 和 catalog 约束 |
| `pnpm test:unit` | Vitest 已声明单元测试 |
| `pnpm test:e2e` | Turbo 分发声明的 E2E 任务，核对实际用例数；当前规格只验证生产登录页 |
| 仓库根 `python -B -X utf8 scripts/e2e/run_business_e2e.py` | 隔离库、种子管理员、真实后端与预览上的字典类型 CRUD 浏览器业务用例；缺少连接变量、后端或浏览器时失败 |
| `pnpm build:ele` | 生成 apps/web-ele/dist |
| `pnpm quality:verify` | 当前串联门禁，包括类型、Lint、单测、构建与 E2E |

完整门禁中任一步失败，不能把其他单项成功当作全量通过。外部接口、登录、权限和真实上传另行验证，见[测试策略](../../docs/测试与可靠性/测试策略.md)与[脚本索引](../../docs/开发指南/脚本使用索引.md)。

## 生产交付

生产使用构建产物和 Nginx，开发服务器不作为发布制品。

1. 核对 `VITE_BASE=/admin/`、运行时 API 地址和 Nginx 上游。
2. 执行 `pnpm build:ele`，收集 `apps/web-ele/dist` 内容；不要重复嵌套 dist。
3. 使用 [apps/web-ele/Dockerfile](apps/web-ele/Dockerfile)，从前端根执行 `docker build -t basic-framework-admin:local apps/web-ele`。Dockerfile 只装配已有 dist，不负责源码编译；根 `pnpm build:docker` 串联这两步。
4. 模板上游为 `basic-framework-backend:48080`。Java 容器使用该名称并与前端加入同一 Docker 网络；Java 在宿主机时运行前端容器需 `--add-host basic-framework-backend:host-gateway`，并验证宿主机监听与防火墙。
5. 访问 `/admin/`，检查静态资源、登录、菜单、权限和文件链接。目标 HTTPS 与代理端口须一致。

框架不提供完整生产 Compose；Java、前端、中间件与 HTTPS 网关按通用服务器步骤安装。模板不代理 AI、媒体、泛 `/api/` 或 App API；对象读取使用浏览器可达的 `MINIO_PUBLIC_URL`。完整步骤见[部署说明](../../docs/部署/部署说明.md)。

## 开发机制

<details>
<summary>页面、权限与请求的实现关系</summary>

启动入口加载配置、Pinia、路由与适配器；认证 Store 从 Java 权限信息接口取得用户、角色、菜单和权限码。动态路由将菜单组件地址匹配到 `views/**/*.vue`，页面存在不会自动授权。新增页面要同时补 API 类型、菜单组件地址、角色授权和后端权限校验。

`api/request.ts` 统一处理 Token、语言、响应拆包、刷新与错误提示，普通页面不复制认证逻辑。默认文件上传由 Java 接收；浏览器直传需要可达的预签名地址及 MinIO CORS，并在成功上传后登记元数据。

具体入口见[管理前端架构](../../docs/架构/01-管理前端.md)与[Web 技能](../../.agents/skills/weetion-development-web-standards/SKILL.md)。

</details>

## 已知限制与暂缓工作

框架页面与菜单只对应当前已提取的业务，接口与环境仍需独立验收。

- 当前维护 system、infra 与核心页面，AI、Workflow、媒体页面不在范围内。
- 路由和按钮权限控制界面，真实授权仍由 Java 执行。
- 生产对象 URL 必须从浏览器可达；Java 能访问存储不等于用户浏览器能访问。
- E2E 命令存在不证明每项业务有自动化场景，零任务与跳过必须如实记录；浏览器业务用例当前只覆盖字典类型 CRUD 与两条重名拒绝路径。
