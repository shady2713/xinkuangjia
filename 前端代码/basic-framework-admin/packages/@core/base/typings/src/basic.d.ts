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
  /** 用户所属部门，无部门时服务端返回 null。 */
  deptId?: null | number;
  /** 可选联系邮箱。 */
  email?: string;
  /** 服务端用户编号；界面通用标识使用 userId。 */
  id?: number;
  /**
   * 用户昵称
   */
  nickname: string;
  /**
   * 用户角色
   */
  roles?: string[];
  /**
   * 用户id
   */
  userId: string;
  /**
   * 用户名
   */
  username: string;
  /** 服务端明确返回的平台账号类型。 */
  userType?: string;
}

type ClassType = Array<object | string> | object | string;

export type { BasicOption, BasicUserInfo, ClassType, SelectOption, TabOption };
