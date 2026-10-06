<script setup lang="ts">
/**
 * 滚动内容弹窗面板：遮罩自身可滚动，内容超出视口时随页面滚动，适合长表单。
 * 指针按下点越过内容边界时阻止外部关闭，避免拖动滚动条误关弹窗；
 * 默认 zIndex 为 1000，与可拖拽的 DialogContent 面板是两条独立实现。
 */
import type { DialogContentEmits, DialogContentProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { X } from 'lucide-vue-next';
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  useForwardPropsEmits,
} from 'reka-ui';

const props = withDefaults(
  defineProps<DialogContentProps & { class?: ClassValue; zIndex?: number }>(),
  { zIndex: 1000 },
);
const emits = defineEmits<DialogContentEmits>();

/** 去掉 class 后的弹窗面板属性，连同 emits 转发给 DialogContent；zIndex 与越界拖拽拦截留在模板里处理。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <DialogPortal>
    <DialogOverlay
      :style="{ zIndex }"
      class="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 absolute inset-0 grid place-items-center overflow-y-auto border border-border bg-black/80"
    >
      <DialogContent
        :class="
          cn(
            'relative z-50 my-8 grid w-full max-w-lg gap-4 border border-border bg-background p-6 shadow-lg duration-200 sm:rounded-lg md:w-full',
            props.class,
          )
        "
        :style="{ zIndex }"
        v-bind="forwarded"
        @pointer-down-outside="
          (event) => {
            const originalEvent = event.detail.originalEvent;
            const target = originalEvent.target as HTMLElement;
            if (
              originalEvent.offsetX > target.clientWidth ||
              originalEvent.offsetY > target.clientHeight
            ) {
              event.preventDefault();
            }
          }
        "
      >
        <slot></slot>

        <DialogClose
          class="absolute right-4 top-4 rounded-md p-0.5 transition-colors hover:bg-secondary"
        >
          <X class="h-4 w-4" />
          <span class="sr-only">Close</span>
        </DialogClose>
      </DialogContent>
    </DialogOverlay>
  </DialogPortal>
</template>
