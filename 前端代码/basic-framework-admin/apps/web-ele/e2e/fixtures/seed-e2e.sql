-- 前端关键路径 e2e 专用本地测试数据，只能应用到隔离的测试库。
-- 使用前先导入 数据库文件/basic_framework.sql，再执行本文件。
-- 密码为测试账号的 BCrypt 摘要（明文见 e2e/README.md），不是生产凭据。

-- 管理员首次登录改密改为普通登录，并写入测试口令。
UPDATE `system_users`
SET `password` = '$2b$10$lu8UUvPAU7c4lDr.2A.gGO6shr7RD4TCbYC4nQtVjCwlZV/BGJxsq',
    `password_change_required` = 0
WHERE `username` = 'admin' AND `user_type` = 'super_admin';

-- 用户导入使用现有导入能力，导入账号的初始密码必须满足密码策略。
UPDATE `infra_config`
SET `value` = 'Test@123456'
WHERE `config_key` = 'system.user.init-password';

-- 基线种子数据没有文件管理菜单，补一个本地测试菜单及删除权限，供上传下载用例进入页面。
REPLACE INTO `system_menu`
    (`id`, `name`, `permission`, `type`, `menu_type`, `sort`, `parent_id`, `path`, `icon`,
     `component`, `component_name`, `status`, `visible`, `keep_alive`, `always_show`,
     `creator`, `create_time`, `updater`, `update_time`, `deleted`)
VALUES (107, '文件管理', 'infra:file:query', 2, 'super_admin', 3, 2, 'file', 'ep:document',
        'infra/file/index', 'InfraFile', 0, b'1', b'1', b'1', 'admin', NOW(), '', NOW(), b'0'),
       (1070, '文件删除', 'infra:file:delete', 3, 'super_admin', 1, 107, '', '', '', '', 0,
        b'1', b'1', b'1', 'admin', NOW(), '', NOW(), b'0');

-- 授予管理员角色文件菜单权限，保证 infra:file:query 的权限校验可命中。
DELETE FROM `system_role_menu` WHERE `menu_id` IN (107, 1070);
INSERT INTO `system_role_menu`
    (`role_id`, `menu_id`, `creator`, `create_time`, `updater`, `update_time`, `deleted`)
VALUES (1, 107, 'admin', NOW(), '', NOW(), b'0'),
       (1, 1070, 'admin', NOW(), '', NOW(), b'0');

-- 受限角色不关联任何菜单，用于验证无权限入口不可用和后端接口拒绝。
REPLACE INTO `system_role`
    (`id`, `name`, `code`, `role_type`, `sort`, `data_scope`, `data_scope_dept_ids`, `status`,
     `type`, `remark`, `creator`, `create_time`, `updater`, `update_time`, `deleted`)
VALUES (200, 'E2E受限角色', 'e2e_limited', 'super_admin', 10, 1, '', 0, 2,
        '仅用于 e2e 权限用例', 'admin', NOW(), '', NOW(), b'0');

-- 受限账号必须使用新管理平台账号类型，才能通过当前登录入口。
REPLACE INTO `system_users`
    (`id`, `username`, `password`, `password_change_required`, `user_type`, `nickname`, `remark`,
     `dept_id`, `post_ids`, `email`, `mobile`, `sex`, `avatar`, `status`, `login_ip`, `login_date`,
     `creator`, `create_time`, `updater`, `update_time`, `deleted`)
VALUES (200, 'e2elimited', '$2b$10$AwNyM4MS0oiJyL5lQfeSYOGV2rqBuCQNwzqiRT35rEZwx8V0gbUru', 0,
        'super_admin', 'E2E受限用户', '仅用于 e2e 权限用例', 103, '[]',
        'e2e_limited@example.com', '', 0, '', 0, '', NULL, 'admin', NOW(), '', NOW(), b'0');

DELETE FROM `system_user_role` WHERE `user_id` = 200;
INSERT INTO `system_user_role`
    (`user_id`, `role_id`, `creator`, `create_time`, `updater`, `update_time`, `deleted`)
VALUES (200, 200, 'admin', NOW(), '', NOW(), b'0');
