---
description: '说明 web-ele 关键路径端到端测试的运行前提、测试数据、执行命令与覆盖范围，供本地和后续 CI 接入时查阅。'
kind: package-reference
---

# web-ele 关键路径 e2e

## 摘要

本目录在现有 Playwright 体系上覆盖登录、权限、文件上传下载和用户导入四条关键路径。用例运行在生产构建的 vite preview 上，通过 Playwright 路由把 `/admin-api` 转发到真实后端，不修改产品源码与后端接口。e2e 暂不进入 GitHub Actions 门禁，执行命令与测试环境要求如下。

## 目录

- [运行前提](#运行前提)
- [测试数据](#测试数据)
- [执行命令](#执行命令)
- [覆盖范围](#覆盖范围)

## 运行前提

1. 准备隔离的 MySQL 8 兼容库、Redis 和 S3 兼容对象存储，并导入 `数据库文件/basic_framework.sql`。
2. 在测试库执行 [seed-e2e.sql](fixtures/seed-e2e.sql) 写入测试账号、导入初始密码和文件管理菜单。
3. 按[后端 README](../../../../../后端代码/basic-framework-boot/README.md) 配置 `.env` 或环境变量，并为本次测试关闭验证码和登录失败锁定：`BASIC_FRAMEWORK_CAPTCHA_ENABLE=false`、`LOGIN_LOCK_ENABLED=false`。`SM2_PRIVATE_KEY`、数据库和对象存储凭据只放在被忽略的本地配置中。
4. 构建当前生产产物后安装浏览器依赖：

```powershell
CI=true pnpm install --frozen-lockfile
pnpm build:ele
pnpm exec playwright install chromium
```

前端预览由 `playwright.config.ts` 自动启动，地址为 `http://127.0.0.1:4173/admin/`；4173 端口必须空闲。后端默认地址为 `http://127.0.0.1:48080`，可用 `E2E_BACKEND_URL` 覆盖。

## 测试数据

| 账号 | 测试口令 | 用途 |
| --- | --- | --- |
| `admin` | `Test@123456` | 登录成功、文件上传下载、用户导入、有权限入口 |
| `e2elimited` | `E2eLimited@123` | 无菜单权限、直达路由被拒绝、后端接口返回 403 |
| `e2enotexist` | 任意错误口令 | 登录失败路径，不写入数据库 |

以上口令只用于隔离测试库，不是生产凭据。夹具 `fixtures/user-import.xlsx` 导入 `e2eimportuser`，用例勾选“是否覆盖”以便重复执行；`fixtures/upload-sample.png` 用于上传与下载字节比对。

## 执行命令

```powershell
# 在 前端代码/basic-framework-admin 下执行
pnpm -F @vben/web-ele test:e2e

# 或使用仓库统一入口（同样需要本地后端与测试库）
pnpm test:e2e:isolated
```

单独执行某条路径：

```powershell
pnpm -F @vben/web-ele exec playwright test e2e/login.spec.ts
```

## 覆盖范围

| 用例文件 | 关键断言 |
| --- | --- |
| `login.spec.ts` | 正确口令登录接口返回成功并进入概览页；错误口令停留登录页并提示失败 |
| `permission.spec.ts` | 受限账号无系统管理/用户管理菜单、直达路由落到未找到页、用户分页接口返回 403；管理员可进入用户管理 |
| `file-upload-download.spec.ts` | 通过文件管理页上传图片、列表出现记录、下载内容与上传字节一致 |
| `user-import.spec.ts` | 通过导入弹窗上传 Excel、提示新增或更新成功、列表可按账号检索到导入用户 |

`production-security.spec.ts` 继续覆盖生产登录页不预填密码，与其他用例共用同一配置。

## 已知限制与暂缓工作

- e2e 暂未纳入 GitHub Actions 门禁，执行前需要本地准备 MySQL、Redis、S3 兼容存储和后端进程。
- 构建产物中的验证码开关由测试上下文关闭，不能替代验证码本身的自动化；后端需以 `BASIC_FRAMEWORK_CAPTCHA_ENABLE=false` 和 `LOGIN_LOCK_ENABLED=false` 启动。
- 文件下载断言覆盖对象存储公开地址可达和字节一致，不覆盖私有桶签名或网关转发。
- 用户导入夹具不携带邮箱，覆盖新增与覆盖更新；失败明细的逐项展示未纳入断言。
