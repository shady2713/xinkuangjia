/** 验证共享用户 Store 的明确身份模型与清空身份时的角色撤销。 */
import {
  createPinia,
  disposePinia,
  getActivePinia,
  setActivePinia,
} from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useUserStore } from './user';

describe('useUserStore', /** 用真实 Pinia 验证身份及角色清理。 */ () => {
  beforeEach(
    /** 隔离各例用户状态。 */ () => {
      setActivePinia(createPinia());
    },
  );
  afterEach(
    /** 释放每例状态及订阅。 */ () => {
      const pinia = getActivePinia();
      if (pinia) disposePinia(pinia);
    },
  );

  it('returns correct userInfo', /** 使用实际共享身份模型，禁止虚构展示字段。 */ () => {
    const store = useUserStore();
    const userInfo = {
      avatar: '',
      nickname: 'Jane Doe',
      userId: '1',
      username: 'user',
    };
    store.setUserInfo(userInfo);
    expect(store.userInfo).toEqual(userInfo);
  });

  // 测试重置用户信息时的行为
  it('clears userInfo and userRoles when setting null userInfo', /** 验证公开支持的空身份同时撤销角色。 */ () => {
    const store = useUserStore();
    store.setUserInfo({
      avatar: '',
      nickname: 'User',
      userId: '1',
      username: 'user',
    });
    store.setUserRoles(['user']);
    expect(store.userInfo).not.toBeNull();
    expect(store.userRoles.length).toBeGreaterThan(0);

    store.setUserInfo(null);
    expect(store.userInfo).toBeNull();
    expect(store.userRoles).toEqual([]);
  });

  // 测试在没有用户角色时返回空数组
  it('returns an empty array for userRoles if not set', /** 未登录前不能出现预设授权。 */ () => {
    const store = useUserStore();
    expect(store.userRoles).toEqual([]);
  });
});
