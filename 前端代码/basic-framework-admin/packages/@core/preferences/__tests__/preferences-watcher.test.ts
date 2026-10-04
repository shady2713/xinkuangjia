/**
 * 偏好管理器初始化幂等与系统主题跟随的真实行为回归。
 *
 * 覆盖两条只在真实装配下才出现的契约：
 * ① 同一实例只允许初始化一次，重复初始化不得覆盖首次写定的初始偏好；
 * ② 仅在 auto 模式下跟随系统配色变化，先应用具体主题再恢复 auto。
 * 断言读取管理器对外暴露的只读状态与初始偏好，不触碰私有字段。
 */

import { watch } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import { PreferenceManager } from '../src/preferences';

/** 系统配色变化的监听器签名，仅使用实现实际读取的 matches 字段。 */
type ColorSchemeListener = (event: { matches: boolean }) => void;

/** 记录系统配色监听器的注册与注销，供用例手工触发变化。 */
type MediaQueryHarness = {
  /** 当前注册的 change 监听器；未注册时为 undefined。 */
  listener: ColorSchemeListener | undefined;
  /** 手动触发的系统配色查询结果。 */
  matches: boolean;
  /** 注销调用次数，用于确认监听器按浏览器契约成对注册与移除。 */
  removed: number;
};

/**
 * 以受控的 matchMedia 替身接管系统配色查询。
 * 只替换浏览器 API 这一外部边界，偏好管理器与真实 Store 均保留原实现。
 * @param initialMatches 首次查询 `(prefers-color-scheme: dark)` 时的系统结果。
 * @returns 可读取并触发监听器的句柄。
 */
function stubMatchMedia(initialMatches: boolean): MediaQueryHarness {
  const harness: MediaQueryHarness = {
    listener: undefined,
    matches: initialMatches,
    removed: 0,
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation(
      /** 按查询条件构造受控的媒体查询结果。 */ (query: string) => {
        return {
          /** 只登记暗色查询的 change 事件，其他查询与事件类型不参与主题跟随。 */
          addEventListener: (type: string, handler: ColorSchemeListener) => {
            if (query === '(prefers-color-scheme: dark)' && type === 'change') {
              harness.listener = handler;
            }
          },
          /**
           * 按当前受控结果回答系统配色查询。
           * @returns 暗色查询返回受控结果，其他查询恒为假。
           */
          get matches() {
            return query === '(prefers-color-scheme: dark)'
              ? harness.matches
              : false;
          },
          media: query,
          onchange: null,
          /** 记录注销次数，用例终止后不再触发监听器。 */
          removeEventListener: () => {
            harness.removed += 1;
          },
        } as unknown as MediaQueryList;
      },
    ),
  );
  return harness;
}

describe('偏好管理器初始化幂等（PreferenceManager）', /** 重复初始化必须保留首次写定的偏好。 */ () => {
  it('第二次初始化直接返回且不覆盖初始偏好', /** 应用重复调用初始化是真实场景，第二次不得把已生效的配置改回默认或新入参。 */ async () => {
    stubMatchMedia(false);
    const manager = new PreferenceManager();

    await manager.initPreferences({
      namespace: 'first-namespace',
      overrides: { app: { locale: 'en-US' } },
    });
    const firstInitial = manager.getInitialPreferences();

    await manager.initPreferences({
      namespace: 'second-namespace',
      overrides: { app: { locale: 'zh-CN' } },
    });

    expect(firstInitial.app.locale).toBe('en-US');
    expect(manager.getInitialPreferences()).toBe(firstInitial);
    expect(manager.getPreferences().app.locale).toBe('en-US');
  });

  it('首次初始化写入平台标识', /** 平台标识由初始化流程写入文档根节点，后续渲染依赖该数据集判定 macOS。 */ async () => {
    stubMatchMedia(false);
    const manager = new PreferenceManager();
    delete document.documentElement.dataset.platform;

    await manager.initPreferences({ namespace: 'platform-namespace' });

    expect(['macOs', 'window']).toContain(
      document.documentElement.dataset.platform,
    );
  });
});

describe('系统主题跟随（PreferenceManager）', /** 系统配色变化只在 auto 模式下生效。 */ () => {
  /**
   * 建立已完成初始化并处于 auto 模式的管理器。
   * @returns 管理器与它注册的系统配色监听器。
   */
  async function setupAutoMode() {
    const media = stubMatchMedia(false);
    const manager = new PreferenceManager();
    await manager.initPreferences({ namespace: 'auto-namespace' });
    manager.updatePreferences({ theme: { mode: 'auto' } });
    return { manager, media };
  }

  it('auto 模式下先应用具体主题再恢复 auto', /** 跟随系统时必须依次写入 dark/light 与 auto，界面才会换肤而配置仍保持跟随。 */ async () => {
    const { manager, media } = await setupAutoMode();
    expect(media.listener).toBeTypeOf('function');

    const observed: string[] = [];
    const stop = watch(
      /** 订阅只读偏好上的主题模式，按写入顺序记录取值。 */ () => {
        return manager.getPreferences().theme.mode;
      },
      /** 每次主题模式变化都记录新值，用于还原写入顺序。 */ (mode) => {
        observed.push(mode);
      },
      // 同步冲刷才能观察到同一批次内的两次写入；默认 pre 冲刷只会看到最终值。
      { flush: 'sync' },
    );

    try {
      // 系统已切换到暗色：恢复 auto 后重新判定也必须得到暗色，界面不能闪回亮色。
      media.matches = true;
      media.listener?.({ matches: true });
      await Promise.resolve();

      expect(observed).toEqual(['dark', 'auto']);
      expect(manager.getPreferences().theme.mode).toBe('auto');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    } finally {
      stop();
    }
  });

  it('非 auto 模式忽略系统配色变化', /** 手动选择亮色或暗色后，系统切换不得改写用户配置。 */ async () => {
    const { manager, media } = await setupAutoMode();
    manager.updatePreferences({ theme: { mode: 'light' } });

    const observed: string[] = [];
    const stop = watch(
      /** 订阅只读偏好上的主题模式，按写入顺序记录取值。 */ () => {
        return manager.getPreferences().theme.mode;
      },
      /** 每次主题模式变化都记录新值。 */ (mode) => {
        observed.push(mode);
      },
      // 同步冲刷才能观察到同一批次内的写入，这里期望一次都没有。
      { flush: 'sync' },
    );

    try {
      media.listener?.({ matches: true });
      await Promise.resolve();

      expect(observed).toEqual([]);
      expect(manager.getPreferences().theme.mode).toBe('light');
    } finally {
      stop();
    }
  });
});
