/** 认证接口的运行时边界；先验证传输值，再构造凭据、用户和权限菜单。 */
import type { AppRouteRecordRaw, AuthPermissionInfo } from '@vben/types';

import type { AuthApi } from './auth';

/** 判断 JSON 对象，排除 null 和数组，随后才允许按字段读取。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 读取必需对象，错误只包含字段名，不回显凭据。
 * @param value 接口返回的未知值。
 * @param field 当前校验字段路径。
 * @returns 已确认可以按字段读取的对象。
 * @throws {TypeError} 值不是 JSON 对象。
 */
function record(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${field} 必须是对象`);
  return value;
}

/** 读取字符串字段，不对未知值执行隐式字符串化。
 * @param value 接口字段值。
 * @param field 用于错误定位的字段名。
 * @param nonempty 是否禁止空白文本，凭据及身份名称必须非空。
 * @returns 已验证的原始字符串。
 * @throws {TypeError} 值不是字符串或违反非空约束。
 */
function text(value: unknown, field: string, nonempty = false): string {
  if (typeof value !== 'string' || (nonempty && !value.trim())) {
    throw new TypeError(`${field} 必须是${nonempty ? '非空' : ''}字符串`);
  }
  return value;
}

/** 将服务端可空展示文本规范化为空串，其他类型仍拒绝。 */
function optionalText(value: unknown, field: string): string {
  return value === undefined || value === null ? '' : text(value, field);
}

/** 读取安全整数，防止用户或菜单编号在 JavaScript 中静默丢失精度。
 * @param value 接口数值。
 * @param field 校验字段名。
 * @param minimum 可接受的最小值，编号通常为正数，父节点和时间允许零。
 * @returns 可准确表达的整数。
 * @throws {TypeError} 类型、精度或最小值不符合约束。
 */
function integer(value: unknown, field: string, minimum = 0): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new TypeError(`${field} 必须是大于等于 ${minimum} 的安全整数`);
  }
  return value;
}

/** 读取权限布尔字段，禁止把字符串 false 当成真值。
 * @param value 服务端权限或可见性字段。
 * @param field 校验字段名。
 * @returns 经类型校验的布尔值。
 * @throws {TypeError} 字段不是布尔值。
 */
function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${field} 必须是布尔值`);
  return value;
}

/** 校验角色或权限码列表，保留服务端顺序及合法空字符串权限项。
 * @param value 服务端返回的集合。
 * @param field 角色或权限字段名。
 * @returns 元素均为字符串的集合。
 * @throws {TypeError} 集合或元素类型错误。
 */
function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${field} 必须是数组`);
  return value.map(
    /** 每个权限项独立校验，不能用整个数组断言替代。 */ (
      item: unknown,
      index,
    ) => text(item, `${field}[${index}]`),
  );
}

/** 校验登录和刷新结果，凭据不合格时不会返回给 Store。
 * @param value HTTP 数据节点中的未知登录结果。
 * @returns 已验证的令牌、用户编号和毫秒过期时间。
 * @throws {TypeError} 凭据、用户编号或过期时间无效。
 */
export function parseLoginResult(value: unknown): AuthApi.LoginResult {
  const result = record(value, 'login');
  const accessToken = text(result.accessToken, 'accessToken', true);
  const refreshToken = text(result.refreshToken, 'refreshToken', true);
  if (/[\r\n]/u.test(accessToken) || /[\r\n]/u.test(refreshToken)) {
    throw new TypeError('认证令牌不能包含换行');
  }
  return {
    accessToken,
    refreshToken,
    userId: integer(result.userId, 'userId', 1),
    expiresTime: integer(result.expiresTime, 'expiresTime'),
  };
}

/** 解开未使用业务响应拦截器的刷新接口外壳。
 * @param value Axios 响应体中的未知 CommonResult。
 * @returns 已确认成功的业务数据，随后仍需验证具体模型。
 * @throws {Error} 响应形状错误或业务 code 不为零。
 */
export function parseSuccessData(value: unknown): unknown {
  const result = record(value, 'response');
  if (result.code !== 0)
    throw new Error(optionalText(result.msg, 'msg') || '认证请求失败');
  return result.data;
}

/** 验证菜单树并只复制消费方实际需要的字段。
 * @param value 服务端菜单数组。
 * @param ancestors 当前路径已访问的对象，拒绝循环对象造成无限递归。
 * @returns 可转换为路由的服务端菜单树。
 * @throws {TypeError} 菜单字段、层级或对象关系不合法。
 */
function menus(
  value: unknown,
  ancestors = new Set<unknown>(),
): AppRouteRecordRaw[] {
  if (!Array.isArray(value)) throw new TypeError('menus 必须是数组');
  return value.map(
    /** 对每个目录及子菜单应用相同的输入边界。
     * @param item 未验证的单个服务端菜单。
     * @returns 当前菜单及通过验证的子菜单。
     * @throws {TypeError} 出现循环对象或菜单字段无效。
     */ (item: unknown) => {
      const menu = record(item, 'menu');
      if (ancestors.has(menu)) throw new TypeError('菜单树不能包含循环引用');
      const next = new Set(ancestors).add(menu);
      return {
        id: integer(menu.id, 'menu.id', 1),
        parentId: integer(menu.parentId, 'menu.parentId'),
        name: text(menu.name, 'menu.name', true),
        path: text(menu.path, 'menu.path', true),
        component: optionalText(menu.component, 'menu.component'),
        componentName: optionalText(menu.componentName, 'menu.componentName'),
        icon: optionalText(menu.icon, 'menu.icon'),
        visible: boolean(menu.visible, 'menu.visible'),
        keepAlive: boolean(menu.keepAlive, 'menu.keepAlive'),
        ...(menu.children === undefined || menu.children === null
          ? {}
          : { children: menus(menu.children, next) }),
      };
    },
  );
}

/** 校验权限响应并将服务端 id 映射到通用展示标识 userId。
 * @param value HTTP 数据节点中的未知权限结果。
 * @returns 类型稳定的用户、角色、权限码和独立服务端菜单。
 * @throws {TypeError} 身份或任一权限字段不符合真实接口契约。
 */
export function parsePermissionInfo(value: unknown): AuthPermissionInfo {
  const result = record(value, 'permission');
  const user = record(result.user, 'user');
  const id = integer(user.id, 'user.id', 1);
  return {
    user: {
      id,
      userId: String(id),
      username: text(user.username, 'user.username', true),
      nickname: text(user.nickname, 'user.nickname', true),
      avatar: optionalText(user.avatar, 'user.avatar'),
      email: optionalText(user.email, 'user.email'),
      userType: text(user.userType, 'user.userType', true),
      deptId:
        user.deptId === undefined || user.deptId === null
          ? null
          : integer(user.deptId, 'user.deptId', 1),
    },
    roles: strings(result.roles, 'roles'),
    permissions: strings(result.permissions, 'permissions'),
    menus: menus(result.menus),
  };
}
