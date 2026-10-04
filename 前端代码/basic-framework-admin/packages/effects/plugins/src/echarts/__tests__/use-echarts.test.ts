/**
 * ECharts 组合式函数（useEcharts）的真实行为回归。
 *
 * 该模块负责图表实例的创建、重绘、尺寸自适应与销毁：元素不可见时必须延迟重试而不是
 * 直接放弃，主题切换必须重建实例，未初始化时更新数据要回退到首次渲染。
 * 用例挂载真实宿主组件驱动真实 watch 与生命周期钩子，只把 echarts 图形库替换成
 * 记录型替身（真实 canvas 渲染不属于本层契约）。
 */
import type { Ref } from 'vue';

import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';

import { preferencesManager } from '@vben/preferences';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEcharts } from '../use-echarts';

/** echarts 图形库初始化入口的记录型替身；模块替身与用例读取同一实例。 */
const echartsMock = vi.hoisted(
  /** 建立跨用例共享的 init 替身容器。 */
  () => ({ init: vi.fn() }),
);

vi.mock(
  '../echarts',
  /** 只替换第三方图形库边界，实例管理与重试逻辑全部真实执行。 */ () => ({
    default: { init: echartsMock.init },
  }),
);

/** 最近一次挂载取得的图表 API，用来驱动真实渲染与销毁流程。 */
let charts: ReturnType<typeof useEcharts>;

/** 宿主组件持有的图表元素引用，用例通过改变它覆盖可见与不可见两类分支。 */
let chartRef: Ref<unknown>;

/**
 * 让元素在伪 DOM 中表现为可见（非零尺寸）。
 * @param el 目标元素。
 * @param size 要写入的宽高。
 */
function makeVisible(el: HTMLElement, size = 300) {
  Object.defineProperty(el, 'offsetHeight', {
    configurable: true,
    value: size,
  });
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: size });
}

/**
 * 构造记录调用的图表实例替身。
 * @param dom 实例声称拥有的真实元素，用于触发重建分支。
 * @returns 满足被测代码调用契约的图表实例替身。
 */
function createChartInstance(dom: HTMLElement) {
  return {
    clear: vi.fn(),
    dispose: vi.fn(),
    /**
     * 返回该实例当前绑定的元素。
     * @returns 构造时传入的元素。
     */
    getDom: () => dom,
    resize: vi.fn(),
    setOption: vi.fn(),
  };
}

/** 图表宿主组件：把真实 API 暴露给用例并渲染一个可挂载的元素。 */
const ChartsProbe = defineComponent({
  name: 'ChartsProbe',
  /**
   * 在真实组件上下文内调用组合式函数。
   * @returns 渲染最小宿主节点的渲染函数。
   */
  setup() {
    charts = useEcharts(chartRef as never);
    return /** 渲染最小宿主节点，图表元素由用例直接挂到引用上。 */ () =>
      h('div', { 'data-test': 'charts-probe' });
  },
});

/**
 * 挂载图表宿主组件并等待响应式副作用建立。
 * @returns 已挂载的宿主组件包装器。
 */
async function mountProbe() {
  const wrapper = mount(ChartsProbe);
  await nextTick();
  return wrapper;
}

