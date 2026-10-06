<script lang="ts" setup>
/**
 * 数字滚动组件：endVal 变化时按 duration/delay 与过渡曲线从当前值滚向目标值。
 * 整数部分按 separator 分千位，decimals 控制小数位，前后缀插槽与样式类名可替换，
 * 起止分别抛出 started/finished 事件；组件不负责取数与业务侧数值加工。
 */
import type { CountToProps } from './types';

import { computed, onMounted, ref, watch } from 'vue';

import { isString } from '@vben-core/shared/utils';

import { TransitionPresets, useTransition } from '@vueuse/core';

const props = withDefaults(defineProps<CountToProps>(), {
  startVal: 0,
  duration: 2000,
  separator: ',',
  decimal: '.',
  decimals: 0,
  delay: 0,
  /** 过渡曲线默认值：easeOutExpo，数值先快后慢地逼近目标值。 */
  transition: () => TransitionPresets.easeOutExpo,
});

const emit = defineEmits(['started', 'finished']);

const lastValue = ref(props.startVal);

onMounted(() => {
  lastValue.value = props.endVal;
});

watch(
  () => props.endVal,
  (val) => {
    lastValue.value = val;
  },
);

const currentValue = useTransition(lastValue, {
  /** 动画开始前的延迟毫秒数，随 props.delay 变化。 */
  delay: computed(() => props.delay),
  /** 动画持续的毫秒数，随 props.duration 变化。 */
  duration: computed(() => props.duration),
  /** 是否禁用过渡动画；禁用时数值直接跳到目标值。 */
  disabled: computed(() => props.disabled),
  /** 过渡曲线：传入字符串时从预设表中取，否则原样使用传入的曲线函数。 */
  transition: computed(() => {
    return isString(props.transition)
      ? TransitionPresets[props.transition]
      : props.transition;
  }),
  /** 动画开始时抛 started 事件。 */
  onStarted() {
    emit('started');
  },
  /** 动画结束时抛 finished 事件。 */
  onFinished() {
    emit('finished');
  },
});

/** 整数部分文本：按 decimals 固定小数位后取整数段，并按 separator 插入千位分隔。 */
const numMain = computed(() => {
  const result = currentValue.value
    .toFixed(props.decimals)
    .split('.')[0]
    ?.replaceAll(/\B(?=(\d{3})+(?!\d))/g, props.separator);
  return result;
});

/** 小数部分文本：小数点符号加固定位数的小数；decimals 为 0 时模板不渲染该段。 */
const numDec = computed(() => {
  return (
    props.decimal + currentValue.value.toFixed(props.decimals).split('.')[1]
  );
});
</script>
<template>
  <div class="count-to" v-bind="$attrs">
    <slot name="prefix">
      <div
        class="count-to-prefix"
        :style="prefixStyle"
        :class="prefixClass"
        v-if="prefix"
      >
        {{ prefix }}
      </div>
    </slot>
    <div class="count-to-main" :class="mainClass" :style="mainStyle">
      <span>{{ numMain }}</span>
      <span
        class="count-to-main-decimal"
        v-if="decimals > 0"
        :class="decimalClass"
        :style="decimalStyle"
      >
        {{ numDec }}
      </span>
    </div>
    <slot name="suffix">
      <div
        class="count-to-suffix"
        :style="suffixStyle"
        :class="suffixClass"
        v-if="suffix"
      >
        {{ suffix }}
      </div>
    </slot>
  </div>
</template>
<style lang="scss" scoped>
.count-to {
  display: flex;
  align-items: baseline;

  &-prefix {
    // font-size: 1rem;
  }

  &-suffix {
    // font-size: 1rem;
  }

  &-main {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    // font-size: 1.5rem;

    &-decimal {
      // font-size: 0.8rem;
    }
  }
}
</style>
