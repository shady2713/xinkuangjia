---
description: "说明管理后台 SM2 密码传输、服务端密钥配置、密码存储兼容迁移、等保二级密码策略、登录会话空闲超时、安全审计、短信登录限流和 Redis 降级行为。"
kind: package-reference
---

# SM2 密码传输与密码策略

## 摘要

管理后台所有提交用户密码的接口不再接收前端 MD5 摘要，改为 SM2 密文。前端用服务端公钥按 C1C3C2 模式加密 `{"p":密码,"t":时间戳,"n":nonce}`，后端用 BouncyCastle 私钥解密，并校验时间窗和 nonce 一次性。密码仍以 BCrypt 存储，历史 `bcrypt(md5(明文))` 在登录成功时自动升级。密码复杂度、失败锁定、首次改密、会话空闲超时和安全审计按等保二级要求落在后端；短信登录按手机号与 IP 双维度限流；默认 OAuth2 客户端停用，管理后台改用内部会话客户端。

## 目录

- [传输协议](#传输协议)
- [配置项](#配置项)
- [密钥生成与注入](#密钥生成与注入)
- [覆盖的接口](#覆盖的接口)
- [密码存储与兼容迁移](#密码存储与兼容迁移)
- [等保二级密码策略](#等保二级密码策略)
- [登录会话与空闲超时](#登录会话与空闲超时)
- [令牌吊销](#令牌吊销)
- [安全审计](#安全审计)
- [短信登录限流](#短信登录限流)
- [Redis 不可用时的行为](#redis-不可用时的行为)
- [默认 OAuth2 客户端](#默认-oauth2-客户端)
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
| `basic-framework.security.sms-login-lock.enabled` | `SMS_LOGIN_LOCK_ENABLED` | `true` | 短信登录失败锁定开关 |
| `basic-framework.security.sms-login-lock.max-failures` | `SMS_LOGIN_LOCK_MAX_FAILURES` | `5` | 同一手机号的连续失败阈值 |
| `basic-framework.security.sms-login-lock.ip-max-failures` | `SMS_LOGIN_LOCK_IP_MAX_FAILURES` | `20` | 同一 IP 的连续失败阈值 |
| `basic-framework.security.sms-login-lock.lock-duration` | `SMS_LOGIN_LOCK_DURATION` | `30m` | 短信登录锁定时长 |
| `basic-framework.security.sms-login-lock.failure-window` | `SMS_LOGIN_LOCK_FAILURE_WINDOW` | `30m` | 短信登录失败计数保留时长 |
| `basic-framework.security.session.idle-timeout` | `SESSION_IDLE_TIMEOUT` | `30m` | 会话空闲超时；`0` 关闭空闲校验 |
| `basic-framework.security.session.access-token-validity` | `ACCESS_TOKEN_VALIDITY` | `30m` | 管理后台访问令牌有效期 |
| `basic-framework.security.session.refresh-token-validity` | `REFRESH_TOKEN_VALIDITY` | `30d` | 管理后台刷新令牌有效期 |
| `basic-framework.security.redis-unavailable-strategy` | `REDIS_UNAVAILABLE_STRATEGY` | `local-fallback` | Redis 不可用时的降级策略，可选 `local-fallback`、`fail-closed` |

防重放默认失败关闭：Redis 不可用时登录请求返回通用失败，不会静默跳过 nonce 校验。若部署环境没有 Redis，必须显式设置 `SM2_REPLAY_CHECK_ENABLED=false` 并接受仅时间戳保护的风险；应用启动时会输出告警。登录锁定、短信限流和会话空闲校验的降级行为见 [Redis 不可用时的行为](#redis-不可用时的行为)。

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
3. 执行 [V202611051200__system_harden_default_oauth2_client.sql](../../数据库文件/V202611051200__system_harden_default_oauth2_client.sql)，停用默认 OAuth2 客户端并补充审计字典。
4. 注入 `SM2_PRIVATE_KEY` 后滚动重启后端；升级会清理默认客户端令牌，旧会话需要重新登录。
5. 管理员创建或重置密码后，用户首次登录会被要求改密；存量非空密码账号首次登录时自动升级哈希。

## 等保二级密码策略

后端 `ValidationUtils.isPassword` 与前端 `isPasswordValue` 使用同一规则：

- 长度 8-32 位；
- 只允许可见 ASCII 字符，不允许空格、控制字符和非 ASCII 字符；
- 大写字母、小写字母、数字、特殊字符四类中至少包含三类。

规则在解密后于 Service 层执行；前端规则、提示文案和表单校验同步更新。登录不强制校验当前密码复杂度，避免历史弱密码用户无法登录；新建、注册、重置和修改密码必须通过策略。

登录失败按账号计数，达到阈值后锁定，成功登录清零。锁定提示只说明剩余时间，不区分账号是否存在。

## 登录会话与空闲超时

管理后台登录和刷新令牌使用代码内置的 `system-admin` 内部会话客户端，不再读取 `system_oauth2_client` 中的 `default` 记录。访问令牌默认 30 分钟、刷新令牌默认 30 天，配置项见[配置项](#配置项)。

空闲超时按访问令牌的最后活动时间计算，默认 30 分钟：

1. 签发访问令牌时写入 Redis 活动标记 `oauth2_access_token_active:{token}`，TTL 为空闲超时。
2. 每次通过访问令牌认证时续期活动标记；标记不存在即判定会话空闲超时，按 401 返回“登录已超时，请重新登录”。
3. 刷新令牌前校验该刷新令牌关联的访问令牌是否仍有活动标记；空闲会话不能靠刷新令牌继续续期。
4. 退出登录、改密、重置密码、删除用户和刷新令牌时同步删除活动标记。

空闲校验只作用于 `system-admin` 内部会话客户端，开放接口客户端继续使用各自登记的有效期。校验在后端强制执行，前端无需额外空闲计时；前端现有 401 刷新拦截仍可在空闲窗口内正常续期，超过窗口后刷新失败并回到登录页。`SESSION_IDLE_TIMEOUT=0` 可关闭空闲校验，但访问令牌有效期仍然生效。Redis 不可用时空闲校验失败关闭，见 [Redis 不可用时的行为](#redis-不可用时的行为)。

升级后旧版本签发的访问令牌没有活动标记，第一次请求会被判定为空闲超时，用户需要重新登录一次；这是强制新会话策略的预期结果。

## 令牌吊销

以下操作完成后，后端同步撤销该用户（`userId + userType`）的全部访问令牌和刷新令牌：

| 触发操作 | 实现位置 | 失效原因 |
| --- | --- | --- |
| 用户自助修改密码 | `AdminUserServiceImpl.updateUserPassword(id, reqVO)` | `password-changed` |
| 短信重置密码 | `AdminUserServiceImpl.updateUserPassword(id, password)` | `password-reset` |
| 管理员重置密码 | `AdminUserServiceImpl.updateUserPassword(id, password, userType)` | `password-reset` |
| 删除用户 / 批量删除 | `AdminUserServiceImpl.deleteUser`、`deleteUserList` | `user-deleted` |
| 停用用户 | `UserStatusChangedConsumer` | 禁用事件 |

吊销由 `UserTokenInvalidatedEvent` 同步通知 `UserTokenInvalidatedConsumer`，删除访问令牌、按用户删除全部刷新令牌（包括没有关联访问令牌的孤立刷新令牌），并清理 Redis 令牌缓存和活动标记。监听器保持同步执行，业务方法返回前旧令牌已经失效，不存在异步窗口。

## 安全审计

安全事件统一写入 `system_login_log`，由 `SecurityAuditService` 组装用户编号、账号、IP、User-Agent、日志类型、结果和原因；操作日志继续记录管理员重置密码等后台操作。审计记录不包含密码、密码密文、短信验证码或请求载荷。

| 事件 | 日志类型 | 结果编码 |
| --- | --- | --- |
| 账号密码登录成功 / 失败 | `100` 账号登录 | `0` 成功、`10` 凭据错误、`20` 禁用、`30/31` 图形验证码、`40` 锁定 |
| 短信登录成功 / 失败 | `103` 短信登录 | `0` 成功、`50` 短信码错误/过期/已使用、`60` 手机号未注册、`20` 禁用、`40` 锁定 |
| 自助改密 | `300` 修改密码 | `0` 成功、`73` 旧密码错误、`74` 新密码不合规 |
| 短信或管理员重置密码 | `301` 重置密码 | `0` 成功、`74` 新密码不合规 |
| SM2 解密、时间戳或载荷校验失败 | `302` 密码传输校验 | `70` 密文/载荷/时间戳无效 |
| SM2 nonce 重放 | `302` 密码传输校验 | `71` 重放被拒绝 |
| 防重放依赖不可用 | `302` 密码传输校验 | `72` Redis 不可用导致校验失败 |

字典数据 `system_login_type` 和 `system_login_result` 包含上述编码；存量库通过 [V202611051200__system_harden_default_oauth2_client.sql](../../数据库文件/V202611051200__system_harden_default_oauth2_client.sql) 幂等补充。

## 短信登录限流

短信登录在验证码校验前检查两个维度的锁定，校验失败后同时累加两个维度的计数：

- 手机号维度：默认连续 5 次失败锁定 30 分钟；
- IP 维度：默认连续 20 次失败锁定 30 分钟；
- 两个维度都使用摘要键，Redis 中不保存手机号或 IP 原文；
- 成功登录后清零两个维度的计数和锁定；
- 锁定提示统一为“登录失败次数过多，请 X 分钟后重试”，不包含手机号、账号或注册状态信息；
- IP 取框架客户端 IP 解析结果，部署时必须由可信网关覆盖转发头，避免客户端伪造 `X-Forwarded-For` 绕过 IP 维度。

短信发送侧原有的同手机号发送间隔和每日上限继续生效；本节的锁定量用于短信登录验证码的尝试行为。

## Redis 不可用时的行为

`basic-framework.security.redis-unavailable-strategy` 控制登录锁定、短信登录限流的降级方式，默认 `local-fallback`：

| 策略 | 行为 | 适用取舍 |
| --- | --- | --- |
| `local-fallback`（默认） | Redis 读写失败时改用当前实例的有界内存计数（最多 10000 条，按访问顺序淘汰并带 TTL），单实例内继续计数和锁定 | Redis 短时故障时不阻断全部登录；多实例之间计数不共享，降级期间只能约束本实例 |
| `fail-closed` | Redis 不可用时锁定检查直接判定为已锁定，登录和短信登录被拒绝 | 安全性优先，接受 Redis 故障期间登录不可用 |

默认选择 `local-fallback` 的原因：登录锁定是密码校验之外的补充防线，Redis 故障时直接阻断全部登录会把单点依赖放大为业务中断；内存兜底仍能在单实例内阻止连续暴力尝试。要求“依赖不可用即拒绝”的部署应显式改为 `fail-closed`。

各安全能力的具体边界：

- **登录失败锁定**：按上述策略处理；`fail-closed` 下 `recordFailure` 无法写计数，但锁定检查会持续拒绝登录，直到 Redis 恢复。
- **短信登录限流**：与登录锁定使用同一策略；无 Redis 时按单实例内存计数锁定手机号或 IP。
- **SM2 nonce 防重放**：不跟随上述策略，始终失败关闭。Redis 不可用时登录返回通用失败；只有显式设置 `SM2_REPLAY_CHECK_ENABLED=false` 才退化为仅时间戳校验，并在启动时告警。
- **会话空闲校验**：失败关闭。Redis 不可用时无法可靠读取跨实例的活动标记，直接按空闲超时返回 401，避免绕过空闲限制。`SESSION_IDLE_TIMEOUT=0` 只用于明确关闭该能力，不用于规避 Redis 依赖。

## 默认 OAuth2 客户端

空库基线和存量迁移都会停用 `client_id='default'` 的 OAuth2 客户端：状态置为停用，授权类型和回调地址清空，并删除该客户端已签发的访问令牌和刷新令牌。管理后台登录、刷新令牌和权限查询不读取该记录，前端也没有依赖 `client_id=default` 的登录流程；SSO 授权页示例已改为占位客户端编号。

后端同时拒绝 `default` 客户端残留的访问令牌和刷新令牌，即使迁移尚未执行或 Redis 仍缓存旧令牌，也不会继续放行。管理后台使用代码内置的 `system-admin` 内部会话客户端：不落库、不校验客户端密钥、授权类型为空，只能由登录和刷新流程签发令牌，不能通过开放接口换取令牌。有效期来自 `basic-framework.security.session`。

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

后端测试覆盖 SM2 加解密与 sm-crypto 样例兼容、错误密文、过期时间戳、nonce 重放、密码策略、失败锁定、历史哈希迁移、首次改密标志、短信登录双维度锁定、令牌吊销、空闲超时和审计字段。前端在 `前端代码/basic-framework-admin` 执行 `pnpm test:unit` 覆盖密码规则和 SM2 加密工具。真实 Redis、数据库迁移和浏览器登录仍需在目标环境验证。
