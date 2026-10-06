/**
 * 菜单滚动定位：把侧边栏中已激活的菜单项平滑滚动到可视区域中间。
 * enable 支持响应式开关，delay 提供防抖，避免切换频繁时反复滚动。
 * 依赖 aside 下 role=menuitem 的 DOM 结构，水平与折叠菜单不适用。
 */
import type { Ref } from 'vue';

import { watch } from 'vue';

import { useDebounceFn } from '@vueuse/core';

/**
 * 滚动定位的可调参数：enable 控制是否启用，delay 是连续切换激活项时的防抖间隔。
 */
interface UseMenuScrollOptions {
  delay?: number;
  enable?: boolean | Ref<boolean>;
}

/**
 * 监听激活项变化并在启用时把侧边栏中的激活菜单项滚到可视区域中间，滚动本身做了防抖。
 * @param activePath 当前激活项路径；只在它变化时触发定位，初始值不触发。
 * @param options 启用开关与防抖间隔，enable 传布尔值或 ref，均缺省视为启用。
 * @returns 含立即执行定位方法的对象，供调用方在其它时机手动触发。
 */
export function useMenuScroll(
  activePath: Ref<string | undefined>,
  options: UseMenuScrollOptions = {},
) {
  const { enable = true, delay = 320 } = options;

  /**
   * 立即把 aside 内带 is-active 的菜单项平滑滚动到容器中央。
   * 未启用或侧边栏尚未渲染出激活项时直接返回，不做任何滚动。
   */
  function scrollToActiveItem() {
    const isEnabled = typeof enable === 'boolean' ? enable : enable.value;
    if (!isEnabled) return;

    const activeElement = document.querySelector(
      `aside li[role=menuitem].is-active`,
    );
    if (activeElement) {
      activeElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center',
      });
    }
  }

  const debouncedScroll = useDebounceFn(scrollToActiveItem, delay);

  watch(activePath, () => {
    const isEnabled = typeof enable === 'boolean' ? enable : enable.value;
    if (!isEnabled) return;

    debouncedScroll();
  });

  return {
    scrollToActiveItem,
  };
}
