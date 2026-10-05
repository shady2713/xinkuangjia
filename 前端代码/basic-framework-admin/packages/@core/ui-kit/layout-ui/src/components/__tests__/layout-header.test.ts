/**
 * 布局顶栏（layout-ui 的 components/layout-header）样式与插槽真实渲染回归。
 *
 * 顶栏承载 logo、折叠按钮与右侧内容，高度、隐藏位移与 logo 最小宽度决定页面骨架是否正确：
 * 隐藏状态未按高度上移会让页面顶部留下一整条空白，logo 在移动端未收窄会挤掉折叠按钮，
 * 定宽布局判定写反会让顶栏右侧留出错误间距。用例挂载真实组件，传入真实属性并断言真实渲染
 * 出的内联样式与插槽内容，不替换任何内部实现。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import LayoutHeader from '../layout-header.vue';

/** 顶栏的基准属性：桌面端、可见、通栏，供各用例按需覆盖。 */
const baseProps = {
  fullWidth: true,
  height: 48,
  isMobile: false,
  show: true,
  sidebarWidth: 210,
  theme: 'light',
  width: '100%',
  zIndex: 100,
};

/** 读取顶栏根元素的内联样式，失败时直接报错而不是让断言落到 undefined。 */
function readHeaderStyle(wrapper: ReturnType<typeof mount>) {
  const header = wrapper.find<HTMLElement>('header');
  if (!header.exists()) {
    throw new Error('顶栏根元素未渲染');
  }
  return header.element.style;
}

/** 读取 logo 容器元素，容器缺失说明 logo 插槽分支未生效。 */
function readLogoStyle(wrapper: ReturnType<typeof mount>) {
  const logo = wrapper.find<HTMLElement>('header > div');
  if (!logo.exists()) {
    throw new Error('logo 容器未渲染');
  }
  return logo.element.style;
}

describe('顶栏显示状态与高度', /** 隐藏位移与高度写错会让顶栏遮挡内容或在顶部留下空白。 */ () => {
  it('可见时按高度撑开且不产生负位移', /** 可见状态带负位移会把顶栏整体推出视口。 */ () => {
    const wrapper = mount(LayoutHeader, { props: baseProps });

    const style = readHeaderStyle(wrapper);
    expect(style.height).toBe('48px');
    expect(style.marginTop).toBe('0px');

    wrapper.unmount();
  });

  it('隐藏时按高度上移让出页面空间', /** 隐藏后不上移会在页面顶部留下与顶栏等高的空白。 */ () => {
    const wrapper = mount(LayoutHeader, {
      props: { ...baseProps, show: false },
    });

    expect(readHeaderStyle(wrapper).marginTop).toBe('-48px');

    wrapper.unmount();
  });
});

describe('顶栏横向布局', /** 通栏判定决定顶栏右侧是否贴边，写反会让页面两侧出现错位。 */ () => {
  it('通栏且可见时右侧贴边', /** 通栏顶栏必须定位到右侧 0，否则右侧留出未覆盖区域。 */ () => {
    const wrapper = mount(LayoutHeader, { props: baseProps });

    expect(readHeaderStyle(wrapper).right).toBe('0px');

    wrapper.unmount();
  });

  it('非通栏时不设置右侧贴边', /** 定宽布局的顶栏必须与内容区对齐，不能被强行拉到右边缘。 */ () => {
    const wrapper = mount(LayoutHeader, {
      props: { ...baseProps, fullWidth: false },
    });

    expect(readHeaderStyle(wrapper).right).toBe('');

    wrapper.unmount();
  });

  it('隐藏时不设置右侧贴边', /** 隐藏态仍写右侧贴边会让顶栏在动画期间横向跳动。 */ () => {
    const wrapper = mount(LayoutHeader, {
      props: { ...baseProps, show: false },
    });

    expect(readHeaderStyle(wrapper).right).toBe('');

    wrapper.unmount();
  });
});

describe('顶栏 logo 与插槽', /** logo 宽度与插槽缺失会让顶栏出现空白块或丢失操作入口。 */ () => {
  it('桌面端 logo 按侧边栏宽度占位并渲染全部插槽', /** logo 未按侧边栏宽度占位会让顶栏与菜单列错位。 */ () => {
    const wrapper = mount(LayoutHeader, {
      props: baseProps,
      slots: {
        default: '<span class="probe-right">DUMMY-右侧内容</span>',
        logo: '<span class="probe-logo">DUMMY-品牌</span>',
        'toggle-button':
          '<button class="probe-toggle" type="button">折叠</button>',
      },
    });

    expect(readLogoStyle(wrapper).minWidth).toBe('210px');
    expect(wrapper.get('.probe-logo').text()).toBe('DUMMY-品牌');
    expect(wrapper.find('.probe-toggle').exists()).toBe(true);
    expect(wrapper.get('.probe-right').text()).toBe('DUMMY-右侧内容');

    wrapper.unmount();
  });

  it('移动端 logo 收窄为固定最小宽度', /** 移动端仍按侧边栏宽度占位会把折叠按钮挤出屏幕。 */ () => {
    const wrapper = mount(LayoutHeader, {
      props: { ...baseProps, isMobile: true },
      slots: { logo: '<span class="probe-logo">DUMMY-品牌</span>' },
    });

    expect(readLogoStyle(wrapper).minWidth).toBe('40px');

    wrapper.unmount();
  });

  it('未提供 logo 插槽时不渲染 logo 容器', /** 没有 logo 仍渲染容器会在顶栏左侧留下空占位。 */ () => {
    const wrapper = mount(LayoutHeader, { props: baseProps });

    expect(wrapper.find('header > div').exists()).toBe(false);

    wrapper.unmount();
  });
});

describe('顶栏主题类名', /** 主题类名决定顶栏配色，丢失会与页面明暗风格冲突。 */ () => {
  it('按属性渲染主题类名', /** 主题类名缺失会让顶栏与侧边栏明显不同色。 */ () => {
    const wrapper = mount(LayoutHeader, {
      props: { ...baseProps, theme: 'dark' },
    });

    expect(wrapper.get('header').classes()).toContain('dark');

    wrapper.unmount();
  });
});
