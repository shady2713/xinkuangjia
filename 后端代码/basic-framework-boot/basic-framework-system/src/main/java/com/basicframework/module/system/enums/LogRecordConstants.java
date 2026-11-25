package com.basicframework.module.system.enums;

/**
 * System 操作审计日志常量（供原生 {@code @OperateLog} 使用）。
 *
 * @author shady
 */
public interface LogRecordConstants {

    String SYSTEM_USER_TYPE = "用户管理";
    String SYSTEM_USER_CREATE_SUB_TYPE = "创建用户";
    String SYSTEM_USER_CREATE_SUCCESS = "创建了用户【#{#createReqVO.username}】";
    String SYSTEM_USER_UPDATE_SUB_TYPE = "更新用户";
    String SYSTEM_USER_UPDATE_SUCCESS = "更新了用户【#{#updateReqVO.username}】";
    String SYSTEM_USER_DELETE_SUB_TYPE = "删除用户";
    String SYSTEM_USER_DELETE_SUCCESS = "删除了编号为【#{#id}】的用户";
    String SYSTEM_USER_UPDATE_PASSWORD_SUB_TYPE = "重置用户密码";
    String SYSTEM_USER_UPDATE_PASSWORD_SUCCESS = "重置了编号为【#{#id}】的用户密码";

    String SYSTEM_ROLE_TYPE = "角色管理";
    String SYSTEM_ROLE_CREATE_SUB_TYPE = "创建角色";
    String SYSTEM_ROLE_CREATE_SUCCESS = "创建了角色【#{#createReqVO.name}】";
    String SYSTEM_ROLE_UPDATE_SUB_TYPE = "更新角色";
    String SYSTEM_ROLE_UPDATE_SUCCESS = "更新了角色【#{#updateReqVO.name}】";
    String SYSTEM_ROLE_DELETE_SUB_TYPE = "删除角色";
    String SYSTEM_ROLE_DELETE_SUCCESS = "删除了编号为【#{#id}】的角色";

}
