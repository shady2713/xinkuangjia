/**
 * 菜单树检索：findMenuByPath 按 path 递归命中菜单项，未命中返回 null；
 * findRootMenuByPath 在命中结果上借 parents 定位指定层级的根菜单，供面包屑与侧边栏选中态使用。
 * 只读取传入的菜单数据，不修改菜单，也不做权限过滤。
 */
import type { MenuRecordRaw } from '@vben-core/typings';

/** 根据路径在菜单列表中递归查找菜单项 */
function findMenuByPath(
  list: MenuRecordRaw[],
  path?: string,
): MenuRecordRaw | null {
  for (const menu of list) {
    if (menu.path === path) {
      return menu;
    }
    const findMenu = menu.children && findMenuByPath(menu.children, path);
    if (findMenu) {
      return findMenu;
    }
  }
  return null;
}

/**
 * 查找根菜单
 * @param menus
 * @param path
 */
function findRootMenuByPath(menus: MenuRecordRaw[], path?: string, level = 0) {
  const findMenu = findMenuByPath(menus, path);
  const rootMenuPath = findMenu?.parents?.[level];
  const rootMenu = rootMenuPath
    ? menus.find((item) => item.path === rootMenuPath)
    : undefined;
  return {
    findMenu,
    rootMenu,
    rootMenuPath,
  };
}

export { findMenuByPath, findRootMenuByPath };
