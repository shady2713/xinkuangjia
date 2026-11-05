-- 目的：停用默认 OAuth2 客户端，清理其已签发令牌，并补充安全审计字典项。
-- 适用旧结构：system_oauth2_client 仍存在 client_id='default' 的启用记录，或缺少登录类型 300-302、登录结果 40/50/60/70-74 字典。
-- 受影响对象：system_oauth2_client（默认客户端停用并清空授权类型）、system_oauth2_access_token、system_oauth2_refresh_token（删除 default 客户端令牌）、system_dict_data（新增安全审计字典项）。
-- 执行顺序：在升级到使用内部会话客户端（system-admin）的应用版本前执行一次；不依赖其他迁移。
-- 重放能力：幂等；UPDATE 使用固定 client_id，DELETE 使用固定 client_id，字典 INSERT 使用 NOT EXISTS 去重。
-- 执行前后检查：执行前确认目标库、备份和恢复方式；执行后确认 client_id='default' 的 status=1 且 authorized_grant_types='[]'，并查询字典项是否存在。
-- 恢复方式：从执行前备份恢复；本脚本删除的 default 客户端令牌无法由应用重建，用户需要重新登录。

-- 管理后台登录与刷新改用代码内置的 system-admin 内部会话客户端，不再依赖持久化客户端。
UPDATE `system_oauth2_client`
SET `status` = 1,
    `authorized_grant_types` = '[]',
    `redirect_uris` = '[]',
    `description` = '已停用：管理后台改用内部会话客户端，不再使用默认 OAuth2 客户端'
WHERE `client_id` = 'default';

-- 清理默认客户端已签发的令牌；升级后用户需要重新登录。
DELETE FROM `system_oauth2_access_token` WHERE `client_id` = 'default';
DELETE FROM `system_oauth2_refresh_token` WHERE `client_id` = 'default';

-- 安全审计：新增登录类型 300-302。
INSERT INTO `system_dict_data` (`sort`, `label`, `value`, `dict_type`, `status`, `color_type`, `css_class`,
                                `remark`, `creator`, `create_time`, `updater`, `update_time`, `deleted`)
SELECT 300, '修改密码', '300', 'system_login_type', 0, 'warning', '',
       '安全审计 - 用户自助修改密码', '1', NOW(), '1', NOW(), b'0'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `system_dict_data`
                  WHERE `dict_type` = 'system_login_type' AND `value` = '300');

INSERT INTO `system_dict_data` (`sort`, `label`, `value`, `dict_type`, `status`, `color_type`, `css_class`,
                                `remark`, `creator`, `create_time`, `updater`, `update_time`, `deleted`)
SELECT 301, '重置密码', '301', 'system_login_type', 0, 'warning', '',
       '安全审计 - 短信或管理员重置密码', '1', NOW(), '1', NOW(), b'0'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `system_dict_data`
                  WHERE `dict_type` = 'system_login_type' AND `value` = '301');

INSERT INTO `system_dict_data` (`sort`, `label`, `value`, `dict_type`, `status`, `color_type`, `css_class`,
                                `remark`, `creator`, `create_time`, `updater`, `update_time`, `deleted`)
SELECT 302, '密码传输校验', '302', 'system_login_type', 0, 'danger', '',
       '安全审计 - SM2 解密或防重放校验', '1', NOW(), '1', NOW(), b'0'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `system_dict_data`
                  WHERE `dict_type` = 'system_login_type' AND `value` = '302');

-- 安全审计：新增登录结果 40/50/60/70-74。
INSERT INTO `system_dict_data` (`sort`, `label`, `value`, `dict_type`, `status`, `color_type`, `css_class`,
                                `remark`, `creator`, `create_time`, `updater`, `update_time`, `deleted`)
SELECT 40, '登录尝试被锁定', '40', 'system_login_result', 0, 'danger', '',
       '登录结果 - 连续失败被临时锁定', '1', NOW(), '1', NOW(), b'0'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `system_dict_data`
                  WHERE `dict_type` = 'system_login_result' AND `value` = '40');

