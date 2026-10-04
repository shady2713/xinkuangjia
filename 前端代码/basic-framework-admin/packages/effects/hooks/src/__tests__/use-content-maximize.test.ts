/**
 * 主体区域最大化（effects/hooks 的 use-content-maximize）的真实行为回归。
 *
 * 两个切换入口写的是同一组布局偏好：`toggleMaximize` 只隐藏页头与侧栏，
 * `toggleMaximizeAndTabbarHidden` 还要求标签栏可切换。写反隐藏标记会让"最大化"变成
 * "全部展开"，漏写标签栏开关会让最大化后仍显示标签栏。用例读取真实偏好设置状态，
 * 不替换偏好模块，也不断言实现内部的中间变量。
 */
import {
  preferences,
  resetPreferences,
  updatePreferences,
} from '@vben/preferences';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useContentMaximize } from '../use-content-maximize';

/** 把布局相关偏好恢复成"非最大化"的确定性基线，避免依赖默认值。 */
function resetLayoutPreferences(): void {
  updatePreferences({
    app: { layout: 'sidebar-nav' },
    header: { hidden: false },
    sidebar: { hidden: false },
    tabbar: { enable: true },
  });
}

describe('useContentMaximize', /** 两个切换入口对页头、侧栏与标签栏的写入口径。 */ () => {
  beforeEach(
    /** 每例从非最大化状态开始，避免上例的隐藏标记影响判断。 */ () => {
      resetPreferences();
      resetLayoutPreferences();
    },
  );

  afterEach(
    /** 还原偏好设置，避免把布局切换留给其它测试文件。 */ () => {
      resetPreferences();
    },
  );

  it('切换最大化时同步隐藏页头与侧栏并可再次还原', /** 只隐藏其中一侧会留下半屏布局，且必须能切回非最大化。 */ () => {
    const { contentIsMaximize, toggleMaximize } = useContentMaximize();

    expect(contentIsMaximize.value).toBe(false);

    toggleMaximize();

    expect(preferences.header.hidden).toBe(true);
    expect(preferences.sidebar.hidden).toBe(true);
    expect(contentIsMaximize.value).toBe(true);

    toggleMaximize();

    expect(preferences.header.hidden).toBe(false);
    expect(preferences.sidebar.hidden).toBe(false);
    expect(contentIsMaximize.value).toBe(false);
  });

  it('切换最大化并隐藏标签栏时同时关闭标签栏开关', /** 最大化场景要求标签栏一起让位，漏写会让内容区被标签栏挤占。 */ () => {
    const { contentIsMaximize, toggleMaximizeAndTabbarHidden } =
      useContentMaximize();

    toggleMaximizeAndTabbarHidden();

    expect(preferences.header.hidden).toBe(true);
    expect(preferences.sidebar.hidden).toBe(true);
    expect(preferences.tabbar.enable).toBe(false);
    expect(contentIsMaximize.value).toBe(true);

    toggleMaximizeAndTabbarHidden();

    expect(preferences.header.hidden).toBe(false);
    expect(preferences.sidebar.hidden).toBe(false);
    expect(preferences.tabbar.enable).toBe(true);
    expect(contentIsMaximize.value).toBe(false);
  });
});
