/**
 * 布局模式换算：把布局属性折算成 currentLayout 与五个模式标志。
 *
 * 供 admin-layout 取舍各布局区域，不产出样式，也不读取路由。
 */
import type { LayoutType } from '@vben-core/typings';

import type { VbenLayoutProps } from '../admin-layout';

import { computed } from 'vue';

/**
 * 把布局属性折算成当前布局与五个模式标志，供布局组件取舍各区域。
 * 移动端一律按 sidebar-nav 处理，此时忽略 props.layout。
 * @param props 布局属性，只读取 isMobile 与 layout 两项。
 * @returns currentLayout 以及 isFullContent、isHeaderMixedNav、isHeaderNav、isMixedNav、isSidebarMixedNav 五个计算属性。
 */
export function useLayout(props: VbenLayoutProps) {
  /** 当前生效的布局类型：移动端强制为 sidebar-nav，桌面端沿用 props.layout 传入的类型。 */
  const currentLayout = computed(() =>
    props.isMobile ? 'sidebar-nav' : (props.layout as LayoutType),
  );

  /**
   * 是否全屏显示content，不需要侧边、底部、顶部、tab区域
   */
  const isFullContent = computed(() => currentLayout.value === 'full-content');

  /**
   * 是否侧边混合模式
   */
  const isSidebarMixedNav = computed(
    () => currentLayout.value === 'sidebar-mixed-nav',
  );

  /**
   * 是否为头部导航模式
   */
  const isHeaderNav = computed(() => currentLayout.value === 'header-nav');

  /**
   * 是否为混合导航模式
   */
  const isMixedNav = computed(
    () =>
      currentLayout.value === 'mixed-nav' ||
      currentLayout.value === 'header-sidebar-nav',
  );

  /**
   * 是否为头部混合模式
   */
  const isHeaderMixedNav = computed(
    () => currentLayout.value === 'header-mixed-nav',
  );

  return {
    currentLayout,
    isFullContent,
    isHeaderMixedNav,
    isHeaderNav,
    isMixedNav,
    isSidebarMixedNav,
  };
}
