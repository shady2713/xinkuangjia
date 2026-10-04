/**
 * 访问模式切换与权限判定（effects/access 的 use-access）的真实行为回归。
 *
 * `useAccess` 是页面与指令共用的权限查询入口，也是"前后端权限模式"切换的唯一写入口：
 * 判定必须基于当前身份的角色/权限码交集，切换必须把新模式写回偏好设置，否则重建布局后
 * 会退回旧模式。真实 Store 依赖 pinia 安装，本用例只替换权限与角色的数据来源，
 * 交集判定与偏好设置写回全部保留真实实现。
 */
import {
  preferences,
  resetPreferences,
  updatePreferences,
} from '@vben/preferences';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAccess } from '../use-access';

const permissionSource = vi.hoisted(
  /** 建立可被各用例逐例重置的权限码与角色数据容器。 */ () => ({
    accessCodes: [] as string[],
    userRoles: [] as string[],
  }),
);

vi.mock(
  '@vben/stores',
  /** 只替换权限数据来源；权限交集判定与偏好设置写回保持真实实现。 */ () => ({
    /** 返回当前生效的权限码集合。 */
    useAccessStore: () => ({ accessCodes: permissionSource.accessCodes }),
    /** 返回当前生效的用户角色集合。 */
    useUserStore: () => ({ userRoles: permissionSource.userRoles }),
  }),
);

describe('useAccess', /** 权限交集判定与访问模式切换都必须落在真实状态上。 */ () => {
  beforeEach(
    /** 每例重置身份数据与偏好设置，避免相互影响。 */ () => {
      permissionSource.accessCodes = [];
      permissionSource.userRoles = [];
      resetPreferences();
    },
  );

  afterEach(
    /** 还原偏好设置，避免把切换结果留给其它测试文件。 */ () => {
      resetPreferences();
    },
  );

  it('按当前角色与目标角色的交集判定角色权限', /** 角色判定必须读当前身份的角色，空角色不能误判为有权限。 */ () => {
    // 数据来源替身在 useAccess 建立时读取一次，必须先写入身份再取权限函数。
    permissionSource.userRoles = ['admin'];
    const { hasAccessByRoles } = useAccess();

    expect(hasAccessByRoles(['admin', 'user'])).toBe(true);
    expect(hasAccessByRoles(['user'])).toBe(false);
    expect(hasAccessByRoles([])).toBe(false);
  });

  it('按当前权限码与目标权限码的交集判定权限', /** 权限码判定必须读当前身份的权限码，任一命中即视为有权限。 */ () => {
    permissionSource.accessCodes = ['system:user:list'];
    const { hasAccessByCodes } = useAccess();

    expect(hasAccessByCodes(['system:user:list', 'system:role:list'])).toBe(
      true,
    );
    expect(hasAccessByCodes(['system:role:list'])).toBe(false);
    expect(hasAccessByCodes([])).toBe(false);
  });

  it('切换访问模式在前后端模式之间往返并写回偏好设置', /** 只改本地变量不写回偏好设置，会在下次读取时退回旧模式。 */ async () => {
    updatePreferences({ app: { accessMode: 'frontend' } });
    const { accessMode, toggleAccessMode } = useAccess();

    expect(accessMode.value).toBe('frontend');

    await toggleAccessMode();

    expect(preferences.app.accessMode).toBe('backend');
    // 偏好设置是响应式来源，切换后计算属性必须跟随变化。
    expect(accessMode.value).toBe('backend');

    await toggleAccessMode();

    expect(preferences.app.accessMode).toBe('frontend');
    expect(accessMode.value).toBe('frontend');
  });
});
