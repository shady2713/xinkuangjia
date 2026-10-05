/**
 * 布局内容区（layout-ui 的 components/layout-content）样式与遮罩插槽真实渲染回归。
 *
 * 内容区是页面主体的承载容器：定宽布局判定与四向内边距写错会让内容在宽屏下铺满或与页脚重叠，
 * 遮罩插槽未渲染会让加载遮罩、拖拽提示一类浮层无处安放。用例挂载真实组件，注入真实属性并断言
 * 真实渲染出的内联样式与插槽内容，遮罩样式来自真实的布局样式 composable。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import LayoutContent from '../layout-content.vue';

/** 内容区的基准属性：宽屏不写定宽、四向统一内边距。 */
const baseProps = {
  contentCompact: 'wide' as const,
  contentCompactWidth: 1200,
  padding: 16,
  paddingBottom: 8,
  paddingLeft: 4,
  paddingRight: 6,
  paddingTop: 2,
};

/** 读取内容区根元素，缺失时直接报错而不是让断言落到 undefined。 */
function readMain(wrapper: ReturnType<typeof mount>) {
  const main = wrapper.find<HTMLElement>('main');
  if (!main.exists()) {
    throw new Error('内容区根元素未渲染');
  }
  return main;
}

describe('内容区宽窄布局', /** 定宽判定决定内容在宽屏下是否居中收窄，写错会让页面在大屏上过度拉伸。 */ () => {
  it('紧凑布局按声明宽度居中', /** 定宽布局不居中会让内容整体贴左，与顶栏 logo 对不齐。 */ () => {
    const wrapper = mount(LayoutContent, {
      props: { ...baseProps, contentCompact: 'compact' },
    });

    const style = readMain(wrapper).element.style;
    expect(style.margin).toBe('0px auto');
    expect(style.width).toBe('1200px');
    expect(style.flex).toBe('1 1 0%');

    wrapper.unmount();
  });

  it('宽屏布局不写宽度与居中偏移', /** 负对照：宽屏被写死宽度会在小屏上出现横向滚动条。 */ () => {
    const wrapper = mount(LayoutContent, {
      props: baseProps,
    });

    const style = readMain(wrapper).element.style;
    expect(style.width).toBe('');
    expect(style.margin).toBe('');

    wrapper.unmount();
  });
});

describe('内容区内边距', /** 四向内边距决定内容与顶栏、页脚的距离，写错会让内容被裁切或贴边。 */ () => {
  it('按属性渲染统一的 padding 与四向覆盖值', /** 四向覆盖失效会让业务设置的上下边距被统一值覆盖。 */ () => {
    const wrapper = mount(LayoutContent, { props: baseProps });

    const style = readMain(wrapper).element.style;
    expect(style.paddingTop).toBe('2px');
    expect(style.paddingBottom).toBe('8px');
    expect(style.paddingLeft).toBe('4px');
    expect(style.paddingRight).toBe('6px');

    wrapper.unmount();
  });
});

describe('内容区遮罩插槽', /** 遮罩插槽承载加载与拖拽浮层，未渲染会让这些交互提示消失。 */ () => {
  it('渲染默认插槽与遮罩插槽内容', /** 插槽丢失会让页面主体或浮层内容整体空白。 */ () => {
    const wrapper = mount(LayoutContent, {
      props: baseProps,
      slots: {
        default: '<div class="probe-body">DUMMY-页面主体</div>',
        overlay: '<div class="probe-overlay">DUMMY-遮罩</div>',
      },
    });

    expect(wrapper.get('.probe-body').text()).toBe('DUMMY-页面主体');
    const overlay = wrapper.get<HTMLElement>('.probe-overlay');
    expect(overlay.text()).toBe('DUMMY-遮罩');
    // 遮罩内容必须真实继承固定定位与层级样式，否则浮层会随页面滚动或被内容盖住。
    expect(overlay.element.style.position).toBe('fixed');
    expect(overlay.element.style.zIndex).toBe('150');

    wrapper.unmount();
  });
});

describe('内容区根元素样式', /** 内容区根元素的背景与定位类名决定页面底色，丢失会露出默认白底。 */ () => {
  it('根元素带上背景与相对定位类名', /** 背景类名缺失会让内容区与页面底色分层。 */ () => {
    const wrapper = mount(LayoutContent, { props: baseProps });

    expect(readMain(wrapper).classes()).toEqual(
      expect.arrayContaining(['relative', 'bg-background-deep']),
    );

    wrapper.unmount();
  });
});
