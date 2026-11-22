<script setup lang="ts">
/**
 * 通用按需引入 ECharts 渲染基座（BaseChart）：
 * - 仅按需注册折线图、柱状图、饼图与基础组件，控制产物体积
 * - 自动绑定 ResizeObserver（通过 requestAnimationFrame 节流避免浏览器 ResizeObserver 抖动）
 * - 支持任意标准 EChartsOption 透传，供后续业务统计页统一引用
 */
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import type { ECBasicOption } from 'echarts/types/dist/shared';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer,
]);

const props = withDefaults(
  defineProps<{
    option: ECBasicOption;
    height?: string;
  }>(),
  {
    height: '280px',
  },
);

const containerRef = ref<HTMLDivElement | null>(null);
let chartInstance: echarts.ECharts | null = null;
let resizeObserver: ResizeObserver | null = null;
let rafId: number | null = null;

function renderChart() {
  if (!containerRef.value) return;
  if (!chartInstance) {
    chartInstance = echarts.init(containerRef.value);
  }
  chartInstance.setOption(props.option, true);
}

function scheduleResize() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
  }
  rafId = requestAnimationFrame(() => {
    rafId = null;
    chartInstance?.resize();
  });
}

watch(
  () => props.option,
  () => {
    renderChart();
  },
  { deep: true },
);

onMounted(() => {
  renderChart();
  if (containerRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      scheduleResize();
    });
    resizeObserver.observe(containerRef.value);
  }
});

onBeforeUnmount(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
  chartInstance?.dispose();
  chartInstance = null;
});
</script>

<template>
  <div ref="containerRef" class="w-full" :style="{ height }" />
</template>
