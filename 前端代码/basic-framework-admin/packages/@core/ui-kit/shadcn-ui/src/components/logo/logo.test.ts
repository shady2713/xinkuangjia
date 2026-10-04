/**
 * 品牌 Logo（shadcn-ui 的 components/logo）真实渲染回归。
 *
 * 该组件是所有布局头部与登录页的品牌入口：主题切换选错图标会让暗色模式显示亮色
 * Logo，折叠态没隐藏文本会撑破侧边栏，跳转地址写错会让点击 Logo 离开应用。用例真实
 * 挂载组件，按属性组合断言渲染出的图标地址、文本可见性与链接地址。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import Logo from './logo.vue';

/** 亮色主题 Logo 地址夹具，用于与暗色主题地址区分。 */
const LIGHT_SRC = 'https://example.test/logo-light.png';
/** 暗色主题 Logo 地址夹具，用于证明暗色分支确实被采用。 */
const DARK_SRC = 'https://example.test/logo-dark.png';

/**
 * 读取组件内真实图片元素，缺失时立即失败。
 * @param wrapper 已挂载的 Logo 组件。
 * @returns 图片元素的 src 与 alt 属性。
 * @throws 未渲染图片时报告契约变化。
 */
function readImage(wrapper: ReturnType<typeof mount>) {
  const image = wrapper.find('img');
  if (!image.exists()) {
    throw new Error('Logo 未渲染图片元素');
  }
  return { alt: image.attributes('alt'), src: image.attributes('src') };
}

describe('品牌图标选择', /** 主题与暗色图标决定品牌图是否与当前配色一致。 */ () => {
  it('亮色主题使用普通图标', /** 默认主题必须使用 src，否则暗色图会出现在亮色页面上。 */ () => {
    const wrapper = mount(Logo, {
      props: { src: LIGHT_SRC, srcDark: DARK_SRC, text: '管理平台' },
    });

    expect(readImage(wrapper)).toEqual({ alt: '管理平台', src: LIGHT_SRC });
  });

  it('暗色主题且提供暗色图标时使用暗色图标', /** 暗色模式必须优先采用 srcDark。 */ () => {
    const wrapper = mount(Logo, {
      props: {
        src: LIGHT_SRC,
        srcDark: DARK_SRC,
        text: '管理平台',
        theme: 'dark',
      },
    });

    expect(readImage(wrapper).src).toBe(DARK_SRC);
  });

  it('暗色主题但未提供暗色图标时回退普通图标', /** 只配了一张图时不能渲染出空图标。 */ () => {
    const wrapper = mount(Logo, {
      props: { src: LIGHT_SRC, text: '管理平台', theme: 'dark' },
    });

    expect(readImage(wrapper).src).toBe(LIGHT_SRC);
  });

  it('没有图标地址时不渲染图片', /** 纯文字品牌不能渲染出坏图占位。 */ () => {
    const wrapper = mount(Logo, { props: { text: '管理平台' } });

    expect(wrapper.find('img').exists()).toBe(false);
  });
});

describe('品牌文本与折叠', /** 折叠态用于窄侧边栏，文本溢出会破坏布局。 */ () => {
  it('默认展示品牌文本', /** 展开态必须显示品牌名，否则头部缺少可识别信息。 */ () => {
    const wrapper = mount(Logo, {
      props: { src: LIGHT_SRC, text: '管理平台' },
    });

    expect(wrapper.text()).toContain('管理平台');
  });

  it('折叠时隐藏品牌文本但保留图标', /** 折叠态只保留图标，隐藏文本不能连图标一起丢掉。 */ () => {
    const wrapper = mount(Logo, {
      props: { collapsed: true, src: LIGHT_SRC, text: '管理平台' },
    });

    expect(wrapper.text()).not.toContain('管理平台');
    expect(readImage(wrapper).src).toBe(LIGHT_SRC);
  });

  it('调用方可以通过文本插槽替换品牌名', /** 业务需要展示多语言或带状态标记的名称时必须可替换。 */ () => {
    const wrapper = mount(Logo, {
      props: { text: '管理平台' },
      slots: {
        /** 渲染可识别的替换文本。 */
        text: () => '自定义品牌',
      },
    });

    expect(wrapper.text()).toContain('自定义品牌');
    expect(wrapper.text()).not.toContain('管理平台');
  });
});

describe('品牌链接与主题类名', /** 跳转地址与主题类名是外部可观察的样式与导航契约。 */ () => {
  it('默认跳转地址不离开当前页面', /** 未配置地址时必须留在应用内，避免点击 Logo 打开空白页。 */ () => {
    const wrapper = mount(Logo, { props: { text: '管理平台' } });

    expect(wrapper.get('a').attributes('href')).toBe('javascript:void 0');
  });

  it('自定义跳转地址原样落到链接上', /** 外部传入的首页地址不能被改写。 */ () => {
    const wrapper = mount(Logo, {
      props: { href: '/dashboard', text: '管理平台' },
    });

    expect(wrapper.get('a').attributes('href')).toBe('/dashboard');
  });

  it('根节点带当前主题类名', /** 主题类名驱动 Logo 的配色样式，缺失会让品牌区域与主题不一致。 */ () => {
    const light = mount(Logo, { props: { text: '管理平台' } });
    const dark = mount(Logo, {
      props: { text: '管理平台', theme: 'dark' },
    });

    expect(light.get('div').classes()).toContain('light');
    expect(dark.get('div').classes()).toContain('dark');
  });

  it('外部类名透传到链接元素', /** 布局需要按位置调整 Logo 间距，透传链路不能被切断。 */ () => {
    const wrapper = mount(Logo, {
      attrs: { class: 'header-logo' },
      props: { text: '管理平台' },
    });

    expect(wrapper.get('a').classes()).toContain('header-logo');
  });

  it('图标尺寸与裁剪方式交给图片元素', /** 尺寸或裁剪方式丢失会让 Logo 变形或撑破头部高度。 */ () => {
    const wrapper = mount(Logo, {
      props: { fit: 'contain', logoSize: 48, src: LIGHT_SRC, text: '管理平台' },
    });

    expect(wrapper.get('div.relative').attributes('style')).toContain(
      'height: 48px',
    );
    expect(wrapper.get('img').attributes('style')).toContain(
      'object-fit: contain',
    );
  });
});
