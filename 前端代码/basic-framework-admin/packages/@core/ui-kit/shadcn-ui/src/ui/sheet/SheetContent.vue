<script setup lang="ts">
/**
 * 抽屉内容面板：按 side 四向滑入，负责挂载位置、遮罩与出入场动画编排。
 * appendTo 为 body 时用 fixed 定位，否则相对挂载点 absolute，modal、overlayBlur、zIndex 调控遮罩与层级。
 * 面板动画结束才抛出 opened/closed 给抽屉同步状态；开合状态与页头页脚由 Sheet 根和调用方掌握。
 */
import type { DialogContentEmits, DialogContentProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import type { SheetVariants } from './sheet';

import { computed, ref } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { DialogContent, useForwardPropsEmits } from 'reka-ui';

import { sheetVariants } from './sheet';
import SheetOverlay from './SheetOverlay.vue';

/** 抽屉内容面板的属性契约：在 DialogContentProps 之上补挂载位置、四向滑入、遮罩模糊与层级等抽屉专属配置。 */
interface SheetContentProps extends DialogContentProps {
  appendTo?: HTMLElement | string;
  class?: ClassValue;
  modal?: boolean;
  open?: boolean;
  overlayBlur?: number;
  side?: SheetVariants['side'];
  zIndex?: number;
}

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(defineProps<SheetContentProps>(), {
  appendTo: 'body',
});

const emits = defineEmits<
  DialogContentEmits & { close: []; closed: []; opened: [] }
>();

/**
 * 剔除 class、modal、open、side 四个由本组件或样式表自行消费的字段后，把其余属性转交 DialogContent，
 * 避免遮罩开关与滑入方向泄漏到底层弹窗。
 */
const delegatedProps = computed(() => {
  const {
    class: _,
    modal: _modal,
    open: _open,
    side: _side,
    ...delegated
  } = props;

  return delegated;
});

/** 判断抽屉是否挂到 body：appendTo 为字符串 body、document.body 或未指定时都算挂到 body，否则相对挂载点定位。 */
function isAppendToBody() {
  return (
    props.appendTo === 'body' ||
    props.appendTo === document.body ||
    !props.appendTo
  );
}

/** 由挂载位置推导的定位方式，供遮罩与面板共用：挂到 body 用 fixed，挂在其他元素用 absolute。 */
const position = computed(() => {
  return isAppendToBody() ? 'fixed' : 'absolute';
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
const contentRef = ref<InstanceType<typeof DialogContent> | null>(null);
/**
 * 抽屉面板的滑入滑出动画播完后按 open 抛出 opened 或 closed，供抽屉同步状态；非面板根元素的动画事件一律忽略。
 * @param event 面板节点冒泡的 animationend 事件，只有 target 命中 contentRef 才继续派发完成事件。
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
</script>

<template>
  <Teleport defer :to="appendTo">
    <Transition name="fade">
      <SheetOverlay
        v-if="open && modal"
        :style="{
          ...(zIndex ? { zIndex } : {}),
          position,
          backdropFilter:
            overlayBlur && overlayBlur > 0 ? `blur(${overlayBlur}px)` : 'none',
        }"
      />
    </Transition>
    <DialogContent
      ref="contentRef"
      :class="cn('z-popup', sheetVariants({ side }), props.class)"
      :style="{
        ...(zIndex ? { zIndex } : {}),
        position,
      }"
      @animationend="onAnimationEnd"
      v-bind="{ ...forwarded, ...$attrs }"
    >
      <slot></slot>

      <!-- <DialogClose
        class="data-[state=open]:bg-secondary absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none disabled:pointer-events-none"
      >
        <Cross2Icon class="h-5 w-" />
      </DialogClose> -->
    </DialogContent>
  </Teleport>
</template>
