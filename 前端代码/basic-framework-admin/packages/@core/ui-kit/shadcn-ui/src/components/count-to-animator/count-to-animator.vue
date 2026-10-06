<script lang="ts" setup>
/**
 * 数字滚动动画：用 useTransition 把 startVal 到 endVal 的过渡渲染成文本。
 * 供统计卡、对比卡与仪表盘概览展示数值变化；duration、分隔符、前后缀与
 * 缓动由 props 控制，reset 通过 ref 暴露，开始与结束抛出 started、finished。
 * 不负责取数，数据来源与单位换算由使用方决定。
 */
import { computed, onMounted, ref, unref, watch, watchEffect } from 'vue';

import { isNumber } from '@vben-core/shared/utils';

import { TransitionPresets, useTransition } from '@vueuse/core';

/**
 * 数字动画的入参。
 * startVal 与 endVal 决定动画的起点和终点，autoplay 控制挂载与两端数值变化时是否自动播放；
 * duration、transition、useEasing 决定过渡时长与缓动曲线；
 * decimal、decimals、separator、prefix、suffix 只影响文本格式化，不参与数值计算；
 * color 直接作用到外层 span 的文字颜色。
 */
interface Props {
  autoplay?: boolean;
  color?: string;
  decimal?: string;
  decimals?: number;
  duration?: number;
  endVal?: number;
  prefix?: string;
  separator?: string;
  startVal?: number;
  suffix?: string;
  transition?: keyof typeof TransitionPresets;
  useEasing?: boolean;
}

defineOptions({ name: 'CountToAnimator' });

const props = withDefaults(defineProps<Props>(), {
  autoplay: true,
  color: '',
  decimal: '.',
  decimals: 0,
  duration: 1500,
  endVal: 2021,
  prefix: '',
  separator: ',',
  startVal: 0,
  suffix: '',
  transition: 'linear',
  useEasing: true,
});

const emit = defineEmits<{
  finished: [];
  /**
   * @deprecated 请使用{@link finished}事件
   */
  onFinished: [];
  /**
   * @deprecated 请使用{@link started}事件
   */
  onStarted: [];
  started: [];
}>();

const source = ref(props.startVal);
const disabled = ref(false);
let outputValue = useTransition(source);

/**
 * 正在过渡的数值格式化后的展示文本，是模板唯一渲染的内容。
 * 过渡尚未开始时 useTransition 返回空值，格式化结果也是空串，因此初始不会闪出 0。
 */
const value = computed(() => formatNumber(unref(outputValue)));

watchEffect(() => {
  source.value = props.startVal;
});

watch([() => props.startVal, () => props.endVal], () => {
  if (props.autoplay) {
    start();
  }
});

onMounted(() => {
  props.autoplay && start();
});

/**
 * 从 startVal 播放到 endVal 的一次完整动画。
 * 先重建过渡实例以确保 onStarted、onFinished 回调生效，再把过渡源推到终点触发动画。
 * 挂载时与两端数值变化且 autoplay 为真时调用。
 */
function start() {
  run();
  source.value = props.endVal;
}

/**
 * 回到起点并重放一次过渡，供使用方通过模板 ref 主动调用。
 * 不改变 endVal，因此重放后仍会动画到原终点。
 */
function reset() {
  source.value = props.startVal;
  run();
}

/**
 * 按当前 props 重建过渡实例，把 duration、缓动曲线与开始/结束事件重新绑定到新的 outputValue 上。
 * 换实例而不是复用，是为了让同一次数值变化也能再次触发 onStarted 与 onFinished。
 * 内部只重建过渡，不改动过渡源的当前值。
 */
function run() {
  outputValue = useTransition(source, {
    disabled,
    duration: props.duration,
    /** 过渡跑完时同时抛新事件 finished 与已废弃的 onFinished */
    onFinished: () => {
      emit('finished');
      emit('onFinished');
    },
    /** 过渡开始时同时抛新事件 started 与已废弃的 onStarted */
    onStarted: () => {
      emit('started');
      emit('onStarted');
    },
    ...(props.useEasing
      ? { transition: TransitionPresets[props.transition] }
      : {}),
  });
}

/**
 * 按 props 的小数位、整数分隔符与前后缀把过渡中的数值转成展示文本。
 * 先用 toFixed 保留固定小数位，再只在整数部分插入分隔符（小数部分不做千分位），
 * 最后拼上前后缀；separator 是纯数字时视为"不加分隔"的特殊配置。
 * @param num 待格式化的数值，null、undefined、空串这类非数字输入返回空串。
 * @returns 带前后缀的展示文本；0 会被正常格式化为零值而不是空串。
 */
function formatNumber(num: number | string) {
  if (!num && num !== 0) {
    return '';
  }
  const { decimal, decimals, prefix, separator, suffix } = props;
  num = Number(num).toFixed(decimals);
  num += '';

  const x = num.split('.');
  let x1 = x[0];
  const x2 = x.length > 1 ? decimal + x[1] : '';

  const rgx = /(\d+)(\d{3})/;
  if (separator && !isNumber(separator) && x1) {
    while (rgx.test(x1)) {
      x1 = x1.replace(rgx, `$1${separator}$2`);
    }
  }
  return prefix + x1 + x2 + suffix;
}

defineExpose({ reset });
</script>
<template>
  <span :style="{ color }">
    {{ value }}
  </span>
</template>
