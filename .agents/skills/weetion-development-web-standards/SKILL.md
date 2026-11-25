---
name: weetion-development-web-standards
description: 在 basic-framework 单包 Vue 3 + TypeScript + Element Plus 前端工程中开发、修改或测试页面与组件时使用。
---

# 前端工程规范（v2.0 单包 Vue 3 + Element Plus）

## 工程结构与设计基线
- 目录：`前端代码/basic-framework-admin/`（单包工程，无 Monorepo）。
- 视觉 Token 位于 `src/styles/index.css`：默认浅色蓝主色 `#006BE6`、浅灰画布 `#F1F3F6`、白底侧边栏（224px）/顶栏（50px）/标签栏（38px）、8px 圆角。
- 运行时公开配置由 `public/_app.config.js` 提供（禁止存放任何密钥）。

## 开发约束
1. **OpenAPI 单一事实源**：接口模型优先复用 `src/api/generated/api-types.d.ts` 中的 `OpenApiSchemas`，后端契约更新后执行 `pnpm api:gen` 同步。
2. **统一组件复用**：
   - 列表页统一使用 `src/components/ProTable.vue`（默认一屏锁高 `autoHeight`、响应式 Grid 搜索栏、支持 `columns` 列显隐设置）+ `el-table` + `src/components/TableAction.vue`（操作列）+ `src/components/FormDialog.vue` / `src/components/DetailDialog.vue`（弹窗，支持缩放动效与拖拽）；
   - 导航与外壳图标统一通过 `@lucide/vue` 与 `src/components/MenuIcon.vue` 管理，保持细线条风格一致；
   - 概览与统计页复用 `src/components/stats/*`（`StatCard`、`ChartCard`、`BaseChart`、`ActivityListCard`）；
   - 文件/图片上传统一使用 `src/components/UploadField.vue`（按需传 `:cropper="true"` 开启裁剪）；
   - 字典展示使用 `src/components/DictTag.vue`，按钮权限使用 `v-has-permi`，字段长度与校验规则复用 `src/constants/validation.ts`（`FIELD_LIMITS`）。
   - 编辑弹窗异步回填详情时必须使用单调请求令牌（`formLoad` + `formReady` + `formOwner` + `:confirm-disabled="!formReady"`）防竞态覆盖；外链或公开文件预览必须经 `resolveSafeHttpUrl()` 校验仅放行 `http:`/`https:`。
3. **安全基线**：所有密码提交必须经 `src/utils/sm2.ts` 的 `encryptPassword` 执行 SM2（C1C3C2）加密；单元测试使用 `sm2.generateKeyPairHex()` 动态生成密钥对，严禁提交任何看似密钥的字面量。

## 验证

使用 [仓库质量门禁](../../../AGENTS.md#required-validation)。
