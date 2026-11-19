/** 基础选项与登录用户信息通用类型定义。 */
interface BasicOption {
  label: string;
  value: string;
}

type SelectOption = BasicOption;

type TabOption = BasicOption;

interface BasicUserInfo {
  /**
   * 头像
   */
  avatar: string;
  /**
   * 部门编号
   */
  deptId?: number | string;
  /**
   * 邮箱
   */
  email?: string;
  /**
   * 用户编号（后端认证信息主键）
   */
  id?: number | string;
  /**
   * 用户昵称
   */
  nickname: string;
  /**
   * 是否要求先修改密码
   */
  passwordChangeRequired?: boolean;
  /**
   * 用户角色
   */
  roles?: string[];
  /**
   * 兼容字段：部分模板中使用的用户标识
   */
  userId?: string;
  /**
   * 用户名
   */
  username: string;
  /**
   * 所属后台类型
   */
  userType?: string;
}

type ClassType = Array<object | string> | object | string;

export type { BasicOption, BasicUserInfo, ClassType, SelectOption, TabOption };
