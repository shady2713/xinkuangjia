-- 目的：补齐菜单、OAuth2 客户端、OAuth2 令牌与文件管理四组权限菜单行并授予内置超管，消除管理接口的真实 403。
-- 适用：已登记 202610010000 基线、存在 system_menu/system_role/system_role_menu 的 MySQL 8.x 库；空库新装与旧库升级都执行本文件。
-- 顺序：核对目标库、flyway_schema_history 与备份，完成恢复演练并停写后，由独立 Flyway 运维入口执行。
-- 重放：脚本按保留区间 id 或权限标识判断行是否已存在，命中即跳过该行；重复执行不新增行、不改写已有行。
-- 前检：确认 system_menu.id 落在 90001-90017、且 12 个权限标识均不存在；命中说明业务菜单已占用保留区间，先调查再执行。
-- 后检：12 个权限标识各 1 行且 type=3、menu_type='super_admin'；4 个页面菜单的 component 指向真实页面；17 行全部授予内置超管角色。
-- 恢复：本文件只有 INSERT ... SELECT，成功或失败都不改写历史行；需要回退时按保留区间 id 与权限标识删除本文件插入的 menu/role_menu 行。

-- 故障现象：PermissionServiceImpl 的严格模式要求权限标识能查到菜单行，超管分支同样要求菜单行存在，
-- 且菜单的 menu_type 必须与登录入口平台一致；四个页面的菜单行缺失时，超管访问对应接口一律 403，
-- 而"菜单管理"页面自身的接口也在其中，等于没有可自助恢复的图形入口。
-- 保留区间 90001-90017：框架种子只用到 1-1106，菜单管理界面新建的菜单从 AUTO_INCREMENT 继续增长；
-- 采用高位区间避免升级库中已有业务菜单占用同一 id。插入后 AUTO_INCREMENT 前进到 90018，后续新建菜单不会与本文件的行冲突。
-- 全部行的 create_time/update_time 取固定值，使空库新装与旧库升级得到逐行一致的结果，便于按行核对收敛。

-- 页面菜单与权限行一次插入：id 被占用或权限标识已存在都跳过该行，由后检断言兜底报错。
-- 派生表先给列定类型，避免 UNION 分支的 NULL 与字符串推断出不一致的列类型。
INSERT INTO `system_menu` (`id`, `name`, `permission`, `type`, `menu_type`, `sort`, `parent_id`,
                           `path`, `icon`, `component`, `component_name`, `status`,
                           `visible`, `keep_alive`, `always_show`,
                           `creator`, `create_time`, `updater`, `update_time`, `deleted`)
SELECT `seed`.`id`, `seed`.`name`, `seed`.`permission`, `seed`.`type`, `seed`.`menu_type`,
       `seed`.`sort`, `seed`.`parent_id`, `seed`.`path`, `seed`.`icon`, `seed`.`component`,
       `seed`.`component_name`, 0, b'1', b'1', b'1',
       'framework-202610020006', '2026-10-06 00:00:00', 'framework-202610020006', '2026-10-06 00:00:00', b'0'
FROM (
    SELECT 90001 AS `id`, '菜单管理' AS `name`, '' AS `permission`, 2 AS `type`,
           'super_admin' AS `menu_type`, 11 AS `sort`, 1 AS `parent_id`, 'menu' AS `path`,
           'ep:menu' AS `icon`, 'system/menu/index' AS `component`, 'SystemMenu' AS `component_name`
    UNION ALL SELECT 90002, 'OAuth2 管理', '', 1, 'super_admin', 12, 1, 'oauth2', 'ep:key', NULL, NULL
    UNION ALL SELECT 90003, 'OAuth2 客户端', '', 2, 'super_admin', 1, 90002, 'client', 'ep:connection', 'system/oauth2/client/index', 'SystemOauth2Client'
    UNION ALL SELECT 90004, 'OAuth2 令牌', '', 2, 'super_admin', 2, 90002, 'token', 'ep:ticket', 'system/oauth2/token/index', 'SystemOauth2Token'
    UNION ALL SELECT 90005, '文件管理', '', 2, 'super_admin', 9, 2, 'file', 'ep:folder', 'infra/file/index', 'InfraFile'
    UNION ALL SELECT 90006, '菜单查询', 'system:menu:query', 3, 'super_admin', 1, 90001, '', '', '', NULL
    UNION ALL SELECT 90007, '菜单新增', 'system:menu:create', 3, 'super_admin', 2, 90001, '', '', '', NULL
    UNION ALL SELECT 90008, '菜单修改', 'system:menu:update', 3, 'super_admin', 3, 90001, '', '', '', NULL
    UNION ALL SELECT 90009, '菜单删除', 'system:menu:delete', 3, 'super_admin', 4, 90001, '', '', '', NULL
    UNION ALL SELECT 90010, 'OAuth2 客户端查询', 'system:oauth2-client:query', 3, 'super_admin', 1, 90003, '', '', '', NULL
    UNION ALL SELECT 90011, 'OAuth2 客户端新增', 'system:oauth2-client:create', 3, 'super_admin', 2, 90003, '', '', '', NULL
    UNION ALL SELECT 90012, 'OAuth2 客户端修改', 'system:oauth2-client:update', 3, 'super_admin', 3, 90003, '', '', '', NULL
    UNION ALL SELECT 90013, 'OAuth2 客户端删除', 'system:oauth2-client:delete', 3, 'super_admin', 4, 90003, '', '', '', NULL
    UNION ALL SELECT 90014, 'OAuth2 令牌查询', 'system:oauth2-token:page', 3, 'super_admin', 1, 90004, '', '', '', NULL
    UNION ALL SELECT 90015, 'OAuth2 令牌删除', 'system:oauth2-token:delete', 3, 'super_admin', 2, 90004, '', '', '', NULL
    UNION ALL SELECT 90016, '文件查询', 'infra:file:query', 3, 'super_admin', 1, 90005, '', '', '', NULL
    UNION ALL SELECT 90017, '文件删除', 'infra:file:delete', 3, 'super_admin', 2, 90005, '', '', '', NULL
) AS `seed`
LEFT JOIN (
    SELECT `id`, `permission` FROM `system_menu`
) AS `existing`
    ON `existing`.`id` = `seed`.`id`
    OR (`seed`.`permission` <> '' AND `existing`.`permission` = `seed`.`permission`)
