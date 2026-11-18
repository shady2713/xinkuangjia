---
description: "说明唯一官方服务器部署路径与离线交付准备，涵盖应用、中间件、数据库、HTTPS网关、Redis降级和短信能力边界。"
kind: package-reference
---

# 服务器安装与部署

## 摘要

框架运行需要MySQL、Redis、MinIO、Java后端、管理前端和入口网关。本目录只维护一条官方部署路径：在独立服务器构建产物、安装或复用中间件、运行应用并完成验收，不依赖个人开发机器配置。离线部署包是同一路径的断网资源准备，不是第二种运行方式；仓库不提供一键全栈 Compose 或 Jenkins 部署入口。

## 目录

- [选择流程](#选择流程)
- [配置与开发入口](#配置与开发入口)
- [已知限制与暂缓工作](#已知限制与暂缓工作)

## 选择流程

按目标网络和已有资源准备同一套服务器部署。下表的“服务器部署”是唯一官方入口；离线包只准备该入口所需的镜像、SQL与说明，复用兼容中间件时保留真实数据和恢复责任。

| 目标 | 文档 |
| --- | --- |
| 安装完整项目，构建并运行应用与中间件 | [服务器部署](部署说明.md) |
| 准备并验收断网服务器安装包 | [离线部署包](构建离线部署包说明.md) |

## 配置与开发入口

Java配置字段查[环境样例](../../后端代码/basic-framework-boot/.env.example)，浏览器参数查[运行配置](../../前端代码/basic-framework-admin/apps/web-ele/docker/app.config.js)。实际密码、私钥与Token由负责人受控提供，模板不公布默认口令。

仓库辅助脚本只保留本地用途，不构成部署入口：

- [http-client.env.json](../../后端代码/basic-framework-boot/script/idea/http-client.env.json)及其[说明](../../后端代码/basic-framework-boot/script/idea/README.md)是IntelliJ IDEA HTTP Client的本地调试环境，令牌由使用者在本机填写，不参与服务器部署、镜像构建或交付包制作。
- 服务器安装统一按[服务器部署](部署说明.md)的容器化流程与官方 Dockerfile 执行。

开发构建与模块说明分别见[Java README](../../后端代码/basic-framework-boot/README.md)、[前端 README](../../前端代码/basic-framework-admin/README.md)，模块关系见[总体架构](../架构/00-总体架构.md)。

## 已知限制与暂缓工作

当前流程由源码和已有Dockerfile核实，正式环境仍需按本次制品独立验收。

- SQL含重建语句，已有库升级需要迁移和备份恢复设计。
- 密码传输要求 `SM2_PRIVATE_KEY`；缺失时后端拒绝启动，首次登录或管理员重置密码后强制改密，详见[SM2 密码传输与密码策略](../开发指南/SM2密码传输与密码策略.md)。
- 文件地址采用长期公开读取契约，网关 `/files/` 路径须开启 `Content-Security-Policy: sandbox` 与 `X-Content-Type-Options: nosniff`；敏感文件需要完整私有授权实现。
- Redis不可用时默认按 `REDIS_UNAVAILABLE_STRATEGY=local-fallback` 降级：登录失败锁定和短信登录限流改用当前实例的有界内存计数，多实例之间不共享、重启后清零；令牌空闲校验仍失败关闭。多实例或严格安全要求应显式改为 `fail-closed`，并接受Redis故障期间拒绝登录。适用场景与风险见[Redis 不可用时的行为](../开发指南/SM2密码传输与密码策略.md#redis-不可用时的行为)。
- 短信发送侧按同一手机号执行发送间隔和每日上限；短信回调入口 `/admin-api/system/sms/callback/{aliyun,tencent}` 强制校验时间戳与 HMAC 签名（`basic-framework.sms-callback.secrets.ALIYUN` / `TENCENT`），未配置对应密钥时默认失败关闭返回 403。
- 短信、第三方OAuth2与数据恢复不因应用构建成功而自动通过。
- 目标操作系统、CPU架构与Docker离线安装依赖必须实际确认。
