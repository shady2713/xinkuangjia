-- MySQL 8.x 空库快照；只用于已确认的独立空库，禁止覆盖已有业务库。
-- 无账号、密码哈希、Token 或演示组织；初始管理员使用受控 bootstrap 命令创建。
-- 正式安装与升级使用 scripts/database/pom.xml 中固定版本的显式 Flyway 入口。
-- 本快照不携带迁移历史；新装优先执行版本化迁移，不能将快照导入当作升级。

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for infra_api_access_log
-- ----------------------------
CREATE TABLE `infra_api_access_log`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '日志主键',
  `trace_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '链路追踪编号',
  `user_id` bigint NOT NULL DEFAULT 0 COMMENT '用户编号',
  `user_type` tinyint NOT NULL DEFAULT 0 COMMENT '用户类型',
  `application_name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '应用名',
  `request_method` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '请求方法名',
  `request_url` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '请求地址',
  `request_params` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT '请求参数',
  `response_body` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT '响应结果',
  `user_ip` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户 IP',
  `user_agent` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '浏览器 UA',
  `operate_module` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '操作模块',
  `operate_name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '操作名',
  `operate_type` tinyint NULL DEFAULT 0 COMMENT '操作分类',
  `begin_time` datetime NOT NULL COMMENT '开始请求时间',
  `end_time` datetime NOT NULL COMMENT '结束请求时间',
  `duration` int NOT NULL COMMENT '执行时长',
  `result_code` int NOT NULL DEFAULT 0 COMMENT '结果码',
  `result_msg` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '结果提示',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_create_time`(`create_time` ASC) USING BTREE,
  INDEX `idx_user_id`(`user_id` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'API 访问日志表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of infra_api_access_log
-- ----------------------------

-- ----------------------------
-- Table structure for infra_api_error_log
-- ----------------------------
CREATE TABLE `infra_api_error_log`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '编号',
  `trace_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '链路追踪编号',
  `user_id` bigint NOT NULL DEFAULT 0 COMMENT '用户编号',
  `user_type` tinyint NOT NULL DEFAULT 0 COMMENT '用户类型',
  `application_name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '应用名',
  `request_method` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '请求方法名',
  `request_url` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '请求地址',
  `request_params` varchar(8000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '请求参数',
  `user_ip` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户 IP',
  `user_agent` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '浏览器 UA',
  `exception_time` datetime NOT NULL COMMENT '异常发生时间',
  `exception_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '异常名',
  `exception_message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '异常导致的消息',
  `exception_root_cause_message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '异常导致的根消息',
  `exception_stack_trace` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '异常的栈轨迹',
  `exception_class_name` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '异常发生的类全名',
  `exception_file_name` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '异常发生的类文件',
  `exception_method_name` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '异常发生的方法名',
  `exception_line_number` int NOT NULL COMMENT '异常发生的方法所在行',
  `process_status` tinyint NOT NULL COMMENT '处理状态',
  `process_time` datetime NULL DEFAULT NULL COMMENT '处理时间',
  `process_user_id` bigint NULL DEFAULT 0 COMMENT '处理用户编号',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_process_status`(`process_status` ASC) USING BTREE,
  INDEX `idx_create_time`(`create_time` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '系统异常日志' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of infra_api_error_log
-- ----------------------------

-- ----------------------------
-- Table structure for infra_config
-- ----------------------------
CREATE TABLE `infra_config`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '参数主键',
  `category` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '参数分组',
  `type` tinyint NOT NULL COMMENT '参数类型',
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '参数名称',
  `config_key` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '参数键名',
  `value` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '参数键值',
  `visible` bit(1) NOT NULL COMMENT '是否可见',
  `remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '备注',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_config_key`(`config_key` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '参数配置表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of infra_config
-- ----------------------------
INSERT INTO `infra_config` VALUES (2, 'biz', 1, '用户管理-账号初始密码', 'system.user.init-password', '', b'0', '仅用于受控用户导入；无预设初始口令', 'admin', '2021-01-05 17:03:48', '1', '2026-04-11 12:40:17', b'0');
INSERT INTO `infra_config` VALUES (3, '用户管理-账号初始密码', 2, '用户管理-注册开关', 'system.user.register-enabled', 'false', b'0', '', '1', '2025-04-26 17:23:41', '1', '2025-04-26 17:23:41', b'0');

-- ----------------------------
-- Table structure for infra_file
-- ----------------------------
CREATE TABLE `infra_file`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '文件编号',
  `name` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '文件名',
  `path` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '文件路径',
  `url` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '文件 URL',
  `type` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '文件类型',
  `size` bigint NOT NULL COMMENT '文件大小',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_path`(`path` ASC) USING BTREE,
  INDEX `idx_type`(`type` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '文件表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of infra_file
-- ----------------------------

-- 仅空库初始化：上传预约与预算结构；已有库使用版本化迁移。
CREATE TABLE `infra_file_upload` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '上传预约编号',
  `owner_key` varchar(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '可信身份域与用户编号',
  `path` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT '唯一且永不复用的最终对象键',
  `staging_path` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '浏览器直传暂存对象键',
  `name` varchar(256) NOT NULL COMMENT '规范化原文件名',
  `size` bigint NOT NULL COMMENT '预约精确字节数',
  `status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'PENDING待完成 COMPLETE已登记 CANCELLED已取消',
  `file_id` bigint DEFAULT NULL COMMENT '完成登记的文件编号',
  `expires_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '预约截止时间UTC',
  `next_cleanup_at` datetime DEFAULT NULL COMMENT '下一次补偿核对时间UTC，空表示无需清理',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_path` (`path`),
  KEY `idx_cleanup` (`next_cleanup_at`, `id`),
  CONSTRAINT `ck_upload_size` CHECK (`size` > 0),
  CONSTRAINT `ck_upload_status` CHECK (`status` IN ('PENDING', 'COMPLETE', 'CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='上传预约及持久化补偿记录';

CREATE TABLE `infra_file_upload_quota` (
  `owner_key` varchar(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '可信身份域与用户编号',
  `quota_date` date NOT NULL COMMENT '预算UTC日期',
  `reserved_bytes` bigint NOT NULL DEFAULT 0 COMMENT '累计预约字节数，失败不退款',
  `requests` int NOT NULL DEFAULT 0 COMMENT '累计预约次数，失败不退款',
  PRIMARY KEY (`owner_key`, `quota_date`),
  CONSTRAINT `ck_upload_quota` CHECK (`reserved_bytes` >= 0 AND `requests` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='每身份每日上传预约预算';

-- ----------------------------
-- Table structure for infra_job
-- ----------------------------
CREATE TABLE `infra_job`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '任务编号',
  `name` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '任务名称',
  `status` tinyint NOT NULL COMMENT '任务状态',
  `handler_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '处理器的名字',
  `handler_param` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '处理器的参数',
  `cron_expression` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'CRON 表达式',
  `retry_count` int NOT NULL DEFAULT 0 COMMENT '重试次数',
  `retry_interval` int NOT NULL DEFAULT 0 COMMENT '重试间隔',
  `monitor_timeout` int NOT NULL DEFAULT 0 COMMENT '监控超时时间',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_status`(`status` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '定时任务表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of infra_job
-- ----------------------------
INSERT INTO `infra_job` VALUES (25, '访问日志清理 Job', 2, 'accessLogCleanJob', '', '0 0 0 * * ?', 3, 0, 0, '1', '2023-10-03 10:59:41', '1', '2023-10-03 11:01:10', b'0');
INSERT INTO `infra_job` VALUES (26, '错误日志清理 Job', 2, 'errorLogCleanJob', '', '0 0 0 * * ?', 3, 0, 0, '1', '2023-10-03 11:00:43', '1', '2023-10-03 11:01:12', b'0');
INSERT INTO `infra_job` VALUES (27, '任务日志清理 Job', 2, 'jobLogCleanJob', '', '0 0 0 * * ?', 3, 0, 0, '1', '2023-10-03 11:01:33', '1', '2024-09-12 13:40:34', b'0');

-- ----------------------------
-- Table structure for infra_job_log
-- ----------------------------
CREATE TABLE `infra_job_log`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '日志编号',
  `job_id` bigint NOT NULL COMMENT '任务编号',
  `handler_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '处理器的名字',
  `handler_param` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '处理器的参数',
  `execute_index` tinyint NOT NULL DEFAULT 1 COMMENT '第几次执行',
  `begin_time` datetime NOT NULL COMMENT '开始执行时间',
  `end_time` datetime NULL DEFAULT NULL COMMENT '结束执行时间',
  `duration` int NULL DEFAULT NULL COMMENT '执行时长',
  `status` tinyint NOT NULL COMMENT '任务状态',
  `result` varchar(4000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '结果数据',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_job_id`(`job_id` ASC) USING BTREE,
  INDEX `idx_status`(`status` ASC) USING BTREE,
  INDEX `idx_create_time`(`create_time` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '定时任务日志表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of infra_job_log
-- ----------------------------

-- ----------------------------
-- Table structure for system_auto_login_ticket
-- ----------------------------
CREATE TABLE `system_auto_login_ticket`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '编号',
  `ticket` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '固定分享码，对应链接中的 ticket 参数',
  `username` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '绑定的后台用户账号',
  `status` tinyint NOT NULL DEFAULT 0 COMMENT '状态（0正常 1停用）',
  `remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '备注',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_auto_login_ticket`(`ticket` ASC) USING BTREE,
  INDEX `idx_auto_login_username`(`username` ASC) USING BTREE,
  INDEX `idx_auto_login_status`(`status` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '自动登录固定分享码表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of system_auto_login_ticket
-- ----------------------------

-- ----------------------------
-- Table structure for system_dept
-- ----------------------------
CREATE TABLE `system_dept`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '部门id',
  `name` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '部门名称',
  `parent_id` bigint NOT NULL DEFAULT 0 COMMENT '父部门id',
  `role_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '后台类型',
  `sort` int NOT NULL DEFAULT 0 COMMENT '显示顺序',
  `leader_user_id` bigint NULL DEFAULT NULL COMMENT '负责人',
  `phone` varchar(11) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '联系电话',
  `email` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '邮箱',
  `status` tinyint NOT NULL COMMENT '部门状态（0正常 1停用）',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_parent_id`(`parent_id` ASC) USING BTREE,
  INDEX `idx_status`(`status` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '部门表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of system_dept
-- ----------------------------

-- ----------------------------
-- Table structure for system_dict_data
-- ----------------------------
CREATE TABLE `system_dict_data`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '字典编码',
  `sort` int NOT NULL DEFAULT 0 COMMENT '字典排序',
  `label` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '字典标签',
  `value` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '字典键值',
  `dict_type` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '字典类型',
  `status` tinyint NOT NULL DEFAULT 0 COMMENT '状态（0正常 1停用）',
  `color_type` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '颜色类型',
  `css_class` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT 'css 样式',
  `remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '备注',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_dict_type`(`dict_type` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '字典数据表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of system_dict_data
-- ----------------------------
INSERT INTO `system_dict_data` VALUES (1, 1, '男', '1', 'system_user_sex', 0, 'default', 'A', '性别男', 'admin', '2021-01-05 17:03:48', '1', '2022-03-29 00:14:39', b'0');
INSERT INTO `system_dict_data` VALUES (2, 2, '女', '2', 'system_user_sex', 0, 'success', '', '性别女', 'admin', '2021-01-05 17:03:48', '1', '2023-11-15 23:30:37', b'0');
INSERT INTO `system_dict_data` VALUES (8, 1, '正常', '1', 'infra_job_status', 0, 'success', '', '正常状态', 'admin', '2021-01-05 17:03:48', '1', '2022-02-16 19:33:38', b'0');
INSERT INTO `system_dict_data` VALUES (9, 2, '暂停', '2', 'infra_job_status', 0, 'danger', '', '停用状态', 'admin', '2021-01-05 17:03:48', '1', '2022-02-16 19:33:45', b'0');
INSERT INTO `system_dict_data` VALUES (12, 1, '系统内置', '1', 'infra_config_type', 0, 'danger', '', '参数类型 - 系统内置', 'admin', '2021-01-05 17:03:48', '1', '2022-02-16 19:06:02', b'0');
INSERT INTO `system_dict_data` VALUES (13, 2, '自定义', '2', 'infra_config_type', 0, 'primary', '', '参数类型 - 自定义', 'admin', '2021-01-05 17:03:48', '1', '2022-02-16 19:06:07', b'0');
INSERT INTO `system_dict_data` VALUES (16, 0, '其它', '0', 'infra_operate_type', 0, 'default', '', '其它操作', 'admin', '2021-01-05 17:03:48', '1', '2024-03-14 12:44:19', b'0');
INSERT INTO `system_dict_data` VALUES (17, 1, '查询', '1', 'infra_operate_type', 0, 'info', '', '查询操作', 'admin', '2021-01-05 17:03:48', '1', '2024-03-14 12:44:20', b'0');
INSERT INTO `system_dict_data` VALUES (18, 2, '新增', '2', 'infra_operate_type', 0, 'primary', '', '新增操作', 'admin', '2021-01-05 17:03:48', '1', '2024-03-14 12:44:21', b'0');
INSERT INTO `system_dict_data` VALUES (19, 3, '修改', '3', 'infra_operate_type', 0, 'warning', '', '修改操作', 'admin', '2021-01-05 17:03:48', '1', '2024-03-14 12:44:22', b'0');
INSERT INTO `system_dict_data` VALUES (20, 4, '删除', '4', 'infra_operate_type', 0, 'danger', '', '删除操作', 'admin', '2021-01-05 17:03:48', '1', '2024-03-14 12:44:23', b'0');
INSERT INTO `system_dict_data` VALUES (22, 5, '导出', '5', 'infra_operate_type', 0, 'default', '', '导出操作', 'admin', '2021-01-05 17:03:48', '1', '2024-03-14 12:44:24', b'0');
INSERT INTO `system_dict_data` VALUES (23, 6, '导入', '6', 'infra_operate_type', 0, 'default', '', '导入操作', 'admin', '2021-01-05 17:03:48', '1', '2024-03-14 12:44:25', b'0');
INSERT INTO `system_dict_data` VALUES (27, 1, '开启', '0', 'common_status', 0, 'primary', '', '开启状态', 'admin', '2021-01-05 17:03:48', '1', '2022-02-16 08:00:39', b'0');
INSERT INTO `system_dict_data` VALUES (28, 2, '关闭', '1', 'common_status', 0, 'info', '', '关闭状态', 'admin', '2021-01-05 17:03:48', '1', '2022-02-16 08:00:44', b'0');
INSERT INTO `system_dict_data` VALUES (29, 1, '目录', '1', 'system_menu_type', 0, '', '', '目录', 'admin', '2021-01-05 17:03:48', '', '2022-02-01 16:43:45', b'0');
INSERT INTO `system_dict_data` VALUES (30, 2, '菜单', '2', 'system_menu_type', 0, '', '', '菜单', 'admin', '2021-01-05 17:03:48', '', '2022-02-01 16:43:41', b'0');
INSERT INTO `system_dict_data` VALUES (31, 3, '按钮', '3', 'system_menu_type', 0, '', '', '按钮', 'admin', '2021-01-05 17:03:48', '', '2022-02-01 16:43:39', b'0');
INSERT INTO `system_dict_data` VALUES (32, 1, '内置', '1', 'system_role_type', 0, 'danger', '', '内置角色', 'admin', '2021-01-05 17:03:48', '1', '2022-02-16 13:02:08', b'0');
INSERT INTO `system_dict_data` VALUES (33, 2, '自定义', '2', 'system_role_type', 0, 'primary', '', '自定义角色', 'admin', '2021-01-05 17:03:48', '1', '2022-02-16 13:02:12', b'0');
INSERT INTO `system_dict_data` VALUES (34, 1, '全部数据权限', '1', 'system_data_scope', 0, '', '', '全部数据权限', 'admin', '2021-01-05 17:03:48', '', '2022-02-01 16:47:17', b'0');
INSERT INTO `system_dict_data` VALUES (35, 2, '指定部门数据权限', '2', 'system_data_scope', 0, '', '', '指定部门数据权限', 'admin', '2021-01-05 17:03:48', '', '2022-02-01 16:47:18', b'0');
INSERT INTO `system_dict_data` VALUES (36, 3, '本部门数据权限', '3', 'system_data_scope', 0, '', '', '本部门数据权限', 'admin', '2021-01-05 17:03:48', '', '2022-02-01 16:47:16', b'0');
INSERT INTO `system_dict_data` VALUES (37, 4, '本部门及以下数据权限', '4', 'system_data_scope', 0, '', '', '本部门及以下数据权限', 'admin', '2021-01-05 17:03:48', '', '2022-02-01 16:47:21', b'0');
INSERT INTO `system_dict_data` VALUES (38, 5, '仅本人数据权限', '5', 'system_data_scope', 0, '', '', '仅本人数据权限', 'admin', '2021-01-05 17:03:48', '', '2022-02-01 16:47:23', b'0');
INSERT INTO `system_dict_data` VALUES (39, 0, '成功', '0', 'system_login_result', 0, 'success', '', '登陆结果 - 成功', '', '2021-01-18 06:17:36', '1', '2022-02-16 13:23:49', b'0');
INSERT INTO `system_dict_data` VALUES (40, 10, '账号或密码不正确', '10', 'system_login_result', 0, 'primary', '', '登陆结果 - 账号或密码不正确', '', '2021-01-18 06:17:54', '1', '2022-02-16 13:24:27', b'0');
INSERT INTO `system_dict_data` VALUES (41, 20, '用户被禁用', '20', 'system_login_result', 0, 'warning', '', '登陆结果 - 用户被禁用', '', '2021-01-18 06:17:54', '1', '2022-02-16 13:23:57', b'0');
INSERT INTO `system_dict_data` VALUES (42, 30, '验证码不存在', '30', 'system_login_result', 0, 'info', '', '登陆结果 - 验证码不存在', '', '2021-01-18 06:17:54', '1', '2022-02-16 13:24:07', b'0');
INSERT INTO `system_dict_data` VALUES (43, 31, '验证码不正确', '31', 'system_login_result', 0, 'info', '', '登陆结果 - 验证码不正确', '', '2021-01-18 06:17:54', '1', '2022-02-16 13:24:11', b'0');
INSERT INTO `system_dict_data` VALUES (44, 100, '未知异常', '100', 'system_login_result', 0, 'danger', '', '登陆结果 - 未知异常', '', '2021-01-18 06:17:54', '1', '2022-02-16 13:24:23', b'0');
INSERT INTO `system_dict_data` VALUES (45, 1, '是', 'true', 'infra_boolean_string', 0, 'danger', '', 'Boolean 是否类型 - 是', '', '2021-01-19 03:20:55', '1', '2022-03-15 23:01:45', b'0');
INSERT INTO `system_dict_data` VALUES (46, 1, '否', 'false', 'infra_boolean_string', 0, 'info', '', 'Boolean 是否类型 - 否', '', '2021-01-19 03:20:55', '1', '2022-03-15 23:09:45', b'0');
INSERT INTO `system_dict_data` VALUES (53, 0, '初始化中', '0', 'infra_job_status', 0, 'primary', '', NULL, '', '2021-02-07 07:46:49', '1', '2022-02-16 19:33:29', b'0');
INSERT INTO `system_dict_data` VALUES (57, 0, '运行中', '0', 'infra_job_log_status', 0, 'primary', '', 'RUNNING', '', '2021-02-08 10:04:24', '1', '2022-02-16 19:07:48', b'0');
INSERT INTO `system_dict_data` VALUES (58, 1, '成功', '1', 'infra_job_log_status', 0, 'success', '', NULL, '', '2021-02-08 10:06:57', '1', '2022-02-16 19:07:52', b'0');
INSERT INTO `system_dict_data` VALUES (59, 2, '失败', '2', 'infra_job_log_status', 0, 'warning', '', '失败', '', '2021-02-08 10:07:38', '1', '2022-02-16 19:07:56', b'0');
INSERT INTO `system_dict_data` VALUES (60, 1, '会员', '1', 'user_type', 0, 'primary', '', NULL, '', '2021-02-26 00:16:27', '1', '2022-02-16 10:22:19', b'0');
INSERT INTO `system_dict_data` VALUES (61, 2, '管理员', '2', 'user_type', 0, 'success', '', NULL, '', '2021-02-26 00:16:34', '1', '2025-04-06 18:37:43', b'0');
INSERT INTO `system_dict_data` VALUES (62, 0, '未处理', '0', 'infra_api_error_log_process_status', 0, 'primary', '', NULL, '', '2021-02-26 07:07:19', '1', '2022-02-16 20:14:17', b'0');
INSERT INTO `system_dict_data` VALUES (63, 1, '已处理', '1', 'infra_api_error_log_process_status', 0, 'success', '', NULL, '', '2021-02-26 07:07:26', '1', '2022-02-16 20:14:08', b'0');
INSERT INTO `system_dict_data` VALUES (64, 2, '已忽略', '2', 'infra_api_error_log_process_status', 0, 'danger', '', NULL, '', '2021-02-26 07:07:34', '1', '2022-02-16 20:14:14', b'0');
INSERT INTO `system_dict_data` VALUES (66, 1, '阿里云', 'ALIYUN', 'system_sms_channel_code', 0, 'primary', '', NULL, '1', '2021-04-05 01:05:26', '1', '2024-07-22 22:23:25', b'0');
INSERT INTO `system_dict_data` VALUES (67, 1, '验证码', '1', 'system_sms_template_type', 0, 'warning', '', NULL, '1', '2021-04-05 21:50:57', '1', '2022-02-16 12:48:30', b'0');
INSERT INTO `system_dict_data` VALUES (68, 2, '通知', '2', 'system_sms_template_type', 0, 'primary', '', NULL, '1', '2021-04-05 21:51:08', '1', '2022-02-16 12:48:27', b'0');
INSERT INTO `system_dict_data` VALUES (69, 0, '营销', '3', 'system_sms_template_type', 0, 'danger', '', NULL, '1', '2021-04-05 21:51:15', '1', '2022-02-16 12:48:22', b'0');
INSERT INTO `system_dict_data` VALUES (70, 0, '初始化', '0', 'system_sms_send_status', 0, 'primary', '', NULL, '1', '2021-04-11 20:18:33', '1', '2022-02-16 10:26:07', b'0');
INSERT INTO `system_dict_data` VALUES (71, 1, '发送成功', '10', 'system_sms_send_status', 0, 'success', '', NULL, '1', '2021-04-11 20:18:43', '1', '2022-02-16 10:25:56', b'0');
INSERT INTO `system_dict_data` VALUES (72, 2, '发送失败', '20', 'system_sms_send_status', 0, 'danger', '', NULL, '1', '2021-04-11 20:18:49', '1', '2022-02-16 10:26:03', b'0');
INSERT INTO `system_dict_data` VALUES (73, 3, '不发送', '30', 'system_sms_send_status', 0, 'info', '', NULL, '1', '2021-04-11 20:19:44', '1', '2022-02-16 10:26:10', b'0');
INSERT INTO `system_dict_data` VALUES (74, 0, '等待结果', '0', 'system_sms_receive_status', 0, 'primary', '', NULL, '1', '2021-04-11 20:27:43', '1', '2022-02-16 10:28:24', b'0');
INSERT INTO `system_dict_data` VALUES (75, 1, '接收成功', '10', 'system_sms_receive_status', 0, 'success', '', NULL, '1', '2021-04-11 20:29:25', '1', '2022-02-16 10:28:28', b'0');
INSERT INTO `system_dict_data` VALUES (76, 2, '接收失败', '20', 'system_sms_receive_status', 0, 'danger', '', NULL, '1', '2021-04-11 20:29:31', '1', '2022-02-16 10:28:32', b'0');
INSERT INTO `system_dict_data` VALUES (80, 100, '账号登录', '100', 'system_login_type', 0, 'primary', '', '账号登录', '1', '2021-10-06 00:52:02', '1', '2022-02-16 13:11:34', b'0');
INSERT INTO `system_dict_data` VALUES (81, 101, '社交登录', '101', 'system_login_type', 0, 'info', '', '社交登录', '1', '2021-10-06 00:52:17', '1', '2022-02-16 13:11:40', b'0');
INSERT INTO `system_dict_data` VALUES (83, 200, '主动登出', '200', 'system_login_type', 0, 'primary', '', '主动登出', '1', '2021-10-06 00:52:58', '1', '2022-02-16 13:11:49', b'0');
INSERT INTO `system_dict_data` VALUES (85, 202, '强制登出', '202', 'system_login_type', 0, 'danger', '', '强制退出', '1', '2021-10-06 00:53:41', '1', '2022-02-16 13:11:57', b'0');
INSERT INTO `system_dict_data` VALUES (1154, 20, 'S3 对象存储', '20', 'infra_file_storage', 0, 'default', '', NULL, '1', '2022-03-15 00:26:31', '1', '2022-03-15 00:26:45', b'0');
INSERT INTO `system_dict_data` VALUES (1155, 103, '短信登录', '103', 'system_login_type', 0, 'default', '', NULL, '1', '2022-05-09 23:57:58', '1', '2022-05-09 23:58:09', b'0');
INSERT INTO `system_dict_data` VALUES (1156, 1, 'password', 'password', 'system_oauth2_grant_type', 0, 'default', '', '密码模式', '1', '2022-05-12 00:22:05', '1', '2022-05-11 16:26:01', b'0');
INSERT INTO `system_dict_data` VALUES (1157, 2, 'authorization_code', 'authorization_code', 'system_oauth2_grant_type', 0, 'primary', '', '授权码模式', '1', '2022-05-12 00:22:59', '1', '2022-05-11 16:26:02', b'0');
INSERT INTO `system_dict_data` VALUES (1158, 3, 'implicit', 'implicit', 'system_oauth2_grant_type', 0, 'success', '', '简化模式', '1', '2022-05-12 00:23:40', '1', '2022-05-11 16:26:05', b'0');
INSERT INTO `system_dict_data` VALUES (1159, 4, 'client_credentials', 'client_credentials', 'system_oauth2_grant_type', 0, 'default', '', '客户端模式', '1', '2022-05-12 00:23:51', '1', '2022-05-11 16:26:08', b'0');
INSERT INTO `system_dict_data` VALUES (1160, 5, 'refresh_token', 'refresh_token', 'system_oauth2_grant_type', 0, 'info', '', '刷新模式', '1', '2022-05-12 00:24:02', '1', '2022-05-11 16:26:11', b'0');
INSERT INTO `system_dict_data` VALUES (1194, 10, '微信小程序', '10', 'terminal', 0, 'default', '', '终端 - 微信小程序', '1', '2022-12-10 10:51:11', '1', '2022-12-10 10:51:57', b'0');
INSERT INTO `system_dict_data` VALUES (1195, 20, 'H5 网页', '20', 'terminal', 0, 'default', '', '终端 - H5 网页', '1', '2022-12-10 10:51:30', '1', '2022-12-10 10:51:59', b'0');
INSERT INTO `system_dict_data` VALUES (1196, 11, '微信公众号', '11', 'terminal', 0, 'default', '', '终端 - 微信公众号', '1', '2022-12-10 10:54:16', '1', '2022-12-10 10:52:01', b'0');
INSERT INTO `system_dict_data` VALUES (1197, 31, '苹果 App', '31', 'terminal', 0, 'default', '', '终端 - 苹果 App', '1', '2022-12-10 10:54:42', '1', '2022-12-10 10:52:18', b'0');
INSERT INTO `system_dict_data` VALUES (1198, 32, '安卓 App', '32', 'terminal', 0, 'default', '', '终端 - 安卓 App', '1', '2022-12-10 10:55:02', '1', '2022-12-10 10:59:17', b'0');
INSERT INTO `system_dict_data` VALUES (1223, 0, '初始化', '0', 'system_mail_send_status', 0, 'primary', '', '邮件发送状态 - 初始化\n', '1', '2023-01-26 09:53:49', '1', '2023-01-26 16:36:14', b'0');
INSERT INTO `system_dict_data` VALUES (1224, 10, '发送成功', '10', 'system_mail_send_status', 0, 'success', '', '邮件发送状态 - 发送成功', '1', '2023-01-26 09:54:28', '1', '2023-01-26 16:36:22', b'0');
INSERT INTO `system_dict_data` VALUES (1225, 20, '发送失败', '20', 'system_mail_send_status', 0, 'danger', '', '邮件发送状态 - 发送失败', '1', '2023-01-26 09:54:50', '1', '2023-01-26 16:36:26', b'0');
INSERT INTO `system_dict_data` VALUES (1226, 30, '不发送', '30', 'system_mail_send_status', 0, 'info', '', '邮件发送状态 -  不发送', '1', '2023-01-26 09:55:06', '1', '2023-01-26 16:36:36', b'0');
INSERT INTO `system_dict_data` VALUES (1529, 1, '天', '1', 'date_interval', 0, '', '', '', '1', '2024-03-29 22:50:26', '1', '2024-03-29 22:50:26', b'0');
INSERT INTO `system_dict_data` VALUES (1530, 2, '周', '2', 'date_interval', 0, '', '', '', '1', '2024-03-29 22:50:36', '1', '2024-03-29 22:50:36', b'0');
INSERT INTO `system_dict_data` VALUES (1531, 3, '月', '3', 'date_interval', 0, '', '', '', '1', '2024-03-29 22:50:46', '1', '2024-03-29 22:50:54', b'0');
INSERT INTO `system_dict_data` VALUES (1532, 4, '季度', '4', 'date_interval', 0, '', '', '', '1', '2024-03-29 22:51:01', '1', '2024-03-29 22:51:01', b'0');
INSERT INTO `system_dict_data` VALUES (1533, 5, '年', '5', 'date_interval', 0, '', '', '', '1', '2024-03-29 22:51:07', '1', '2024-03-29 22:51:07', b'0');
INSERT INTO `system_dict_data` VALUES (1586, 2, '腾讯云', 'TENCENT', 'system_sms_channel_code', 0, '', '', '', '1', '2024-07-22 22:23:16', '1', '2024-07-22 22:23:16', b'0');
INSERT INTO `system_dict_data` VALUES (3036, 105, '分享码登录', '105', 'system_login_type', 0, 'default', '', '登录类型 - 分享码登录', '1', '2026-05-20 09:29:38', '1', '2026-05-20 09:29:38', b'0');

-- ----------------------------
-- Table structure for system_dict_type
-- ----------------------------
CREATE TABLE `system_dict_type`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '字典主键',
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '字典名称',
  `type` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '字典类型',
  `status` tinyint NOT NULL DEFAULT 0 COMMENT '状态（0正常 1停用）',
  `remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '备注',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  `deleted_time` datetime NULL DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_type`(`type` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '字典类型表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of system_dict_type
-- ----------------------------
INSERT INTO `system_dict_type` VALUES (1, '用户性别', 'system_user_sex', 0, NULL, 'admin', '2021-01-05 17:03:48', '1', '2022-05-16 20:29:32', b'0', NULL);
INSERT INTO `system_dict_type` VALUES (6, '参数类型', 'infra_config_type', 0, NULL, 'admin', '2021-01-05 17:03:48', '', '2022-02-01 16:36:54', b'0', NULL);
INSERT INTO `system_dict_type` VALUES (9, '操作类型', 'infra_operate_type', 0, NULL, 'admin', '2021-01-05 17:03:48', '1', '2024-03-14 12:44:01', b'0', NULL);
INSERT INTO `system_dict_type` VALUES (10, '系统状态', 'common_status', 0, NULL, 'admin', '2021-01-05 17:03:48', '', '2022-02-01 16:21:28', b'0', NULL);
INSERT INTO `system_dict_type` VALUES (11, 'Boolean 是否类型', 'infra_boolean_string', 0, 'boolean 转是否', '', '2021-01-19 03:20:08', '', '2022-02-01 16:37:10', b'0', NULL);
INSERT INTO `system_dict_type` VALUES (104, '登陆结果', 'system_login_result', 0, '登陆结果', '', '2021-01-18 06:17:11', '', '2022-02-01 16:36:00', b'0', NULL);
INSERT INTO `system_dict_type` VALUES (107, '定时任务状态', 'infra_job_status', 0, NULL, '', '2021-02-07 07:44:16', '', '2022-02-01 16:51:11', b'0', NULL);
INSERT INTO `system_dict_type` VALUES (108, '定时任务日志状态', 'infra_job_log_status', 0, NULL, '', '2021-02-08 10:03:51', '', '2022-02-01 16:50:43', b'0', NULL);
INSERT INTO `system_dict_type` VALUES (109, '用户类型', 'user_type', 0, NULL, '', '2021-02-26 00:15:51', '', '2021-02-26 00:15:51', b'0', NULL);
INSERT INTO `system_dict_type` VALUES (110, 'API 异常数据的处理状态', 'infra_api_error_log_process_status', 0, NULL, '', '2021-02-26 07:07:01', '', '2022-02-01 16:50:53', b'0', NULL);
INSERT INTO `system_dict_type` VALUES (111, '短信渠道编码', 'system_sms_channel_code', 0, NULL, '1', '2021-04-05 01:04:50', '1', '2022-02-16 02:09:08', b'0', NULL);
INSERT INTO `system_dict_type` VALUES (112, '短信模板的类型', 'system_sms_template_type', 0, NULL, '1', '2021-04-05 21:50:43', '1', '2022-02-01 16:35:06', b'0', NULL);
INSERT INTO `system_dict_type` VALUES (113, '短信发送状态', 'system_sms_send_status', 0, NULL, '1', '2021-04-11 20:18:03', '1', '2022-02-01 16:35:09', b'0', NULL);
INSERT INTO `system_dict_type` VALUES (114, '短信接收状态', 'system_sms_receive_status', 0, NULL, '1', '2021-04-11 20:27:14', '1', '2022-02-01 16:35:14', b'0', NULL);
INSERT INTO `system_dict_type` VALUES (116, '登陆日志的类型', 'system_login_type', 0, '登陆日志的类型', '1', '2021-10-06 00:50:46', '1', '2022-02-01 16:35:56', b'0', NULL);
INSERT INTO `system_dict_type` VALUES (145, '角色类型', 'system_role_type', 0, '角色类型', '1', '2022-02-16 13:01:46', '1', '2022-02-16 13:01:46', b'0', NULL);
INSERT INTO `system_dict_type` VALUES (146, '文件存储器', 'infra_file_storage', 0, '文件存储器', '1', '2022-03-15 00:24:38', '1', '2022-03-15 00:24:38', b'0', NULL);
INSERT INTO `system_dict_type` VALUES (147, 'OAuth 2.0 授权类型', 'system_oauth2_grant_type', 0, 'OAuth 2.0 授权类型（模式）', '1', '2022-05-12 00:20:52', '1', '2022-05-11 16:25:49', b'0', NULL);
INSERT INTO `system_dict_type` VALUES (160, '终端', 'terminal', 0, '终端', '1', '2022-12-10 10:50:50', '1', '2022-12-10 10:53:11', b'0', NULL);
INSERT INTO `system_dict_type` VALUES (166, '邮件发送状态', 'system_mail_send_status', 0, '邮件发送状态', '1', '2023-01-26 09:53:13', '1', '2023-01-26 09:53:13', b'0', '1970-01-01 00:00:00');
INSERT INTO `system_dict_type` VALUES (616, '时间间隔', 'date_interval', 0, '', '1', '2024-03-29 22:50:09', '1', '2024-03-29 22:50:09', b'0', '1970-01-01 00:00:00');
INSERT INTO `system_dict_type` VALUES (2008, '数据权限范围', 'system_data_scope', 0, NULL, '', '2026-10-01 20:22:50', '', '2026-10-01 20:22:50', b'0', NULL);
INSERT INTO `system_dict_type` VALUES (2009, '菜单类型', 'system_menu_type', 0, NULL, '', '2026-10-01 20:22:50', '', '2026-10-01 20:22:50', b'0', NULL);

-- ----------------------------
-- Table structure for system_login_log
-- ----------------------------
CREATE TABLE `system_login_log`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '访问ID',
  `log_type` int NOT NULL COMMENT '日志类型',
  `trace_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '链路追踪编号',
  `user_id` bigint NOT NULL DEFAULT 0 COMMENT '用户编号',
  `user_type` tinyint NOT NULL DEFAULT 0 COMMENT '用户类型',
  `username` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '用户账号',
  `result` tinyint NOT NULL COMMENT '登陆结果',
  `user_ip` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户 IP',
  `user_agent` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '浏览器 UA',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_user_id`(`user_id` ASC) USING BTREE,
  INDEX `idx_username`(`username` ASC) USING BTREE,
  INDEX `idx_create_time`(`create_time` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '系统访问记录' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of system_login_log
-- ----------------------------

-- ----------------------------
-- Table structure for system_menu
-- ----------------------------
CREATE TABLE `system_menu`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '菜单ID',
  `name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '菜单名称',
  `permission` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '权限标识',
  `type` tinyint NOT NULL COMMENT '菜单类型',
  `menu_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '后台类型',
  `sort` int NOT NULL DEFAULT 0 COMMENT '显示顺序',
  `parent_id` bigint NOT NULL DEFAULT 0 COMMENT '父菜单ID',
  `path` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '路由地址',
  `icon` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '#' COMMENT '菜单图标',
  `component` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '组件路径',
  `component_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '组件名',
  `status` tinyint NOT NULL DEFAULT 0 COMMENT '菜单状态',
  `visible` bit(1) NOT NULL DEFAULT b'1' COMMENT '是否可见',
  `keep_alive` bit(1) NOT NULL DEFAULT b'1' COMMENT '是否缓存',
  `always_show` bit(1) NOT NULL DEFAULT b'1' COMMENT '是否总是显示',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_parent_id`(`parent_id` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '菜单权限表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of system_menu
-- ----------------------------
INSERT INTO `system_menu` VALUES (1, '系统管理', '', 1, 'super_admin', 10, 0, '/system', 'ep:tools', NULL, NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (2, '基础设施', '', 1, 'super_admin', 20, 0, '/infra', 'ep:monitor', NULL, NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (100, '用户管理', 'system:user:list', 2, 'super_admin', 1, 1, 'user', 'ep:avatar', 'system/user/index', 'SystemUser', 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (101, '角色管理', '', 2, 'super_admin', 2, 1, 'role', 'ep:user', 'system/role/index', 'SystemRole', 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (103, '部门管理', '', 2, 'super_admin', 4, 1, 'dept', 'fa:address-card', 'system/dept/index', 'SystemDept', 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (104, '岗位管理', '', 2, 'super_admin', 5, 1, 'post', 'fa:address-book-o', 'system/post/index', 'SystemPost', 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (105, '字典管理', '', 2, 'super_admin', 6, 1, 'dict', 'ep:collection', 'system/dict/index', 'SystemDictType', 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (106, '配置管理', '', 2, 'super_admin', 8, 2, 'config', 'fa:connectdevelop', 'infra/config/index', 'InfraConfig', 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (108, '审计日志', '', 1, 'super_admin', 9, 1, 'log', 'ep:document-copy', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (110, '定时任务', '', 2, 'super_admin', 7, 2, 'job', 'fa-solid:tasks', 'infra/job/index', 'InfraJob', 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (500, '操作日志', '', 2, 'super_admin', 1, 108, 'operate-log', 'ep:position', 'system/operatelog/index', 'SystemOperateLog', 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (501, '登录日志', '', 2, 'super_admin', 2, 108, 'login-log', 'ep:promotion', 'system/loginlog/index', 'SystemLoginLog', 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1001, '用户查询', 'system:user:query', 3, 'super_admin', 1, 100, '', '#', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1002, '用户新增', 'system:user:create', 3, 'super_admin', 2, 100, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1003, '用户修改', 'system:user:update', 3, 'super_admin', 3, 100, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1004, '用户删除', 'system:user:delete', 3, 'super_admin', 4, 100, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1005, '用户导出', 'system:user:export', 3, 'super_admin', 5, 100, '', '#', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1006, '用户导入', 'system:user:import', 3, 'super_admin', 6, 100, '', '#', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1007, '重置密码', 'system:user:update-password', 3, 'super_admin', 7, 100, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1008, '角色查询', 'system:role:query', 3, 'super_admin', 1, 101, '', '#', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1009, '角色新增', 'system:role:create', 3, 'super_admin', 2, 101, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1010, '角色修改', 'system:role:update', 3, 'super_admin', 3, 101, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1011, '角色删除', 'system:role:delete', 3, 'super_admin', 4, 101, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1012, '角色导出', 'system:role:export', 3, 'super_admin', 5, 101, '', '#', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1017, '部门查询', 'system:dept:query', 3, 'super_admin', 1, 103, '', '#', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1018, '部门新增', 'system:dept:create', 3, 'super_admin', 2, 103, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1019, '部门修改', 'system:dept:update', 3, 'super_admin', 3, 103, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1020, '部门删除', 'system:dept:delete', 3, 'super_admin', 4, 103, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1021, '岗位查询', 'system:post:query', 3, 'super_admin', 1, 104, '', '#', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1022, '岗位新增', 'system:post:create', 3, 'super_admin', 2, 104, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1023, '岗位修改', 'system:post:update', 3, 'super_admin', 3, 104, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1024, '岗位删除', 'system:post:delete', 3, 'super_admin', 4, 104, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1025, '岗位导出', 'system:post:export', 3, 'super_admin', 5, 104, '', '#', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1026, '字典查询', 'system:dict:query', 3, 'super_admin', 1, 105, '#', '#', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1027, '字典新增', 'system:dict:create', 3, 'super_admin', 2, 105, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1028, '字典修改', 'system:dict:update', 3, 'super_admin', 3, 105, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1029, '字典删除', 'system:dict:delete', 3, 'super_admin', 4, 105, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1030, '字典导出', 'system:dict:export', 3, 'super_admin', 5, 105, '#', '#', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1031, '配置查询', 'infra:config:query', 3, 'super_admin', 1, 106, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1032, '配置新增', 'infra:config:create', 3, 'super_admin', 2, 106, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1033, '配置修改', 'infra:config:update', 3, 'super_admin', 3, 106, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1034, '配置删除', 'infra:config:delete', 3, 'super_admin', 4, 106, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1035, '配置导出', 'infra:config:export', 3, 'super_admin', 5, 106, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1040, '操作查询', 'system:operate-log:query', 3, 'super_admin', 1, 500, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1042, '日志导出', 'system:operate-log:export', 3, 'super_admin', 2, 500, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1043, '登录查询', 'system:login-log:query', 3, 'super_admin', 1, 501, '#', '#', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1045, '日志导出', 'system:login-log:export', 3, 'super_admin', 3, 501, '#', '#', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1050, '任务新增', 'infra:job:create', 3, 'super_admin', 2, 110, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1051, '任务修改', 'infra:job:update', 3, 'super_admin', 3, 110, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1052, '任务删除', 'infra:job:delete', 3, 'super_admin', 4, 110, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1053, '状态修改', 'infra:job:update', 3, 'super_admin', 5, 110, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1054, '任务导出', 'infra:job:export', 3, 'super_admin', 7, 110, '', '', '', NULL, 0, b'1', b'1', b'1', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1063, '设置角色菜单权限', 'system:permission:assign-role-menu', 3, 'super_admin', 6, 101, '', '', '', NULL, 0, b'1', b'1', b'1', '', '2021-01-06 17:53:44', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1064, '设置角色数据权限', 'system:permission:assign-role-data-scope', 3, 'super_admin', 7, 101, '', '', '', NULL, 0, b'1', b'1', b'1', '', '2021-01-06 17:56:31', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1065, '设置用户角色', 'system:permission:assign-user-role', 3, 'super_admin', 8, 101, '', '', '', NULL, 0, b'1', b'1', b'1', '', '2021-01-07 10:23:28', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1075, '任务触发', 'infra:job:trigger', 3, 'super_admin', 8, 110, '', '', '', NULL, 0, b'1', b'1', b'1', '', '2021-02-07 13:03:10', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1087, '任务查询', 'infra:job:query', 3, 'super_admin', 1, 110, '', '', '', NULL, 0, b'1', b'1', b'1', '1', '2021-03-10 01:26:19', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1093, '短信管理', '', 1, 'super_admin', 1, 1, 'sms', 'ep:message', NULL, NULL, 0, b'1', b'1', b'1', '1', '2021-04-05 01:10:16', '1', '2026-10-01 20:22:50', b'0');
INSERT INTO `system_menu` VALUES (1094, '短信渠道', '', 2, 'super_admin', 0, 1093, 'sms-channel', 'fa:stack-exchange', 'system/sms/channel/index', 'SystemSmsChannel', 0, b'1', b'1', b'1', '', '2021-04-01 11:07:15', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1095, '短信渠道查询', 'system:sms-channel:query', 3, 'super_admin', 1, 1094, '', '', '', NULL, 0, b'1', b'1', b'1', '', '2021-04-01 11:07:15', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1096, '短信渠道创建', 'system:sms-channel:create', 3, 'super_admin', 2, 1094, '', '', '', NULL, 0, b'1', b'1', b'1', '', '2021-04-01 11:07:15', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1097, '短信渠道更新', 'system:sms-channel:update', 3, 'super_admin', 3, 1094, '', '', '', NULL, 0, b'1', b'1', b'1', '', '2021-04-01 11:07:15', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1098, '短信渠道删除', 'system:sms-channel:delete', 3, 'super_admin', 4, 1094, '', '', '', NULL, 0, b'1', b'1', b'1', '', '2021-04-01 11:07:15', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1100, '短信模板', '', 2, 'super_admin', 1, 1093, 'sms-template', 'ep:connection', 'system/sms/template/index', 'SystemSmsTemplate', 0, b'1', b'1', b'1', '', '2021-04-01 17:35:17', '1', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1101, '短信模板查询', 'system:sms-template:query', 3, 'super_admin', 1, 1100, '', '', '', NULL, 0, b'1', b'1', b'1', '', '2021-04-01 17:35:17', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1102, '短信模板创建', 'system:sms-template:create', 3, 'super_admin', 2, 1100, '', '', '', NULL, 0, b'1', b'1', b'1', '', '2021-04-01 17:35:17', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1103, '短信模板更新', 'system:sms-template:update', 3, 'super_admin', 3, 1100, '', '', '', NULL, 0, b'1', b'1', b'1', '', '2021-04-01 17:35:17', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1104, '短信模板删除', 'system:sms-template:delete', 3, 'super_admin', 4, 1100, '', '', '', NULL, 0, b'1', b'1', b'1', '', '2021-04-01 17:35:17', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1105, '短信模板导出', 'system:sms-template:export', 3, 'super_admin', 5, 1100, '', '', '', NULL, 0, b'1', b'1', b'1', '', '2021-04-01 17:35:17', '', '2026-10-01 19:42:37', b'0');
INSERT INTO `system_menu` VALUES (1106, '发送测试短信', 'system:sms-template:send-sms', 3, 'super_admin', 6, 1100, '', '', '', NULL, 0, b'1', b'1', b'1', '1', '2021-04-11 00:26:40', '1', '2026-10-01 19:42:37', b'0');

-- ----------------------------
-- Table structure for system_oauth2_access_token
-- ----------------------------
CREATE TABLE `system_oauth2_access_token`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '编号',
  `user_id` bigint NOT NULL DEFAULT 0 COMMENT '用户编号',
  `user_type` tinyint NOT NULL COMMENT '用户类型',
  `user_info` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户信息',
  `access_token` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '访问令牌',
  `refresh_token` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '刷新令牌',
  `client_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '客户端编号',
  `scopes` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '授权范围',
  `expires_time` datetime NOT NULL COMMENT '过期时间',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_access_token`(`access_token` ASC) USING BTREE,
  INDEX `idx_refresh_token`(`refresh_token` ASC) USING BTREE,
  INDEX `idx_user_id`(`user_id` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'OAuth2 访问令牌' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of system_oauth2_access_token
-- ----------------------------

-- ----------------------------
-- Table structure for system_oauth2_client
-- ----------------------------
CREATE TABLE `system_oauth2_client`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '编号',
  `client_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '客户端编号',
  `secret` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '客户端密钥',
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '应用名',
  `logo` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '应用图标',
  `description` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '应用描述',
  `status` tinyint NOT NULL COMMENT '状态',
  `access_token_validity_seconds` int NOT NULL COMMENT '访问令牌的有效期',
  `refresh_token_validity_seconds` int NOT NULL COMMENT '刷新令牌的有效期',
  `redirect_uris` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '可重定向的 URI 地址',
  `authorized_grant_types` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '授权类型',
  `scopes` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '授权范围',
  `auto_approve_scopes` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '自动通过的授权范围',
  `authorities` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '权限',
  `resource_ids` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '资源',
  `additional_information` varchar(4096) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '附加信息',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_client_id`(`client_id` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'OAuth2 客户端表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of system_oauth2_client
-- ----------------------------
INSERT INTO `system_oauth2_client` VALUES (1, 'default', '', 'default client', '', 'Default OAuth2 client. Change secret after deployment', 0, 1800, 2592000, '[\"https://admin.example.com/callback\",\"https://docs.example.com/callback\"]', '[\"password\",\"authorization_code\",\"implicit\",\"refresh_token\"]', '[\"user.read\",\"user.write\"]', '[]', '[\"user.read\",\"user.write\"]', '[]', '{}', '1', '2022-05-11 21:47:12', '1', '2026-04-11 12:40:17', b'0');

-- ----------------------------
-- Table structure for system_oauth2_refresh_token
-- ----------------------------
CREATE TABLE `system_oauth2_refresh_token`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '编号',
  `user_id` bigint NOT NULL COMMENT '用户编号',
  `refresh_token` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '刷新令牌',
  `user_type` tinyint NOT NULL COMMENT '用户类型',
  `client_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '客户端编号',
  `scopes` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '授权范围',
  `expires_time` datetime NOT NULL COMMENT '过期时间',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_refresh_token`(`refresh_token` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'OAuth2 刷新令牌' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of system_oauth2_refresh_token
-- ----------------------------

-- ----------------------------
-- Table structure for system_operate_log
-- ----------------------------
CREATE TABLE `system_operate_log`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '日志主键',
  `trace_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '链路追踪编号',
  `user_id` bigint NOT NULL DEFAULT 0 COMMENT '用户编号',
  `user_type` tinyint NOT NULL DEFAULT 0 COMMENT '用户类型',
  `type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作模块类型',
  `sub_type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作名',
  `biz_id` bigint NOT NULL COMMENT '操作数据模块编号',
  `action` varchar(2000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '操作内容',
  `extra` varchar(2000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '拓展字段',
  `request_method` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '请求方法名',
  `request_url` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '请求地址',
  `user_ip` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '用户 IP',
  `user_agent` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '浏览器 UA',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_user_id`(`user_id` ASC) USING BTREE,
  INDEX `idx_type`(`type` ASC) USING BTREE,
  INDEX `idx_create_time`(`create_time` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '操作日志记录 V2 版本' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of system_operate_log
-- ----------------------------

-- ----------------------------
-- Table structure for system_post
-- ----------------------------
CREATE TABLE `system_post`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '岗位ID',
  `code` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '岗位编码',
  `name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '岗位名称',
  `sort` int NOT NULL COMMENT '显示顺序',
  `status` tinyint NOT NULL COMMENT '状态（0正常 1停用）',
  `remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '备注',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_code`(`code` ASC) USING BTREE,
  INDEX `idx_status`(`status` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '岗位信息表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of system_post
-- ----------------------------

-- ----------------------------
-- Table structure for system_role
-- ----------------------------
CREATE TABLE `system_role`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '角色ID',
  `name` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '角色名称',
  `code` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '角色权限字符串',
  `role_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '后台类型',
  `sort` int NOT NULL COMMENT '显示顺序',
  `data_scope` tinyint NOT NULL DEFAULT 1 COMMENT '数据范围（1：全部数据权限 2：自定数据权限 3：本部门数据权限 4：本部门及以下数据权限）',
  `data_scope_dept_ids` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '数据范围(指定部门数组)',
  `status` tinyint NOT NULL COMMENT '角色状态（0正常 1停用）',
  `type` tinyint NOT NULL COMMENT '角色类型',
  `remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '备注',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_code`(`code` ASC) USING BTREE,
  INDEX `idx_status`(`status` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '角色信息表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of system_role
-- ----------------------------
INSERT INTO `system_role` VALUES (1, '超级管理员', 'super_admin', 'super_admin', 1, 1, '', 0, 1, '超级管理员', 'admin', '2021-01-05 17:03:48', '', '2026-10-01 19:37:55', b'0');

-- ----------------------------
-- Table structure for system_role_menu
-- ----------------------------
CREATE TABLE `system_role_menu`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '自增编号',
  `role_id` bigint NOT NULL COMMENT '角色ID',
  `menu_id` bigint NOT NULL COMMENT '菜单ID',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_role_id`(`role_id` ASC) USING BTREE,
  INDEX `idx_menu_id`(`menu_id` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '角色和菜单关联表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of system_role_menu
-- ----------------------------
INSERT INTO `system_role_menu` VALUES (6293, 1, 1, '1', '2026-04-07 08:29:41', '1', '2026-04-07 08:29:41', b'0');
INSERT INTO `system_role_menu` VALUES (6294, 1, 2, '1', '2026-04-07 08:29:41', '1', '2026-04-07 08:29:41', b'0');
INSERT INTO `system_role_menu` VALUES (6295, 1, 100, '1', '2026-04-07 08:29:41', '1', '2026-04-07 08:29:41', b'0');
INSERT INTO `system_role_menu` VALUES (6296, 1, 101, '1', '2026-04-07 08:29:41', '1', '2026-04-07 08:29:41', b'0');
INSERT INTO `system_role_menu` VALUES (6297, 1, 103, '1', '2026-04-07 08:29:41', '1', '2026-04-07 08:29:41', b'0');
INSERT INTO `system_role_menu` VALUES (6298, 1, 104, '1', '2026-04-07 08:29:41', '1', '2026-04-07 08:29:41', b'0');
INSERT INTO `system_role_menu` VALUES (6299, 1, 105, '1', '2026-04-07 08:29:41', '1', '2026-04-07 08:29:41', b'0');
INSERT INTO `system_role_menu` VALUES (6300, 1, 106, '1', '2026-04-07 08:29:41', '1', '2026-04-07 08:29:41', b'0');
INSERT INTO `system_role_menu` VALUES (6302, 1, 108, '1', '2026-04-07 08:29:41', '1', '2026-04-07 08:29:41', b'0');
INSERT INTO `system_role_menu` VALUES (6303, 1, 110, '1', '2026-04-07 08:29:41', '1', '2026-04-07 08:29:41', b'0');
INSERT INTO `system_role_menu` VALUES (6305, 1, 500, '1', '2026-04-07 08:29:41', '1', '2026-04-07 08:29:41', b'0');
INSERT INTO `system_role_menu` VALUES (6306, 1, 501, '1', '2026-04-07 08:29:41', '1', '2026-04-07 08:29:41', b'0');
INSERT INTO `system_role_menu` VALUES (6308, 1, 1093, '1', '2026-04-07 08:29:41', '1', '2026-04-07 08:29:41', b'0');
INSERT INTO `system_role_menu` VALUES (6309, 1, 1094, '1', '2026-04-07 08:29:41', '1', '2026-04-07 08:29:41', b'0');
INSERT INTO `system_role_menu` VALUES (6310, 1, 1100, '1', '2026-04-07 08:29:41', '1', '2026-04-07 08:29:41', b'0');
INSERT INTO `system_role_menu` VALUES (6317, 1, 1001, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6318, 1, 1002, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6319, 1, 1003, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6320, 1, 1004, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6321, 1, 1005, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6322, 1, 1006, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6323, 1, 1007, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6324, 1, 1008, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6325, 1, 1009, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6326, 1, 1010, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6327, 1, 1011, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6328, 1, 1012, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6329, 1, 1017, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6330, 1, 1018, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6331, 1, 1019, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6332, 1, 1020, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6333, 1, 1021, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6334, 1, 1022, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6335, 1, 1023, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6336, 1, 1024, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6337, 1, 1025, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6338, 1, 1026, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6339, 1, 1027, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6340, 1, 1028, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6341, 1, 1029, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6342, 1, 1030, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6343, 1, 1031, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6344, 1, 1032, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6345, 1, 1033, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6346, 1, 1034, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6347, 1, 1035, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6352, 1, 1040, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6353, 1, 1042, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6354, 1, 1043, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6355, 1, 1045, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6356, 1, 1050, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6357, 1, 1051, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6358, 1, 1052, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6359, 1, 1053, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6360, 1, 1054, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6366, 1, 1063, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6367, 1, 1064, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6368, 1, 1065, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6369, 1, 1075, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6370, 1, 1087, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6373, 1, 1095, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6374, 1, 1096, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6375, 1, 1097, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6376, 1, 1098, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6377, 1, 1101, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6378, 1, 1102, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6379, 1, 1103, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6380, 1, 1104, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6381, 1, 1105, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');
INSERT INTO `system_role_menu` VALUES (6382, 1, 1106, '1', '2026-04-07 08:30:13', '1', '2026-04-07 08:30:13', b'0');

-- ----------------------------
-- Table structure for system_sms_channel
-- ----------------------------
CREATE TABLE `system_sms_channel`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '编号',
  `signature` varchar(12) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '短信签名',
  `code` varchar(63) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '渠道编码',
  `status` tinyint NOT NULL COMMENT '开启状态',
  `remark` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '备注',
  `api_key` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '短信 API 的账号',
  `api_secret` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '短信 API 的秘钥',
  `callback_url` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '短信发送回调 URL',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_code`(`code` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '短信渠道' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of system_sms_channel
-- ----------------------------

-- ----------------------------
-- Table structure for system_sms_code
-- ----------------------------
CREATE TABLE `system_sms_code`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '编号',
  `mobile` varchar(11) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '手机号',
  `code` varchar(6) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '验证码',
  `create_ip` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '创建 IP',
  `scene` tinyint NOT NULL COMMENT '发送场景',
  `today_index` tinyint NOT NULL COMMENT '今日发送的第几条',
  `used` tinyint NOT NULL COMMENT '是否使用',
  `used_time` datetime NULL DEFAULT NULL COMMENT '使用时间',
  `used_ip` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '使用 IP',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_mobile`(`mobile` ASC) USING BTREE COMMENT '手机号',
  INDEX `idx_mobile_scene`(`mobile` ASC, `scene` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '手机验证码' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of system_sms_code
-- ----------------------------

-- ----------------------------
-- Table structure for system_sms_log
-- ----------------------------
CREATE TABLE `system_sms_log`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '编号',
  `channel_id` bigint NOT NULL COMMENT '短信渠道编号',
  `channel_code` varchar(63) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '短信渠道编码',
  `template_id` bigint NOT NULL COMMENT '模板编号',
  `template_code` varchar(63) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模板编码',
  `template_type` tinyint NOT NULL COMMENT '短信类型',
  `template_content` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '短信内容',
  `template_params` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '短信参数',
  `api_template_id` varchar(63) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '短信 API 的模板编号',
  `mobile` varchar(11) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '手机号',
  `user_id` bigint NULL DEFAULT NULL COMMENT '用户编号',
  `user_type` tinyint NULL DEFAULT NULL COMMENT '用户类型',
  `send_status` tinyint NOT NULL DEFAULT 0 COMMENT '发送状态',
  `send_time` datetime NULL DEFAULT NULL COMMENT '发送时间',
  `api_send_code` varchar(63) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '短信 API 发送结果的编码',
  `api_send_msg` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '短信 API 发送失败的提示',
  `api_request_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '短信 API 发送返回的唯一请求 ID',
  `api_serial_no` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '短信 API 发送返回的序号',
  `receive_status` tinyint NOT NULL DEFAULT 0 COMMENT '接收状态',
  `receive_time` datetime NULL DEFAULT NULL COMMENT '接收时间',
  `api_receive_code` varchar(63) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'API 接收结果的编码',
  `api_receive_msg` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'API 接收结果的说明',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_mobile`(`mobile` ASC) USING BTREE,
  INDEX `idx_send_time`(`send_time` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '短信日志' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of system_sms_log
-- ----------------------------

-- ----------------------------
-- Table structure for system_sms_template
-- ----------------------------
CREATE TABLE `system_sms_template`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '编号',
  `type` tinyint NOT NULL COMMENT '模板类型',
  `status` tinyint NOT NULL COMMENT '开启状态',
  `code` varchar(63) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模板编码',
  `name` varchar(63) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模板名称',
  `content` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模板内容',
  `params` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '参数数组',
  `remark` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '备注',
  `api_template_id` varchar(63) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '短信 API 的模板编号',
  `channel_id` bigint NOT NULL COMMENT '短信渠道编号',
  `channel_code` varchar(63) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '短信渠道编码',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_code`(`code` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '短信模板' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of system_sms_template
-- ----------------------------

-- ----------------------------
-- Table structure for system_user_post
-- ----------------------------
CREATE TABLE `system_user_post`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'id',
  `user_id` bigint NOT NULL DEFAULT 0 COMMENT '用户ID',
  `post_id` bigint NOT NULL DEFAULT 0 COMMENT '岗位ID',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_user_id`(`user_id` ASC) USING BTREE,
  INDEX `idx_post_id`(`post_id` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '用户岗位表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of system_user_post
-- ----------------------------

-- ----------------------------
-- Table structure for system_user_role
-- ----------------------------
CREATE TABLE `system_user_role`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '自增编号',
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `role_id` bigint NOT NULL COMMENT '角色ID',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_user_id`(`user_id` ASC) USING BTREE,
  INDEX `idx_role_id`(`role_id` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '用户和角色关联表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of system_user_role
-- ----------------------------

-- ----------------------------
-- Table structure for system_users
-- ----------------------------
CREATE TABLE `system_users`  (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '用户ID',
  `username` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户账号',
  `password` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '密码',
  `user_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'business_admin' COMMENT '后台类型',
  `nickname` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户昵称',
  `remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '备注',
  `dept_id` bigint NULL DEFAULT NULL COMMENT '部门ID',
  `post_ids` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '岗位编号数组',
  `email` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '用户邮箱',
  `mobile` varchar(11) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '手机号码',
  `sex` tinyint NULL DEFAULT 0 COMMENT '用户性别',
  `avatar` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '头像地址',
  `status` tinyint NOT NULL DEFAULT 0 COMMENT '帐号状态（0正常 1停用）',
  `login_ip` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '最后登录IP',
  `login_date` datetime NULL DEFAULT NULL COMMENT '最后登录时间',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_username_user_type`(`username` ASC, `user_type` ASC) USING BTREE,
  INDEX `idx_mobile`(`mobile` ASC) USING BTREE,
  INDEX `idx_email`(`email` ASC) USING BTREE,
  INDEX `idx_dept_id`(`dept_id` ASC) USING BTREE,
  INDEX `idx_status`(`status` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '用户信息表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of system_users
-- ----------------------------

SET FOREIGN_KEY_CHECKS = 1;
