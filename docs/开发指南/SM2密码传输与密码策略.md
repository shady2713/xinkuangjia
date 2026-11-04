---
description: "说明管理后台密码从 sm-crypto 到 BouncyCastle 的 SM2 传输协议、服务端密钥配置、密码存储兼容迁移、等保二级策略和首次改密拦截。"
kind: package-reference
---

# SM2 密码传输与密码策略

## 摘要

管理后台所有提交用户密码的接口不再接收前端 MD5 摘要，改为 SM2 密文。前端用服务端公钥按 C1C3C2 模式加密 `{"p":密码,"t":时间戳,"n":nonce}`，后端用 BouncyCastle 私钥解密，并校验时间窗和 nonce 一次性。密码仍以 BCrypt 存储，历史 `bcrypt(md5(明文))` 在登录成功时自动升级。密码复杂度、失败锁定和首次改密标志按等保二级要求落在后端。

## 目录

- [传输协议](#传输协议)
- [配置项](#配置项)
- [密钥生成与注入](#密钥生成与注入)
- [覆盖的接口](#覆盖的接口)
- [密码存储与兼容迁移](#密码存储与兼容迁移)
- [等保二级密码策略](#等保二级密码策略)
- [首次改密](#首次改密)
- [验证入口](#验证入口)

## 传输协议

1. 前端请求 `GET /admin-api/system/auth/sm2-public-key`，取得带 `04` 前缀的未压缩公钥和 `cipherMode=1`。
2. 前端拼装 JSON 明文 `{"p":"明文密码","t":毫秒时间戳,"n":"32 位随机串"}`，用 `sm-crypto` 的 `sm2.doEncrypt(payload, publicKey, 1)` 加密。sm-crypto 返回的 C1 不含 `04`，前端补齐后再提交。
3. 请求体中的 `password`、`oldPassword`、`newPassword` 字段均为十六进制密文，不是明文，也不是摘要。
4. 后端按 C1C3C2 解析；时间戳默认允许前后 5 分钟偏差；nonce 通过 Redis `SETNX + TTL` 只允许使用一次。
5. 密文格式错误、时间戳过期、nonce 重放统一返回通用失败，不返回具体原因，日志不记录明文、密文或载荷。

公钥接口只读且匿名可访问；私钥只存在于服务端环境变量或仓库外配置。前端公钥在当前页面会话内缓存，密钥轮换后刷新页面即可重新获取。

## 配置项

配置位于 `basic-framework.security`，环境变量样例见 [.env.example](../../后端代码/basic-framework-boot/.env.example)。

| 配置 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `basic-framework.security.sm2.private-key` | `SM2_PRIVATE_KEY` | 空 | 必填，64 位十六进制私钥；缺失或格式错误时应用启动失败 |
| `basic-framework.security.sm2.timestamp-window` | `SM2_TIMESTAMP_WINDOW` | `5m` | 时间戳允许偏差 |
| `basic-framework.security.sm2.nonce-ttl` | `SM2_NONCE_TTL` | `10m` | nonce 在 Redis 的保留时长，至少为时间窗两倍 |
| `basic-framework.security.sm2.replay-check-enabled` | `SM2_REPLAY_CHECK_ENABLED` | `true` | 关闭后只校验时间戳；无 Redis 的降级环境才可关闭 |
| `basic-framework.security.login-lock.enabled` | `LOGIN_LOCK_ENABLED` | `true` | 登录失败锁定开关 |
| `basic-framework.security.login-lock.max-failures` | `LOGIN_LOCK_MAX_FAILURES` | `5` | 连续失败次数阈值 |
| `basic-framework.security.login-lock.lock-duration` | `LOGIN_LOCK_DURATION` | `30m` | 锁定时长 |
| `basic-framework.security.login-lock.failure-window` | `LOGIN_LOCK_FAILURE_WINDOW` | `30m` | 失败计数保留时长 |

防重放默认失败关闭：Redis 不可用时登录请求返回通用失败，不会静默跳过 nonce 校验。若部署环境没有 Redis，必须显式设置 `SM2_REPLAY_CHECK_ENABLED=false` 并接受仅时间戳保护的风险；应用启动时会输出告警。

## 密钥生成与注入

以下命令只用于生成现场密钥，示例输出不得写入源码、SQL、文档或提交的配置。

使用 OpenSSL 生成 SM2 私钥：

```bash
openssl ecparam -name SM2 -genkey -noout -out sm2-private.pem
openssl ec -in sm2-private.pem -text -noout
```

从输出中取出 `priv:` 的 64 位十六进制值，写入仓库外 `.env` 或密钥管理系统：

```dotenv
SM2_PRIVATE_KEY=CHANGE_ME
```

把 `CHANGE_ME` 替换为现场生成的 64 位十六进制私钥，不要保留占位符。

也可以使用前端依赖的 sm-crypto 生成一对测试密钥，仅用于本地联调：

```bash
node -e "const {sm2}=require('sm-crypto'); const k=sm2.generateKeyPairHex(); console.log(k);"
```

命令输出的 `privateKey` 写入 `SM2_PRIVATE_KEY`，`publicKey` 仅供本地核对；服务端只配置私钥，公钥在启动时推导。私钥变化后必须重启后端，并刷新所有已打开的管理页面。

## 覆盖的接口

| 入口 | 字段 | 说明 |
| --- | --- | --- |
| `POST /system/auth/login`、`POST /system/auth/super-admin-login` | `password` | 账号密码登录 |
| `POST /system/auth/register` | `password` | 注册 |
| `POST /system/auth/reset-password` | `password` | 短信重置密码 |
| `PUT /system/user/profile/update-password` | `oldPassword`、`newPassword` | 个人修改密码 |
| `POST /system/user/create` | `password` | 管理员创建用户 |
| `PUT /system/user/update-password` | `password` | 管理员重置用户密码 |

OAuth2 密码授权 Service 仍接收明文参数，但当前没有对外暴露对应 HTTP 入口；新增入口时必须复用同一套 SM2 传输服务。

## 密码存储与兼容迁移

现状：`AdminUserServiceImpl` 注入 Spring Security 的 `BCryptPasswordEncoder`，强度取 `basic-framework.security.password-encoder-length`，默认 10；DAL 字段为 `system_users.password`。BCrypt 自带盐，不需要额外盐字段。等保二级不强制密码存储使用国密算法，因此保留 BCrypt。

前端旧方案提交 `md5(明文)`，后端用 BCrypt 存储，所以历史哈希实际是 `bcrypt(md5(明文))`。本次登录流程为：

1. 先按新格式校验 `BCrypt.matches(明文, hash)`。
2. 失败后按历史格式校验 `BCrypt.matches(md5(明文), hash)`。
3. 历史格式通过时立即用 `BCrypt(明文)` 重写该用户 hash，再继续登录。

兼容代码位于 `AdminUserServiceImpl.isPasswordMatchLegacy` 和 `AuthServiceImpl.authenticate`。建议在存量账号完成一次成功登录后，设置迁移截止日期并删除兼容分支；届时从未登录的旧账号需要管理员重置密码。MD5 只作为历史输入，不参与新的传输或存储。

旧库升级步骤：

1. 备份数据库并确认恢复方式。
2. 执行 [V202611042000__system_add_password_change_required.sql](../../数据库文件/V202611042000__system_add_password_change_required.sql)。
3. 注入 `SM2_PRIVATE_KEY` 后滚动重启后端。
4. 管理员创建或重置密码后，用户首次登录会被要求改密；存量非空密码账号首次登录时自动升级哈希。

## 等保二级密码策略

后端 `ValidationUtils.isPassword` 与前端 `isPasswordValue` 使用同一规则：

- 长度 8-32 位；
- 只允许可见 ASCII 字符，不允许空格、控制字符和非 ASCII 字符；
- 大写字母、小写字母、数字、特殊字符四类中至少包含三类。

规则在解密后于 Service 层执行；前端规则、提示文案和表单校验同步更新。登录不强制校验当前密码复杂度，避免历史弱密码用户无法登录；新建、注册、重置和修改密码必须通过策略。

登录失败按账号计数，达到阈值后锁定，成功登录清零。锁定提示只说明剩余时间，不区分账号是否存在。

## 首次改密

`system_users.password_change_required` 字段标记是否必须先改密：

- 管理员创建用户、管理员重置密码、导入初始密码时置为 `1`；
- 用户自行修改密码、短信重置密码、注册时置为 `0`；
- 登录响应和 `/system/auth/get-permission-info` 返回该标志；
- 前端路由守卫强制跳转 `/change-password`；
- 后端 `PasswordChangeRequiredFilter` 对已登录且标志为 `1` 的请求返回 403，只放行登录、刷新、权限信息、个人中心读取和修改密码等必要入口。

初始化 SQL 中管理员密码 hash 仍为空，必须由受控 provisioning 写入；该账号的 `password_change_required` 初始为 `1`。`system.user.init-password` 不再包含任何明文线索，导入前必须由管理员在系统中设置符合策略的初始密码。

## 验证入口

```powershell
cd 后端代码/basic-framework-boot
mvn -B -pl basic-framework-module-system -am test
```

后端测试覆盖 SM2 加解密与 sm-crypto 样例兼容、错误密文、过期时间戳、nonce 重放、密码策略、失败锁定、历史哈希迁移和首次改密标志。前端在 `前端代码/basic-framework-admin` 执行 `pnpm test:unit` 覆盖密码规则和 SM2 加密工具。真实 Redis、数据库迁移和浏览器登录仍需在目标环境验证。
