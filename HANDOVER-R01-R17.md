# 整改 R01–R17 移交说明

> 历史材料：以下内容记录 2026-09-30 的状态，数字、环境和旧会话约束不代表当前版本。
> 2026-10-03 的独立审查、实际验证与跨电脑接续说明见[整改审查与接续](docs/测试与可靠性/整改审查与接续.md)。
> 当前用户已授权将未完成成果作为检查点提交并推送；本文中的禁止提交、推送或删除本文等旧会话要求不适用于此次交接。

> 生成时间：2026-09-30（会话结束前最后一次独立复核）
> 本文所有数字均为**本文生成时实际复跑所得**，非引用历史结论。
> 本文件是临时工作产物，正式提交前请删除或移入合适的文档位置。

---

## 一、一句话结论

**测量工具已经可信，测量结果仍然大面积不达标。** 本轮最大的产出不是补了多少测试，而是把
"门禁本身有缺陷、根本无法运行"修好了，使退出码从 `2 (invalid-evidence)` 变成 `1 (failed)`。
现在后端 373 个受测文件中 276 个、前端 698 个受测文件中 671 个未达逐文件行+方法双 100%。
**这远未达到可交付状态。**

---

## 二、工作树事实（交接第一优先级）

| 项 | 值 |
| --- | --- |
| 仓库 | `E:\xiangmu\kuangjiaxin\2026-dev_lj_优化` |
| HEAD | `a42baeabf80dadc64ef2f7daa5e896dcfacc33bc` |
| 分支 | `codex/framework-remediation` |
| 工作区改动 | **601 条** |
| 暂存区 | **0 条（空）** |
| 已提交 / 已推送 | **无** |

**所有成果都只存在于工作区，没有进入任何提交。** 接手方必须清楚：这是一棵未提交的大规模改动树。
在跑通全量验证前不要提交；在门禁全绿前不要推送。

### 红线（沿用本轮约束）

- 禁止 `git add` / `commit` / `push` / `reset` / `stash` / `clean`；`git checkout` 亦禁止。
- **禁止**通过降阈值、加排除项、`<excludes>`、`jacoco.skip`、跳过用例、零对象伪装等方式让门禁变绿。
- 覆盖率与门禁只能靠"真实补测试"变绿。
- 隔离服务凭据只可注入子进程环境，**禁止打印、回显、写入文档或提交**。
- 不要自动操作真实业务库，不要自动部署。

---

## 三、本轮真正完成的事

### 3.1 安全修复（生产代码改动，由 Codex 实施）

1. **`EncryptTypeHandler`：ECB → AES-CBC + HMAC-SHA256**
   加 `v1:` 前缀、随机 16 字节 IV、HMAC-SHA256 完整性校验。
   **关键更正**：全仓检索确认该 TypeHandler **零生产消费者**（仅自身测试引用），
   因此**不存在存量密文、不需要数据迁移**。此前"ECB 需重加密存量数据"的前提不成立。

2. **短信回执链路加固**
   - `SmsCallbackController`：415（媒体类型）/ 400（载荷）/ 500（下游）分层，
     并加 `@ApiAccessLog(requestEnable=false)` 避免敏感载荷入审计日志。
   - 新增 `SmsCallbackPayloadValidator`：严格 JSON 解析，拒收尾随内容与重复键，整批校验后才落库。
   - `SmsLogMapper` / `SmsLogServiceImpl`：改为**带 `receiveStatus=INIT` 条件的原子 UPDATE**，
     修复重复/乱序回执覆盖终态的问题；同时移除了"用回执 `apiSerialNo` 回写数据库"的污染路径。
   - 新增 `SmsCallbackParsingTest`（25 用例）。
   - 新增 `SmsReceiptException`。

### 3.2 结构性缺陷：mq 模块从未被编译

`basic-framework-core/pom.xml` **缺少** `basic-framework-spring-boot-starter-mq` 依赖声明。
后果：该模块 12 个生产文件从未参与编译、测试从未运行、无 jacoco 报告 → 门禁直接判 `invalid-evidence`。
经 git 核对为**上游遗留缺陷，非本轮回归**。已加入 reactor，现 17 模块 BUILD SUCCESS。

随后为 mq 模块补 11 个测试文件（约 103 KB），**11/12 文件行+方法双 100%**
（唯一未达标：`RedisPendingMessageResendJob` 23/34 行，方法 6/6，原因见第五节）。
清理使用 `SCAN MATCH mq-test-*`，**未使用 FLUSHDB**。

Codex 另修复 `AbstractRedisStreamMessageListener.java:109` 的**失效错误守卫**：
原 `type == null` 判断是死代码（抽象类实现 `StreamListener<String,...>`，hutool 总会解析出 `String.class`），
改为按可赋值性判断后该行可达，文件达 30/30 行、7/7 方法。