describe('图表实例管理', /** 图表不可见时要重试、主题变化要重建，写错会白屏或残留旧主题。 */ () => {
  beforeEach(
    /** 每个用例从浅色偏好与清空的替身记录出发；默认偏好为深色，必须显式固定。 */ () => {
      preferencesManager.updatePreferences({ theme: { mode: 'light' } });
      echartsMock.init.mockReset();
      chartRef = ref(undefined);
    },
  );

  afterEach(
    /** 恢复偏好并清理宿主元素引用。 */ () => {
      preferencesManager.resetPreferences();
    },
  );

  it('元素可见时创建实例并写入合并后的配置', /** 不创建实例或写错配置会让图表空白。 */ async () => {
    const el = document.createElement('div');
    makeVisible(el);
    const instance = createChartInstance(el);
    echartsMock.init.mockReturnValue(instance);
    chartRef = ref({ $el: el });
    const wrapper = await mountProbe();

    const rendered = await charts.renderEcharts({ series: [] });

    expect(echartsMock.init).toHaveBeenCalledWith(el, null);
    expect(rendered).toBe(instance);
    expect(instance.clear).toHaveBeenCalledTimes(1);
    expect(instance.setOption).toHaveBeenCalledWith({ series: [] });
    expect(charts.getChartInstance()).toBe(instance);
    wrapper.unmount();
  });

  it('深色模式写入透明背景且 clear 可关闭', /** 透明背景是深色主题下的既定口径，clear=false 用于保留动画。 */ async () => {
    preferencesManager.updatePreferences({ theme: { mode: 'dark' } });
    const el = document.createElement('div');
    makeVisible(el);
    const instance = createChartInstance(el);
    echartsMock.init.mockReturnValue(instance);
    chartRef = ref({ $el: el });
    const wrapper = await mountProbe();

    await charts.renderEcharts({ series: [] }, false);

    expect(echartsMock.init).toHaveBeenCalledWith(el, 'dark');
    expect(instance.clear).not.toHaveBeenCalled();
    expect(instance.setOption).toHaveBeenCalledWith({
      backgroundColor: 'transparent',
      series: [],
    });
    wrapper.unmount();
  });

  it('元素尺寸为零时延迟重试直到可见', /** 直接放弃会让首屏隐藏的图表永远渲染不出来。 */ async () => {
    const el = document.createElement('div');
    const instance = createChartInstance(el);
    echartsMock.init.mockReturnValue(instance);
    chartRef = ref({ $el: el });
    const wrapper = await mountProbe();

    const pending = charts.renderEcharts({ series: [] });
    // 首次进入时元素不可见：先确认没有立即创建实例。
    await nextTick();
    expect(echartsMock.init).not.toHaveBeenCalled();

    makeVisible(el);
    await expect(pending).resolves.toBe(instance);
    expect(echartsMock.init).toHaveBeenCalledWith(el, null);
    wrapper.unmount();
  });

  it('元素引用自身尺寸为零时同样延迟重试', /** 直接把元素放进引用时也要等尺寸就绪，否则首屏会画出零尺寸画布。 */ async () => {
    const el = document.createElement('div');
    const target = document.createElement('div');
    makeVisible(target);
    // 兼容组件引用形状：引用本身是元素，同时暴露真实挂载节点。
    Object.defineProperty(el, '$el', { configurable: true, value: target });
    const instance = createChartInstance(target);
    echartsMock.init.mockReturnValue(instance);
    chartRef = ref(el);
    const wrapper = await mountProbe();

    const pending = charts.renderEcharts({ series: [] });
    await nextTick();
    expect(echartsMock.init).not.toHaveBeenCalled();

    makeVisible(el);
    await expect(pending).resolves.toBe(instance);
    expect(echartsMock.init).toHaveBeenCalledWith(target, null);
    wrapper.unmount();
  });

  it('直接持有元素但缺少组件实例时不创建图表且不结算', /** 组件引用缺失时既不创建实例也不结算，避免把图表挂到错误对象上。 */ async () => {
    const el = document.createElement('div');
    makeVisible(el);
    const wrapper = await mountProbe();
    chartRef.value = el;
    let settled = false;
    const pending = charts.renderEcharts({ series: [] }).then(
      /** 标记该 Promise 是否被结算。 */ () => {
        settled = true;
      },
    );

    // 越过一次 30ms 重试窗口，确认既不初始化也不结算。
    await new Promise(
      /** 真实等待一次重试窗口。 */ (resolve) => {
        setTimeout(resolve, 80);
      },
    );

    expect(echartsMock.init).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    wrapper.unmount();
    // 未结算的 Promise 由被测实现保留，交由流程结束回收。
    void pending;
  });

  it('实例绑定了其他元素时先销毁再重建', /** 复用绑定旧元素的实例会把图表画到已经废弃的节点上。 */ async () => {
    const firstEl = document.createElement('div');
    makeVisible(firstEl);
    const stale = createChartInstance(document.createElement('div'));
    const current = createChartInstance(firstEl);
    echartsMock.init.mockReturnValueOnce(stale).mockReturnValueOnce(current);
    chartRef = ref({ $el: firstEl });
    const wrapper = await mountProbe();
    await charts.renderEcharts({ series: ['first'] });

    await charts.renderEcharts({ series: ['second'] });

    expect(stale.dispose).toHaveBeenCalledTimes(1);
    expect(echartsMock.init).toHaveBeenCalledTimes(2);
    expect(current.setOption).toHaveBeenLastCalledWith({ series: ['second'] });
    wrapper.unmount();
  });
});

