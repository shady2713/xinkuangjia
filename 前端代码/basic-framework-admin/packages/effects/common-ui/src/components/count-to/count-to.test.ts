/**
 * 数字动画组件（effects/common-ui 的 count-to）真实行为回归。
 *
 * 该组件用于大屏与看板的数值滚动展示：整数分组、小数位与小数点写错会显示错误的
 * 金额或统计值，前后缀与自定义插槽决定单位展示，动画开始/结束事件是外部联动
 * （如动画结束后再拉取明细）的触发点。此前该文件只被测试间接导入、从未渲染，
 * 门禁按导入计为"已覆盖"；本用例真实渲染组件，断言真实 DOM 文本、类名、样式与
 * 事件，覆盖整数、小数、前后缀、插槽、样式与动画两条分支。
 */
import type { VueWrapper } from '@vue/test-utils';

import type { CountToProps } from './types';

import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { afterEach, describe, expect, it } from 'vitest';

import CountTo from './count-to.vue';

/** 当前用例挂载的组件包装器，用于逐例卸载并停止动画循环。 */
let wrapper: undefined | VueWrapper;

/**
 * 挂载数字动画组件并等待挂载后的首次渲染收敛。
 * @param props 组件属性，至少包含结束值。
 * @param attrs 透传到根元素的未声明属性。
 * @returns 已挂载并完成首帧渲染的组件包装器。
 */
async function mountCountTo(
  props: Partial<CountToProps> & { endVal: number },
  attrs: Record<string, string> = {},
) {
  wrapper = mount(CountTo, { attrs, props });
  await nextTick();
  return wrapper;
}

/**
 * 读取整数部分的展示文本。
 * @param target 已挂载的数字动画组件。
 * @returns 整数部分元素的文本内容。
 */
function mainText(target: VueWrapper) {
  return target.find('.count-to-main > span').text();
}

afterEach(
  /** 卸载组件，停止未完成的动画循环并清空包装器。 */ () => {
    wrapper?.unmount();
    wrapper = undefined;
  },
);

describe('数字动画数值格式', /** 分组、小数位与小数点决定展示数值是否可读且准确。 */ () => {
  it('整数按千位分组展示', /** 分组缺失会让大额数值难以核对。 */ async () => {
    const target = await mountCountTo({ disabled: true, endVal: 1_234_567 });

    expect(mainText(target)).toBe('1,234,567');
    expect(target.find('.count-to-main-decimal').exists()).toBe(false);
  });

  it('按小数位补零并保留小数点', /** 小数位丢失会让金额展示少算一位精度。 */ async () => {
    const target = await mountCountTo({
      decimal: ',',
      decimals: 2,
      disabled: true,
      endVal: 1234.5,
      separator: ' ',
    });

    expect(mainText(target)).toBe('1 234');
    expect(target.find('.count-to-main-decimal').text()).toBe(',50');
  });

  it('结束值变化后重新展示新数值', /** 未监听结束值会让数据刷新后界面停在旧数值。 */ async () => {
    const target = await mountCountTo({ disabled: true, endVal: 1000 });
    expect(mainText(target)).toBe('1,000');

    await target.setProps({ endVal: 2000 });
    await nextTick();

    expect(mainText(target)).toBe('2,000');
  });

  it('首帧展示起始值、挂载后切到结束值', /** 起始值未生效会让动画从 0 跳变而不是从指定值开始。 */ async () => {
    const target = mount(CountTo, {
      props: { disabled: true, endVal: 500, startVal: 400 },
    });
    wrapper = target;

    expect(mainText(target)).toBe('400');

    await nextTick();

    expect(mainText(target)).toBe('500');
  });
});

describe('数字动画前后缀', /** 前后缀与插槽决定单位展示，缺失会让数值没有业务含义。 */ () => {
  it('按属性展示前后缀', /** 单位缺失会让用户无法判断数值口径。 */ async () => {
    const target = await mountCountTo({
      disabled: true,
      endVal: 88,
      prefix: '¥',
      suffix: '元',
    });

    expect(target.find('.count-to-prefix').text()).toBe('¥');
    expect(target.find('.count-to-suffix').text()).toBe('元');
  });

  it('没有前后缀属性时不渲染对应节点', /** 渲染空节点会占用布局间距，破坏对齐。 */ async () => {
    const target = await mountCountTo({ disabled: true, endVal: 88 });

    expect(target.find('.count-to-prefix').exists()).toBe(false);
    expect(target.find('.count-to-suffix').exists()).toBe(false);
  });

  it('具名插槽覆盖默认前后缀展示', /** 插槽被忽略会让使用图标或自定义单位的大屏无法定制。 */ async () => {
    const target = mount(CountTo, {
      props: { disabled: true, endVal: 88 },
      slots: {
        /** 渲染自定义前缀节点。 */
        prefix: () => h('em', { class: 'custom-prefix' }, '约'),
        /** 渲染自定义后缀节点。 */
        suffix: () => h('em', { class: 'custom-suffix' }, '万元'),
      },
    });
    wrapper = target;
    await nextTick();

    expect(target.find('.custom-prefix').text()).toBe('约');
    expect(target.find('.custom-suffix').text()).toBe('万元');
    expect(target.find('.count-to-prefix').exists()).toBe(false);
    expect(target.find('.count-to-suffix').exists()).toBe(false);
  });
});

