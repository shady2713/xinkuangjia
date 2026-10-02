---
description: "说明 @vben/icons 的项目图标入口，供前端页面复用图标组件时查阅。"
kind: package-library
---

# @vben/icons

## 摘要

用于多个 `app` 公用的图标文件，继承了 `@vben-core/icons` 的所有能力。业务上有通用图标可以放在这里。


## 目录

- [用法](#用法)
- [已知限制与暂缓工作](#已知限制与暂缓工作)

## 用法

### 添加依赖

```bash
# 进入目标应用目录，例如 apps/xxxx-app
# cd apps/xxxx-app
pnpm add @vben/icons
```

### 使用

```ts
import { X } from '@vben/icons';
```

## 已知限制与暂缓工作

只能使用 [公开入口](src/index.ts) 及其实际导出的图标；示例名称不代表任意图标都会自动存在。图标组件供 Vue 前端使用，新增图标需维护对应导出。
