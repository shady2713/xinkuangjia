/**
 * 布局计算属性（layout-ui 的 use-layout.ts）行为回归。
 *
 * `useLayout` 把布局属性换算成六个互斥的布局标志，管理端外壳与内容区据此切换结构。
 * 这里用真实响应式属性对象验证：移动端强制侧边导航优先于传入布局、各布局模式只点亮
 * 对应标志、属性更新后计算结果随之失效重算。
 */
import type { VbenLayoutProps } from '../../admin-layout';

import { reactive } from 'vue';

import { describe, expect, it } from 'vitest';

import { useLayout } from '../use-layout';

/** 创建用例私有的可变态布局属性，模拟父组件传入的响应式 props。 */
function createProps(overrides: Partial<VbenLayoutProps> = {}) {
  return reactive({
    isMobile: false,
    layout: 'sidebar-nav',
    ...overrides,
  }) as VbenLayoutProps;
}

describe('useLayout 布局标志换算', /** 布局标志决定外壳结构，取值错误会让页面出现重复或缺失的导航区域。 */ () => {
  it('移动端忽略传入布局并强制侧边导航', /** 小屏必须退化为侧边导航，否则头部混合布局无法交互。 */ () => {
    const layout = useLayout(
      createProps({ isMobile: true, layout: 'header-nav' }),
    );

    expect(layout.currentLayout.value).toBe('sidebar-nav');
    expect(layout.isHeaderNav.value).toBe(false);
    expect(layout.isSidebarMixedNav.value).toBe(false);
    expect(layout.isFullContent.value).toBe(false);
  });

  it.each([
    ['full-content', 'isFullContent'],
    ['sidebar-mixed-nav', 'isSidebarMixedNav'],
    ['header-nav', 'isHeaderNav'],
    ['header-mixed-nav', 'isHeaderMixedNav'],
  ] as const)(
    '布局 %s 只点亮 %s',
    /** 每个布局模式必须与唯一标志对应，错配会让外壳渲染出错误区域。 */ (
      layoutType,
      expectedFlag,
    ) => {
      const layout = useLayout(createProps({ layout: layoutType }));
      const flags = {
        isFullContent: layout.isFullContent.value,
        isHeaderMixedNav: layout.isHeaderMixedNav.value,
        isHeaderNav: layout.isHeaderNav.value,
        isMixedNav: layout.isMixedNav.value,
        isSidebarMixedNav: layout.isSidebarMixedNav.value,
      };

      expect(layout.currentLayout.value).toBe(layoutType);
      expect(flags[expectedFlag]).toBe(true);
      expect(
        Object.entries(flags).filter(
          /** 统计除期望标志外被误点亮的标志。 */ ([name, value]) =>
            name !== expectedFlag && value,
        ),
      ).toEqual([]);
    },
  );

  it.each(['mixed-nav', 'header-sidebar-nav'] as const)(
    '布局 %s 归入混合导航',
    /** 两种混合布局共用同一标志，遗漏其中一种会让导航区域判定错误。 */ (
      layoutType,
    ) => {
      const layout = useLayout(createProps({ layout: layoutType }));

      expect(layout.isMixedNav.value).toBe(true);
    },
  );

  it('属性更新后重新计算布局标志', /** 布局在运行期可切换，缓存错误会让界面停留在旧结构。 */ () => {
    const props = createProps({ layout: 'header-nav' });
    const layout = useLayout(props);

    expect(layout.isHeaderNav.value).toBe(true);
    props.isMobile = true;
    expect(layout.currentLayout.value).toBe('sidebar-nav');
    expect(layout.isHeaderNav.value).toBe(false);
    props.isMobile = false;
    props.layout = 'full-content';
    expect(layout.isFullContent.value).toBe(true);
    expect(layout.isHeaderNav.value).toBe(false);
  });
});
