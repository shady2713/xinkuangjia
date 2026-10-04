/**
 * 无权限兜底插画（common-ui 的 ui/fallback/icons/icon-403）真实行为回归。
 *
 * 该组件是没有脚本的静态 SVG，被兜底页在 `status="403"` 时异步加载：根节点的
 * viewBox 与宽高决定插画在兜底页中的显示比例，缺一块图元会让"禁止访问"示意不完整；
 * 主题色圆牌与白色叉号是表达"无权限"的核心语义符号，写成固定颜色会在深色主题下
 * 与背景冲突；人物肤色与浏览器窗口线框决定插画能否读出"被人为拦截"的场景。
 * 用例真实渲染组件并断言渲染出的 SVG 结构，不做文本层面的模板比对。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import Icon403 from './icon-403.vue';

/** 插画声明的 viewBox，决定兜底页按原比例缩放。 */
const VIEW_BOX = '0 0 586 659.29778';

/** 插画中主题色图元的填充值，必须跟随偏好设置换色。 */
const PRIMARY_FILL = 'hsl(var(--primary))';

/** 插画使用的全部填充色，缺少任一色值都说明图元被改动或丢失。 */
const FILL_USAGE = {
  '#2f2e41': 6,
  '#3f3d56': 12,
  '#a0616a': 5,
  '#cacaca': 2,
  '#f2f2f2': 2,
  '#fff': 4,
  [PRIMARY_FILL]: 1,
};

/**
 * 按填充色统计图元数量。
 * @param wrapper 已挂载的插画包装器。
 * @param fill 图元声明的填充值。
 * @returns 使用该填充色的图元包装器数组。
 */
function shapesByFill(wrapper: ReturnType<typeof mount>, fill: string) {
  return wrapper.findAll(`[fill="${fill}"]`);
}

describe('无权限插画结构', /** 根节点尺寸与图元数量决定插画能否完整呈现拒绝访问场景。 */ () => {
  it('渲染带固定视窗尺寸的根 svg', /** 缺少 viewBox 会让插画在兜底页里被拉伸出错。 */ () => {
    const wrapper = mount(Icon403);
    const svg = wrapper.find('svg');

    expect(svg.exists()).toBe(true);
    expect(svg.attributes('viewBox')).toBe(VIEW_BOX);
    expect(svg.attributes('width')).toBe('586');
    expect(svg.attributes('height')).toBe('659.29778');
    expect(svg.attributes('xmlns')).toBe('http://www.w3.org/2000/svg');
    // 模板声明的 xmlns:xlink 经 Vue 编译后属性名归一化为 xlink，取值保持不变。
    expect(svg.attributes('xlink')).toBe('http://www.w3.org/1999/xlink');
  });

  it('包含完整的图元分组与数量', /** 漏画图元会让无权限示意缺件，用户读不出被拦截的含义。 */ () => {
    const wrapper = mount(Icon403);

    expect(wrapper.findAll('path')).toHaveLength(23);
    expect(wrapper.findAll('circle')).toHaveLength(3);
    expect(wrapper.findAll('rect')).toHaveLength(1);
    expect(wrapper.findAll('polygon')).toHaveLength(2);
    expect(wrapper.findAll('ellipse')).toHaveLength(3);
    expect(wrapper.findAll('g')).toHaveLength(1);
    // 图元总数与分类计数必须自洽，避免新增图元后分类断言漏更新。
    expect(
      wrapper.findAll('path, circle, rect, polygon, ellipse'),
    ).toHaveLength(32);
    // 浏览器窗口里的控件图元集中在唯一的 g 分组内，分组内容缺失会让窗口只剩空框。
    expect(wrapper.find('g').findAll('ellipse')).toHaveLength(3);
    expect(wrapper.find('g').findAll('path')).toHaveLength(6);
  });

  it('每种填充色都覆盖到预期图元', /** 色值被写死或图元被删除都会让插画配色与语义缺件。 */ () => {
    const wrapper = mount(Icon403);

    for (const [fill, count] of Object.entries(FILL_USAGE)) {
      expect(shapesByFill(wrapper, fill)).toHaveLength(count);
    }
  });
});

describe('无权限插画语义图形', /** 主题色圆牌与白色叉号是插画表达"禁止访问"的关键视觉契约。 */ () => {
  it('禁止圆牌使用主题色并带旋转位移', /** 写死颜色的圆牌在深色主题下会与背景冲突。 */ () => {
    const wrapper = mount(Icon403);
    const badge = wrapper.find(`circle[fill="${PRIMARY_FILL}"]`);

    expect(badge.exists()).toBe(true);
    expect(badge.attributes('cx')).toBe('281.3585');
    expect(badge.attributes('cy')).toBe('285.71051');
    expect(badge.attributes('r')).toBe('51.12006');
    expect(badge.attributes('transform')).toBe(
      'translate(-26.58509 542.54478) rotate(-85.26884)',
    );
  });

  it('圆牌内绘制白色叉号表达禁止', /** 叉号缺失会让插画退化成普通空状态图，表达不出无权限。 */ () => {
    const wrapper = mount(Icon403);
    const cross = wrapper
      .findAll('path[fill="#fff"]')
      .find(
        /** 只挑出圆牌内的叉号路径，窗口线框与它无关。 */ (item) =>
          item.attributes('d')?.startsWith('M294.78675,264.41051') === true,
      );

    expect(cross).toBeDefined();
  });

  it('绘制被拦截场景的人物与窗口线框', /** 缺少人物或窗口会让插画只剩符号，读不出"操作被拦下"的场景。 */ () => {
    const wrapper = mount(Icon403);
    const window = wrapper.find('rect');

    expect(window.attributes('fill')).toBe('#fff');
    expect(window.attributes('rx')).toBe('17.49318');
    expect(window.attributes('width')).toBe('163.61147');
    // 肤色图元分布在头部、手臂和腿部，任何一处缺失都说明人物被简化掉。
    expect(shapesByFill(wrapper, '#a0616a')).toHaveLength(5);
  });

  it('插画为纯静态图形，不渲染交互元素', /** 兜底插画里出现按钮或脚本会让无障碍与安全扫描产生误报。 */ () => {
    const wrapper = mount(Icon403);

    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.find('a').exists()).toBe(false);
  });
});
