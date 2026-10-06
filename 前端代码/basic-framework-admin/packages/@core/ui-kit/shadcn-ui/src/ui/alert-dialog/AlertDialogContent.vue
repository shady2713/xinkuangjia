<script setup lang="ts">
/**
 * 警告对话框内容层：组合遮罩与内容面板，处理居中、层级和出入场动画。
 *
 * open 与 modal 决定遮罩是否渲染，overlayBlur、zIndex 调整观感与层级；遮罩点击抛 close，
 * 动画结束按 open 抛 opened 或 closed。标题、说明与按钮由使用方拼装，本组件不校验顺序，
 * 并通过 getContentRef 把内容元素暴露给上层。
 */
import type { AlertDialogContentEmits, AlertDialogContentProps } from 'reka-ui';

import type { ClassType } from '@vben-core/typings';

import { computed, ref } from 'vue';

import { cn } from '@vben-core/shared/utils';

import {
  AlertDialogContent,
  AlertDialogPortal,
  useForwardPropsEmits,
} from 'reka-ui';

import AlertDialogOverlay from './AlertDialogOverlay.vue';

const props = withDefaults(
  defineProps<
    AlertDialogContentProps & {
      centered?: boolean;
      class?: ClassType;
      modal?: boolean;
      open?: boolean;
      overlayBlur?: number;
      zIndex?: number;
    }
  >(),
  { modal: true },
);
const emits = defineEmits<
  AlertDialogContentEmits & { close: []; closed: []; opened: [] }
>();

/**
 * 剔除 class、modal、open 三个由本组件自行消费的字段后，把其余属性转交 AlertDialogContent，
 * 避免只服务于遮罩显隐与居中定位的开关泄漏到底层弹窗。
 */
const delegatedProps = computed(() => {
  const { class: _, modal: _modal, open: _open, ...delegated } = props;

  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);

const contentRef = ref<InstanceType<typeof AlertDialogContent> | null>(null);
/**
 * 警告框面板自身的动画播完时按 open 抛出 opened 或 closed，供使用方在动画真正结束后再回调完成钩子。
 * @param event 面板节点冒泡的 animationend 事件，target 与面板根元素一致才认为面板动画结束，子元素动画会被忽略。
 */
function onAnimationEnd(event: AnimationEvent) {
  // 只有在 contentRef 的动画结束时才触发 opened/closed 事件
  if (event.target === contentRef.value?.$el) {
    if (props.open) {
      emits('opened');
    } else {
      emits('closed');
    }
  }
}
defineExpose({
  /** 暴露给上层的内容节点引用，面板未挂载时为 null，供调用方测量尺寸或聚焦面板内元素。 */
  getContentRef: () => contentRef.value,
});
</script>

<template>
  <AlertDialogPortal>
    <Transition name="fade" appear>
      <AlertDialogOverlay
        v-if="open && modal"
        :style="{
          ...(zIndex ? { zIndex } : {}),
          position: 'fixed',
          backdropFilter:
            overlayBlur && overlayBlur > 0 ? `blur(${overlayBlur}px)` : 'none',
        }"
        @click="() => emits('close')"
      />
    </Transition>
    <AlertDialogContent
      ref="contentRef"
      :style="{ ...(zIndex ? { zIndex } : {}), position: 'fixed' }"
      @animationend="onAnimationEnd"
      v-bind="forwarded"
      :class="
        cn(
          'z-popup bg-background p-6 shadow-lg outline-none sm:rounded-xl',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          {
            'data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-top-[48%]':
              !centered,
            'data-[state=closed]:slide-out-to-top-[148%] data-[state=open]:slide-in-from-top-[98%]':
              centered,
            'top-[10vh]': !centered,
            'top-1/2 -translate-y-1/2': centered,
          },
          props.class,
        )
      "
    >
      <slot></slot>
    </AlertDialogContent>
  </AlertDialogPortal>
</template>
