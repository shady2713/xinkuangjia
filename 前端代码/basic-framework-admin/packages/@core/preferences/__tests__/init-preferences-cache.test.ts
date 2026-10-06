/**
 * 偏好缓存优先级的单元测试。
 * 关注点只有一个：本地缓存里存着旧版本偏好时，代码里显式声明的覆盖项必须胜出，
 * 否则升级后用户会一直看到历史遗留的应用名。
 *
 * 被测模块使用静态导入，不使用 `vi.resetModules()` 加动态 `import()`：
 * 该模块图（Vue、@vueuse/core、共享工具包）在单个测试进程内首次加载需要数百毫秒，
 * 动态导入会把这笔开销计入用例自身的 5000ms 超时预算；全量并行运行时加载耗时会随宿主负载
 * 成倍放大（实测单进程约 0.3s，宿主 CPU 超订时超过 8s），曾使本用例稳定超时。
 * 静态导入把模块加载提前到收集阶段，用例体内只保留被测行为。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PreferenceManager } from '../src/preferences';

/**
 * 构造一个最小的 Storage 替身。
 * 只实现偏好管理器实际调用的成员，其余保持未实现，避免替身比被测对象更难维护。
 * @returns 形状与 `window.localStorage` 一致的内存实现。
 */
function createStorage() {
  const store = new Map<string, string>();

  return {
    /** 清空替身里的全部键值。 */
    clear() {
      store.clear();
    },
    /**
     * 读取替身中的值。
     * @param key - 键名。
     * @returns 命中的字符串值；键不存在时返回 null，与浏览器的 Storage 一致。
     */
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
    /**
     * 当前键值对数量，模拟 Storage 的 length 成员。
     * @returns 替身中已写入的键数量。
     */
    get length() {
      return store.size;
    },
    /**
     * 删除单个键，模拟 Storage 的 removeItem 成员。
     * @param key - 键名；键不存在时静默忽略。
     */
    removeItem(key: string) {
      store.delete(key);
    },
    /**
     * 写入键值对，模拟 Storage 的 setItem 成员。
     * @param key - 键名，已存在时覆盖。
     * @param value - 字符串值，替身不做序列化。
     */
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe('preferenceManager cache precedence', /** 缓存里存有旧版本偏好时，代码里显式声明的覆盖项必须胜出。 */ () => {
  /**
   * 本用例替换掉的 window 存储成员及其替换前描述符。
   * 描述符为 undefined 表示该成员原先不是自有属性，恢复时删除本次新增的自有属性。
   */
  let replacedStorageMembers: Array<{
    descriptor: PropertyDescriptor | undefined;
    name: 'localStorage' | 'sessionStorage';
  }> = [];

  beforeEach(
    /** 安装内存存储替身与媒体查询替身，并登记被替换成员的原描述符供用例结束后恢复。 */ () => {
      // happy-dom 的 window 与 globalThis 是同一对象，替换前先登记原描述符供 afterEach 恢复，
      // 避免同一环境内后续用例读到替身存储。
      replacedStorageMembers = (
        ['localStorage', 'sessionStorage'] as const
      ).map(
        /** 登记单个存储成员名及其替换前的属性描述符。 */ (name) => ({
          descriptor: Object.getOwnPropertyDescriptor(window, name),
          name,
        }),
      );

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

      // 固定媒体查询结果，使主题与断点判断不依赖宿主环境的实现细节。
      vi.stubGlobal(
        'matchMedia',
        vi.fn().mockImplementation(
          /** 返回固定匹配结果的媒体查询替身，只有深色主题查询为真。 */ (
            query,
          ) => ({
            addEventListener: vi.fn(),
            addListener: vi.fn(),
            dispatchEvent: vi.fn(),
            matches: query === '(prefers-color-scheme: dark)',
            media: query,
            onchange: null,
            removeEventListener: vi.fn(),
            removeListener: vi.fn(),
          }),
        ),
      );
    },
  );

  afterEach(
    /** 撤销媒体查询替身并按登记的描述符恢复存储成员，避免污染同一环境内的后续用例。 */ () => {
      // matchMedia 由 Vitest 的 stubGlobal 登记，统一撤销；存储成员没有替身设施，按登记的描述符恢复。
      vi.unstubAllGlobals();
      for (const { descriptor, name } of replacedStorageMembers) {
        if (descriptor) {
          Object.defineProperty(window, name, descriptor);
        } else {
          Reflect.deleteProperty(window, name);
        }
      }
      replacedStorageMembers = [];
    },
  );

  it('keeps override app name when cached preferences contain an older name', /** 缓存中的旧应用名不得压过显式覆盖项，且初始化要清理该历史缓存。 */ async () => {
    // 写入旧版本遗留的缓存项，作为“缓存中已有旧应用名”的前置条件。
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

    const preferenceManager = new PreferenceManager();

    await preferenceManager.initPreferences({
      namespace: 'testNamespace',
      overrides: {
        app: {
          name: 'agent-brand',
        },
      },
    });

    // 覆盖项胜出：缓存里的旧应用名不得回流到最终状态。
    expect(preferenceManager.getPreferences().app.name).toBe('agent-brand');
    // 初始化同时清理历史缓存键，避免旧值在后续读取中再次出现。
    expect(window.localStorage.getItem('testNamespace-preferences')).toBeNull();
  });
});
