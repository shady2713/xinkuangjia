/** 验证 Pinia 初始化在空白存储密钥下的原生 localStorage 回退与全量 Store 重置。 */
import { createApp, nextTick } from 'vue';

import { defineStore } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initStores, resetAllStores } from '../setup';

const originalConfig = (window as any)._VBEN_ADMIN_PRO_APP_CONF_;

afterEach(() => {
  (window as any)._VBEN_ADMIN_PRO_APP_CONF_ = originalConfig;
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe('stores/setup 初始化与复位', () => {
  it('生产环境空白混淆密钥时直接持久化到 localStorage 且 resetAllStores 能复位状态', async () => {
    vi.stubEnv('DEV', false);
    (window as any)._VBEN_ADMIN_PRO_APP_CONF_ = {
      VITE_APP_STORE_SECURE_KEY: '   ',
    };
    const app = createApp({});
    const pinia = await initStores(app, { namespace: 'unit-ns' });

    const useCounterStore = defineStore('counter', {
      persist: true,
      /** 初始化演示计数器状态。 */
      state: () => ({ count: 0 }),
    });
    const store = useCounterStore(pinia);
    store.count = 42;
    await nextTick();
    expect(localStorage.getItem('unit-ns-counter')).toContain('42');

    resetAllStores();
    expect(store.count).toBe(0);
  });

  it('生产环境配置非空混淆密钥时启用 SecureLS，且旧明文损坏时安全清理不崩溃', async () => {
    vi.stubEnv('DEV', false);
    (window as any)._VBEN_ADMIN_PRO_APP_CONF_ = {
      VITE_APP_STORE_SECURE_KEY: 'CHANGE_ME_UNIT_SECURE_KEY',
    };
    // 预置无法按当前密钥解密的旧数据，模拟首次启用密钥或密钥轮换场景
    localStorage.setItem('enc-ns-corrupt', 'not-valid-aes-payload');
    const app = createApp({});
    const pinia = await initStores(app, { namespace: 'enc-ns' });

    const useCorruptStore = defineStore('corrupt', {
      persist: true,
      /** 初始化演示状态。 */
      state: () => ({ flag: 'default' }),
    });
    const store = useCorruptStore(pinia);
    expect(store.flag).toBe('default');

    store.flag = 'updated';
    await nextTick();
    const raw = localStorage.getItem('enc-ns-corrupt');
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('updated');
  });
});
