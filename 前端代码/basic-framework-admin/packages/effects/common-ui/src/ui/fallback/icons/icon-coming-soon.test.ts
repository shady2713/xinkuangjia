/**
 * 即将上线插画（common-ui 的 ui/fallback/icons/icon-coming-soon）真实行为回归。
 *
 * 该组件是没有脚本的静态 SVG，被兜底页在“即将上线”状态时异步加载：根节点的 viewBox
 * 与宽高决定插画在兜底页中的显示比例，缺一块图元会让“建设中”示意不完整；主题色图元
 * 必须引用 CSS 变量才能跟随偏好设置换色，写死颜色会在深色主题下突兀；脚手架、告示牌与
 * 人物图元是“功能还在搭建”的语义符号，漏画会让用户读不出含义。用例真实渲染组件并断言
 * 渲染出的 SVG 结构与图元数量，不做文本层面的模板比对。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import IconComingSoon from './icon-coming-soon.vue';

/** 插画声明的 viewBox，决定兜底页按原比例缩放。 */
const VIEW_BOX = '0 0 979.32677 424.8366';

/** 插画中主题色图元的填充值，必须跟随偏好设置换色。 */
const PRIMARY_FILL = 'hsl(var(--primary))';

/** 插画使用的全部填充色与对应图元数量，缺任一项都说明图元被改动或丢失。 */
const FILL_USAGE = {
  '#2f2e41': 5,
  '#3f3d56': 4,
  '#ccc': 18,
  '#e4e4e4': 3,
  '#e6e6e6': 3,
  '#f2f2f2': 6,
  '#ffb6b6': 5,
  '#fff': 4,
  [PRIMARY_FILL]: 5,
};

/**
 * 按填充色取出图元。
 * @param wrapper 已挂载的插画包装器。
 * @param fill 图元声明的填充值。
 * @returns 使用该填充色的图元包装器数组。
 */
function shapesByFill(wrapper: ReturnType<typeof mount>, fill: string) {
  return wrapper.findAll(`[fill="${fill}"]`);
}

describe('即将上线插画结构', /** 根节点尺寸与图元数量决定插画能否完整呈现建设场景。 */ () => {
  it('渲染带固定视窗尺寸的根 svg', /** 缺少 viewBox 会让插画在兜底页里被拉伸出错。 */ () => {
    const wrapper = mount(IconComingSoon);
    const svg = wrapper.find('svg');

    expect(svg.exists()).toBe(true);
    expect(svg.attributes('viewBox')).toBe(VIEW_BOX);
    expect(svg.attributes('width')).toBe('979.32677');
    expect(svg.attributes('height')).toBe('424.8366');
    expect(svg.attributes('data-name')).toBe('Layer 1');
    expect(svg.attributes('xmlns')).toBe('http://www.w3.org/2000/svg');
    // 模板声明的 xmlns:xlink 经 Vue 编译后属性名归一化为 xlink，取值保持不变。
    expect(svg.attributes('xlink')).toBe('http://www.w3.org/1999/xlink');
  });

  it('包含完整的图元数量', /** 漏画图元会让建设场景缺件，用户读不出功能尚未上线的含义。 */ () => {
    const wrapper = mount(IconComingSoon);

    expect(wrapper.findAll('path')).toHaveLength(45);
    expect(wrapper.findAll('circle')).toHaveLength(4);
    expect(wrapper.findAll('rect')).toHaveLength(2);
    expect(wrapper.findAll('polygon')).toHaveLength(2);
    // 图元总数与分类计数必须自洽，避免新增图元后分类断言漏更新。
    expect(wrapper.findAll('svg > *')).toHaveLength(53);
  });

  it('每种填充色都覆盖到预期图元', /** 色值被写死或图元被删除都会让插画配色与语义缺件。 */ () => {
    const wrapper = mount(IconComingSoon);

    for (const [fill, count] of Object.entries(FILL_USAGE)) {
      expect(shapesByFill(wrapper, fill)).toHaveLength(count);
    }
  });
});

describe('即将上线插画语义图形', /** 主题色图元与几何图元是表达“正在搭建”的视觉契约。 */ () => {
  it('主题色图元跟随偏好设置换色', /** 写死颜色的图元在深色主题下会与背景冲突。 */ () => {
    const wrapper = mount(IconComingSoon);
    const shapes = shapesByFill(wrapper, PRIMARY_FILL);

    expect(shapes).toHaveLength(5);
    expect(
      shapes.every(
        /** 主题色只允许用在真实图元上，不允许出现空占位节点。 */ (item) =>
          item.element.tagName === 'path',
      ),
    ).toBe(true);
  });

  it('几何图元带有确定的位置与尺寸', /** 缺少坐标会让图元堆叠在原点，插画退化成色块。 */ () => {
    const wrapper = mount(IconComingSoon);

    for (const circle of wrapper.findAll('circle')) {
      expect(circle.attributes('cx')).toBeTruthy();
      expect(circle.attributes('cy')).toBeTruthy();
      expect(circle.attributes('r')).toBeTruthy();
    }
    for (const rect of wrapper.findAll('rect')) {
      expect(rect.attributes('x')).toBeTruthy();
      expect(rect.attributes('y')).toBeTruthy();
    }
    for (const polygon of wrapper.findAll('polygon')) {
      expect(polygon.attributes('points')).toBeTruthy();
    }
  });

  it('人物与设备图元整体做了位移变换', /** 缺少 transform 会让图元落在画布外，插画出现大片空白。 */ () => {
    const wrapper = mount(IconComingSoon);
    const transformed = wrapper.findAll('[transform]');

    expect(transformed).toHaveLength(45);
    expect(
      transformed.every(
        /** 位移矩阵必须统一指向同一画布原点，避免图元错位。 */ (item) =>
          item.attributes('transform') === 'translate(-110.33661 -237.5817)',
      ),
    ).toBe(true);
  });

  it('插画为纯静态图形，不渲染交互元素', /** 兜底插画里出现按钮或脚本会让无障碍与安全扫描产生误报。 */ () => {
    const wrapper = mount(IconComingSoon);

    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.find('a').exists()).toBe(false);
  });
});
