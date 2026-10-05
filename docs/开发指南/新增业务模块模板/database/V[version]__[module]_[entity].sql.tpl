-- 目的：为新增业务模块 [module] 建立 [entity-name]表，并注册权限菜单行与内置超管授权。
-- 适用：已登记 202610010000 基线、存在 system_menu/system_role/system_role_menu 的 MySQL 8.x 库；
--       空库新装与既有库升级都执行本文件。
-- 顺序：核对目标库、flyway_schema_history 与备份，完成恢复演练并停写后，由独立 Flyway 运维入口执行。
-- 重放：本文件只用 CREATE TABLE IF NOT EXISTS 与 INSERT ... SELECT；按保留区间 id 或权限标识命中即跳过，
--       重复执行不新增行、不改写已有行。
-- 前检：确认 system_menu.id 未落在 [menu-id-prefix]1-[menu-id-prefix]6、且 4 个权限标识均不存在。
-- 后检：表结构存在；4 个权限标识各 1 行且 type=3、menu_type 与登录入口平台一致；页面菜单 component
--       指向真实页面；6 行全部授予内置超管角色。末尾 CHECK 不通过即迁移失败。
-- 恢复：本文件不改写历史行。需回退时按保留区间 id 与权限标识删除本次插入的 menu/role_menu 行，
--       并按备份决定是否删除业务表。
--
-- 占位符：[module]、[entity]、[Entity]、[entity-name]、[entity-title]、[permission]、
--         [table]、[menu-id-prefix]（菜单编号前缀，实例化为 9100，于是编号为 91001-91006）、
--         [module-title]（一级目录菜单名，如 业务示例）、[menu-path]（一级目录路由，如 /demo）、[component]（页面组件地址，如 demo/thing/index）、
--         [component-name]（组件名，如 DemoThing）、[entity-sort]（菜单排序）。
--
-- 关键契约（改错不会编译失败，只会让已授权用户 403 或页面打不开）：
-- 1) menu_type 必须与登录入口平台一致（管理后台为 super_admin）；PermissionServiceImpl 的严格模式
--    要求权限标识能查到菜单行，内置超管分支同样要求菜单行存在。
-- 2) type：1 目录、2 菜单、3 按钮。权限标识只挂在 type=3 的按钮行上。
-- 3) component 必须与 前端代码/basic-framework-admin/apps/web-ele/src/views/<路径>.vue 对应。
-- 4) 授权按角色 code/role_type 定位，不能假设干净环境里角色编号一定是 1。

