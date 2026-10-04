/** 权限响应契约的字段级边界测试：补齐部门编号取值与错误定位信息两类真实用户模型差异。 */
import { describe, expect, it } from 'vitest';

import { parsePermissionInfo } from './auth-contract';

/** 构造真实权限 VO 的最小可接受结果，供本文件按字段覆盖。
 * @returns 可通过 parsePermissionInfo 校验的权限响应。
 */
function permission() {
  return {
    menus: [],
    permissions: ['system:user:list'],
    roles: ['admin'],
    user: {
      avatar: null,
      deptId: null,
      email: null,
      id: 1,
      nickname: 'Admin',
      userType: 'super_admin',
      username: 'admin',
    },
  };
}

describe('parsePermissionInfo 字段边界', /** 覆盖部门归属与错误定位两类正常后端值差异。 */ () => {
  it('部门编号为安全正整数时写入数字而非空值', /** 有部门的用户必须保留真实部门归属，不能统一退化成 null 而丢失数据范围。 */ () => {
    const result = parsePermissionInfo({
      ...permission(),
      user: { ...permission().user, deptId: 1024 },
    });

    expect(result.user.deptId).toBe(1024);
  });

  it('部门编号缺失时按无部门处理', /** 顶层用户没有部门字段，必须得到 null 而不是抛错。 */ () => {
    const { deptId: _deptId, ...userWithoutDept } = permission().user;
    const result = parsePermissionInfo({
      ...permission(),
      user: userWithoutDept,
    });

    expect(result.user.deptId).toBeNull();
  });

  it('非空字段校验失败时错误信息指出具体字段名', /** 排查权限响应时必须能定位到出错字段，而不是只看到一句笼统失败。 */ () => {
    expect(
      /** 空用户名触发非空文本约束，错误应带上字段名。 */
      () =>
        parsePermissionInfo({
          ...permission(),
          user: { ...permission().user, username: '   ' },
        }),
    ).toThrow('user.username 必须是非空字符串');

    expect(
      /** 角色集合中出现非字符串项，错误应带上下标。 */
      () => parsePermissionInfo({ ...permission(), roles: ['admin', 1] }),
    ).toThrow('roles[1] 必须是字符串');
  });

  it('菜单子节点存在时按层级递归保留', /** 后端返回 children 时必须转成真实子树，而不是丢弃或保留原始对象。 */ () => {
    const result = parsePermissionInfo({
      ...permission(),
      menus: [
        {
          children: [
            {
              component: 'system/user/index',
              componentName: 'SystemUser',
              icon: 'lucide:user',
              id: 12,
              keepAlive: true,
              name: 'SystemUser',
              parentId: 11,
              path: 'user',
              visible: true,
            },
          ],
          component: null,
          componentName: null,
          icon: null,
          id: 11,
          keepAlive: false,
          name: 'System',
          parentId: 0,
          path: 'system',
          visible: true,
        },
      ],
    });

    expect(result.menus).toEqual([
      {
        children: [
          {
            component: 'system/user/index',
            componentName: 'SystemUser',
            icon: 'lucide:user',
            id: 12,
            keepAlive: true,
            name: 'SystemUser',
            parentId: 11,
            path: 'user',
            visible: true,
          },
        ],
        component: '',
        componentName: '',
        icon: '',
        id: 11,
        keepAlive: false,
        name: 'System',
        parentId: 0,
        path: 'system',
        visible: true,
      },
    ]);
  });

  it('菜单树出现循环引用时拒绝整棵权限', /** 服务端数据异常不能造成无限递归并把页面卡死。 */ () => {
    const looped: Record<string, unknown> = {
      children: null,
      component: null,
      componentName: null,
      icon: null,
      id: 1,
      keepAlive: false,
      name: 'Loop',
      parentId: 0,
      path: 'loop',
      visible: true,
    };
    looped.children = [looped];

    expect(
      /** 自引用菜单触发循环检测。 */
      () => parsePermissionInfo({ ...permission(), menus: [looped] }),
    ).toThrow('菜单树不能包含循环引用');
  });
});
