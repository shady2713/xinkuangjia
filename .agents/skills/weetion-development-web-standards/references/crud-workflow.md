# CRUD 模块生成流程

本引用由 [Web 开发技能](../SKILL.md) 在完整 CRUD 模块生成场景加载。现有页面、组件或接口的局部修改按主技能处理，不因进入 Web 技能而自动生成整套 CRUD 文件。下文保留完整 CRUD 的需求、文件结构、检查和交付要求。

## 强制执行的流程（不得跳过任何步骤）

### 1. 收集需求（必须先询问，不得跳过）

在生成任何代码之前，如果用户没有提供以下信息，
必须逐条询问并等待确认后，才能进入第 2 步。
禁止根据上下文猜测并直接生成：

- 模块名称（英文，如 user、product）
- 字段列表及类型（名称、类型、是否必填、校验规则）
- 是否需要多标签页
- 特殊功能需求（导入导出、批量操作等）
- 除非用户明确要求多语言支持，否则默认不启用 i18n

### 2. 阅读参考文档（生成前必须先读）

**优先阅读默认 CRUD 模板：`../assets/crud-template.md`**

**在生成任何组件之前，必须先阅读对应文档。禁止凭记忆生成。**

**在使用 useVbenModal、useVbenDrawer、useVbenVxeGrid 之前，先在项目中搜索确认真实的导入路径。禁止猜测。**

| 组件类型 | 先读这篇文档 | 再参考这个模板 |
|---|---|---|
| 表单 Form | `vben-form.md` | `../assets/form-template.md` |
| 表格 Table | `vben-table.md` | `../assets/table-usage-template.md` |
| 弹窗 Modal | `vben-modal.md` | `../assets/modal-template.md` |
| 抽屉 Drawer | `vben-drawer.md` | `../assets/drawer-template.md` |
| 页面 Page | `vben-page.md` | `../assets/page-template.md` |
| 数字动画 Count Animator | `vben-count-animator.md` | `../assets/count-animator-template.md` |
| 省略文本 Ellipsis Text | `vben-ellipsis-text.md` | `../assets/ellipsis-text-template.md` |
| 提示 Alert | `vben-alert.md` | `../assets/alert-template.md` |

本 Skill 中所有 `src/` 路径均指目标前端应用的源码目录：本仓库为 `前端代码/basic-framework-admin/apps/web-ele/src`，执行前确认目标业务模块。当前应用使用 Element Plus，API 使用 `#/api/request`；分页复用 `PageParam`/`PageResult`，参数为 `pageNo`、`pageSize`，结果为 `list`、`total`。接口端点、实体字段及更新签名须核对实际后端和相邻模块，不照搬示例字段。生成代码前必须完整读取本技能的 [Web 注释完整规范](web-comments.md)（中文注释、props/emits 契约、职责说明）。

### 3. 生成文件结构

API 类型、请求封装、页面、表单和数据配置必须生成或复用已有对应文件。当前管理应用使用后端菜单模式：业务菜单在 `system_menu` 配置组件路径及权限，再分配角色；不为每个 CRUD 强制新增静态路由。只有明确需要核心或独立静态路由时，才生成下图的路由文件：

```
src/
├── api/
│   └── [module]/
│       ├── types.ts              # 类型定义，必须生成
│       └── index.ts              # API 接口，必须生成
├── router/
│   └── routes/
│       └── modules/
│           └── [module].ts       # 仅明确需要静态路由时生成
└── views/
    └── [module]/                 # 如 push/
        ├── index.vue             # 主页面，必须生成
        ├── data.ts               # 数据配置，必须生成
        └── modules/              # 子组件目录
            └── form.vue          # 表单组件，必须生成
```

**重要：`index.vue` 和 `data.ts` 同级，位于 `views/[module]/` 页面模块目录下。`form.vue`、`drawer.vue` 等其他组件位于该页面模块的 `modules/` 子目录下。不要嵌套额外的 `[module]` 子目录。**

**完整模块接入见[新增业务模块模板](../../../../docs/开发指南/新增业务模块模板/README.md)**：该指南提供后端模块骨架、Flyway 权限菜单/角色关联骨架、前端骨架与逐步接入清单。本流程只覆盖前端文件结构；只生成前端文件不等于模块接入完成。

**文件职责：**
- `types.ts`：定义请求/响应类型和实体类型
- `index.ts`：封装 CRUD API 方法（新增、查询、更新、删除）
- `[module].ts`：仅静态路由场景定义页面路由；后端菜单模式由后端菜单与授权配置提供业务路由
- `form.vue`：使用 `useVbenModal` 或 `useVbenDrawer` 的表单组件
- `data.ts`：表格列配置和搜索表单 schema
- `index.vue`：使用 `useVbenVxeGrid` 集成表格的主页面

### 4. 代码质量检查（必须在输出总结前完成，不得跳过）

#### 4.1 自动化脚本检查（先运行）

```bash
# 在目标前端应用根目录（如 前端代码/basic-framework-admin）下执行，路径相对于该目录
bash ../../.agents/skills/weetion-development-web-standards/scripts/check.sh <api-path> <views-path>
# 示例: bash ../../.agents/skills/weetion-development-web-standards/scripts/check.sh apps/web-ele/src/api/system/push apps/web-ele/src/views/system/push
```

任何非零退出码均表示未通过；缺少配置、依赖或解析失败返回 `2`，类型与 ESLint 保留实际失败退出码。修复对应问题后重新运行。模块内部允许 `../data` 等相对导入；越出 API 或页面模块的导入须使用应用别名。脚本使用真实语法树，不将注释和普通字符串误认作导入。
只有脚本输出 "🎉 全部检查通过" 之后，才能进入 4.2。

#### 4.2 手工对照文档检查（脚本通过后执行）

脚本无法验证组件 API 用法，必须手工对照文档检查：

- [ ] 阅读 `vben-form.md`，核对 form.vue 中的表单 API 用法
- [ ] 阅读 `vben-table.md`，核对 data.ts 中的表格列配置
- [ ] 阅读 `vben-modal.md` 或 `vben-drawer.md`，核对弹窗/抽屉用法
- [ ] 核对 types.ts 中的类型定义与 form.vue、data.ts、index.ts 中的用法一致
- [ ] 核对 API 方法参数与 types.ts 中定义的请求类型一致

发现不一致就修复。全部检查通过后，才能输出最终总结。

---

## 输出格式

生成完成后，必须按以下固定格式输出总结：

```
✅ [Module Name] CRUD 模块生成完成

📁 生成的文件：
- src/api/[module]/types.ts
- src/api/[module]/index.ts
- 后端菜单与角色授权配置（或明确需要时的 src/router/routes/modules/[module].ts）
- src/views/[module]/index.vue
- src/views/[module]/modules/form.vue
- src/views/[module]/data.ts

🎯 后续步骤：
1. 调整 API 端点 URL，使其与实际后端路径一致
2. 核对后端菜单组件路径、权限标识和角色授权；静态路由场景再核对路由注册
3. 根据业务需求调整字段校验和展示逻辑
```

---

## 核心原则

- 所有代码必须符合 TypeScript 严格模式
- 遵循 Vben Admin 最佳实践和代码风格
- 只使用框架提供的组件和工具，不自行实现自定义方案
- 保持代码简洁，避免过度设计
- 保证类型安全，减少运行时错误
