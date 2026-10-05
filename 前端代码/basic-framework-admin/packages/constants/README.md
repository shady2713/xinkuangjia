---
description: '说明 @vben/constants 的公共常量入口，供多个应用复用业务枚举与基础常量时查阅。'
kind: package-library
---

# @vben/constants

## 摘要

用于多个 `app` 公用的常量，继承了 `@vben-core/shared/constants` 的所有能力。业务上有通用常量可以放在这里。

## 目录

- [用法](#用法)
- [已知限制与暂缓工作](#已知限制与暂缓工作)

## 用法

### 添加依赖

```bash
# 进入目标应用目录，例如 apps/xxxx-app
# cd apps/xxxx-app
pnpm add @vben/constants
```

### 使用

```ts
import { LOGIN_PATH } from '@vben/constants';
```

## 已知限制与暂缓工作

共享常量不替代服务端配置与校验；可用符号见 [公开入口](src/index.ts)。修改常量时需核对各消费应用。
