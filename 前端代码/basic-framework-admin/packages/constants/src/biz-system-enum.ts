// ========== COMMON 模块 ==========
/**
 * 全局通用状态枚举
 * ENABLE 为 0 表示开启，DISABLE 为 1 表示禁用。
 */
export const CommonStatusEnum = {
  ENABLE: 0, // 开启
  DISABLE: 1, // 禁用
};

/**
 * 全局用户类型枚举
 * MEMBER 为 1 表示会员，ADMIN 为 2 表示管理员。
 */
export const UserTypeEnum = {
  MEMBER: 1, // 会员
  ADMIN: 2, // 管理员
};

// ========== SYSTEM 模块 ==========
/**
 * 菜单的类型枚举
 */
export const SystemMenuTypeEnum = {
  DIR: 1, // 目录
  MENU: 2, // 菜单
  BUTTON: 3, // 按钮
};

/**
 * 角色的类型枚举
 */
export const SystemRoleTypeEnum = {
  SYSTEM: 1, // 内置角色
  CUSTOM: 2, // 自定义角色
};

/**
 * 数据权限的范围枚举
 */
export const SystemDataScopeEnum = {
  ALL: 1, // 全部数据权限
  DEPT_CUSTOM: 2, // 指定部门数据权限
  DEPT_ONLY: 3, // 部门数据权限
  DEPT_AND_CHILD: 4, // 部门及以下数据权限
  DEPT_SELF: 5, // 仅本人数据权限
};
