/**
 * 菜单滚动定位（use-menu-scroll.ts）的真实 DOM 与防抖行为回归。
 *
 * 该 composable 在侧边菜单中把当前激活项滚入可视区域：显式调用立即定位，激活路径变化时
 * 走防抖路径，`enable` 为布尔或响应式引用时都必须能关闭定位。用例使用真实 DOM 结构、
 * 真实 `watch` 与模拟计时器，断言元素是否真的收到滚动请求。
 */
import { nextTick, ref } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMenuScroll } from '../use-menu-scroll';

/** 记录激活菜单项的 scrollIntoView 调用参数。 */
const scrollIntoView = vi.fn();

/** 在真实 DOM 中建立侧边菜单容器，并按需放入一个激活菜单项。 */
function renderActiveMenu(withActive = true) {
  const menuItem = document.createElement('li');
  menuItem.setAttribute('role', 'menuitem');
  if (withActive) menuItem.classList.add('is-active');
  menuItem.scrollIntoView = scrollIntoView;
  const aside = document.createElement('aside');
  const list = document.createElement('ul');
  list.append(menuItem);
  aside.append(list);
  document.body.append(aside);
  return menuItem;
}

describe('useMenuScroll 菜单滚动定位', /** 滚动定位错误会让用户看不到当前菜单项。 */ () => {
  beforeEach(
    /** 每例使用独立计时器与调用记录，不继承上例状态。 */ () => {
      vi.useFakeTimers();
      scrollIntoView.mockClear();
      document.body.innerHTML = '';
    },
  );
  afterEach(
    /** 恢复真实计时器并清理真实 DOM。 */ () => {
      vi.useRealTimers();
      document.body.innerHTML = '';
    },
  );

  it('显式定位把激活项滚动到容器中部', /** 参数决定滚动动画与对齐方式，写错会让菜单跳动或停在边缘。 */ () => {
    renderActiveMenu();
    const { scrollToActiveItem } = useMenuScroll(ref('/dashboard'));

    scrollToActiveItem();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'center',
    });
  });

  it('没有激活项时静默返回', /** 菜单切换瞬间可能没有激活项，此时不能抛错中断渲染。 */ () => {
    renderActiveMenu(false);
    const { scrollToActiveItem } = useMenuScroll(ref('/dashboard'));

    expect(
      /** 无激活项时执行定位。 */ () => scrollToActiveItem(),
    ).not.toThrow();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('enable 为 false 时不滚动', /** 折叠菜单或禁用定位时不能再改动滚动位置。 */ () => {
    const menuItem = renderActiveMenu();
    const { scrollToActiveItem } = useMenuScroll(ref('/dashboard'), {
      enable: false,
    });

    scrollToActiveItem();

    expect(scrollIntoView).not.toHaveBeenCalled();
    // 激活项仍在页面中，证明定位被配置关闭而不是选择器失效。
    expect(document.body.contains(menuItem)).toBe(true);
  });

  it('enable 为响应式引用时按当前取值决定是否滚动', /** 定位开关随布局状态变化，必须在每次调用时读取最新值。 */ () => {
    renderActiveMenu();
    const enable = ref(false);
    const { scrollToActiveItem } = useMenuScroll(ref('/dashboard'), {
      enable,
    });

    scrollToActiveItem();
    expect(scrollIntoView).not.toHaveBeenCalled();

    enable.value = true;
    scrollToActiveItem();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('激活路径变化后经防抖定位一次', /** 连续切换菜单只应滚动一次，避免菜单抖动。 */ async () => {
    renderActiveMenu();
    const activePath = ref('/first');
    useMenuScroll(activePath, { delay: 40 });

    activePath.value = '/second';
    await nextTick();
    expect(scrollIntoView).not.toHaveBeenCalled();

    vi.advanceTimersByTime(39);
    expect(scrollIntoView).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('禁用时激活路径变化不触发滚动', /** 关闭定位后路径变化同样不能改动滚动位置。 */ async () => {
    renderActiveMenu();
    const activePath = ref('/first');
    const enable = ref(false);
    useMenuScroll(activePath, { delay: 40, enable });

    activePath.value = '/second';
    await nextTick();
    vi.advanceTimersByTime(100);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
