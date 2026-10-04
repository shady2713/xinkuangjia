/**
 * 水印组合式函数（useWatermark）的真实行为回归。
 *
 * 该模块决定页面水印的创建、更新与销毁时机：首次更新必须真正创建水印并把默认配置与
 * 调用方配置合并；已有实例时必须走配置变更而不是重建；组件卸载只允许注册一次卸载钩子，
 * 否则路由切换会把仍在使用的水印销毁。用例只替换第三方水印渲染边界（受控 Watermark 类），
 * 组合式函数的编排逻辑全部真实执行。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWatermark } from './use-watermark';

/** 受控 Watermark 替身记录到的调用与参数，供各用例断言真实副作用。 */
const spy = vi.hoisted(
  /** 建立跨用例共享的调用记录容器，记录构造、创建、变更与销毁。 */
  () => ({
    changedOptions: [] as unknown[],
    createCount: 0,
    destroyCount: 0,
    instances: [] as { options: unknown }[],
  }),
);

vi.mock(
  'watermark-js-plus',
  /** 只替换第三方水印渲染边界，不改变被测模块的调用顺序与配置合并逻辑。 */ () => ({
    /** 受控水印类：记录构造参数与 create/changeOptions/destroy 调用。 */
    Watermark: class {
      public options: unknown;

      /**
       * 记录组合式函数合并后的最终配置。
       * @param options 默认配置与调用方配置合并后的水印选项。
       */
      constructor(options: unknown) {
        this.options = options;
        spy.instances.push(this);
      }

      /**
       * 记录配置变更的真实参数。
       * @param options 本次变更后要应用的完整选项。
       * @returns 与真实实现一致的完成 Promise，供调用方继续等待。
       */
      changeOptions(options: unknown) {
        spy.changedOptions.push(options);
        return Promise.resolve();
      }

      /**
       * 记录水印创建。
       * @returns 与真实实现一致的完成 Promise，供调用方继续等待。
       */
      create() {
        spy.createCount += 1;
        return Promise.resolve();
      }

      /** 记录水印销毁。 */
      destroy() {
        spy.destroyCount += 1;
      }
    },
  }),
);

/** 最近一次挂载取得的水印 API，用来驱动真实创建、变更与销毁流程。 */
let watermarkApi: ReturnType<typeof useWatermark>;

/**
 * 探针组件：在真实组件上下文内调用组合式函数，保证卸载钩子可用。
 */
const WatermarkProbe = defineComponent({
  name: 'WatermarkProbe',
  /**
   * 在真实组件上下文内调用水印组合式函数。
   * @returns 渲染最小宿主节点的渲染函数。
   */
  setup() {
    watermarkApi = useWatermark();
    return /** 渲染最小宿主节点，水印 API 通过模块变量读取。。 */ () =>
      h('div', { 'data-test': 'watermark-probe' });
  },
});

/**
 * 挂载探针组件并让模块级 API 指向本次实例。
 * @returns 已挂载的探针组件包装器。
 */
function mountProbe() {
  return mount(WatermarkProbe);
}

describe('水印组合式函数', /** 水印的创建、更新与销毁时机直接决定水印是否真实生效且不残留。 */ () => {
  beforeEach(
    /** 清空上一用例的调用记录；模块级水印实例由各用例自行销毁。 */ () => {
      spy.changedOptions.length = 0;
      spy.createCount = 0;
      spy.destroyCount = 0;
      spy.instances.length = 0;
    },
  );

  it('卸载时销毁水印且卸载钩子只注册一次', /** 重复注册卸载钩子会让路由切换销毁仍在使用的水印；完全不注册则会残留水印。 */ async () => {
    const first = mountProbe();
    await watermarkApi.updateWatermark({ content: '第一个组件' });
    expect(spy.destroyCount).toBe(0);

    first.unmount();
    expect(spy.destroyCount).toBe(1);
    expect(watermarkApi.watermark.value).toBeUndefined();

    // 第二个组件没有注册卸载钩子，它的卸载不得再次销毁水印。
    const second = mountProbe();
    await watermarkApi.updateWatermark({ content: '第二个组件' });
    second.unmount();
    expect(spy.destroyCount).toBe(1);
  });

  it('首次更新走初始化路径并合并默认配置', /** 未创建实例时必须真实 new + create，否则水印永远不显示。 */ async () => {
    const probe = mountProbe();
    watermarkApi.destroyWatermark();

    await watermarkApi.updateWatermark({ content: '内部资料' });

    expect(spy.createCount).toBe(1);
    expect(spy.instances).toHaveLength(1);
    expect(spy.instances[0]?.options).toEqual(
      expect.objectContaining({
        content: '内部资料',
        contentType: 'multi-line-text',
        globalAlpha: 0.25,
        height: 200,
        layout: 'grid',
        rotate: 30,
        width: 160,
      }),
    );
    expect(spy.changedOptions).toEqual([]);
    watermarkApi.destroyWatermark();
    probe.unmount();
  });

  it('已有实例时走配置变更且后续调用沿用缓存配置', /** 每次更新都重建实例会闪烁并丢动画，必须复用实例并合并缓存。 */ async () => {
    const probe = mountProbe();
    watermarkApi.destroyWatermark();

    await watermarkApi.updateWatermark({ content: '第一版' });
    await watermarkApi.updateWatermark({ rotate: 45 });

    expect(spy.createCount).toBe(1);
    expect(spy.changedOptions).toHaveLength(1);
    expect(spy.changedOptions[0]).toEqual(
      expect.objectContaining({
        content: '第一版',
        rotate: 45,
        width: 160,
      }),
    );
    watermarkApi.destroyWatermark();
    probe.unmount();
  });

  it('销毁后清空实例且重复销毁安全', /** 残留实例会让下一次更新走变更分支，作用在已经销毁的水印上。 */ async () => {
    const probe = mountProbe();
    // 先清掉上一用例遗留的实例，本次断言只观察本用例真实产生的销毁。
    watermarkApi.destroyWatermark();
    const baseline = spy.destroyCount;
    expect(watermarkApi.watermark.value).toBeUndefined();

    await watermarkApi.updateWatermark({ content: '待销毁' });
    // readonly 暴露的是水印实例的只读视图，按结构比对创建出来的真实实例。
    expect(watermarkApi.watermark.value).toEqual(spy.instances.at(-1));

    watermarkApi.destroyWatermark();
    expect(spy.destroyCount).toBe(baseline + 1);
    expect(watermarkApi.watermark.value).toBeUndefined();

    // 重复销毁不得再次调用第三方 destroy。
    watermarkApi.destroyWatermark();
    expect(spy.destroyCount).toBe(baseline + 1);
    probe.unmount();
  });
});
