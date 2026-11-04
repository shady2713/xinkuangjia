-- 目的：为存量用户增加首次登录强制修改密码标志，并清理初始口令线索。
-- 适用旧结构：system_users 缺少 password_change_required 列，或 infra_config 仍带初始口令备注。
-- 受影响对象：system_users（新增列与空密码账号标记）、infra_config（初始密码说明）。
-- 执行顺序：在升级到启用首次改密校验的应用版本前执行一次；不依赖其他迁移。
-- 重放能力：幂等；列存在时跳过 ALTER，UPDATE 使用固定条件。
-- 执行前后检查：执行前确认目标库与备份；执行后查询 information_schema 确认列存在，并确认空密码账号标记为 1。
-- 恢复方式：本脚本只新增列和修改说明，不删除业务数据；回退时先确认应用不再读取该列，再按备份恢复。

SET @column_exists := (
    SELECT COUNT(1)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'system_users'
      AND COLUMN_NAME = 'password_change_required'
);

SET @ddl := IF(
    @column_exists = 0,
    'ALTER TABLE `system_users` ADD COLUMN `password_change_required` tinyint(1) NOT NULL DEFAULT 0 COMMENT ''是否要求下次登录后先修改密码（0否 1是）'' AFTER `password`',
    'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 空密码账号无法直接登录，标记为需要受控设置密码后再首次修改。
UPDATE `system_users`
SET `password_change_required` = 1
WHERE LENGTH(`password`) = 0 AND `password_change_required` = 0;

-- 初始化说明改为受控下发，不再保留任何初始口令线索。
UPDATE `infra_config`
SET `remark` = '首次部署后由管理员设置并通过受控流程下发'
WHERE `config_key` = 'system.user.init-password';
