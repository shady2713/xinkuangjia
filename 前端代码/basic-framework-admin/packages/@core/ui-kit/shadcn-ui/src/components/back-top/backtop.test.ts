/**
 * 回到顶部按钮属性契约的真实行为回归。
 *
 * `backtopProps` 是该模块唯一的运行时导出：它把四个尺寸与目标参数声明成 Vue 可解析的
 * props（默认值与类型校验）。只有把这些声明真实交给 Vue 解析，才能证明「bottom=40、
 * right=40、target=''、visibilityHeight=200」以及数字属性确实按 Number 校验生效；
 * 仅导入模块无法证明任何一项。类型成员 `BacktopProps` 只在编译期存在，不做运行时断言。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { backtopProps } from './backtop';

/**
 * 构造把属性契约直接作为 props 声明的探针组件。
 * 渲染出的文本即 Vue 解析后的真实取值，可据此断言默认值与属性覆盖。
 */
const BacktopPropsProbe = defineComponent({
  name: 'BacktopPropsProbe',
  props: backtopProps,
  /**
   * 读取 Vue 解析后的属性取值并渲染成文本。
   * @param props 组件真实解析后的四个属性。
   * @returns 渲染探针文本的渲染函数。
   */
  setup(props) {
    return /** 把四个属性的解析结果渲染成可读文本。 */ () =>
      h('div', { 'data-test': 'backtop-probe' }, [
        `bottom=${String(props.bottom)};`,
        `right=${String(props.right)};`,
        `target=${String(props.target)};`,
        `visibilityHeight=${String(props.visibilityHeight)}`,
      ]);
  },
});

describe('回到顶部按钮属性契约', /** 属性默认值写错会让按钮贴边或过早出现。 */ () => {
  afterEach(
    /** 恢复被替换的控制台警告，避免影响其他用例。 */ () => {
      vi.restoreAllMocks();
    },
  );

  it('未传属性时四个默认值真实生效', /** 默认值是该契约对调用方的核心承诺。 */ () => {
    const wrapper = mount(BacktopPropsProbe);

    expect(wrapper.get('[data-test="backtop-probe"]').text()).toBe(
      'bottom=40;right=40;target=;visibilityHeight=200',
    );
  });

  it('显式传入的属性覆盖默认值', /** 覆盖失效会让页面无法按设计调整按钮位置与出现时机。 */ () => {
    const wrapper = mount(BacktopPropsProbe, {
      props: {
        bottom: 80,
        right: 12,
        target: '#main',
        visibilityHeight: 500,
      },
    });

    expect(wrapper.get('[data-test="backtop-probe"]').text()).toBe(
      'bottom=80;right=12;target=#main;visibilityHeight=500',
    );
  });

  it('数字属性声明为 Number 且字符串取值被真实拒绝', /** 声明成 String 会让样式拼接与阈值比较得到非预期结果，必须由 Vue 类型校验拦住。 */ () => {
    expect(backtopProps.bottom.type).toBe(Number);
    expect(backtopProps.right.type).toBe(Number);
    expect(backtopProps.visibilityHeight.type).toBe(Number);
    expect(backtopProps.target.type).toBe(String);

    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(
        /** Vue 的类型校验告警不是本用例的断言目标，避免污染测试输出。 */ () => {},
      );

    const wrapper = mount(BacktopPropsProbe, {
      // 字符串底边距用于触发 Vue 的属性类型告警，属性类型只声明数字。
      props: { bottom: '72' } as unknown as InstanceType<
        typeof BacktopPropsProbe
      >['$props'],
    });

    expect(warn.mock.calls.flat().join(' ')).toContain(
      'Invalid prop: type check failed for prop "bottom"',
    );
    expect(wrapper.get('[data-test="backtop-probe"]').text()).toContain(
      'bottom=72',
    );
  });

  it('只声明契约中的四个属性名', /** 多出或缺少属性名会改变组件对外契约。 */ () => {
    expect(Object.keys(backtopProps)).toEqual([
      'bottom',
      'right',
      'target',
      'visibilityHeight',
    ]);
  });
});