### 3.3 修门禁自身缺陷（本轮最高价值产出）

**后端覆盖率门禁 3 个判定缺陷：**

1. `lombok_markers` 不认 `import lombok.*;` 通配导入 → 7 个纯声明 DO 被误判为"有实现"。
2. `lombok_declaration_only` 硬拒任何 `=`，导致 `@ConfigurationProperties` 默认值类永远无法达标
   （其默认值会编译进 Lombok 生成的构造器）。
   改为可证明判据：**大括号对必须逐一归属于类型声明**——显式方法、构造器、静态块、实例块、
   数组初始化、匿名类、lambda 全都会打破该等式，故剩余的 `=` 只可能是字段初始化器。
   24 个正反例全部验证通过。
3. 嵌套类型判据过严（要求"恰好一对大括号"）→ 放宽为允许嵌套声明类型。

另新增 `constant_holder_only` 规则，处理"仅编译期常量 + 空私有构造"的类
（jacoco 不为其产出方法计数器）。

> **放宽判据必须配行为测试补偿**：放宽 Lombok 声明判定后同步新增 `OAuth2MachineTokenTest`
> （防实例化契约 + 哨兵值列约束），2/2 通过。

结果：`invalid-zero` **19 → 0**，`problems` → 0，状态 `invalid-evidence`(2) → `failed`(1)。

**前端覆盖率门禁 2 个阻断缺陷（此前从未成功运行过一次）：**

1. `web_sources` 用 `rglob("*")` 无剪枝，走完整个 pnpm `node_modules` → 枚举 911 文件耗时 **426.3 秒**。
   改 `os.walk` 下降前剪枝后 **0.07 秒**，结果完全一致。
2. `coverage_declarations.mjs` 无视 SFC `lang="tsx"`，用纯 TS 解析器解析 JSX →
   `description.vue` 必然抛错 → 门禁每次退 2。
   改为按 `lang` 选 `ScriptKind.TSX/JSX`，报错带文件名与行列。

**4 个检查器丢弃异常原因**（只打印 `type(exc).__name__` 丢掉消息）：
`coverage_gate.py`、`check_worktree_python_comments.py`、`check_worktree_java_comments.py`、
`run_checks.py`（2 处）。`check_staged_quality.py` 原本就正确，可作参照。

### 3.4 其他

- 清理 56 个探针/临时文件（618 → 563 条改动），残留扫描 0。
- 补齐 95 处注释门禁问题 + 4 条 `@param` + 1 条模块说明。
- protection 模块补 16 个测试文件、**79 用例 0 失败 0 错误 0 跳过**，**19/20 文件行+方法双 100%**。
- 新增 `OAuth2MachineTokenTest`（2 用例）。
- OAuth 采用「止血+加固」方案（不新增 CLIENT userType、不改 userType 语义）。
  **保留的已知权衡**：机器 access token 有效期内仍可越权读 18 个端点。

---

## 四、当前真实绿灯数字（本文生成时实测）

### 后端

| 检查 | 结果 |
| --- | --- |
| `mvn -Pquality-audit clean verify` | BUILD SUCCESS，17 模块 |
| surefire 汇总 | **72 套件 / 740 用例 / 0 失败 / 0 错误 / 1 跳过** |
| Java 注释门禁 | 135 文件，**0 问题，passed** |
| Python 工具测试 | **515 项全过** |
| 覆盖率门禁 release | `problems=0`、`invalid-zero=0`、**`status=failed`、`code=1`** |
| 受测文件 | **373 → 97 passed / 276 failed / 222 not-applicable** |

未达标按模块：`module-system` 141、common 40、starter-web 39、starter-mybatis 21、
starter-excel 11、starter-job 6、biz-data-permission 5、starter-redis 4。

**好打的起点**：`module-system` 的 105 个文件中有 **38 个只缺 ≤5 行**。
Top 缺口：`AdminUserServiceImpl` 168 行、`MenuServiceImpl` 109、`PermissionServiceImpl` 108、
`PictureWordCaptchaServiceImpl` 90、`OAuth2ClientServiceImpl` 86。

