---
description: '说明 @vben/styles 的基础样式和组件库子路径，供前端应用接入公共外观时查阅。'
kind: package-library
---

# @vben/styles

## 摘要

用于多个 `app` 公用的样式文件，继承了 `@vben-core/design` 的所有能力。业务上有通用的样式文件可以放在这里。

## 目录

- [用法](#用法)
- [已知限制与暂缓工作](#已知限制与暂缓工作)

## 用法

### 添加依赖

```bash
# 进入目标应用目录，例如 apps/xxxx-app
# cd apps/xxxx-app
pnpm add @vben/styles
```

### 使用

```ts
import '@vben/styles';
```

## 已知限制与暂缓工作

根入口加载基础设计样式，不等于加载所有组件库样式。组件库与全局样式入口以 [package.json](package.json) 的 exports 为准，应按应用所用组件库选择。
