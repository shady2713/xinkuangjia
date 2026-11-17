import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 构造用于隔离本地缓存的内存 Storage。
 * @returns 仅存当前用例数据的 Storage 替身
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
     * 按插入顺序读取键名。
     * @param index 键的位置
     * @returns 对应键名；越界时返回 null
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

/**
 * 验证偏好设置初始化时本地缓存的优先级。
 */
function describePreferenceManagerCachePrecedence() {
  /** 每个用例重置模块，并用内存 Storage 替换浏览器缓存。 */
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
}

describe(
  'preferenceManager cache precedence',
  describePreferenceManagerCachePrecedence,
);