### 前端

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @vben/web-ele typecheck` | **通过，0 错误** |
| `npx eslint .` | **exit 0，0 error 0 warning** |
| `pnpm quality:comments` | **441 项 0 问题** |
| `pnpm test:unit` | **75 文件 / 808 用例全绿**（复跑确认） |
| 覆盖率门禁 release | `problems=0`、**`status=failed`、`code=1`** |
| 受测文件 | **698 → 27 passed / 671 failed / 213 not-applicable** |

未达标分布：`@core/ui-kit` 235、web-ele/src 159、effects/layouts 75、effects/common-ui 64、
internal/lint-configs 26、internal/vite-config 17、effects/plugins 16、@core/base 15、
internal/node-utils 9、effects/hooks 9、@core/composables 8、effects/request 7、
@core/preferences 6、stores/src 6、icons/src 4。

### ⚠️ 三个必须如实知道的"不是全绿"

1. **`pnpm lint` 失败，且与本轮改动无关。**
   它实际执行 `vsh lint` = `prettier --check` + ESLint。prettier 挂在 **13 个 Markdown 文件**上
   （12 个包 README + `前端代码/basic-framework-admin/docs/开发指南/模块依赖关系图.md`）。
   **已逐个 `git status` 核实：13 个全部为未改动的既有文件** → 这是**本轮之前就已存在的状态，不是回归**。
   ESLint 单独运行是干净的（exit 0）。要不要修这 13 个文件属于范围决策，交接方自行判断。

2. **前端单测不是确定性绿。**
   首次全量跑时 `packages/@core/preferences/__tests__/init-preferences-cache.test.ts` 的
   "keeps override app name when cached preferences contain an older name" **5 秒超时失败**。
   单独跑**通过，但耗时 1157ms**——逼近 5s 上限。原因是它 `await import('../src/preferences')`
   拉起整个依赖图，在 75 文件并行负载下超时。
   复跑全量 808/808 全绿，故判定为**负载下超时偶发，非逻辑回归**。
   但该用例**没有超时余量**，测试文件从 61 增到 75 后此风险被放大，建议尽快加固。

3. **前端覆盖率"469 failed"这个旧数字已不可复现，不要再用。**
   本文实测为 671 failed（两次独立复跑一致）。早期记录的 469 是在不同测量基线上取得的，
   已作废。

---

## 五、阻断项与待决策项

### 5.1 待决策 1：Redis 5.0 → 6.2 升级（环境资源变更，未擅自执行）

`RedisPendingMessageResendJob` 有 **11 行不可达**：5 分钟超时重投分支需要构造 idle 超过阈值的
pending 消息，唯一途径是 `XCLAIM ... IDLE`，而**该命令需 Redis 6.2+**。
隔离实例是 **5.0.14.1**（已用 redis-cli 复核；子代理另用原始 RESP 探针证实 `IDLE` 被静默忽略）。
测试已写好并标 `@Disabled`，升级实例后直接可用。
**未加任何 excludes、未降阈值。**

> 附带线索（未证实）：重投时 `ofObject(records.get(0).getValue())` 拿到的可能是字段 Map 而非 JSON 字符串，
> 可能写出双重包裹的负载。升级后应一并验证。

### 5.2 待决策 2：`RateLimiterRedisDAO.java:74` 死分支

`if (config == null)` 是**死代码**（已独立核实）：Redisson 对不存在的 key 也返回非空
`RateLimiterConfig`（rate=0），因此永远落到第 87 行的**非原子** `setRate`，
**丢失了注释声明的 `trySetRate`(HSETNX) 原子创建语义**。

两个修法，需决策：
- **A**：改为 `if (config == null || config.getRate() == null)`，恢复原子创建语义；
- **B**：删掉 74–79 行死分支，承认非原子创建。

**修复需改生产代码**，已超出子代理可写范围。

### 5.3 待决策 3：`ApiSignatureAspect.java:128`

`Long.parseLong(timestamp)` 对非数字时间戳抛 `NumberFormatException`，
**未转 `ServiceException`**，会变成 500 而非应有的 400。

### 5.4 待验证：`mockStatic(HttpUtils.class)` 能否覆盖厂商短信客户端

此前"厂商短信客户端需改生产代码才能测"的判断**过重**：
`HttpUtils.post` 是干净静态边界（`HttpUtils.java:187`），`mockStatic` 可拦
（Mockito 由 Spring Boot 3.5.16 管理，5.x，inline mock-maker 已在用）。
`AliyunSmsClient`(72 行) + `TencentSmsClient`(67 行) 共 **139 行缺口，无需生产改动即可测**。
**此推断尚待实测证实。**

---

## 六、三个被证伪的"缺陷"（不要重蹈）

1. **「Excel 导出 StackOverflowError」不存在。**
   `ExcelUtils.write` 仅 13 行无递归；全仓 `StackOverflow` 仅出现在测试里故意抛出的位置。
2. **「ECB 需重加密存量数据」前提不成立。** `EncryptTypeHandler` 零生产消费者。
3. **「prettier 与注释门禁互斥」是误判。**
   全库 ESLint 事实：95 个 error **全部**是 `weetion/comments`，`prettier/prettier` 报错 **0**。
   唯一兼容写法是「逗号后、回调前、同一行块注释」。

---

## 七、隔离环境与可复现命令

### 隔离服务（均在运行）

| 服务 | 地址 | 版本 | PID |
| --- | --- | --- | --- |
| MySQL | `127.0.0.1:55704` | 8.0.39 | 20384 |
| Redis | `127.0.0.1:55705` | **5.0.14.1** | 34336 |
| MinIO | `127.0.0.1:63603` | — | 32612 |

MySQL 客户端：`E:/huanjing/mysql-8.0.39-winx64/bin`
环境文件（含随机秘密，**只可注入子进程环境**）：
`C:/Users/64576/AppData/Local/Temp/framework-auth-test-828be624f9304830b9f9c0893e0a46db/environment.json`

```powershell
# 注入环境变量到当前进程（不得打印值）
$cfg = Get-Content -LiteralPath '<env path>\environment.json' -Raw -Encoding UTF8 | ConvertFrom-Json
foreach($p in $cfg.PSObject.Properties){ [Environment]::SetEnvironmentVariable($p.Name, [string]$p.Value, 'Process') }
```

### 常用命令

```powershell
# ---- 后端 ----
cd 后端代码/basic-framework-boot
# 全量（须先注入 environment.json）
mvn -B -ntp -Pquality-audit clean verify '-Dtest=*Test,*IT' '-Dsurefire.failIfNoSpecifiedTests=false'
# 单模块（-am 必须带）
mvn -B -ntp -Pquality-audit -pl basic-framework-core/<module> -am verify '-Dtest=*Test,*IT' '-Dsurefire.failIfNoSpecifiedTests=false'

