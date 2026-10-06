<script lang="ts" setup>
/**
 * 加载遮罩：铺满宿主容器，等 minLoadingTime 毫秒后才淡入，避免快请求闪一下。
 *
 * 由 spinning 切换显隐，text 在动画下方显示提示语，icon 插槽可替换默认四点动画；
 * 不发起请求也不处理失败，宿主需自己提供定位上下文。
 */
import { ref, watch } from 'vue';

import { cn } from '@vben-core/shared/utils';

/**
 * 加载遮罩的入参。
 * spinning 是唯一的显隐开关，组件只在它为真且持续超过 minLoadingTime 毫秒后才显示；
 * text 是动画下方的提示语，为空串时整行不渲染；class 用于追加遮罩层的样式。
 */
interface Props {
  class?: string;
  /**
   * @zh_CN 最小加载时间
   * @en_US Minimum loading time
   */
  minLoadingTime?: number;

  /**
   * @zh_CN loading状态开启
   */
  spinning?: boolean;
  /**
   * @zh_CN 文字
   */
  text?: string;
}

defineOptions({
  name: 'VbenLoading',
});

const props = withDefaults(defineProps<Props>(), {
  minLoadingTime: 50,
  text: '',
});
// const startTime = ref(0);
const showSpinner = ref(false);
const renderSpinner = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => props.spinning,
  (show) => {
    if (!show) {
      showSpinner.value = false;
      timer && clearTimeout(timer);
      return;
    }

    // startTime.value = performance.now();
    timer = setTimeout(() => {
      // const loadingTime = performance.now() - startTime.value;

      showSpinner.value = true;
      if (showSpinner.value) {
        renderSpinner.value = true;
      }
    }, props.minLoadingTime);
  },
  {
    immediate: true,
  },
);

/**
 * 遮罩淡出动画结束后卸载动画节点。
 * 用动画结束而非定时器来回收，是为了让最后一次淡出自然播完；
 * 此时 showSpinner 已为 false 说明确实是关闭而非开启方向的过渡，
 * 期间若又被打开成 loading，showSpinner 会重新为真，本次回收自动作废。
 */
function onTransitionEnd() {
  if (!showSpinner.value) {
    renderSpinner.value = false;
  }
}
</script>

<template>
  <div
    :class="
      cn(
        'z-100 absolute left-0 top-0 flex size-full flex-col items-center justify-center bg-overlay-content transition-all duration-500 dark:bg-overlay',
        {
          'invisible opacity-0': !showSpinner,
        },
        props.class,
      )
    "
    @transitionend="onTransitionEnd"
  >
    <slot name="icon" v-if="renderSpinner">
      <span class="dot relative inline-block size-9 text-3xl">
        <i
          v-for="index in 4"
          :key="index"
          class="absolute block size-4 origin-[50%_50%] scale-75 rounded-full bg-primary opacity-30"
        ></i>
      </span>
    </slot>

    <div v-if="text" class="mt-4 text-xs text-primary">{{ text }}</div>
    <slot></slot>
  </div>
</template>

<style scoped>
.dot {
  transform: rotate(45deg);
  animation: rotate-ani 1.2s infinite linear;
}

.dot i {
  animation: spin-move-ani 1s infinite linear alternate;
}

.dot i:nth-child(1) {
  top: 0;
  left: 0;
}

.dot i:nth-child(2) {
  top: 0;
  right: 0;
  animation-delay: 0.4s;
}

.dot i:nth-child(3) {
  right: 0;
  bottom: 0;
  animation-delay: 0.8s;
}

.dot i:nth-child(4) {
  bottom: 0;
  left: 0;
  animation-delay: 1.2s;
}

@keyframes rotate-ani {
  to {
    transform: rotate(405deg);
  }
}

@keyframes spin-move-ani {
  to {
    opacity: 1;
  }
}
</style>
