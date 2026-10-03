-- 目的：支持短信 IPv6 来源并对升级库关闭开放注册。
-- 适用：已登记 202610010000 基线、存在 system_sms_code/infra_config 的 MySQL 8.x 库。
-- 顺序：备份恢复演练成功、停止写入后，由独立 Flyway 运维入口执行。
-- 重放：Flyway 记录版本与校验和，已完成版本不重放；禁止改写已应用脚本。
-- 前检：确认目标数据库、当前 schema history；保留既有账号、会话、部门和文件数据。
-- 后检：create_ip 长度 45，未删除的注册配置值为 false；IPv6 短信路径可用。
-- 恢复：MySQL DDL 隐式提交，失败后核对实际结构并恢复经验证备份，不能假定事务已回滚。

ALTER TABLE `system_sms_code`
    MODIFY COLUMN `create_ip` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        NOT NULL COMMENT '创建 IP';

UPDATE `infra_config`
SET `value` = 'false'
WHERE `config_key` = 'system.user.register-enabled' AND `deleted` = b'0';
