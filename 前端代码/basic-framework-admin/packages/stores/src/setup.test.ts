/** 校验 Store 初始化与批量重置契约：生产存储适配器、持久化键命名和未安装时的失败提示。 */
import type { Pinia } from 'pinia';

import type { App } from 'vue';

import { defineStore } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initStores, resetAllStores } from './setup';

/** 持久化插件替身捕获的选项形状，只包含被测代码实际写入的字段。 */
interface PersistedOptions {
  /** 按 store 标识拼接命名空间的键生成函数。 */
  key: (id: string) => string;
  /** 持久化实际落到的存储实现。 */
  storage: unknown;
}

/** 加密存储适配器契约，被测代码在生产分支提供的读写入口。 */
interface SecureStorageAdapter {
  /** 读取并解密指定键；键不存在时返回空字符串。 */
  getItem: (key: string) => unknown;
  /** 加密后写入指定键。 */
  setItem: (key: string, value: string) => void;
}

/** 持久化插件替身捕获的选项；用例据此核对键命名与实际存储实现。 */
let persistedOptions: PersistedOptions | undefined;

/** 应用替身只记录 pinia 是否被安装，不引入真实组件树。 */
let installedPinia: unknown;

/** 记录 console.error 的替身，用例结束后统一恢复真实实现。 */
let consoleError: ReturnType<typeof vi.spyOn>;

/** 构造只实现 use 的应用替身，用于观察 pinia 安装结果。 */
function createApp() {
  return {
    /** 记录被安装的插件，返回应用自身以匹配链式调用。
     * @param plugin 被安装的插件实例，仅记录引用。
     * @returns 应用替身自身，保持链式调用形状。
     */
    use(plugin: unknown) {
      installedPinia = plugin;
      return this;
    },
  } as unknown as App;
}

/** 初始化 Store 并返回创建出的 pinia 实例。 */
async function bootstrap(namespace = 'probe') {
  return initStores(createApp(), { namespace });
}

/** 读取持久化插件实际收到的选项；插件未被调用时立即失败。 */
function requirePersistedOptions() {
  if (!persistedOptions) throw new Error('持久化插件未被调用');
  return persistedOptions;
}

vi.mock(
  'pinia-plugin-persistedstate',
  /** 真实插件会订阅每个 store 的变更，这里只捕获选项，便于断言存储实现。 */ () => ({
    /** 记录选项并返回空插件，使 initStores 能完成安装。 */
    createPersistedState: (options: PersistedOptions) => {
      persistedOptions = options;
      return /** 空插件实现，仅用于满足安装契约。 */ () => {};
    },
  }),
);

describe('store 初始化与重置', /** 该模块决定登录态持久化方式与切换身份时的状态清理，写错会泄漏或串号。 */ () => {
  beforeEach(
    /** SecureLS 在构造期读取运行时配置，两个分支都需要先提供密钥。 */ () => {
      (
        globalThis as unknown as { _VBEN_ADMIN_PRO_APP_CONF_: unknown }
      )._VBEN_ADMIN_PRO_APP_CONF_ = {
        VITE_APP_STORE_SECURE_KEY: 'DUMMY-store-secure-key',
      };
    },
  );

  afterEach(
    /** 恢复被替换的全局对象与共享状态，避免影响其他用例。 */ () => {
      consoleError?.mockRestore();
      persistedOptions = undefined;
      installedPinia = undefined;
      localStorage.clear();
    },
  );

  it('未安装 pinia 时重置会打印错误并安全返回', /** 首屏初始化前调用重置不能抛错，否则启动流程会被中断。 */ () => {
    consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(/** 屏蔽真实输出，只保留调用记录。 */ () => {});

    expect(
      /** 触发一次未安装状态下的重置，确认不会抛错。 */ () => resetAllStores(),
    ).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith('Pinia is not installed');
  });

  it('初始化后把 pinia 安装到应用并返回同一实例', /** 调用方依赖返回值继续注册 store，安装对象必须是同一个 pinia。 */ async () => {
    const pinia = await bootstrap('probe-app');
    expect(pinia).toBeTypeOf('object');
    expect(installedPinia).toBe(pinia);
    expect(typeof (pinia as Pinia).install).toBe('function');
  });

  it('持久化键按命名空间与 store 标识拼接', /** 多应用共存时键必须带命名空间，否则同名 store 会互相覆盖。 */ async () => {
    await bootstrap('probe-ns');
    expect(requirePersistedOptions().key('auth')).toBe('probe-ns-auth');
    expect(requirePersistedOptions().key('tabbar')).toBe('probe-ns-tabbar');
  });

  it('开发环境直接使用 localStorage', /** 开发调试需要明文可读的持久化数据。 */ async () => {
    await bootstrap('probe-dev');
    expect(requirePersistedOptions().storage).toBe(localStorage);
  });

  it('生产环境改用加密存储且能原样读回', /** 生产分支必须落盘密文，同时保证读取能还原原始值。 */ async () => {
    vi.stubEnv('DEV', false);
    try {
      await bootstrap('probe-prod');
      const storage = requirePersistedOptions().storage as SecureStorageAdapter;

      storage.setItem('probe-key', 'probe-value');
      expect(storage.getItem('probe-key')).toBe('probe-value');
      // 落盘内容必须是密文，明文出现即说明加密分支没有生效。
      const raw = localStorage.getItem('probe-key');
      expect(raw).toBeTypeOf('string');
      expect(raw).not.toContain('probe-value');
      // 读取未写入过的键不能抛出，持久化插件会先探测已有数据。
      expect(storage.getItem('missing-key')).toBe('');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('重置会把已注册 store 的状态恢复为初始值', /** 切换身份时必须清空上一个身份的数据，否则会串号。 */ async () => {
    const pinia = await bootstrap('probe-reset');
    const useProbeStore = defineStore('probe-reset-store', {
      /** 初始状态含可变计数与列表，便于观察重置是否真正发生。 */
      state: () => ({ count: 1, items: ['a'] }),
    });
    const store = useProbeStore(pinia);
    store.count = 9;
    store.items.push('b');

    resetAllStores();

    expect(store.count).toBe(1);
    expect(store.items).toEqual(['a']);
  });
});
