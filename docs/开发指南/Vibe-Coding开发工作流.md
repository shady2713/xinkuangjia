---
description: "规范从需求拆解到主分支合并的 Vibe Coding 全链路闭环：上下文勘察、单责切片、工作树隔离、调用方同步、运行期与反例验证、独立代码评审与小批次 PR 门禁。"
kind: package-reference
---

# Vibe Coding 开发工作流

## 摘要

本工作流通过确定性工程约束（先勘察再切片、单一规范实现、运行期真实验证、独立上下文审查）与主干护栏体系（工作树隔离、内部消费方同步、配置与文档漂移校验、小批次 PR 门禁），将从自然语言需求到合入 `main` 分支沉淀为可重复验证的七步闭环。

-----

## 目录

- [全链路流程](#全链路流程)
- [七步执行准则](#七步执行准则)
- [并行切片与工作树隔离](#并行切片与工作树隔离)
- [验收与门禁矩阵](#验收与门禁矩阵)
- [开发笔记](#开发笔记)

-----

<a id="全链路流程"></a>

## 全链路流程

```mermaid
flowchart LR
  S1["1. 勘察调用链与边界"] --> S2["2. 单责切片与隔离分支"]
  S2 --> S3["3. 调用方与契约同步实现"]
  S3 --> S4["4. 运行期与反例验证"]
  S4 --> S5["5. 独立视角代码审查"]
  S5 --> S6["6. 提交前门禁与小 PR"]
  S6 --> S7["7. CI 全绿与人工确认合并"]
```

-----

<a id="七步执行准则"></a>

## 七步执行准则

### 1. 勘察调用链与边界（Inspect Before Write）

- 修改前先定位真实调用方、依赖方向、权限码、持久化边界与配置入口，参考[总体架构](../架构/00-总体架构.md)、[Java 后端](../架构/03-Java后端.md)与[管理前端](../架构/01-管理前端.md)。
- 保持单一规范实现（Single Canonical Implementation）：新能力直接修改权威模块或公共封装，禁止并存两套功能重复的组件、工具类或配置模板。
- 需求存在关键歧义（范围、外部契约、不可逆数据变更或推送授权）时先收敛确认，不在模糊前提下堆叠猜测性代码。

### 2. 单责切片与隔离分支（Slice & Isolate）

- 遵循“一事一分支、一事一 PR”：将跨栈大改动拆分为文件边界清晰、可独立回滚的小切片（非生成文件新增行默认控制在 `<= 600` 行，架构级变更须在 PR 描述中单独成行标注 `[slice-override]: <原因>`）；复杂需求使用 [weetion-task-cards](../../.agents/skills/weetion-task-cards/SKILL.md) 拆卡跟踪。
- 首次接入或新克隆环境先执行 `python -B -X utf8 scripts/runtime/init_local_dev.py --apply`，按 [`后端代码/basic-framework-boot/.env.example`](../../后端代码/basic-framework-boot/.env.example) 生成被 Git 忽略的 `.env.dev`、后端 `.env` 并挂载 `.githooks`，再按需通过 [`docker-compose.dev.yml`](../../docker-compose.dev.yml) 拉起环回绑定的本地 MySQL、Redis 与 MinIO；需要本地演示组织与初始化 `admin` 联调口令时，运行 `python -B -X utf8 scripts/runtime/seed_local_dev.py --apply --admin-password-hash <bcrypt-hash>`。

### 3. 调用方与契约同步实现（Consumer-Sync Implementation）

- 新建模块与标准 CRUD 优先运行黄金脚手架（`scripts/scaffold/new_java_module.py`、`scripts/scaffold/new_java_crud.py` 与 `scripts/scaffold/new_web_crud.py`），减少样板手写漂移。
- 后端遵循 [weetion-development-java-standards](../../.agents/skills/weetion-development-java-standards/SKILL.md) 与模块脚手架规范：Controller 入参与返回值使用 VO/DTO，禁止暴露 `dal.dataobject.*DO`；`core` 禁止反向依赖业务 `module` 或 `server`；DDL、DO 与 `system_menu` 权限码由 `SchemaDoRbacParityTest` 统一校验。
- 前后端接口契约以 `OpenApiContractSnapshotTest` 导出的 `openapi.json` 为唯一事实源，前端通过 `pnpm api:gen` 同步 `api-types.d.ts` 并由 `pnpm api:check` 拦截手工漂移；所有含 `tsconfig.json` 与 `src/` 的工作区包必须声明 `scripts.typecheck`，禁止空 `catch`、裸 `@ts-ignore`、裸 `window.open(` 与残留的 `it.skip`。
- 内部契约（环境变量、接口 URL、权限标识、脚本入口）变更时，在同一提交内同步 `.env.example`、调用方测试与[脚本使用索引](脚本使用索引.md)，防止配置与文档漂移。

### 4. 运行期与反例验证（Runtime & Negative-Proof Verify）

- 编码迭代期间优先运行 `python -B -X utf8 scripts/workflow/verify_slice.py` 对当前改动文件按改动域执行定向增量门禁（密钥、注释、关联文档、前端类型/API 契约与对应单测），缩短反馈回路。
- 编译通过不等于验证通过：Mapper 与 SQL 改动须执行基于真实数据库或 H2 MySQL 模式的切片测试，杜绝仅 Mock Mapper 掩盖 SQL 语法或依赖二进制不兼容。
- 缺陷修复与坏味道治理遵循[纠错即门禁](纠错即门禁.md)：将确定性检查接入既有 `eslint`、`ArchUnit`、`pytest` 或文档检查，并验证故意引入坏样本时门禁必然失败。

### 5. 独立视角代码审查（Independent Review）

- 切片实现并通过门禁后，按 [weetion-code-review](../../.agents/skills/weetion-code-review/SKILL.md) 及[框架安全威胁清单](../../.agents/skills/weetion-code-review/references/framework-threat-checklist.md)以只读审查视角复核真实 diff：核查越权漏检、数据权限写操作绕过、软删唯一约束、空值边界、事务范围、敏感信息脱敏与死代码残留。
- 多智能体协作时，编写代码的执行者与最终审查者分离，主会话负责集成冲突消解与终态验证。

### 6. 提交前门禁与小 PR（Pre-Commit & Small PR）

- 提交前对实际暂存区运行 `python -B -X utf8 scripts/workflow/check_staged_quality.py` 与 `git diff --cached --check`，确保索引版本通过密钥扫描、增量注释与关联文档检查。
- 获用户远端交付授权后推送工作分支，按 [PR 模板](../../.github/pull_request_template.md) 填写变更切片、契约同步、反例证明与实测命令证据。

### 7. CI 全绿与人工确认合并（Gate & Merge）

- GitHub Actions [CI](../../.github/workflows/ci.yml) 的五个必过任务（`backend`、`frontend`、`docs-comments`、`pytest`、`secrets-scan`）全部通过后，由维护者人工确认再合入 `main` 分支，AI 不自行合并受保护主干。

-----

<a id="并行切片与工作树隔离"></a>

## 并行切片与工作树隔离

并行开发多个独立切片时，使用 `git worktree` 为每个切片分配独立工作目录，避免多个代理或任务共享同一工作区与 Git 索引：

```powershell
# 从最新 main 创建隔离工作树与功能分支
git worktree add ../06kuangjiaxin-wt-feature -b feat/slice-name main

# 任务合入并经授权清理工作树
git worktree remove ../06kuangjiaxin-wt-feature
```

- 不同切片尽量保持改动文件集合正交；若存在共享注册表（如 `脚本使用索引.md`），将其归入单一收口切片或按明确依赖顺序演进。
- 在合入主干前可在临时集成分支本地试合并全部待交付分支并执行完整回归，提前消除语义冲突。

-----

<a id="验收与门禁矩阵"></a>

## 验收与门禁矩阵

| 变更层面 | 本地必跑门禁 | 对应线上 CI 任务 |
| --- | --- | --- |
| Java 源码、SQL、Maven 依赖或环境变量 | `mvn -B -ntp -Pquality-gate verify` | `backend (Maven quality-gate)` |
| Vue、TypeScript、OpenAPI 契约、工作区包清单或 ESLint | `pnpm api:check`、`pnpm quality:workspace`、`pnpm quality:development`、`pnpm graph:modules:check`、`pnpm quality:test`、`pnpm quality:analysis:test`、`pnpm quality:workspace:test`、`pnpm quality:development:test`、`pnpm quality:delivery:test`、`pnpm check:circular`、`pnpm check:dep`、`pnpm check:type`、`CI=true pnpm lint`、`pnpm test:unit`、`pnpm build:ele`、`pnpm quality:prod-scan` | `frontend (unit + typecheck + lint + build)` |
| Markdown 文档、README、Skill 或代码注释 | `python -B -X utf8 scripts/workflow/run_checks.py --group docs`、`check_staged_quality.py` | `docs + comments` |
| Python 质量脚本、脚手架工具或跨栈约束 | `python -B -X utf8 -m pytest scripts/tests` | `pytest (scripts/tests)` |
| 配置文件、测试夹具与任意新增变更 | `python -B -X utf8 scripts/security/scan_staged_secrets.py` | `secrets scan (staged-equivalent)` |

-----

<a id="开发笔记"></a>

## 开发笔记

<details>
<summary>为什么不新建独立的全局门禁系统</summary>

将坏味道与架构契约直接挂载到现有的 Maven `ArchUnit`、前端 `vsh lint` / `turbo typecheck`、仓库 `pytest` 与 `run_checks.py` 上，能够保证本地开发命令、Git 提交钩子与 GitHub Actions 执行完全一致的规则集合，避免出现第二套无人维护或与主流程脱节的脚本入口。

</details>
