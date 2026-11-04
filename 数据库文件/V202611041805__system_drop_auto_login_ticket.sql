-- 目的：移除已废弃的固定分享码自动登录能力和对应登录类型字典项。
-- 适用旧结构：存在 system_auto_login_ticket 表或 system_login_type 字典值 105 的数据库。
-- 受影响对象：system_auto_login_ticket（整表及数据）、system_dict_data（分享码登录字典项）。
-- 执行顺序：在升级到删除该功能的应用版本前执行一次；不依赖其他迁移。
-- 重放能力：幂等；表使用 IF EXISTS，字典项删除条件固定。
-- 执行前后检查：执行前确认目标库、备份和恢复方式；执行后查询 information_schema 确认表不存在。
-- 恢复方式：从执行前备份恢复；本脚本删除的表结构和分享码数据不可由应用重建。

DROP TABLE IF EXISTS `system_auto_login_ticket`;

DELETE FROM `system_dict_data`
WHERE `dict_type` = 'system_login_type' AND `value` = '105';
