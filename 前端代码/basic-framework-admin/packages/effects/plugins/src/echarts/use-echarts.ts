/**
 * ECharts 运行时 composable：绑定 EchartsUI 组件引用，负责实例创建、重绘、
 * 尺寸自适应、暗色主题切换与卸载销毁。
 * 只消费调用方给出的 option，不取数、不组装业务图表配置。
 */
import type { EChartsOption } from 'echarts';

import type { Ref } from 'vue';

import type { Nullable } from '@vben/types';

import type EchartsUI from './echarts-ui.vue';

import { computed, nextTick, watch } from 'vue';

import { usePreferences } from '@vben/preferences';

import {
  tryOnUnmounted,
  useDebounceFn,
  useResizeObserver,
  useTimeoutFn,
  useWindowSize,
} from '@vueuse/core';

import echarts from './echarts';

/** EchartsUI 组件实例类型；尚未挂载时为 undefined。 */
type EchartsUIType = typeof EchartsUI | undefined;

/** 可显式传入的图表主题：dark、light 或交给运行环境按明暗偏好自动决定（null）。 */
type EchartsThemeType = 'dark' | 'light' | null;

/** ECharts 图表初始化与管理的 composable 函数 */
function useEcharts(chartRef: Ref<EchartsUIType>) {
  let chartInstance: echarts.ECharts | null = null;
  let cacheOptions: EChartsOption = {};

  const { isDark } = usePreferences();
  const { height, width } = useWindowSize();
  const resizeHandler: /* 防抖后的重绘入口：200ms 内的连续触发只执行最后一次。 */ () => void =
    useDebounceFn(resize, 200);

  /**
   * 解析图表容器：组件引用取其根 DOM，已是元素则原样返回。
   * @returns 可挂载 ECharts 的 HTML 元素；引用为空或组件尚未挂载时为 null。
   */
  const getChartEl = (): HTMLElement | null => {
    const refValue = chartRef?.value as unknown;
    if (!refValue) return null;
    if (refValue instanceof HTMLElement) {
      return refValue;
    }
    const maybeComponent = refValue as { $el?: HTMLElement };
    return maybeComponent.$el ?? null;
  };

  /** 判断容器是否不可见：元素缺失或宽高为 0 都算隐藏，此时创建与重绘都会推迟重试。 */
  const isElHidden = (el: HTMLElement | null): boolean => {
    if (!el) return true;
    return el.offsetHeight === 0 || el.offsetWidth === 0;
  };

  /** 随明暗偏好变化的全局图表配置：浅色模式不追加配置，深色模式仅把背景改为透明。 */
  const getOptions = computed((): EChartsOption => {
    if (!isDark.value) {
      return {};
    }

    return {
      backgroundColor: 'transparent',
    };
  });

  /**
   * 按指定主题创建图表实例并写入实例缓存。
   * @param t 主题名；不传时按当前明暗偏好决定是否使用 dark 主题。
   * @returns 新建的图表实例；组件根元素尚未挂载时返回 undefined。
   */
  const initCharts = (t?: EchartsThemeType) => {
    const el = chartRef?.value?.$el;
    if (!el) {
      return;
    }
    chartInstance = echarts.init(el, t || isDark.value ? 'dark' : null);

    return chartInstance;
  };

  /** 渲染图表：容器不可见时每 30ms 重试，容器变化或实例缺失时重建，随后清空并按合并后的配置重绘。 */
  const renderEcharts = (
    options: EChartsOption,
    clear = true,
  ): Promise<Nullable<echarts.ECharts>> => {
    cacheOptions = options;
    const currentOptions = {
      ...options,
      ...getOptions.value,
    };
    return new Promise((resolve) => {
      if (chartRef.value?.offsetHeight === 0) {
        useTimeoutFn(async () => {
          resolve(await renderEcharts(currentOptions));
        }, 30);
        return;
      }
      nextTick(() => {
        const el = getChartEl();
        if (isElHidden(el)) {
          useTimeoutFn(async () => {
            resolve(await renderEcharts(currentOptions));
          }, 30);
          return;
        }
        useTimeoutFn(() => {
          if (!chartInstance || chartInstance?.getDom() !== el) {
            chartInstance?.dispose();
            const instance = initCharts();
            if (!instance) return;
          }
          clear && chartInstance?.clear();
          chartInstance?.setOption(currentOptions);
          resolve(chartInstance);
        }, 30);
      });
    });
  };

  /** 增量更新图表数据：实例缺失时退化为首次渲染，最后一次调用的配置会作为缓存供主题切换后重放。 */
  const updateData = (
    option: EChartsOption,
    notMerge = false, // false = 合并（保留动画），true = 完全替换
    lazyUpdate = false, // true 时不立即重绘，适合短时间内多次调用
  ): Promise<echarts.ECharts | null> => {
    return new Promise((resolve) => {
      nextTick(() => {
        if (!chartInstance) {
          // 还没初始化 → 当作首次渲染
          renderEcharts(option).then(resolve);
          return;
        }

        // 合并你原有的全局配置（比如 backgroundColor）
        const finalOption = {
          ...option,
          ...getOptions.value,
        };

        chartInstance.setOption(finalOption, {
          notMerge,
          lazyUpdate,
          // silent: true,     // 如果追求极致性能可开启（关闭所有事件）
        });

        resolve(chartInstance);
      });
    });
  };

  /** 按当前容器尺寸重绘并带 300ms 缓动；容器隐藏或实例未创建时直接返回。 */
  function resize() {
    const el = getChartEl();
    if (isElHidden(el)) {
      return;
    }
    chartInstance?.resize({
      animation: {
        duration: 300,
        easing: 'quadraticIn',
      },
    });
  }

  watch([width, height], () => {
    resizeHandler?.();
  });

  useResizeObserver(chartRef as never, resizeHandler);

  watch(isDark, () => {
    if (chartInstance) {
      chartInstance.dispose();
      initCharts();
      renderEcharts(cacheOptions);
      resize();
    }
  });

  tryOnUnmounted(() => {
    // 销毁实例，释放资源
    chartInstance?.dispose();
  });
  return {
    renderEcharts,
    resize,
    updateData,
    /** 读取当前图表实例；尚未初始化时为 null，调用方需自行判空。 */
    getChartInstance: () => chartInstance,
  };
}

export { useEcharts };

export type { EchartsUIType };