describe('数字动画样式契约', /** 类名与样式是看板对齐与配色的接入点，必须落到真实节点上。 */ () => {
  it('把类名与样式应用到对应部分', /** 样式未落到节点会让大屏配色与字号定制失效。 */ async () => {
    const target = await mountCountTo({
      decimalClass: 'dec-x',
      decimalStyle: { color: 'green' },
      decimals: 1,
      disabled: true,
      endVal: 12.3,
      mainClass: 'main-x',
      mainStyle: { color: 'red' },
      prefix: 'P',
      prefixClass: 'pre-x',
      prefixStyle: { color: 'blue' },
      suffix: 'S',
      suffixClass: 'suf-x',
      suffixStyle: { color: 'gray' },
    });

    expect(target.find('.count-to-main').classes()).toContain('main-x');
    expect(
      (target.find('.count-to-main').element as HTMLElement).style.color,
    ).toBe('red');
    expect(target.find('.count-to-main-decimal').classes()).toContain('dec-x');
    expect(target.find('.count-to-prefix').classes()).toContain('pre-x');
    expect(target.find('.count-to-suffix').classes()).toContain('suf-x');
    expect(
      (target.find('.count-to-prefix').element as HTMLElement).style.color,
    ).toBe('blue');
    expect(
      (target.find('.count-to-suffix').element as HTMLElement).style.color,
    ).toBe('gray');
  });

  it('透传未声明的属性到根元素', /** 透传失效会让调用方的定位类名与测试选择器全部落空。 */ async () => {
    const target = await mountCountTo(
      { disabled: true, endVal: 1 },
      {
        'data-probe': 'visible',
      },
    );

    expect(target.find('.count-to').attributes('data-probe')).toBe('visible');
  });
});

describe('数字动画事件', /** 开始与结束事件是外部联动的触发点，必须真实发出且顺序正确。 */ () => {
  it('动画结束后发出结束事件', /** 结束事件缺失会让依赖它的后续加载永远不触发。 */ async () => {
    const target = await mountCountTo({ duration: 30, endVal: 100 });

    await expect
      .poll(
        /** 读取当前已发出的结束事件次数。 */ () =>
          target.emitted('finished')?.length ?? 0,
        { timeout: 2000 },
      )
      .toBeGreaterThan(0);
    expect(target.emitted('started')).toHaveLength(1);
    expect(mainText(target)).toBe('100');
  });

  it('按名称指定缓动时同样完成动画', /** 缓动名称分支写错会让使用内置缓动的看板数值停在起始值。 */ async () => {
    const target = await mountCountTo({
      duration: 30,
      endVal: 200,
      transition: 'linear',
    });

    await expect
      .poll(
        /** 读取当前已发出的结束事件次数。 */ () =>
          target.emitted('finished')?.length ?? 0,
        { timeout: 2000 },
      )
      .toBeGreaterThan(0);
    expect(mainText(target)).toBe('200');
  });

  it('禁用动画时直接展示结束值且不发事件', /** 禁用后仍走动画会让强制同步展示的场景出现跳数。 */ async () => {
    const target = await mountCountTo({ disabled: true, endVal: 300 });
    await nextTick();

    expect(target.emitted('started')).toBeUndefined();
    expect(target.emitted('finished')).toBeUndefined();
    expect(mainText(target)).toBe('300');
  });
});

describe('数字动画组合使用', /** 组合场景验证各配置项互不覆盖。 */ () => {
  it('自定义缓动函数与小数位同时生效', /** 自定义缓动被忽略会让业务侧指定的动画曲线失效。 */ async () => {
    const target = await mountCountTo({
      decimals: 1,
      disabled: true,
      endVal: 9.9,
      /** 使用线性缓动，验证函数形态的过渡配置被接受。 */
      transition: (t) => t,
    });

    expect(mainText(target)).toBe('9');
    expect(target.find('.count-to-main-decimal').text()).toBe('.9');
  });

  it('延迟配置不影响禁用动画的即时展示', /** 延迟误加到禁用分支会让强制同步展示出现空档。 */ async () => {
    const target = await mountCountTo({
      delay: 500,
      disabled: true,
      endVal: 42,
    });

    expect(mainText(target)).toBe('42');
    expect(target.emitted('started')).toBeUndefined();
  });
});