WHERE `existing`.`id` IS NULL;

-- 授予内置超管角色：升级库的角色编号不一定仍是 1，因此按 code 与 role_type 定位，并排除已存在的有效授权。
-- ORDER BY 固定插入顺序，使空库新装与旧库升级的自增编号一致，便于逐行核对。
INSERT INTO `system_role_menu` (`role_id`, `menu_id`, `creator`, `create_time`, `updater`, `update_time`, `deleted`)
SELECT `role`.`id`, `menu`.`id`, 'framework-202610020006', '2026-10-06 00:00:00',
       'framework-202610020006', '2026-10-06 00:00:00', b'0'
FROM (
    SELECT `id` FROM `system_menu` WHERE `id` BETWEEN 90001 AND 90017
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

-- 后检：6 项缺口计数必须全为 0，否则 CHECK 让迁移失败，避免"插了一半也算成功"。
-- 检查表只在当前连接可见，成功即删除；异常由迁移连接关闭回收，不留下永久对象。
CREATE TEMPORARY TABLE `bf_management_menu_assertion` (
    `missing_permissions` INT NOT NULL,
    `missing_menus` INT NOT NULL,
    `missing_grants` INT NOT NULL,
    `missing_rows` INT NOT NULL,
    `wrong_platform` INT NOT NULL,
    `wrong_parent` INT NOT NULL,
    CHECK (`missing_permissions` = 0 AND `missing_menus` = 0 AND `missing_grants` = 0
           AND `missing_rows` = 0 AND `wrong_platform` = 0 AND `wrong_parent` = 0)
);
INSERT INTO `bf_management_menu_assertion`
SELECT
    (SELECT 12 - COUNT(DISTINCT `permission`) FROM `system_menu`
      WHERE `deleted` = b'0' AND `type` = 3 AND `permission` IN (
            'system:menu:query', 'system:menu:create', 'system:menu:update', 'system:menu:delete',
            'system:oauth2-client:query', 'system:oauth2-client:create',
            'system:oauth2-client:update', 'system:oauth2-client:delete',
            'system:oauth2-token:page', 'system:oauth2-token:delete',
            'infra:file:query', 'infra:file:delete')),
    (SELECT 4 - COUNT(DISTINCT `component`) FROM `system_menu`
      WHERE `deleted` = b'0' AND `component` IN (
            'system/menu/index', 'system/oauth2/client/index',
            'system/oauth2/token/index', 'infra/file/index')),
    (SELECT 17 - COUNT(*) FROM `system_role_menu` AS `granted`
      JOIN `system_role` AS `role` ON `role`.`id` = `granted`.`role_id`
      WHERE `granted`.`deleted` = b'0' AND `granted`.`menu_id` BETWEEN 90001 AND 90017
        AND `role`.`code` = 'super_admin' AND `role`.`role_type` = 'super_admin'
        AND `role`.`deleted` = b'0'),
    (SELECT 17 - COUNT(*) FROM `system_menu` WHERE `id` BETWEEN 90001 AND 90017 AND `deleted` = b'0'),
    (SELECT COUNT(*) FROM `system_menu`
      WHERE `id` BETWEEN 90001 AND 90017 AND `deleted` = b'0'
        AND COALESCE(`menu_type`, '') <> 'super_admin'),
    (SELECT COUNT(*) FROM `system_menu`
      WHERE `id` BETWEEN 90001 AND 90017 AND `deleted` = b'0'
        AND NOT ((`id` = 90001 AND `parent_id` = 1 AND `type` = 2 AND `path` = 'menu')
              OR (`id` = 90002 AND `parent_id` = 1 AND `type` = 1 AND `path` = 'oauth2')
              OR (`id` = 90003 AND `parent_id` = 90002 AND `type` = 2 AND `path` = 'client')
              OR (`id` = 90004 AND `parent_id` = 90002 AND `type` = 2 AND `path` = 'token')
              OR (`id` = 90005 AND `parent_id` = 2 AND `type` = 2 AND `path` = 'file')
              OR (`id` BETWEEN 90006 AND 90017 AND `type` = 3)));
DROP TEMPORARY TABLE `bf_management_menu_assertion`;