-- 业务表：逻辑删除列与其他业务表一致；名称唯一性由服务层校验并在冲突时返回业务错误码，
-- 因此这里只建普通索引：唯一索引会与逻辑删除冲突（删除后同名记录无法再建立）。
CREATE TABLE IF NOT EXISTS `[table]` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT '编号',
    `name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '[entity-name]名称',
    `status` tinyint NOT NULL DEFAULT 0 COMMENT '状态：0 开启 1 关闭',
    `remark` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '备注',
    `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
    `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
    `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
    PRIMARY KEY (`id`) USING BTREE,
    INDEX `idx_name`(`name` ASC) USING BTREE,
    INDEX `idx_status`(`status` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '[entity-name]表' ROW_FORMAT = DYNAMIC;

-- 目录、页面与权限按钮一次插入：id 被占用或权限标识已存在都跳过该行，由后检断言兜底报错。
-- 派生表先给列定类型，避免 UNION 分支的 NULL 与字符串推断出不一致的列类型。
-- create_time/update_time 取固定值，使空库新装与既有库升级得到逐行一致的结果。
INSERT INTO `system_menu` (`id`, `name`, `permission`, `type`, `menu_type`, `sort`, `parent_id`,
                           `path`, `icon`, `component`, `component_name`, `status`,
                           `visible`, `keep_alive`, `always_show`,
                           `creator`, `create_time`, `updater`, `update_time`, `deleted`)
SELECT `seed`.`id`, `seed`.`name`, `seed`.`permission`, `seed`.`type`, `seed`.`menu_type`,
       `seed`.`sort`, `seed`.`parent_id`, `seed`.`path`, `seed`.`icon`, `seed`.`component`,
       `seed`.`component_name`, 0, b'1', b'1', b'1',
       'module-[module]', '2026-10-06 00:00:00', 'module-[module]', '2026-10-06 00:00:00', b'0'
FROM (
    SELECT [menu-id-prefix]1 AS `id`, '[module-title]' AS `name`, '' AS `permission`, 1 AS `type`,
           'super_admin' AS `menu_type`, [entity-sort] AS `sort`, 0 AS `parent_id`, '[menu-path]' AS `path`,
           'ep:document' AS `icon`, NULL AS `component`, NULL AS `component_name`
    UNION ALL SELECT [menu-id-prefix]2, '[entity-title]', '', 2, 'super_admin', 1, [menu-id-prefix]1,
                     '[entity]', 'ep:list', '[component]', '[component-name]'
    UNION ALL SELECT [menu-id-prefix]3, '[entity-name]查询', '[permission]:query', 3, 'super_admin', 1, [menu-id-prefix]2, '', '', NULL, NULL
    UNION ALL SELECT [menu-id-prefix]4, '[entity-name]新增', '[permission]:create', 3, 'super_admin', 2, [menu-id-prefix]2, '', '', NULL, NULL
    UNION ALL SELECT [menu-id-prefix]5, '[entity-name]修改', '[permission]:update', 3, 'super_admin', 3, [menu-id-prefix]2, '', '', NULL, NULL
    UNION ALL SELECT [menu-id-prefix]6, '[entity-name]删除', '[permission]:delete', 3, 'super_admin', 4, [menu-id-prefix]2, '', '', NULL, NULL
) AS `seed`
LEFT JOIN (
    SELECT `id`, `permission` FROM `system_menu`
) AS `existing`
    ON `existing`.`id` = `seed`.`id`
    OR (`seed`.`permission` <> '' AND `existing`.`permission` = `seed`.`permission`)
WHERE `existing`.`id` IS NULL;

-- 授予内置超管角色：按 code 与 role_type 定位，排除已存在的有效授权；ORDER BY 固定插入顺序。
INSERT INTO `system_role_menu` (`role_id`, `menu_id`, `creator`, `create_time`, `updater`, `update_time`, `deleted`)
SELECT `role`.`id`, `menu`.`id`, 'module-[module]', '2026-10-06 00:00:00',
       'module-[module]', '2026-10-06 00:00:00', b'0'
FROM (
    SELECT `id` FROM `system_menu` WHERE `id` BETWEEN [menu-id-prefix]1 AND [menu-id-prefix]6
) AS `menu`
JOIN `system_role` AS `role`
    ON `role`.`code` = 'super_admin' AND `role`.`role_type` = 'super_admin'
    AND `role`.`status` = 0 AND `role`.`deleted` = b'0'
LEFT JOIN (
    SELECT `menu_id` FROM `system_role_menu` WHERE `role_id` IN (
        SELECT `id` FROM `system_role` WHERE `code` = 'super_admin' AND `role_type` = 'super_admin'
    ) AND `deleted` = b'0'
) AS `granted`
    ON `granted`.`menu_id` = `menu`.`id`
WHERE `granted`.`menu_id` IS NULL
ORDER BY `menu`.`id`;

-- 后检：任一项不为 0 即让迁移失败，避免"插了一半也算成功"。
-- 检查表只在当前连接可见，成功即删除；异常由迁移连接关闭回收，不留下永久对象。
CREATE TEMPORARY TABLE `bf_[module]_[entity]_assertion` (
    `missing_table` INT NOT NULL,
    `missing_permissions` INT NOT NULL,
    `missing_component` INT NOT NULL,
    `missing_grants` INT NOT NULL,
    `wrong_platform` INT NOT NULL,
    `wrong_parent` INT NOT NULL,
    CHECK (`missing_table` = 0 AND `missing_permissions` = 0 AND `missing_component` = 0
           AND `missing_grants` = 0 AND `wrong_platform` = 0 AND `wrong_parent` = 0)
);
INSERT INTO `bf_[module]_[entity]_assertion`
SELECT
    (SELECT 1 - COUNT(*) FROM `information_schema`.`tables`
      WHERE `table_schema` = DATABASE() AND `table_name` = '[table]'),
    (SELECT 4 - COUNT(DISTINCT `permission`) FROM `system_menu`
      WHERE `deleted` = b'0' AND `type` = 3 AND `permission` IN (
            '[permission]:query', '[permission]:create', '[permission]:update', '[permission]:delete')),
    (SELECT 1 - COUNT(DISTINCT `component`) FROM `system_menu`
      WHERE `deleted` = b'0' AND `component` = '[component]'),
    (SELECT 6 - COUNT(*) FROM `system_role_menu` AS `granted`
      JOIN `system_role` AS `role` ON `role`.`id` = `granted`.`role_id`
      WHERE `granted`.`deleted` = b'0' AND `granted`.`menu_id` BETWEEN [menu-id-prefix]1 AND [menu-id-prefix]6
        AND `role`.`code` = 'super_admin' AND `role`.`role_type` = 'super_admin'
        AND `role`.`deleted` = b'0'),
    (SELECT COUNT(*) FROM `system_menu`
      WHERE `id` BETWEEN [menu-id-prefix]1 AND [menu-id-prefix]6 AND `deleted` = b'0'
        AND COALESCE(`menu_type`, '') <> 'super_admin'),
    (SELECT COUNT(*) FROM `system_menu`
      WHERE `id` BETWEEN [menu-id-prefix]1 AND [menu-id-prefix]6 AND `deleted` = b'0'
        AND NOT ((`id` = [menu-id-prefix]1 AND `parent_id` = 0 AND `type` = 1 AND `path` = '[menu-path]')
              OR (`id` = [menu-id-prefix]2 AND `parent_id` = [menu-id-prefix]1 AND `type` = 2 AND `path` = '[entity]')
              OR (`id` BETWEEN [menu-id-prefix]3 AND [menu-id-prefix]6 AND `type` = 3
                  AND `parent_id` = [menu-id-prefix]2)));
DROP TEMPORARY TABLE `bf_[module]_[entity]_assertion`;
