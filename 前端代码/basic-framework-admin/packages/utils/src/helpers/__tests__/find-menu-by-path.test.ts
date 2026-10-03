/**
 * 菜单查找工具的单元测试。
 *
 * 覆盖 findMenuByPath 的层级匹配、空路径与不存在路径的兜底，
 * 以及 findRootMenuByPath 在命中与非命中两种情况下的返回形状。
 */
import type { MenuRecordRaw } from '@vben-core/typings';

import { describe, expect, it } from 'vitest';

import { findMenuByPath, findRootMenuByPath } from '../find-menu-by-path';

// 示例菜单数据
const menus: MenuRecordRaw[] = [
  { path: '/', children: [] },
  { path: '/about', children: [] },
  {
    path: '/contact',
    children: [
      { path: '/contact/email', children: [] },
      { path: '/contact/phone', children: [] },
    ],
  },
  {
    path: '/services',
    children: [
      { path: '/services/design', children: [] },
      {
        path: '/services/development',
        children: [{ path: '/services/development/web', children: [] }],
      },
    ],
  },
];

describe('menu Finder Tests', /** 覆盖菜单路径查找在顶层、嵌套、空输入与不匹配路径下的返回口径。 */ () => {
  it('finds a top-level menu', () => {
    const menu = findMenuByPath(menus, '/about');
    expect(menu).toBeDefined();
    expect(menu?.path).toBe('/about');
  });

  it('finds a nested menu', () => {
    const menu = findMenuByPath(menus, '/services/development/web');
    expect(menu).toBeDefined();
    expect(menu?.path).toBe('/services/development/web');
  });

  it('returns null for a non-existent path', () => {
    const menu = findMenuByPath(menus, '/non-existent');
    expect(menu).toBeNull();
  });

  it('handles empty menus list', () => {
    const menu = findMenuByPath([], '/about');
    expect(menu).toBeNull();
  });

  it('handles menu items without children', /** children 是可选字段，显式传 undefined 用于覆盖这条分支。 */ () => {
    const menu = findMenuByPath(
      [{ path: '/only', children: undefined }],
      '/only',
    );
    expect(menu).toBeDefined();
    expect(menu?.path).toBe('/only');
  });

  it('finds root menu by path', () => {
    const { findMenu, rootMenu, rootMenuPath } = findRootMenuByPath(
      menus,
      '/services/development/web',
    );

    expect(findMenu).toBeDefined();
    expect(rootMenu).toBeUndefined();
    expect(rootMenuPath).toBeUndefined();
    expect(findMenu?.path).toBe('/services/development/web');
  });

  it('returns null for undefined or empty path', () => {
    const menuUndefinedPath = findMenuByPath(menus);
    const menuEmptyPath = findMenuByPath(menus, '');
    expect(menuUndefinedPath).toBeNull();
    expect(menuEmptyPath).toBeNull();
  });

  it('checks for root menu when path does not exist', () => {
    const { findMenu, rootMenu, rootMenuPath } = findRootMenuByPath(
      menus,
      '/non-existent',
    );
    expect(findMenu).toBeNull();
    expect(rootMenu).toBeUndefined();
    expect(rootMenuPath).toBeUndefined();
  });

  it('resolves the root menu from the ancestors recorded on the hit menu', /** 子菜单带 parents 时要能回溯到顶层菜单，用于面包屑高亮。 */ () => {
    const nested: MenuRecordRaw[] = [
      {
        children: [
          {
            children: [],
            parents: ['/services', '/services/development'],
            path: '/services/development/web',
          },
        ],
        path: '/services',
      },
    ];

    const { findMenu, rootMenu, rootMenuPath } = findRootMenuByPath(
      nested,
      '/services/development/web',
    );

    expect(findMenu?.path).toBe('/services/development/web');
    expect(rootMenuPath).toBe('/services');
    expect(rootMenu?.path).toBe('/services');
  });

  it('keeps rootMenu undefined when the recorded ancestor is not a top-level menu', /** 祖先路径对不上时不能随便挑一个根节点。 */ () => {
    const orphanAncestor: MenuRecordRaw[] = [
      {
        children: [
          {
            children: [],
            parents: ['/missing-root'],
            path: '/services/development/web',
          },
        ],
        path: '/services',
      },
    ];

    const { findMenu, rootMenu, rootMenuPath } = findRootMenuByPath(
      orphanAncestor,
      '/services/development/web',
    );

    expect(findMenu).not.toBeNull();
    expect(rootMenuPath).toBe('/missing-root');
    expect(rootMenu).toBeUndefined();
  });
});
