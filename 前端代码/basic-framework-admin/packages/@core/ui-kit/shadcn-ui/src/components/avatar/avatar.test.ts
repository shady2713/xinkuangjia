/** 头像组件测试：验证尺寸、裁剪方式、替代文本与状态点这些对外展示契约。 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import Avatar from './avatar.vue';

/** 读取头像根容器的内联样式。
 * @param wrapper 已挂载的头像组件。
 * @returns 供断言尺寸的 style 文本。
 */
function rootStyleOf(wrapper: ReturnType<typeof mount>) {
  return wrapper.get('div.relative').attributes('style') ?? '';
}

describe('头像组件展示契约', /** 尺寸与裁剪方式由调用方给出，必须落到真实 DOM 样式上。 */ () => {
  it('传入正整数尺寸时输出像素宽高', /** 表格与菜单按统一尺寸渲染头像，缺失尺寸会导致布局抖动。 */ () => {
    const wrapper = mount(Avatar, {
      props: { alt: 'Zhang San', size: 32, src: 'https://example.test/a.png' },
    });

    expect(rootStyleOf(wrapper)).toContain('height: 32px');
    expect(rootStyleOf(wrapper)).toContain('width: 32px');
  });

  it('未传尺寸或尺寸非正数时不写死宽高', /** 默认由 CSS 类控制大小，写死 0px 会让头像不可见。 */ () => {
    const withoutSize = mount(Avatar, {
      props: { alt: 'Zhang San', src: 'https://example.test/a.png' },
    });
    const zeroSize = mount(Avatar, {
      props: { alt: 'Zhang San', size: 0, src: 'https://example.test/a.png' },
    });

    expect(rootStyleOf(withoutSize)).not.toContain('height');
    expect(rootStyleOf(zeroSize)).not.toContain('height');
  });

  it('默认按 cover 裁剪图片', /** 头像区域固定，等比裁剪可避免人脸变形。 */ () => {
    const wrapper = mount(Avatar, {
      props: { alt: 'Zhang San', src: 'https://example.test/a.png' },
    });

    expect(wrapper.get('img').attributes('style')).toContain(
      'object-fit: cover',
    );
  });

  it('传入 contain 时改用该裁剪方式', /** 允许调用方按业务选择完整展示图片。 */ () => {
    const wrapper = mount(Avatar, {
      props: {
        alt: 'Zhang San',
        fit: 'contain',
        src: 'https://example.test/a.png',
      },
    });

    expect(wrapper.get('img').attributes('style')).toContain(
      'object-fit: contain',
    );
  });

  it('图片加载失败时展示替代文本的后两位', /** 无头像图片时必须用可识别文本兜底，而不是空白圆点。 */ () => {
    const wrapper = mount(Avatar, {
      props: { alt: 'Zhang San', src: 'https://example.test/a.png' },
    });

    expect(wrapper.text()).toContain('AN');
  });

  it('裁剪方式为空时不写入 object-fit', /** 外部调用方可能传入空值，此时必须交由 CSS 决定裁剪方式而不是写空样式。 */ () => {
    const wrapper = mount(Avatar, {
      // 外部 JS 调用方可能传入空值：属性类型只声明合法取值，这里按运行期真实输入模拟。
      props: {
        alt: 'Zhang San',
        fit: '',
        src: 'https://example.test/a.png',
      } as unknown as InstanceType<typeof Avatar>['$props'],
    });

    expect(wrapper.get('img').attributes('style')).not.toContain('object-fit');
  });

  it('启用状态点时渲染角标并应用自定义颜色类', /** 在线状态依赖角标，颜色类决定业务语义。 */ () => {
    const wrapper = mount(Avatar, {
      props: {
        alt: 'Zhang San',
        dot: true,
        dotClass: 'bg-red-500',
        src: 'https://example.test/a.png',
      },
    });

    const dot = wrapper.get('span.absolute');
    expect(dot.classes()).toContain('bg-red-500');
  });

  it('未启用状态点时不渲染角标', /** 默认不显示在线状态，避免误报。 */ () => {
    const wrapper = mount(Avatar, {
      props: { alt: 'Zhang San', src: 'https://example.test/a.png' },
    });

    expect(wrapper.find('span.absolute').exists()).toBe(false);
  });

  it('图片地址与替代文本原样交给图片元素', /** 可访问性要求 img 带 alt，且地址不能被改写。 */ () => {
    const wrapper = mount(Avatar, {
      props: { alt: 'Li Si', src: 'https://example.test/b.png' },
    });

    const image = wrapper.get('img');
    expect(image.attributes('src')).toBe('https://example.test/b.png');
    expect(image.attributes('alt')).toBe('Li Si');
  });
});
