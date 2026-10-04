/**
 * 访问状态 Store（stores 的 access.ts）菜单查找与锁屏状态回归。
 *
 * `getMenuByPath` 供页签与面包屑按路径定位菜单，必须能递归命中子菜单并在未命中时返回空；
 * `lockScreen`/`unlockScreen` 维护锁屏标记与密码，写错会让用户无法解锁或解锁后仍停留在锁屏。
 * 用例使用真实 Pinia 实例，断言状态字段与查找结果本身。
 */
import type { MenuRecordRaw } from '@vben-core/typings';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAccessStore } from './access';

/** 构造带嵌套子菜单的展示菜单树，模拟服务端权限菜单转换结果。 */
function buildMenus(): MenuRecordRaw[] {
  return [
    {
      name: 'Dashboard',
      path: '/dashboard',
      children: [
        { name: 'Workbench', path: '/dashboard/workbench' },
        {
          name: 'Analysis',
          path: '/dashboard/analysis',
          children: [
            { name: 'Realtime', path: '/dashboard/analysis/realtime' },
          ],
        },
      ],
    },
    { name: 'System', path: '/system' },
  ] as MenuRecordRaw[];
}

describe('accessStore 菜单查找', /** 找不到菜单会让页签标题与面包屑退化。 */ () => {
  beforeEach(
    /** 每例使用独立 Store，不继承上例菜单与锁屏状态。 */ () => {
      setActivePinia(createPinia());
    },
  );

  it('按路径命中顶层菜单', /** 顶层路径是最常见的查找入口。 */ () => {
    const store = useAccessStore();
    store.setAccessMenus(buildMenus());

    expect(store.getMenuByPath('/system')?.name).toBe('System');
  });

  it('递归命中深层子菜单', /** 只有递归查找才能定位三级菜单。 */ () => {
    const store = useAccessStore();
    store.setAccessMenus(buildMenus());

    expect(store.getMenuByPath('/dashboard/analysis/realtime')?.name).toBe(
      'Realtime',
    );
  });

  it('未命中时返回 undefined', /** 缓存路由或外部链接不在菜单树中时不能返回错误菜单。 */ () => {
    const store = useAccessStore();
    store.setAccessMenus(buildMenus());

    expect(store.getMenuByPath('/not-in-menu')).toBeUndefined();
  });

  it('菜单为空时返回 undefined', /** 权限尚未生成时查找不能抛错。 */ () => {
    const store = useAccessStore();

    expect(store.getMenuByPath('/dashboard')).toBeUndefined();
  });
});

describe('accessStore 锁屏状态', /** 锁屏标记与密码不一致会造成无法解锁或误解锁。 */ () => {
  beforeEach(
    /** 每例使用独立 Store，避免锁屏状态跨例泄漏。 */ () => {
      setActivePinia(createPinia());
    },
  );

  it('锁屏写入标记与密码', /** 解锁校验依赖同一份密码，写入缺失会导致任何输入都失败。 */ () => {
    const store = useAccessStore();
    store.lockScreen('lock-password');

    expect(store.isLockScreen).toBe(true);
    expect(store.lockScreenPassword).toBe('lock-password');
  });

  it('解锁清除标记与密码', /** 密码残留会让下次锁屏沿用旧口令。 */ () => {
    const store = useAccessStore();
    store.lockScreen('lock-password');

    store.unlockScreen();

    expect(store.isLockScreen).toBe(false);
    expect(store.lockScreenPassword).toBeUndefined();
  });

  it('解锁后可再次锁屏并更新密码', /** 同一会话内重复锁定必须接受新口令。 */ () => {
    const store = useAccessStore();
    store.lockScreen('first-password');
    store.unlockScreen();

    store.lockScreen('second-password');

    expect(store.isLockScreen).toBe(true);
    expect(store.lockScreenPassword).toBe('second-password');
  });
});
