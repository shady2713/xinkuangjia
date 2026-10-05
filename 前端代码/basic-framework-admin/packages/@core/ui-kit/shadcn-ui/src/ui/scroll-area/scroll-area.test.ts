/**
 * 滚动区域（shadcn-ui 的 ui/scroll-area）结构与滚动回调回归。
 *
 * 滚动区域用于长列表与长表单：根节点必须裁剪溢出，视口要能滚动并把滚动事件交给调用方，
 * 垂直滚动条按方向使用不同尺寸类。裁剪或滚动条方向写错会让长内容溢出容器或滚动条错位。
 * 用例真实挂载 reka-ui 的滚动区域根节点，读取真实的裁剪样式、滚动条方向与滚动回调。
 */
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import ScrollArea from './ScrollArea.vue';
import ScrollBar from './ScrollBar.vue';

/** 滚动事件回调签名。 */
type ScrollHandler = (event: Event) => void;

/**
 * 挂载滚动区域。
 * @param onScroll 滚动回调替身。
 * @param orientation 额外滚动条的方向。
 * @returns 已挂载的滚动区域包装器。
 */
function mountScrollArea(
  onScroll: ScrollHandler,
  orientation: 'horizontal' | 'vertical' = 'horizontal',
) {
  return mount(
    h(
      ScrollArea,
      { class: 'custom-area', onScroll, type: 'always' },
      {
        /** 渲染长内容与额外滚动条。 */
        default: () => [
          h('div', { class: 'area-body', style: 'height: 2000px' }, '长内容'),
          h(ScrollBar, { class: 'custom-bar', orientation }),
        ],
      },
    ),
  );
}

describe('滚动区域结构', /** 裁剪与滚动方向决定长内容是否可正常浏览。 */ () => {
  it('根节点裁剪溢出并合并调用方 class', /** 未裁剪会让长内容溢出容器，遮住其他区域。 */ async () => {
    const wrapper = mountScrollArea(vi.fn());
    await nextTick();

    expect(wrapper.find('.custom-area').classes()).toContain('overflow-hidden');
    expect(wrapper.find('.custom-area').classes()).toContain('relative');
    expect(wrapper.find('.area-body').text()).toBe('长内容');
  });

  it('横向滚动条使用横向尺寸类', /** 方向类写错会让横向滚动条竖着显示。 */ async () => {
    const wrapper = mountScrollArea(vi.fn(), 'horizontal');
    await nextTick();

    const horizontal = wrapper.find('.custom-bar');
    expect(horizontal.classes()).toContain('h-2.5');
    expect(horizontal.classes()).toContain('flex-col');
    expect(horizontal.attributes('data-orientation')).toBe('horizontal');
  });

  it('垂直滚动条使用垂直尺寸类并默认渲染拖动滑块', /** 缺少滑块会让滚动条无法拖动。 */ async () => {
    const wrapper = mountScrollArea(vi.fn(), 'vertical');
    await nextTick();

    const vertical = wrapper.find('.custom-bar');
    expect(vertical.classes()).toContain('w-2.5');
    expect(vertical.classes()).toContain('h-full');
    expect(vertical.attributes('data-orientation')).toBe('vertical');
    expect(vertical.html()).toContain('rounded-full');
  });
});

describe('滚动区域滚动回调', /** 滚动回调用于懒加载与回到顶部按钮。 */ () => {
  it('视口滚动时把事件交给调用方', /** 不转发会让依赖滚动位置的交互失效。 */ async () => {
    const onScroll = vi.fn();
    const wrapper = mountScrollArea(onScroll);
    await nextTick();

    const viewport = wrapper.find('[data-reka-scroll-area-viewport]');
    expect(viewport.exists()).toBe(true);
    await viewport.trigger('scroll');

    expect(onScroll).toHaveBeenCalledTimes(1);
  });
});
