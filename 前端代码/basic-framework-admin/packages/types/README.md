---
description: '说明 @vben/types 的公共 TypeScript 类型，供应用共享编译期接口约定时查阅。'
kind: package-library
---

# @vben/types

## 摘要

用于多个 `app` 公用的工具类型，继承了 `@vben-core/typings` 的所有能力。业务上有通用的类型定义可以放在这里。

## 目录

- [用法](#用法)
- [已知限制与暂缓工作](#已知限制与暂缓工作)

## 用法

### 添加依赖

```bash
# 进入目标应用目录，例如 apps/xxxx-app
# cd apps/xxxx-app
pnpm add @vben/types
```

### 使用

```ts
// 推荐加上 type
import type { SelectOption } from '@vben/types';
```

## 已知限制与暂缓工作

类型声明不提供运行时数据校验，外部输入仍需调用方校验。公共类型见 [导出入口](src/index.ts)，全局类型入口由 [package.json](package.json) 单独声明。