# ---- 前端 ----
cd 前端代码/basic-framework-admin
pnpm --filter @vben/web-ele typecheck
pnpm quality:comments
pnpm test:unit
npx eslint . --no-warn-ignored        # 注意：pnpm lint 会因 13 个既有 README 被 prettier 拦下

# ---- 门禁（从仓库根）----
python -B -X utf8 scripts/workflow/coverage_gate.py --kind backend --stage release --require-prepared --json
python -B -X utf8 scripts/workflow/coverage_gate.py --kind backend --stage full --module '后端代码/basic-framework-boot/basic-framework-core/<module>' --json
python -B -X utf8 scripts/workflow/coverage_gate.py --kind web --stage release --json
python -B -X utf8 scripts/code/java/check_worktree_java_comments.py --json
python -B -X utf8 -m pytest scripts/tests -q
```

### ⚠️ 极其重要的耦合

`backend_inputs()` 把 `scripts/workflow/coverage_gate.py` **自身绑进覆盖率证据指纹**。
**改门禁判据就必须重跑全量 `mvn -Pquality-audit`**，否则指纹不匹配、门禁会拒认旧证据。
前端 `run_frontend_tests.py` 的 `coverage_inputs` 同样绑定 `coverage_gate.py`、
`check_staged_java_comments.py`、`quality_common.py`。

---

## 八、环境限制（已知，非本轮引入）

- **Docker Linux Engine 不可用**；MinIO 镜像来源未证实。
- 云端 CI 未运行；**仓库仍无 `.github/workflows/**`**。
- jacoco 对 jsqlparser 的 JavaCC 生成类有 `MethodTooLargeException` 插桩告警
  （不影响构建，该部分第三方类未计入覆盖）。

---

## 九、R05/R06/R15/R16/R17 存量工作：尚未开始

以下整改项**本轮完全没动**，不要误以为已完成：

- R05 全库 PMD
- R06 原生 JDK17
- R15 完整浏览器链路
- R16 真实性能/容量
- R17 制品/许可证、Linux/离线交付
- CI workflow（`.github/workflows/**` 仍不存在）

---

## 十、建议的接手顺序

1. **先跑一遍第七节的验证命令**，确认 601 条改动在你的环境里能复现本文的数字。
   **不要相信本文，也不要相信任何子代理的报告——自己复跑。**
2. 处理第五节的 3 个决策项（其中 Redis 升级会解锁 11 行并验证一个疑似真实缺陷）。
3. 补覆盖率的优先级建议：
   - **后端**：从 `module-system` 里那 38 个"只缺 ≤5 行"的文件入手，投产比最高。
   - **前端**：`@core/ui-kit` 235 个是最大块，其中 shadcn-ui 是 vendored 组件库，
     需先决定**是否值得逐文件 100%**，或走"业务簇做透"策略而非按文件数铺开。
4. 稳定性优先：先修 `init-preferences-cache.test.ts` 的超时余量，再继续加测试文件，
   否则并行负载会持续制造偶发失败。
5. 全绿之后再谈提交/推送；提交前删掉本文件。
