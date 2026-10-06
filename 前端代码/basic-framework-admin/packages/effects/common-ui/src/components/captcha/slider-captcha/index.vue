<script setup lang="ts">
/**
 * 滑块验证码基座：按住滑块拖到右端即判定通过，回传耗时并双向绑定结果；
 * isSlot 打开时把判定权交给父级，只做位移与宽度的交接。
 *
 * 负责位移换算、边界夹紧与复位，图片、提示与后端校验由调用方
 * 或旋转、平移验证码等上层组件负责，resume 用于重置到初始状态。
 */
import type {
  CaptchaVerifyPassingData,
  SliderCaptchaProps,
  SliderRotateVerifyPassingData,
} from '../types';

import { reactive, unref, useTemplateRef, watch, watchEffect } from 'vue';

import { $t } from '@vben/locales';

import { cn } from '@vben-core/shared/utils';

import { useTimeoutFn } from '@vueuse/core';

import SliderCaptchaAction from './slider-captcha-action.vue';
import SliderCaptchaBar from './slider-captcha-bar.vue';
import SliderCaptchaContent from './slider-captcha-content.vue';

const props = withDefaults(defineProps<SliderCaptchaProps>(), {
  /** 滑块样式默认值：空对象，未传入时不附加样式。 */
  actionStyle: () => ({}),
  /** 滑轨样式默认值：空对象，未传入时不附加样式。 */
  barStyle: () => ({}),
  /** 内容区样式默认值：空对象，未传入时不附加样式。 */
  contentStyle: () => ({}),
  isSlot: false,
  successText: '',
  text: '',
  /** 外层容器样式默认值：空对象，未传入时不附加样式。 */
  wrapperStyle: () => ({}),
});

const emit = defineEmits<{
  end: [MouseEvent | TouchEvent];
  move: [SliderRotateVerifyPassingData];
  start: [MouseEvent | TouchEvent];
  success: [CaptchaVerifyPassingData];
}>();

const modelValue = defineModel<boolean>({ default: false });

const state = reactive({
  endTime: 0,
  isMoving: false,
  isPassing: false,
  moveDistance: 0,
  startTime: 0,
  toLeft: false,
});

defineExpose({
  resume,
});

const wrapperRef = useTemplateRef<HTMLDivElement>('wrapperRef');
const barRef = useTemplateRef<typeof SliderCaptchaBar>('barRef');
const contentRef = useTemplateRef<typeof SliderCaptchaContent>('contentRef');
const actionRef = useTemplateRef<typeof SliderCaptchaAction>('actionRef');

watch(
  () => state.isPassing,
  (isPassing) => {
    if (isPassing) {
      const { endTime, startTime } = state;
      const time = (endTime - startTime) / 1000;
      emit('success', { isPassing, time: time.toFixed(1) });
      modelValue.value = isPassing;
    }
  },
);

watchEffect(() => {
  state.isPassing = !!modelValue.value;
});

/**
 * 取鼠标或触摸事件的页面横坐标。
 * @param e 鼠标或触摸事件；触摸事件取第一个触点的坐标。
 * @returns 页面横坐标；事件不携带坐标信息时返回 0。
 */
function getEventPageX(e: MouseEvent | TouchEvent): number {
  if ('pageX' in e) {
    return e.pageX;
  } else if ('touches' in e && e.touches[0]) {
    return e.touches[0].pageX;
  }
  return 0;
}

/**
 * 开始拖动：记录按下的起始位置与起始时间并进入拖动状态。
 * @param e 触发拖动的鼠标或触摸事件，用于换算起始横坐标。
 */
function handleDragStart(e: MouseEvent | TouchEvent) {
  if (state.isPassing) {
    return;
  }
  if (!actionRef.value) return;
  emit('start', e);

  state.moveDistance =
    getEventPageX(e) -
    Number.parseInt(
      actionRef.value.getStyle().left.replace('px', '') || '0',
      10,
    );
  state.startTime = Date.now();
  state.isMoving = true;
}

/** 按外层宽度与滑块宽度算出可拖动的最大位移，并一并返回两者宽度供调用方复用。 */
function getOffset(actionEl: HTMLDivElement) {
  const wrapperWidth = wrapperRef.value?.offsetWidth ?? 220;
  const actionWidth = actionEl?.offsetWidth ?? 40;
  const offset = wrapperWidth - actionWidth - 6;
  return { actionWidth, offset, wrapperWidth };
}

/**
 * 拖动中：按当前位移同步滑块位置与进度条宽度，越过终点时直接判定通过。
 * @param e 拖动过程中的鼠标或触摸事件，用于计算当前横向位移。
 */
