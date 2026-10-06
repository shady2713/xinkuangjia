<script setup lang="ts">
/**
 * 文本省略组件：按行数截断超长文本，悬浮时用 Tooltip 展示完整内容。
 * 供表格列、描述项等窄容器使用；tooltipWhenEllipsis
 * 为真时先探测是否截断再决定是否提示，expand 开启后
 * 点击文本切换展开并抛出 expandChange。
 * 只负责截断展示与提示，文本复制、编辑等操作不在此组件。
 */
import type { CSSProperties } from 'vue';

import {
  computed,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  ref,
  watchEffect,
} from 'vue';

import { VbenTooltip } from '@vben-core/shadcn-ui';

import { useElementSize } from '@vueuse/core';

/** 省略文本属性：展开开关、最大行数与宽度、提示框开关与位置，以及提示框的配色与尺寸。 */
interface Props {
  /**
   * 是否启用点击文本展开全部
   * @default false
   */
  expand?: boolean;
  /**
   * 文本最大行数
   * @default 1
   */
  line?: number;
  /**
   * 文本最大宽度
   * @default '100%'
   */
  maxWidth?: number | string;
  /**
   * 提示框位置
   * @default 'top'
   */
  placement?: 'bottom' | 'left' | 'right' | 'top';
  /**
   * 是否启用文本提示框
   * @default true
   */
  tooltip?: boolean;
  /**
   * 是否只在文本被截断时显示提示框
   * @default false
   */
  tooltipWhenEllipsis?: boolean;
  /**
   * 文本截断检测的像素差异阈值，越大则判断越严格
   * @default 3
   */
  ellipsisThreshold?: number;
  /**
   * 提示框背景颜色，优先级高于 overlayStyle
   */
  tooltipBackgroundColor?: string;
  /**
   * 提示文本字体颜色，优先级高于 overlayStyle
   */
  tooltipColor?: string;
  /**
   * 提示文本字体大小，单位px，优先级高于 overlayStyle
   */
  tooltipFontSize?: number;
  /**
   * 提示框内容最大宽度，单位px，默认不设置时，提示文本内容自动与展示文本宽度保持一致
   */
  tooltipMaxWidth?: number;
  /**
   * 提示框内容区域样式
   * @default { textAlign: 'justify' }
   */
  tooltipOverlayStyle?: CSSProperties;
}

const props = withDefaults(defineProps<Props>(), {
  expand: false,
  line: 1,
  maxWidth: '100%',
  placement: 'top',
  tooltip: true,
  tooltipWhenEllipsis: false,
  ellipsisThreshold: 3,
  tooltipBackgroundColor: '',
  tooltipColor: '',
  tooltipFontSize: 14,
  tooltipMaxWidth: undefined,
  /** 提示框内容区样式默认值：两端对齐，避免多行提示参差不齐。 */
  tooltipOverlayStyle: () => ({ textAlign: 'justify' }),
});

const emit = defineEmits<{ expandChange: [boolean] }>();

/** 文本最大宽度的 CSS 取值：数字补 px，字符串原样使用。 */
const textMaxWidth = computed(() => {
  if (typeof props.maxWidth === 'number') {
    return `${props.maxWidth}px`;
  }
  return props.maxWidth;
});
const ellipsis = ref();
const isExpand = ref(false);
const defaultTooltipMaxWidth = ref();
const isEllipsis = ref(false);

const { width: eleWidth } = useElementSize(ellipsis);

// 检测文本是否被截断
const checkEllipsis = () => {
  if (!ellipsis.value || !props.tooltipWhenEllipsis) return;

  const element = ellipsis.value;

  const originalText = element.textContent || '';
  const originalTrimmed = originalText.trim();

  // 对于空文本直接返回 false
  if (!originalTrimmed) {
    isEllipsis.value = false;
    return;
  }

  const widthDiff = element.scrollWidth - element.clientWidth;
  const heightDiff = element.scrollHeight - element.clientHeight;

  // 使用足够大的差异阈值确保只有真正被截断的文本才会显示 tooltip
  isEllipsis.value =
    props.line === 1
      ? widthDiff > props.ellipsisThreshold
      : heightDiff > props.ellipsisThreshold;
};

// 使用 ResizeObserver 监听尺寸变化
let resizeObserver: null | ResizeObserver = null;

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && props.tooltipWhenEllipsis) {
    resizeObserver = new ResizeObserver(() => {
      checkEllipsis();
    });

    if (ellipsis.value) {
      resizeObserver.observe(ellipsis.value);
    }
  }

  // 初始检测
  checkEllipsis();
});

// 使用onUpdated钩子检测内容变化
onUpdated(() => {
  if (props.tooltipWhenEllipsis) {
    checkEllipsis();
  }
});

onBeforeUnmount(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
});

watchEffect(
  () => {
    if (props.tooltip && eleWidth.value) {
      defaultTooltipMaxWidth.value =
        props.tooltipMaxWidth ?? eleWidth.value + 24;
    }
  },
  { flush: 'post' },
);

/** 切换展开状态并抛出 expandChange；开启截断提示时同步重新检测是否被截断。 */
function onExpand() {
  isExpand.value = !isExpand.value;
  emit('expandChange', isExpand.value);
  if (props.tooltipWhenEllipsis) {
    checkEllipsis();
  }
}

/** 点击文本时的处理：仅在启用 expand 时切换展开状态，否则不做任何事。 */
function handleExpand() {
  props.expand && onExpand();
}
</script>
<template>
  <div>
    <VbenTooltip
      :content-style="{
        ...tooltipOverlayStyle,
        maxWidth: `${defaultTooltipMaxWidth}px`,
        fontSize: `${tooltipFontSize}px`,
        color: tooltipColor,
        backgroundColor: tooltipBackgroundColor,
      }"
      :disabled="
        !props.tooltip || isExpand || (props.tooltipWhenEllipsis && !isEllipsis)
      "
      :side="placement"
    >
      <slot name="tooltip">
        <slot></slot>
      </slot>

      <template #trigger>
        <div
          ref="ellipsis"
          :class="{
            '!cursor-pointer': expand,
            ['block truncate']: line === 1,
            [$style.ellipsisMultiLine]: line > 1,
          }"
          :style="{
            '-webkit-line-clamp': isExpand ? '' : line,
            'max-width': textMaxWidth,
          }"
          class="cursor-text overflow-hidden"
          @click="handleExpand"
          v-bind="$attrs"
        >
          <slot></slot>
        </div>
      </template>
    </VbenTooltip>
  </div>
</template>

<style module>
.ellipsisMultiLine {
  display: -webkit-box;
  -webkit-box-orient: vertical;
}
</style>