describe('图表数据更新与尺寸自适应', /** 更新与 resize 决定数据刷新后画面是否同步。 */ () => {
  beforeEach(
    /** 每个用例从浅色偏好与清空的替身记录出发；默认偏好为深色，必须显式固定。 */ () => {
      preferencesManager.updatePreferences({ theme: { mode: 'light' } });
      echartsMock.init.mockReset();
      chartRef = ref(undefined);
    },
  );

  afterEach(
    /** 恢复偏好。 */ () => {
      preferencesManager.resetPreferences();
    },
  );

  it('未初始化时更新数据回退到首次渲染', /** 缺少回退会让页面上第一次更新数据时图表不出现。 */ async () => {
    const el = document.createElement('div');
    makeVisible(el);
    const instance = createChartInstance(el);
    echartsMock.init.mockReturnValue(instance);
    chartRef = ref({ $el: el });
    const wrapper = await mountProbe();

    await expect(charts.updateData({ series: ['first'] })).resolves.toBe(
      instance,
    );
    expect(echartsMock.init).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('已初始化时按 notMerge 与 lazyUpdate 真实更新', /** 参数丢失会让动画与重绘策略失效。 */ async () => {
    const el = document.createElement('div');
    makeVisible(el);
    const instance = createChartInstance(el);
    echartsMock.init.mockReturnValue(instance);
    chartRef = ref({ $el: el });
    const wrapper = await mountProbe();
    await charts.renderEcharts({ series: ['first'] });
    instance.setOption.mockClear();

    await charts.updateData({ series: ['second'] }, true, true);

    expect(instance.setOption).toHaveBeenCalledWith(
      { series: ['second'] },
      { lazyUpdate: true, notMerge: true },
    );
    wrapper.unmount();
  });

  it('resize 在元素可见时按动画参数调用，隐藏时直接返回', /** 隐藏元素上调用 resize 会得到 0 尺寸画布。 */ async () => {
    const el = document.createElement('div');
    makeVisible(el);
    const instance = createChartInstance(el);
    echartsMock.init.mockReturnValue(instance);
    chartRef = ref({ $el: el });
    const wrapper = await mountProbe();
    await charts.renderEcharts({ series: [] });

    charts.resize();
    expect(instance.resize).toHaveBeenCalledWith({
      animation: { duration: 300, easing: 'quadraticIn' },
    });

    instance.resize.mockClear();
    Object.defineProperty(el, 'offsetHeight', { configurable: true, value: 0 });
    charts.resize();
    expect(instance.resize).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('主题切换销毁并重建实例后重新渲染', /** 不重建会保留旧主题配色。 */ async () => {
    const el = document.createElement('div');
    makeVisible(el);
    const first = createChartInstance(el);
    const second = createChartInstance(el);
    echartsMock.init.mockReturnValueOnce(first).mockReturnValueOnce(second);
    chartRef = ref({ $el: el });
    const wrapper = await mountProbe();
    await charts.renderEcharts({ series: ['cached'] });

    preferencesManager.updatePreferences({ theme: { mode: 'dark' } });
    await vi.waitFor(
      /** 等待主题监听完成重建。 */ () => {
        expect(first.dispose).toHaveBeenCalledTimes(1);
      },
      { timeout: 1000 },
    );

    expect(echartsMock.init).toHaveBeenCalledTimes(2);
    expect(charts.getChartInstance()).toBe(second);
    wrapper.unmount();
  });

  it('窗口尺寸变化触发防抖后的尺寸自适应', /** 窗口变化不重排会让图表在侧边栏收起后错位。 */ async () => {
    const el = document.createElement('div');
    makeVisible(el);
    const instance = createChartInstance(el);
    echartsMock.init.mockReturnValue(instance);
    chartRef = ref({ $el: el });
    const wrapper = await mountProbe();
    await charts.renderEcharts({ series: [] });
    instance.resize.mockClear();

    window.innerWidth = 1280;
    window.dispatchEvent(new Event('resize'));

    await vi.waitFor(
      /** 等待 200ms 防抖窗口结束。 */ () => {
        expect(instance.resize).toHaveBeenCalled();
      },
      { timeout: 1500 },
    );
    wrapper.unmount();
  });

  it('卸载时销毁实例释放资源', /** 不销毁会让图表实例与监听一起泄漏。 */ async () => {
    const el = document.createElement('div');
    makeVisible(el);
    const instance = createChartInstance(el);
    echartsMock.init.mockReturnValue(instance);
    chartRef = ref({ $el: el });
    const wrapper = await mountProbe();
    await charts.renderEcharts({ series: [] });

    wrapper.unmount();
    await nextTick();

    expect(instance.dispose).toHaveBeenCalledTimes(1);
  });
});
