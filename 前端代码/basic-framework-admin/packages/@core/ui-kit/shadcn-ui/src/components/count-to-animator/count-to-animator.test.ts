/**
 * 数字滚动动画（shadcn-ui 的 components/count-to-animator）格式化与动画回归。
 *
 * 该组件用于仪表盘指标：按前后缀、千分位、小数位与过渡曲线把起始值滚动到结束值，动画结束时抛出
 * finished。格式化写错会让金额或指标显示错误，事件缺失会让依赖动画结束的逻辑不触发。用例真实
 * 挂载组件，用真实过渡与真实计时等待动画结束，只把时长压到极小以免测试变慢。
 */
import { mount } from '@vue/test-utils';

import { afterEach, describe, expect, it } from 'vitest';

import CountToAnimator from './count-to-animator.vue';

/** 每个用例挂载的组件，用例结束后统一卸载。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载组件，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
  },
);

/**
 * 等待滚动动画结束。
 * @param duration 动画时长，单位毫秒。
 * @returns 动画结束后的 Promise。
 */
async function waitAnimation(duration: number) {
  await new Promise(
    /** 用真实计时器跨过动画时长。 */ (resolve) => {
      setTimeout(resolve, duration + 80);
    },
  );
}

describe('数字滚动格式化', /** 金额与指标显示错误会直接误导业务判断。 */ () => {
  it('按小数位与千分位渲染结束值', /** 千分位或小数位丢失会让大额数字难以核对。 */ async () => {
    mounted = mount(CountToAnimator, {
      props: {
        decimals: 2,
        duration: 10,
        endVal: 1_234_567.891,
        startVal: 1_234_567.891,
      },
    });
    await waitAnimation(10);

    expect(mounted.text()).toBe('1,234,567.89');
  });

  it('按前后缀与自定义分隔符渲染', /** 前后缀丢失会让货币或百分比含义不清。 */ async () => {
    mounted = mount(CountToAnimator, {
      props: {
        decimal: ',',
        duration: 10,
        endVal: 1234,
        prefix: '¥',
        separator: '.',
        startVal: 1234,
        suffix: '元',
      },
    });
    await waitAnimation(10);

    expect(mounted.text()).toBe('¥1.234元');
  });

  it('数字分隔符不参与千分位拼接', /** 把数字当分隔符会让输出出现异常字符。 */ async () => {
    mounted = mount(CountToAnimator, {
      // 故意传入数字分隔符，验证组件不会把它当成千分位字符。
      props: {
        duration: 10,
        endVal: 1234,
        separator: 0 as unknown as string,
        startVal: 1234,
      },
    });
    await waitAnimation(10);

    expect(mounted.text()).toBe('1234');
  });

  it('无可用数值时渲染空串', /** 直接渲染 NaN 会让指标区出现脏数据。 */ async () => {
    mounted = mount(CountToAnimator, {
      props: { duration: 10, endVal: Number.NaN, startVal: Number.NaN },
    });
    await waitAnimation(10);

    expect(mounted.text()).toBe('');
  });
});

describe('数字滚动动画事件', /** 动画结束事件决定依赖它的后续动作是否执行。 */ () => {
  it('动画结束后抛出 finished 与兼容事件', /** 事件缺失会让依赖动画结束的逻辑永不触发。 */ async () => {
    mounted = mount(CountToAnimator, {
      props: { duration: 10, endVal: 100, startVal: 0 },
    });

    await waitAnimation(10);

    expect(mounted.emitted('started')).toHaveLength(1);
    expect(mounted.emitted('onStarted')).toHaveLength(1);
    expect(mounted.emitted('finished')).toHaveLength(1);
    expect(mounted.emitted('onFinished')).toHaveLength(1);
    expect(mounted.text()).toBe('100');
  });

  it('关闭自动播放时保持起始值', /** 自动播放写死会让需要在合适时机才滚动的场景提前跳动。 */ async () => {
    mounted = mount(CountToAnimator, {
      props: { autoplay: false, duration: 10, endVal: 100, startVal: 7 },
    });
    await waitAnimation(10);

    expect(mounted.text()).toBe('7');
    expect(mounted.emitted('finished')).toBeUndefined();
  });

  it('关闭缓动时不套用过渡曲线', /** 缓动开关失效会让指标滚动节奏与设计不符。 */ async () => {
    mounted = mount(CountToAnimator, {
      props: { duration: 10, endVal: 55, startVal: 0, useEasing: false },
    });
    await waitAnimation(10);

    expect(mounted.text()).toBe('55');
    expect(mounted.emitted('finished')).toHaveLength(1);
  });

  it('起始值或结束值变化时重新播放动画', /** 不重播会让指标在数据刷新后停在旧值。 */ async () => {
    mounted = mount(CountToAnimator, {
      props: { duration: 10, endVal: 100, startVal: 0 },
    });
    await waitAnimation(10);
    const startedBefore = mounted.emitted('started')?.length ?? 0;

    await mounted.setProps({ endVal: 200 });
    await waitAnimation(10);

    // 每次重播都会再抛一次 started，只要求次数增加而不写死总次数。
    expect(mounted.emitted('started')?.length ?? 0).toBeGreaterThan(
      startedBefore,
    );
    expect(mounted.text()).toBe('200');
  });

  it('关闭自动播放时起始值变化不重播', /** 未开启自动播放却重播会让手动控制的指标被覆盖。 */ async () => {
    mounted = mount(CountToAnimator, {
      props: { autoplay: false, duration: 10, endVal: 100, startVal: 0 },
    });

    await mounted.setProps({ endVal: 300 });
    await waitAnimation(10);

    expect(mounted.emitted('started')).toBeUndefined();
    expect(mounted.text()).toBe('0');
  });
});
