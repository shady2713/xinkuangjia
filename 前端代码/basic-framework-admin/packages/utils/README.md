---
description: '说明 @vben/utils 的公共工具函数，供应用复用基础处理、缓存及校验辅助能力时查阅。'
kind: package-library
---

# @vben/utils

## 摘要

用于多个 `app` 公用的工具包，继承了 `@vben-core/shared/utils` 的所有能力。业务上有通用的工具函数可以放在这里。

## 目录

- [用法](#用法)
- [已知限制与暂缓工作](#已知限制与暂缓工作)

## 用法

### 添加依赖

```bash
# 进入目标应用目录，例如 apps/xxxx-app
# cd apps/xxxx-app
pnpm add @vben/utils
```

### 使用

```ts
import { isString } from '@vben/utils';
```

## 已知限制与暂缓工作

本包包含工作区辅助函数及基础工具，不能假定所有导出都适用于无浏览器或无路由的环境。使用前按 [公开入口](src/index.ts) 定位所用函数及依赖。