INSERT INTO `system_dict_data` (`sort`, `label`, `value`, `dict_type`, `status`, `color_type`, `css_class`,
                                `remark`, `creator`, `create_time`, `updater`, `update_time`, `deleted`)
SELECT 50, '短信验证码错误', '50', 'system_login_result', 0, 'warning', '',
       '登录结果 - 短信验证码错误、过期或已使用', '1', NOW(), '1', NOW(), b'0'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `system_dict_data`
                  WHERE `dict_type` = 'system_login_result' AND `value` = '50');

INSERT INTO `system_dict_data` (`sort`, `label`, `value`, `dict_type`, `status`, `color_type`, `css_class`,
                                `remark`, `creator`, `create_time`, `updater`, `update_time`, `deleted`)
SELECT 60, '手机号未注册', '60', 'system_login_result', 0, 'info', '',
       '登录结果 - 短信登录手机号未注册，仅审计记录', '1', NOW(), '1', NOW(), b'0'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `system_dict_data`
                  WHERE `dict_type` = 'system_login_result' AND `value` = '60');

INSERT INTO `system_dict_data` (`sort`, `label`, `value`, `dict_type`, `status`, `color_type`, `css_class`,
                                `remark`, `creator`, `create_time`, `updater`, `update_time`, `deleted`)
SELECT 70, '密码密文校验失败', '70', 'system_login_result', 0, 'warning', '',
       '登录结果 - SM2 密文、载荷或时间戳无效', '1', NOW(), '1', NOW(), b'0'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `system_dict_data`
                  WHERE `dict_type` = 'system_login_result' AND `value` = '70');

INSERT INTO `system_dict_data` (`sort`, `label`, `value`, `dict_type`, `status`, `color_type`, `css_class`,
                                `remark`, `creator`, `create_time`, `updater`, `update_time`, `deleted`)
SELECT 71, '密码载荷重放', '71', 'system_login_result', 0, 'danger', '',
       '登录结果 - SM2 nonce 重放被拒绝', '1', NOW(), '1', NOW(), b'0'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `system_dict_data`
                  WHERE `dict_type` = 'system_login_result' AND `value` = '71');

INSERT INTO `system_dict_data` (`sort`, `label`, `value`, `dict_type`, `status`, `color_type`, `css_class`,
                                `remark`, `creator`, `create_time`, `updater`, `update_time`, `deleted`)
SELECT 72, '防重放校验不可用', '72', 'system_login_result', 0, 'danger', '',
       '登录结果 - 防重放依赖不可用导致校验失败', '1', NOW(), '1', NOW(), b'0'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `system_dict_data`
                  WHERE `dict_type` = 'system_login_result' AND `value` = '72');

INSERT INTO `system_dict_data` (`sort`, `label`, `value`, `dict_type`, `status`, `color_type`, `css_class`,
                                `remark`, `creator`, `create_time`, `updater`, `update_time`, `deleted`)
SELECT 73, '旧密码校验失败', '73', 'system_login_result', 0, 'warning', '',
       '登录结果 - 自助改密旧密码错误', '1', NOW(), '1', NOW(), b'0'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `system_dict_data`
                  WHERE `dict_type` = 'system_login_result' AND `value` = '73');

INSERT INTO `system_dict_data` (`sort`, `label`, `value`, `dict_type`, `status`, `color_type`, `css_class`,
                                `remark`, `creator`, `create_time`, `updater`, `update_time`, `deleted`)
SELECT 74, '新密码不合规', '74', 'system_login_result', 0, 'warning', '',
       '登录结果 - 新密码不满足复杂度策略', '1', NOW(), '1', NOW(), b'0'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `system_dict_data`
                  WHERE `dict_type` = 'system_login_result' AND `value` = '74');
