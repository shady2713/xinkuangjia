/**
 * 偏好缓存优先级的单元测试。
 * 关注点只有一个：本地缓存里存着旧版本偏好时，代码里显式声明的覆盖项必须胜出，
 * 否则升级后用户会一直看到历史遗留的应用名。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 构造一个最小的 Storage 替身。
 * 只实现偏好管理器实际调用的成员，其余保持未实现，避免替身比被测对象更难维护。
 * @returns 形状与 `window.localStorage` 一致的内存实现。
 */
function createStorage() {
  const store = new Map<string, string>();

  return {
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    /**
     * 按序号取键名，模拟 Storage 的 key() 成员。
     * @param index 从 0 开始的键序号。
     * @returns 该序号对应的键名；序号越界时返回 null，与浏览器行为一致。
     */
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    get length() {
      return store.size;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe('preferenceManager cache precedence', /** 缓存里存有旧版本偏好时，代码里显式声明的覆盖项必须胜出。 */ () => {
  beforeEach(() => {
    vi.resetModules();

    const localStorage = createStorage();
    const sessionStorage = createStorage();

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: localStorage,
    });
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: sessionStorage,
    });

    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query) => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    );
  });

  it('keeps override app name when cached preferences contain an older name', async () => {
    window.localStorage.setItem(
      'testNamespace-preferences',
      JSON.stringify({
        value: {
          app: {
            name: 'legacy-brand',
          },
        },
      }),
    );

    const { PreferenceManager } = await import('../src/preferences');
    const preferenceManager = new PreferenceManager();

    await preferenceManager.initPreferences({
      namespace: 'testNamespace',
      overrides: {
        app: {
          name: 'agent-brand',
        },
      },
    });

    expect(preferenceManager.getPreferences().app.name).toBe('agent-brand');
  });
});
