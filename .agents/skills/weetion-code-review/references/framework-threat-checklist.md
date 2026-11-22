# basic-framework 安全威胁与契约核查清单

本清单由 [代码评审主技能](../SKILL.md) 在评审 Java 后端、SQL 或管理前端变更时按需加载，聚焦框架特有的权限、数据隔离、契约一致性与前端渲染风险。只核查本次变更实际触及的链路，不为无关模块制造检查项。

## 1. 认证、角色层级与越权访问（IDOR / Privilege Escalation）

- **超级管理员与业务管理员隔离**：非 `super_admin` 账号（如 `business_admin`）严禁通过更新、删除、修改状态、重置密码、分配菜单或分配数据范围等接口操作 `super_admin` 角色及其绑定用户。
- **数据权限写路径校验**：`@DataPermission` 默认拦截 SQL 查询，单条或批量写操作（`update*`、`delete*`、状态变更、密码重置、角色绑定）必须在 Service 层校验目标 ID 在当前登录者的数据权限可见范围内，防止构造主键直接越权修改他部门数据。
- **匿名端点白名单**：新增 `@PermitAll` 或 Security `permitAll()` 必须具备明确公开契约（如验证码获取、受 HMAC 验签保护的短信回调），并同步登记在 `FootgunRules.PERMIT_ALL_ALLOWLIST`；禁止类级 `@PermitAll`。

## 2. 密码、凭据与审计日志脱敏

- **SM2 密文传输**：所有接收用户密码的管理端入口必须经过 SM2 私钥解密与时间戳/nonce 防重放校验，禁止新增明文或前端哈希直传接口。
- **敏感返回与日志裁剪**：VO、操作日志（`@LogRecord`）与异常消息严禁输出密码哈希、SM2 私钥、OAuth2 `clientSecret`、短信渠道 `apiSecret`、对象存储 `secretKey` 或完整 Bearer/Refresh Token。
- **回调与文件边界**：外部回调接口必须默认失败关闭（未配置签名密钥或签名/时间戳不合法时返回 403）；上传/导出文件名须过滤控制字符与路径穿越，公开对象网关须保持 `Content-Security-Policy: sandbox` 与 `X-Content-Type-Options: nosniff`。

## 3. 持久化、软删除唯一约束与全栈契约

- **软删唯一索引对齐**：带业务唯一键的表必须继承 `UniqueBaseDO`（含 `deleted_tag bigint NOT NULL DEFAULT 0`），唯一索引建在 `(业务唯一列, deleted_tag)` 上，避免逻辑删除后无法重建同名记录。
- **三方契约零漂移**：新增或修改表列、DO 字段、`@PreAuthorize` 权限码、Controller 路由或 VO 字段时，核对 `basic_framework.sql`、`SchemaDoRbacParityTest`、`OpenApiContractSnapshotTest` 快照与前端 `pnpm api:check` 是否同步更新。
- **数值与时间精度**：前端处理后端返回的雪花主键或长整型 ID 时，注意 `> 2^53 - 1` 按字符串序列化的边界，禁止无保护 `Number(id)` 截断精度；Excel 导出长整型主键使用 `LongPlainStringWriteConverter`。

## 4. 前端 XSS、外链与存储卫生

- **外链安全**: Parse untrusted or configured URLs with `const parsed = new URL(value, window.location.origin)`. Allow only the `http:` and `https:` protocols and reject everything else. Open the result with `window.open(parsed.href, '_blank', 'noopener,noreferrer')`. Give every `target="_blank"` anchor `rel="noopener noreferrer"`.
- **富文本与动态节点**：禁止将未净化的用户输入传入 `v-html` 或 `ElMessageBox(..., { dangerouslyUseHTMLString: true })`；高亮确认弹窗优先使用 Vue `h(...)` VNode 构造。
- **浏览器配置边界**：`docker/app.config.js` 与 `VITE_GLOB_*` 对所有浏览器访客可见，严禁写入任何服务端密钥或测试口令。
