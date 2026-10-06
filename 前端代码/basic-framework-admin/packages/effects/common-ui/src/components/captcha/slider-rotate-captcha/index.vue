<script setup lang="ts">
/**
 * 旋转验证码：图片随机旋转一个目标角度，用户拖动滑块把它转回原位，
 * 松手时按角度差是否小于 diffDegree 判定通过，点图可重新换图。
 *
 * 滑块本体复用 slider-captcha 的联动模式，本组件只负责角度换算、
 * 随机目标角度生成与成功事件回传，不直接请求后端接口。
 */
import type {
  CaptchaVerifyPassingData,
  SliderCaptchaActionType,
  SliderRotateCaptchaProps,
  SliderRotateVerifyPassingData,
} from '../types';

import { computed, reactive, unref, useTemplateRef, watch } from 'vue';

import { $t } from '@vben/locales';

import { useTimeoutFn } from '@vueuse/core';

import SliderCaptcha from '../slider-captcha/index.vue';

const props = withDefaults(defineProps<SliderRotateCaptchaProps>(), {
  defaultTip: '',
  diffDegree: 20,
  imageSize: 260,
  maxDegree: 300,
  minDegree: 120,
  src: '',
});

const emit = defineEmits<{
  success: [CaptchaVerifyPassingData];
}>();

const slideBarRef = useTemplateRef<SliderCaptchaActionType>('slideBarRef');

const state = reactive({
  currentRotate: 0,
  dragging: false,
  endTime: 0,
  imgStyle: {},
  isPassing: false,
  randomRotate: 0,
  showTip: false,
  startTime: 0,
  toOrigin: false,
});

const modalValue = defineModel<boolean>({ default: false });

watch(
  () => state.isPassing,
  (isPassing) => {
    if (isPassing) {
      const { endTime, startTime } = state;
      const time = (endTime - startTime) / 1000;
      emit('success', { isPassing, time: time.toFixed(1) });
    }
    modalValue.value = isPassing;
  },
);

const getImgWrapStyleRef = computed(() => {
  const { imageSize, imageWrapperStyle } = props;
  return {
    height: `${imageSize}px`,
    width: `${imageSize}px`,
    ...imageWrapperStyle,
  };
});

const getFactorRef = computed(() => {
  const { maxDegree, minDegree } = props;
  if (minDegree > maxDegree) {
    console.warn('minDegree should not be greater than maxDegree');
  }

  if (minDegree === maxDegree) {
    return Math.floor(1 + Math.random() * 1) / 10 + 1;
  }
  return 1;
});

function handleStart() {
  state.startTime = Date.now();
}

/**
 * 拖动滑块时按位移换算当前旋转角度。
 * @description 位移按图片宽度归一化后再乘以 1.5 倍最大角度，使滑块走完整个行程恰好覆盖
 * [minDegree, maxDegree] 区间；imageSize 为 0 时无法归一化，直接放弃本次更新。
 * @param data 滑块组件回传的本次拖动数据
 */
function handleDragBarMove(data: SliderRotateVerifyPassingData) {
  state.dragging = true;
  const { imageSize, maxDegree } = props;
  const { moveX } = data;
  const denominator = imageSize;
  if (denominator === 0) {
    return;
  }
  const currentRotate = Math.ceil(
    (moveX / denominator) * 1.5 * maxDegree * unref(getFactorRef),
  );
  state.currentRotate = currentRotate;
  setImgRotate(state.randomRotate - currentRotate);
}

/**
 * 图片加载完成后生成一轮随机目标角度。
 * @description 每次换图都要重新随机，否则重放同一张图就能猜中答案；
 * 随机结果写入状态并立即应用到图片，验证时由状态与用户旋转角度求差。
 */
function handleImgOnLoad() {
  const { maxDegree, minDegree } = props;
  const ranRotate = Math.floor(
    minDegree + Math.random() * (maxDegree - minDegree),
  ); // 生成随机角度
  state.randomRotate = ranRotate;
  setImgRotate(ranRotate);
}

function handleDragEnd() {
  const { currentRotate, randomRotate } = state;
  const { diffDegree } = props;

  if (Math.abs(randomRotate - currentRotate) >= (diffDegree || 20)) {
    setImgRotate(randomRotate);
    state.toOrigin = true;
    useTimeoutFn(() => {
      state.toOrigin = false;
      state.showTip = true;
      //  时间与动画时间保持一致
    }, 300);
  } else {
    checkPass();
  }
  state.showTip = true;
  state.dragging = false;
}

function setImgRotate(deg: number) {
  state.imgStyle = {
    transform: `rotateZ(${deg}deg)`,
  };
}

function checkPass() {
  state.isPassing = true;
  state.endTime = Date.now();
}

function resume() {
  state.showTip = false;
  const basicEl = unref(slideBarRef);
  if (!basicEl) {
    return;
  }
  state.isPassing = false;

  basicEl.resume();
  handleImgOnLoad();
}

const imgCls = computed(() => {
  return state.toOrigin ? ['transition-transform duration-300'] : [];
});

const verifyTip = computed(() => {
  return state.isPassing
    ? $t('ui.captcha.sliderRotateSuccessTip', [
        ((state.endTime - state.startTime) / 1000).toFixed(1),
      ])
    : $t('ui.captcha.sliderRotateFailTip');
});

defineExpose({
  resume,
});
</script>

<template>
  <div class="relative flex flex-col items-center">
    <div
      :style="getImgWrapStyleRef"
      class="border-border relative cursor-pointer overflow-hidden rounded-full border shadow-md"
    >
      <img
        :class="imgCls"
        :src="src"
        :style="state.imgStyle"
        alt="verify"
        class="w-full rounded-full"
        @click="resume"
        @load="handleImgOnLoad"
      />
      <div
        class="absolute bottom-3 left-0 z-10 block h-7 w-full text-center text-xs leading-[30px] text-white"
      >
        <div
          v-if="state.showTip"
          :class="{
            'bg-success/80': state.isPassing,
            'bg-destructive/80': !state.isPassing,
          }"
        >
          {{ verifyTip }}
        </div>
        <div v-if="!state.dragging" class="bg-black/30">
          {{ defaultTip || $t('ui.captcha.sliderRotateDefaultTip') }}
        </div>
      </div>
    </div>

    <SliderCaptcha
      ref="slideBarRef"
      v-model="modalValue"
      class="mt-5"
      is-slot
      @end="handleDragEnd"
      @move="handleDragBarMove"
      @start="handleStart"
    >
      <template v-for="(_, key) in $slots" :key="key" #[key]="slotProps">
        <slot :name="key" v-bind="slotProps"></slot>
      </template>
    </SliderCaptcha>
  </div>
</template>
