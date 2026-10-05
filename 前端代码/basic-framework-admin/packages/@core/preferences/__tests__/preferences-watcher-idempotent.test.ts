/**
 * 偏好管理器监听器建立（preferences 的 PreferenceManager.setupWatcher）的真实行为回归。
 *
 * 初始化时会建立断点监听与系统主题监听：初始化完成后再次进入监听建立流程必须直接返回，
 * 否则每重复一次就多挂一份系统主题回调与断点监听，主题切换时偏好被写回多次，监听器也随
 * 调用次数泄漏。用例真实创建 PreferenceManager 并真实完成初始化，只在 matchMedia
 * （测试环境没有实现的浏览器外部 API）上做替身并统计订阅次数，断言的是订阅注册这一可
 * 观察结果；未初始化一侧同样断言会真实注册，证明提前返回来自初始化标记而不是空实现。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PreferenceManager } from '../src/preferences';

/** 系统主题媒体查询串，与实现里监听的查询保持一致。 */
const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/** 监听建立过程中被查询过的媒体查询串，用于核对是否又走了一遍建立流程。 */
const queriedMedia: string[] = [];

/** 各媒体查询串上 change 订阅的替身，用于统计订阅次数。 */
const changeListeners = new Map<string, ReturnType<typeof vi.fn>>();

/**
 * 构造媒体查询替身：matchMedia 在测试环境没有可用实现，属浏览器外部边界。
 * @param query 媒体查询串。
 * @returns 具备 matchMedia 返回值的媒体查询对象。
 */
function createMediaQuery(query: string) {
  queriedMedia.push(query);
  const addEventListener = vi.fn(
    /** 记录 change 订阅，供用例核对是否重复注册。 */ () => {},
  );
  changeListeners.set(query, addEventListener);
  return {
    addEventListener,
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(
      /** 撤销订阅；本用例不断言撤销行为。 */ () => {},
    ),
  };
}

/** 供用例读取私有监听建立入口的最小类型，避免把整个实例断言成 never。 */
type WatcherSetup = {
  /** 初始化完成后再次进入的监听建立入口，真实实现里由初始化标记提前返回。 */
  setupWatcher: () => void;
};

describe('偏好管理器的监听建立', /** 监听只应建立一次，重复建立会让偏好写入次数与订阅数量一起膨胀。 */ () => {
  beforeEach(
    /** 每例重置统计并安装媒体查询替身。 */ () => {
      queriedMedia.length = 0;
      changeListeners.clear();
      vi.stubGlobal(
        'matchMedia',
        vi.fn(
          /** 按查询串交出媒体查询替身。 */ (query: string) =>
            createMediaQuery(query),
        ),
      );
    },
  );

  afterEach(
    /** 撤销全局替身，避免影响其它测试文件。 */ () => {
      vi.unstubAllGlobals();
    },
  );

  it('初始化完成后重复建立监听不会新增订阅', /** 重复订阅会让一次系统主题切换把偏好写回多次，也是监听器泄漏的入口。 */ async () => {
    const manager = new PreferenceManager();
    await manager.initPreferences({ namespace: 'DUMMY-偏好命名空间' });

    const darkQueryListener = changeListeners.get(DARK_SCHEME_QUERY);
    expect(darkQueryListener).toHaveBeenCalledTimes(1);
    const queriedAfterInit = queriedMedia.length;
    expect(queriedAfterInit).toBeGreaterThan(0);

    // 初始化完成后再次进入监听建立流程：真实实现走的是初始化标记的提前返回。
    (manager as unknown as WatcherSetup).setupWatcher();

    expect(queriedMedia.length).toBe(queriedAfterInit);
    expect(darkQueryListener).toHaveBeenCalledTimes(1);
  });

  it('未完成初始化时建立监听会真实注册系统主题订阅', /** 这一侧证明提前返回来自初始化标记，建立流程本身并非空实现。 */ () => {
    const manager = new PreferenceManager();
    const queriedBefore = queriedMedia.length;

    (manager as unknown as WatcherSetup).setupWatcher();

    expect(queriedMedia.length).toBeGreaterThan(queriedBefore);
    expect(changeListeners.get(DARK_SCHEME_QUERY)).toHaveBeenCalledTimes(1);
  });
});
