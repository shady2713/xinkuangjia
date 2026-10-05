---
description: '说明 vsh 的工程检查入口，供维护者查找依赖、循环引用、规范和包发布检查时查阅。'
kind: package-reference
---

# @vben/vsh

## 摘要

用于当前工程的 Shell 工具集合，主要服务于依赖检查、发布检查和工程辅助命令。

## 目录

- [安装](#安装)
- [使用](#使用)
- [常用命令](#常用命令)
- [已知限制与暂缓工作](#已知限制与暂缓工作)

## 安装

```bash
pnpm add -D @vben/vsh
```

## 使用

```bash
pnpm vsh [command]
```

## 常用命令

- `vsh check-deps`
- `vsh scan-circular`
- `vsh publish-check`

## 已知限制与暂缓工作

命令集合以 [CLI 注册入口](src/index.ts) 为准，依赖当前工作区工具和配置。检查通过只说明对应规则满足要求，不代表业务测试或部署验收通过。
