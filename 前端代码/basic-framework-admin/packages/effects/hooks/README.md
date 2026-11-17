---
description: '说明 @vben/hooks 的 Vue 组合函数，供应用复用分页、标签页和配置等能力时查阅。'
kind: package-library
---

# @vben/hooks

## 摘要

用于多个 `app` 公用的 hook，同时导出 `@vben-core/composables` 的组合函数。业务上有通用 hooks 可以放在这里。

## 目录

- [用法](#用法)
- [已知限制与暂缓工作](#已知限制与暂缓工作)

## 用法

### 添加依赖

```bash
# 进入目标应用目录，例如 apps/xxxx-app
# cd apps/xxxx-app
pnpm add @vben/hooks
```

### 使用

```ts
import { useNamespace } from '@vben/hooks';
```

## 已知限制与暂缓工作

本包依赖 Vue 及工作区状态、偏好和路由能力，接入时需满足所用函数的上下文要求，不能视为脱离前端环境运行的通用脚本库。实际导出见 [公开入口](src/index.ts)。
