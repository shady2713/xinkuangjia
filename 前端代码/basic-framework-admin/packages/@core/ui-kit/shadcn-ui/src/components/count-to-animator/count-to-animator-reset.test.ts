/**
 * 数字滚动动画重置入口（shadcn-ui 的 components/count-to-animator）真实行为回归。
 *
 * 组件通过 `defineExpose` 对外提供 `reset()`：调用方在指标刷新或重新查询前需要把动画复位到
 * 起始值，复位写错会让页面停留在上一轮的结束值上，用户看到的指标与实际数据不一致。
 * 用例真实挂载组件、等待真实动画结束后调用暴露的重置入口，断言渲染文本回到起始值且动画事件
 * 重新抛出，不替换组件内部实现。
 */
import type { ComponentPublicInstance } from 'vue';

import { mount } from '@vue/test-utils';

import { describe, expect, it, vi } from 'vitest';

import CountToAnimator from './count-to-animator.vue';

/** 组件暴露的重置入口形状；缺失时用例直接失败而不是静默跳过。 */
type CountToExposed = {
  /** 把动画复位到起始值并重新运行过渡。 */
  reset?: () => void;
} & ComponentPublicInstance;

/**
 * 读取已挂载组件暴露的重置入口。
 * @param wrapper 已挂载的组件包装器。
 * @returns 可直接调用的重置函数。
 * @throws Error 组件未暴露 reset 时抛出，避免用例静默地什么都不验证。
 */
function readReset(wrapper: ReturnType<typeof mount>) {
  const exposed = wrapper.vm as CountToExposed;
  if (typeof exposed.reset !== 'function') {
    throw new TypeError('组件未暴露 reset 入口');
  }
  return exposed.reset;
}

describe('数字滚动动画重置', /** 重置入口决定指标重新查询时显示起始值还是上一轮的旧值。 */ () => {
  it('动画结束后重置回起始值并重新抛出动画事件', /** 重置无效会让刷新后的指标停在旧数值上。 */ async () => {
    const wrapper = mount(CountToAnimator, {
      props: { duration: 10, endVal: 100, startVal: 0 },
    });

    await vi.waitFor(
      /** 等待首次滚动到结束值，证明组件已进入正常的结束态。 */ () => {
        expect(wrapper.text()).toBe('100');
      },
    );
    const finishedBefore = wrapper.emitted('finished')?.length ?? 0;

    readReset(wrapper)();

    await vi.waitFor(
      /** 等待复位过渡真正把渲染值带回起始值。 */ () => {
        expect(wrapper.text()).toBe('0');
      },
    );
    expect(wrapper.emitted('finished')?.length ?? 0).toBeGreaterThan(
      finishedBefore,
    );

    wrapper.unmount();
  });

  it('重置后再次滚动到结束值仍可正常完成', /** 复位过程中重建过渡写错会让重置后的动画永久停在起始值。 */ async () => {
    const wrapper = mount(CountToAnimator, {
      props: { duration: 10, endVal: 66, startVal: 0 },
    });
    await vi.waitFor(
      /** 等待首次滚动完成。 */ () => {
        expect(wrapper.text()).toBe('66');
      },
    );

    readReset(wrapper)();
    await vi.waitFor(
      /** 等待复位生效，确认重置确实改变了渲染值。 */ () => {
        expect(wrapper.text()).toBe('0');
      },
    );

    await wrapper.setProps({ endVal: 88 });

    await vi.waitFor(
      /** 等待复位后重新设置的结束值滚动到位。 */ () => {
        expect(wrapper.text()).toBe('88');
      },
    );

    wrapper.unmount();
  });
});