function handleDragMoving(e: MouseEvent | TouchEvent) {
  const { isMoving, moveDistance } = state;
  if (isMoving) {
    const actionEl = unref(actionRef);
    const barEl = unref(barRef);
    if (!actionEl || !barEl) return;
    const { actionWidth, offset, wrapperWidth } = getOffset(actionEl.getEl());
    const moveX = getEventPageX(e) - moveDistance;

    emit('move', {
      event: e,
      moveDistance,
      moveX,
    });
    if (moveX > 0 && moveX <= offset) {
      actionEl.setLeft(`${moveX}px`);
      barEl.setWidth(`${moveX + actionWidth / 2}px`);
    } else if (moveX > offset) {
      actionEl.setLeft(`${wrapperWidth - actionWidth}px`);
      barEl.setWidth(`${wrapperWidth - actionWidth / 2}px`);
      if (!props.isSlot) {
        checkPass();
      }
    }
  }
}

/**
 * 结束拖动：按最终位移决定复位还是判定通过；插槽模式下由父级决定结果。
 * @param e 结束拖动的鼠标或触摸事件（也包含移出容器），用于计算最终位移。
 */
function handleDragOver(e: MouseEvent | TouchEvent) {
  const { isMoving, isPassing, moveDistance } = state;
  if (isMoving && !isPassing) {
    emit('end', e);
    const actionEl = actionRef.value;
    const barEl = unref(barRef);
    if (!actionEl || !barEl) return;
    const moveX = getEventPageX(e) - moveDistance;
    const { actionWidth, offset, wrapperWidth } = getOffset(actionEl.getEl());
    if (moveX < offset) {
      if (props.isSlot) {
        setTimeout(() => {
          if (modelValue.value) {
            const contentEl = unref(contentRef);
            if (contentEl) {
              contentEl.getEl().style.width = `${Number.parseInt(barEl.getEl().style.width)}px`;
            }
          } else {
            resume();
          }
        }, 0);
      } else {
        resume();
      }
    } else {
      actionEl.setLeft(`${wrapperWidth - actionWidth}px`);
      barEl.setWidth(`${wrapperWidth - actionWidth / 2}px`);
      checkPass();
    }
    state.isMoving = false;
  }
}

/** 判定验证通过并记录结束时间；插槽模式下不自行判定，改为复位等待父级结论。 */
function checkPass() {
  if (props.isSlot) {
    resume();
    return;
  }
  state.endTime = Date.now();
  state.isPassing = true;
  state.isMoving = false;
}

/** 复位到未验证状态：清空耗时与位移，并带动画把滑块与进度条收回起点。 */
function resume() {
  state.isMoving = false;
  state.isPassing = false;
  state.moveDistance = 0;
  state.toLeft = false;
  state.startTime = 0;
  state.endTime = 0;
  const actionEl = unref(actionRef);
  const barEl = unref(barRef);
  const contentEl = unref(contentRef);
  if (!actionEl || !barEl || !contentEl) return;

  contentEl.getEl().style.width = '100%';
  state.toLeft = true;
  useTimeoutFn(() => {
    state.toLeft = false;
    actionEl.setLeft('0');
    barEl.setWidth('0');
  }, 300);
}
</script>

<template>
  <div
    ref="wrapperRef"
    :class="
      cn(
        'border-border bg-background-deep relative flex h-10 w-full items-center overflow-hidden rounded-md border text-center',
        props.class,
      )
    "
    :style="wrapperStyle"
    @mouseleave="handleDragOver"
    @mousemove="handleDragMoving"
    @mouseup="handleDragOver"
    @touchend="handleDragOver"
    @touchmove="handleDragMoving"
  >
    <SliderCaptchaBar
      ref="barRef"
      :bar-style="barStyle"
      :to-left="state.toLeft"
    />
    <SliderCaptchaContent
      ref="contentRef"
      :content-style="contentStyle"
      :is-passing="state.isPassing"
      :success-text="successText || $t('ui.captcha.sliderSuccessText')"
      :text="text || $t('ui.captcha.sliderDefaultText')"
    >
      <template v-if="$slots.text" #text>
        <slot :is-passing="state.isPassing" name="text"></slot>
      </template>
    </SliderCaptchaContent>

    <SliderCaptchaAction
      ref="actionRef"
      :action-style="actionStyle"
      :is-passing="state.isPassing"
      :to-left="state.toLeft"
      @mousedown="handleDragStart"
      @touchstart="handleDragStart"
    >
      <template v-if="$slots.actionIcon" #icon>
        <slot :is-passing="state.isPassing" name="actionIcon"></slot>
      </template>
    </SliderCaptchaAction>
  </div>
</template>
