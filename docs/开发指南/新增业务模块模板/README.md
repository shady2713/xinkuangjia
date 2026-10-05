---
description: "新增业务模块的唯一接入指南：可复制的 CRUD 工程模板、占位符替换规则、完整接入清单与各阶段验证命令。"
kind: package-reference
---

# 新增业务模块模板

## 摘要

本页是**新增业务模块的唯一操作契约**。框架不提供后台产品级代码生成器（不做反向工程、模板市场
或多数据源脚手架）；新增业务采用随框架交付的工程 CRUD 模板，可手工实例化，但必须完成后端装配、
迁移、同平台菜单与角色授权、前端组件映射及真实 API 接入，并通过现行适用门禁与端到端验收。
**模板生成成功不等于模块接入完成。**

本目录下的骨架文件全部可以复制即用：替换占位符后即为可编译、可测试、可通过逐文件覆盖率门禁的
真实模块。代表模块的实例化与端到端验收记录见仓库外证据目录（`A08` 专项），本页只描述可复现的
操作方法。

配套资料：[CRUD 页面与表单组合模板](../../../.agents/skills/weetion-development-web-standards/assets/crud-template.md)
（前端页面片段，本模板的前端骨架由它补齐 API 类型、请求封装与组件映射）、
[CRUD 流程](../../../.agents/skills/weetion-development-web-standards/references/crud-workflow.md)、
[脚本使用索引](../脚本使用索引.md)、[测试策略](../../测试与可靠性/测试策略.md)、
[总体架构](../../架构/00-总体架构.md#新增业务的落点)、[Java 后端](../../架构/03-Java后端.md)、
[数据库初始化与迁移](../../部署/数据库初始化与迁移.md)。

## 目录

- [模板内容与文件映射](#模板内容与文件映射)
- [占位符与替换规则](#占位符与替换规则)
- [实例化步骤（可照抄）](#实例化步骤可照抄)
- [完整接入清单](#完整接入清单)
- [权限注册三步](#权限注册三步)
- [各阶段验证命令](#各阶段验证命令)
- [已知限制与暂缓工作](#已知限制与暂缓工作)

## 模板内容与文件映射

模板根目录：`docs/开发指南/新增业务模块模板/`。文件后缀统一为 `.tpl`，避免未实例化的占位符被
Java/Web 注释与边界检查器当成真实生产源码扫描；实例化时去掉 `.tpl` 后缀。

| 模板文件 | 目标位置（`<java>` = `后端代码/basic-framework-boot`，`<web>` = `前端代码/basic-framework-admin/apps/web-ele`） |
| --- | --- |
| `backend/module-pom.xml.tpl` | `<java>/basic-framework-module-[module]/pom.xml` |
| `backend/src/main/java/com/basicframework/module/[module]/controller/admin/[entity]/[Entity]Controller.java.tpl` | `<java>/basic-framework-module-[module]/src/main/java/com/basicframework/module/[module]/controller/admin/[entity]/[Entity]Controller.java` |
| `backend/src/main/java/.../controller/admin/[entity]/vo/[Entity]PageReqVO.java.tpl` | 同结构分页请求 VO |
| `backend/src/main/java/.../controller/admin/[entity]/vo/[Entity]SaveReqVO.java.tpl` | 同结构新增/修改请求 VO |
| `backend/src/main/java/.../controller/admin/[entity]/vo/[Entity]RespVO.java.tpl` | 同结构响应 VO |
| `backend/src/main/java/.../service/[entity]/[Entity]Service.java.tpl` | 服务接口（纯声明） |
| `backend/src/main/java/.../service/[entity]/[Entity]ServiceImpl.java.tpl` | 服务实现（业务校验与查询条件） |
| `backend/src/main/java/.../dal/dataobject/[entity]/[Entity]DO.java.tpl` | 持久化对象 |
| `backend/src/main/java/.../dal/mysql/[entity]/[Entity]Mapper.java.tpl` | 持久化接口（纯接口，见下） |
| `backend/src/main/java/.../enums/ErrorCodeConstants.java.tpl` | 模块错误码 |
| `backend/src/test/java/.../controller/admin/[entity]/[Entity]ControllerWebTest.java.tpl` | Controller 的 HTTP 契约测试 |
| `backend/src/test/java/.../service/[entity]/[Entity]ServiceImplTest.java.tpl` | Service 行为测试 |
| `database/V[version]__[module]_[entity].sql.tpl` | `docs/部署/mysql-migrations/V<版本>__[module]_[entity].sql` |
| `frontend/apps/web-ele/src/api/[module]/[entity]/types.ts.tpl` | `<web>/src/api/[module]/[entity]/types.ts` |
| `frontend/apps/web-ele/src/api/[module]/[entity]/index.ts.tpl` | `<web>/src/api/[module]/[entity]/index.ts` |
| `frontend/apps/web-ele/src/api/[module]/[entity]/index.test.ts.tpl` | 同目录请求回归测试 |
| `frontend/apps/web-ele/src/views/[module]/[entity]/data.ts.tpl` | `<web>/src/views/[module]/[entity]/data.ts` |
| `frontend/apps/web-ele/src/views/[module]/[entity]/data.test.ts.tpl` | 同目录元数据回归测试 |
| `frontend/apps/web-ele/src/views/[module]/[entity]/index.vue.tpl` | `<web>/src/views/[module]/[entity]/index.vue` |
| `frontend/apps/web-ele/src/views/[module]/[entity]/index.test.ts.tpl` | 同目录页面行为测试 |
| `frontend/apps/web-ele/src/views/[module]/[entity]/modules/form.vue.tpl` | `<web>/src/views/[module]/[entity]/modules/form.vue` |
| `frontend/apps/web-ele/src/views/[module]/[entity]/modules/form.test.ts.tpl` | 同目录弹窗行为测试 |
| `frontend/apps/web-ele/e2e-business/[module]-[entity]-crud.e2e.ts.tpl` | `<web>/e2e-business/[module]-[entity]-crud.e2e.ts` |

两处刻意设计，实例化后不要“顺手改回去”：

1. **Mapper 是纯接口**。当前覆盖率门禁按文件纳管“有方法体的手写实现”：在 Mapper 里写 `default`
   方法就必须同时提供能真实执行它的测试，而这类测试通常需要真实数据库并落在必须显式纳入的
   `*IT` 入口里。条件查询放在 Service，可让默认 `surefire` 范围内就满足逐文件 100% 行/方法覆盖，
   条件正确性由 Service 测试断言 Wrapper 的真实 SQL 片段。
2. **响应对象与 DO 分离**。DO 携带逻辑删除与审计字段，直接输出会把持久化结构固化成对外契约。

## 占位符与替换规则

| 占位符 | 含义 | 示例实例化值 |
| --- | --- | --- |
| `[module]` | 业务模块标识，小写；用于包名、目录名、接口路径段 | `demo` |
| `[Module]` | 模块标识的帕斯卡形式，用于类型命名空间 | `Demo` |
| `[entity]` | 实体标识，小写；用于包名、目录名、接口路径段、前端目录名 | `thing` |
| `[Entity]` | 实体标识的帕斯卡形式，用于类名与方法名 | `Thing` |
| `[ENTITY]` | 实体标识的大写下划线形式，用于错误码常量名 | `THING` |
| `[entity-name]` | 业务中文名（短），用于字段标签、错误文案 | `样例` |
| `[entity-title]` | 业务中文标题，用于页面菜单名与页面标题 | `样例管理` |
| `[module-title]` | 一级目录菜单名，用于侧边栏分组 | `业务示例` |
| `[permission]` | 权限前缀，格式 `模块:实体` | `demo:thing` |
| `[table]` | 业务表名 | `demo_thing` |
| `[menu-path]` | 一级目录菜单的路由地址，带前导斜杠 | `/demo` |
| `[component]` | 页面菜单的组件地址，等于 `views/` 下的相对路径去掉 `.vue` | `demo/thing/index` |
| `[component-name]` | 组件名，全局唯一，供 keep-alive 使用 | `DemoThing` |
| `[menu-id-prefix]` | 菜单编号前缀（5 位区间的前 4 位），实例化后菜单编号为 `<前缀>1`–`<前缀>6` | `9100` |
| `[entity-sort]` | 一级目录在侧边栏中的排序值 | `30` |
| `[error-segment]` | 未占用的错误码段，格式 `1_00X_YYY` | `1_003_000` |
| `[version]` | Flyway 版本号，必须唯一且大于当前最大版本 | `202610030000` |
| `[author]` | 真实作者署名，不得沿用他人姓名或示例值 | 由提交者填写 |

替换规则是一次性全量文本替换；`[module]` 与 `[Module]` 等大小写变体因带方括号而互不冲突。
实例化后必须确认产物中不再残留 `[` 占位符：

```bash
grep -rn "\[module\]\|\[Module\]\|\[module-title\]\|\[entity\]\|\[Entity\]\|\[ENTITY\]\|\[entity-name\]\|\[entity-title\]\|\[permission\]\|\[table\]\|\[menu-\|\[component\|\[entity-sort\]\|\[error-segment\]\|\[version\]\|\[author\]" \
  后端代码/basic-framework-boot/basic-framework-module-<模块> \
  前端代码/basic-framework-admin/apps/web-ele/src/api/<模块> \
  前端代码/basic-framework-admin/apps/web-ele/src/views/<模块> \
  docs/部署/mysql-migrations/V<版本>__*.sql
# 预期：无输出（exit 1）
```

## 实例化步骤（可照抄）

以下命令在仓库根执行，`<...>` 全部替换为真实值。示例取 `module=demo`、`entity=thing`。

```bash
# 0. 变量
TPL="docs/开发指南/新增业务模块模板"
MODULE=demo; MODULE_P=Demo; ENTITY=thing; ENTITY_P=Thing; ENTITY_U=THING
ENTITY_NAME=样例; ENTITY_TITLE=样例管理; MODULE_TITLE=业务示例
PERMISSION=demo:thing; TABLE=demo_thing
MENU_PATH=/demo; COMPONENT=demo/thing/index; COMPONENT_NAME=DemoThing
MENU_ID_PREFIX=9100; ENTITY_SORT=30; ERROR_SEGMENT=1_003_000
VERSION=202610030000; AUTHOR="<真实作者>"

# 1. 复制并去后缀（后端）
DEST="后端代码/basic-framework-boot/basic-framework-module-$MODULE"
mkdir -p "$DEST"
cp "$TPL/backend/module-pom.xml.tpl" "$DEST/pom.xml"
(cd "$TPL/backend/src" && find . -type f -name '*.tpl') | while read -r f; do
  out="$DEST/${f%.tpl}"; mkdir -p "$(dirname "$out")"; cp "$TPL/backend/src/${f#./}" "$out"
done

# 2. 复制并去后缀（前端）
WEB="前端代码/basic-framework-admin/apps/web-ele"
cp -r "$TPL/frontend/apps/web-ele/." "$WEB/"
(cd "$WEB" && find src/api/$MODULE src/views/$MODULE e2e-business -type f -name '*.tpl' -print0 |
  xargs -0 -I{} sh -c 'mv "{}" "${1%.tpl}"' _ {})

# 3. 数据库迁移
cp "$TPL/database/V[version]__[module]_[entity].sql.tpl" "docs/部署/mysql-migrations/V${VERSION}__${MODULE}_${ENTITY}.sql"

# 4. 全量替换占位符（内容）
find "$DEST" "$WEB/src/api/$MODULE" "$WEB/src/views/$MODULE" \
     "$WEB/e2e-business/${MODULE}-${ENTITY}-crud.e2e.ts" \
     "docs/部署/mysql-migrations/V${VERSION}__${MODULE}_${ENTITY}.sql" -type f -print0 |
  xargs -0 sed -i \
    -e "s/\[Module\]/$MODULE_P/g" -e "s/\[module\]/$MODULE/g" \
    -e "s/\[Entity\]/$ENTITY_P/g" -e "s/\[ENTITY\]/$ENTITY_U/g" -e "s/\[entity\]/$ENTITY/g" \
    -e "s/\[entity-name\]/$ENTITY_NAME/g" -e "s/\[entity-title\]/$ENTITY_TITLE/g" \
    -e "s/\[permission\]/$PERMISSION/g" -e "s/\[table\]/$TABLE/g" \
    -e "s/\[menu-path\]/$MENU_PATH/g" -e "s/\[component\]/$COMPONENT/g" \
    -e "s/\[component-name\]/$COMPONENT_NAME/g" -e "s/\[menu-id-prefix\]/$MENU_ID_PREFIX/g" \
    -e "s/\[entity-sort\]/$ENTITY_SORT/g" -e "s/\[error-segment\]/$ERROR_SEGMENT/g" \
    -e "s/\[author\]/$AUTHOR/g"
```

替换后按下面的接入清单逐步完成装配与授权；每一步都给出验证方式，未通过就不要进入下一步。

## 完整接入清单

下表是“新人完整接入需要改的位置”的可执行版本。`10 处` 是调查分类，不是所有业务都固定要改
10 个文件；“验证方式”一列的命令是判定该步是否真的完成的依据。

### 第 1 步　后端模块进入 Maven 聚合

- 在 `后端代码/basic-framework-boot/pom.xml` 的 `<modules>` 增加
  `basic-framework-module-<模块>`。
- 验证：`cd 后端代码/basic-framework-boot && mvn -B -ntp -pl basic-framework-module-<模块> -am -DskipTests package`，
  退出码 0，且日志中出现该模块的 `SUCCESS`。

### 第 2 步　模块 POM 与依赖方向

- 直接使用 `module-pom.xml.tpl` 产物；只保留真实消费的 Starter，不要复制用不到的依赖。
- 验证：`python -B -X utf8 scripts/code/java/verify_backend_boundaries.py`
  退出码 0，且对象数比接入前增加（新模块的类被自动识别，不需要手工登记）。

### 第 3 步　Spring 装配与 server 依赖

- 在 `后端代码/basic-framework-boot/basic-framework-server/pom.xml` 增加该模块依赖
  （`${revision}` 版本），使其进入可执行 JAR。
- 验证：`mvn -B -ntp -pl basic-framework-server -am -DskipTests package` 退出码 0，
  且 `basic-framework-server/target/basic-framework-server.jar` 内包含新模块的 class
  （`unzip -l` 或 `jar tf` 检索 `module/<模块>/`）。

### 第 4 步　Controller/Service/Mapper/DO/VO 分层

- 使用模板产物，按真实职责调整字段；控制器只做权限声明、校验与响应组装，业务校验留在 Service。
- 验证：`python -B -X utf8 scripts/code/java/verify_api_contracts.py`
  退出码 0，且对象数增加；新端点必须出现在结果里（例如 `/[module]/[entity]/page`）。

### 第 5 步　错误码段

- 使用未被占用的 `1_00X_YYY` 段，先用
  `grep -rn "1_00[0-9]_[0-9]\{3\}_[0-9]\{3\}" --include=ErrorCodeConstants.java 后端代码` 确认无冲突。
- 验证：错误码被真实断言（模板的 Service 测试断言 `ServiceException#getCode`），
  且新段的常量值不与既有段重复。

### 第 6 步　每个生产文件配套测试

- 模板已给出 Controller 与 Service 的测试；若新增了自定义 SQL、转换器或工具类，按同样方式补测。
- 验证：`cd 后端代码/basic-framework-boot && mvn -B -ntp -Pquality-gate -pl basic-framework-module-<模块> -am verify`
  退出码 0。逐文件行与方法/函数均要求 100%，任一文件有缺口都会以 1 失败并打印该文件路径。

### 第 7 步　Flyway 版本文件与权限菜单行

- 新变化使用**新的唯一版本号**，不改写已应用版本；模板文件已包含业务表、菜单行、角色关联与
  迁移自检。
- 验证（隔离空库，见[数据库初始化与迁移](../../部署/数据库初始化与迁移.md#空库安装)）：
  `mvn -B -ntp -f scripts/database/pom.xml flyway:migrate`、`flyway:validate`、`flyway:info`
  三条命令各自退出码 0，`flyway:info` 中新版本 `State = Success`。

### 第 8 步　空库快照同步

- 结构或必需元数据变化后同步 `数据库文件/basic_framework.sql`，使新装快照与迁移结果一致。
- 验证：分别用快照导入的库与用 `flyway:migrate` 迁移的库核对新表结构、菜单行、角色关联计数一致
  （例如 `SELECT COUNT(*) FROM system_menu WHERE id BETWEEN <前缀>1 AND <前缀>6` 两边同值）。

### 第 9 步　前端 API 与页面

- 使用模板产物；请求地址必须与后端 `@RequestMapping` 一致，`api/<模块>/<实体>/` 下必须同时有
  `types.ts` 与 `index.ts`。
- 验证：`cd 前端代码/basic-framework-admin && python -B -X utf8 scripts/quality/check_crud.py apps/web-ele/src/api/<模块>/<实体> apps/web-ele/src/views/<模块>/<实体>`
  退出码 0（文件、相对导入边界、应用类型与模块 ESLint 全部通过）。

### 第 10 步　菜单组件地址与平台类型

- 页面菜单的 `component` 必须等于 `views/<模块>/<实体>/index`；`menu_type` 必须与登录入口平台
  一致（管理后台为 `super_admin`）。
- 验证：隔离库中
  `SELECT id,name,type,menu_type,path,component FROM system_menu WHERE id BETWEEN <前缀>1 AND <前缀>6`
  逐行核对；并用有权限身份调用 `GET /admin-api/system/auth/get-permission-info`，
  返回的 `menus` 中出现该页面、`permissions` 中出现 4 个权限码。

### 第 11 步　前端质量门禁

- 验证（前端根，逐条退出码 0）：`pnpm check:type`、`pnpm lint`、`pnpm quality:comments`、
  `pnpm build:ele`；新文件的单测不低于仓库既有页面标准（模板已带 4 个测试文件）。
- 若模块被纳入前端覆盖率分母，另行执行
  `python -B -X utf8 scripts/workflow/static_gate.py --kind web --execute` 与
  `python -B -X utf8 scripts/workflow/coverage_gate.py --kind web --stage full --json`。

### 第 12 步　真实入口与端到端验收

- 使用仓库既有的浏览器业务端到端基础设施
  `python -B -X utf8 scripts/e2e/run_business_e2e.py`，规格放在
  `apps/web-ele/e2e-business/*.e2e.ts`。
- 验证：真实登录后**从菜单进入页面**，完成新建、编辑、删除；用例退出码 0 且没有跳过或重试通过。
  页面提示不能替代数据结果，删除后必须另行直连数据库或再次查询列表确认记录确实不再可见。

### 第 13 步　失败与越权路径

- 用同平台的**非内置超管**身份（有权限与无权限各一）分别请求：无权限身份必须得到契约内 403 且
  没有写入；非法输入必须得到契约内 400；业务冲突必须得到模块错误码。
- 验证：`curl` 记录真实 HTTP 与响应体业务码，并在数据库中确认无新增行。

### 第 14 步　文档与清单同步

- 更新模块清单类文档（`docs/架构/03-Java后端.md` 模块表、`后端代码/basic-framework-boot/README.md`
  模块表），并确保本页的模板文件映射没有过期。
- 验证：`python -B -X utf8 scripts/workflow/run_checks.py --group docs --json` 退出码 0。

## 权限注册三步

权限不生效最常见的原因是只做了其中一步。三步缺一不可：

1. **菜单行存在**：`system_menu` 中必须有 `permission` 等于权限码的行，且 `type = 3`（按钮）；
   页面入口另有 `type = 2` 且带 `component` 的行。权限服务在严格模式下找不到菜单行即判无权限，
   内置超管分支同样要求菜单行存在。
2. **平台类型一致**：菜单行的 `menu_type` 必须与登录入口平台一致（管理后台 `super_admin`），
   否则同一角色的用户在对应平台仍然 403。
3. **角色关联**：`system_role_menu` 中把上述菜单行授予目标角色；`system_user_role` 把用户挂到该角色；
   授权后如权限缓存未失效，按现有 Service 的失效流程处理，不要直接清空共享 Redis。

模板的迁移文件已把三步写在一起，并在末尾用临时表自检：4 个权限码各 1 行、页面 `component` 存在、
6 行全部授予 `code='super_admin' AND role_type='super_admin'` 的角色、`menu_type` 与父级关系正确；
任一不满足则迁移失败，避免“插了一半也算成功”。

## 各阶段验证命令

| 阶段 | 命令（工作目录见括号） | 通过条件 |
| --- | --- | --- |
| 后端边界 | `python -B -X utf8 scripts/code/java/verify_backend_boundaries.py`（仓库根） | 退出码 0，对象数包含新模块 |
| 接口契约 | `python -B -X utf8 scripts/code/java/verify_api_contracts.py`（仓库根） | 退出码 0，新端点被检查 |
| 模块门禁 | `mvn -B -ntp -Pquality-gate -pl basic-framework-module-<模块> -am verify`（`后端代码/basic-framework-boot`） | 退出码 0，逐文件 100% |
| 完整门禁 | `mvn -B -ntp -Pquality-gate verify`（`后端代码/basic-framework-boot`） | 退出码 0（完整 reactor） |
| 前端 CRUD | `python -B -X utf8 scripts/quality/check_crud.py apps/web-ele/src/api/<模块>/<实体> apps/web-ele/src/views/<模块>/<实体>`（前端根） | 退出码 0 |
| 前端类型与规范 | `pnpm check:type`、`pnpm lint`、`pnpm build:ele`（前端根） | 各退出码 0 |
| 数据库迁移 | `mvn -B -ntp -f scripts/database/pom.xml flyway:migrate`、`flyway:validate`、`flyway:info`（仓库根） | 各退出码 0，历史 `Success` |
| 端到端 | `python -B -X utf8 scripts/e2e/run_business_e2e.py`（仓库根） | 退出码 0，正数用例、无跳过与重试 |

## 已知限制与暂缓工作

- 本模板**不是生成器**：没有一键命令、没有后台界面、没有数据库反向工程；实例化由人或智能体按
  [实例化步骤](#实例化步骤可照抄)执行。这是当前验收基准允许的最小交付形态。
- 前端覆盖率裁决入口 `coverage_gate.py --kind web --stage full` 的分母是**整个前端工程**，不是单个
  新模块；新模块自带的 4 个测试文件能覆盖自身文件，但不能把全工程分母变成 100%。全工程缺口见
  既有前端覆盖率证据，与本模板无关。
- 模板只覆盖单表 CRUD。多表关联、导入导出、批量操作、跨模块 API/DTO 需要在同一分层上自行扩展，
  并同样补齐测试与逐文件覆盖。
- 菜单编号区间是**保留区间**：实例化前必须确认 `<前缀>1`–`<前缀>6` 未被占用；升级库中若已有业务
  菜单落在同一区间，本次迁移的前检会命中并需要先调查。

### 实例化后最容易踩的三个坑（都有真实执行证据）

1. **干净检出必须是 Git 仓库**：`git archive` 导出的目录不是仓库时，前端注释检查在增量模式下直接
   报 `增量检查需要 Git 仓库；全量检查请指定 --root 和 --all` 并以环境错误退出。导出后执行
   `git init && git add -A && git commit` 即可，检查规则不需要任何放宽。
2. **编辑回填不能提前、也不能在加载期间放开输入**：隐藏的主键字段只有在表单**挂载之后**通过
   `setValues` 写入才会进入 `getValues()`；在打开弹窗之前设置会被挂载时的默认值覆盖，修改请求
   会缺少编号并被后端判为“记录不存在”。模板因此在回填期间 `formApi.setDisabled(true)`，
   并在 `finally` 中恢复，避免慢请求覆盖用户已经输入的内容。
3. **产物要过仓库自己的格式化口径**：新文件的所有行都在增量注释与格式检查范围内，实例化后先跑
   `pnpm exec prettier --write`（或 `pnpm format`）与 `check_crud.py`，再进入构建与端到端验证。
