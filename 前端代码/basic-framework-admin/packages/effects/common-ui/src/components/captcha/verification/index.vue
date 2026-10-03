<script setup lang="ts">
/**
 * Verify 验证码组件
 * @description 分发验证码使用
 */
import type { CaptchaVerifyPassingPayload, VerificationProps } from './typing';

import { defineAsyncComponent, markRaw, ref, toRefs, watchEffect } from 'vue';

import { IconifyIcon } from '@vben/icons';

import './verify.css';

defineOptions({
  name: 'Verification',
});

const props = withDefaults(defineProps<VerificationProps>(), {
  arith: 0,
  barSize: () => ({
    height: '40px',
    width: '310px',
  }),
  blockSize: () => ({
    height: '50px',
    width: '50px',
  }),
  captchaType: 'blockPuzzle',
  explain: '',
  figure: 0,
  imgSize: () => ({
    height: '155px',
    width: '310px',
  }),
  mode: 'fixed',
  space: 5,
});

const emit = defineEmits(['onSuccess', 'onError', 'onClose', 'onReady']);

const VerifyPoints = defineAsyncComponent(() => import('./verify-points.vue'));
const VerifySlide = defineAsyncComponent(() => import('./verify-slide.vue'));

const { captchaType, mode, checkCaptchaApi, getCaptchaApi } = toRefs(props);
const verifyType = ref();
const componentType = ref();

const instance = ref<InstanceType<typeof VerifyPoints | typeof VerifySlide>>();

const showBox = ref(false);

/**
 * refresh
 * @description 刷新
 */
const refresh = () => {
  if (instance.value && instance.value.refresh) instance.value.refresh();
};

const show = () => {
  if (mode.value === 'pop') showBox.value = true;
};

/**
 * 转发子组件的校验失败事件并立即换一张新验证码。
 * @param proxy 触发事件的子组件实例，原样透传给父组件
 */
const onError = (proxy: unknown) => {
  emit('onError', proxy);
  refresh();
};

/**
 * 转发子组件的就绪事件；子组件完成首次尺寸换算后重新拉一张，避免首帧尺寸未定就锁死画布。
 * @param proxy 触发事件的子组件实例，原样透传给父组件
 */
const onReady = (proxy: unknown) => {
  emit('onReady', proxy);
  refresh();
};

/** 转发关闭事件并收起弹层。 */
const onClose = () => {
  emit('onClose');
  showBox.value = false;
};

/**
 * 转发校验通过事件。
 * @param data 后端可校验的 captchaVerification 密文
 */
const onSuccess = (data: CaptchaVerifyPassingPayload) => {
  emit('onSuccess', data);
};

watchEffect(
  /**
   * 按 captchaType 切换实际渲染的子组件。
   * @description 滑块类走 VerifySlide 并带上内部用的 type 标记，点选文字走 VerifyPoints；
   * 用 markRaw 避免异步组件被响应式代理而丢失组件标记。
   */
  () => {
    switch (captchaType.value) {
      case 'adminBlockPuzzle':
      case 'blockPuzzle': {
        verifyType.value = '2';
        componentType.value = markRaw(VerifySlide);
        break;
      }
      case 'clickWord': {
        verifyType.value = '';
        componentType.value = markRaw(VerifyPoints);
        break;
      }
    }
  },
);

defineExpose({
  onClose,
  onError,
  onReady,
  onSuccess,
  show,
  refresh,
});
</script>

<template>
  <div v-show="showBox">
    <div
      :class="mode === 'pop' ? 'verifybox' : ''"
      :style="{ 'max-width': `${parseInt(imgSize.width) + 20}px` }"
    >
      <div v-if="mode === 'pop'" class="verifybox-top">
        {{ $t('ui.captcha.title') }}
        <span class="verifybox-close" @click="onClose">
          <IconifyIcon icon="lucide:x" class="size-5" />
        </span>
      </div>
      <div
        :style="{ padding: mode === 'pop' ? '10px' : '0' }"
        class="verifybox-bottom"
      >
        <component
          :is="componentType"
          v-if="componentType"
          ref="instance"
          :arith="arith"
          :bar-size="barSize"
          :block-size="blockSize"
          :captcha-type="captchaType"
          :check-captcha-api="checkCaptchaApi"
          :explain="explain"
          :figure="figure"
          :get-captcha-api="getCaptchaApi"
          :img-size="imgSize"
          :mode="mode"
          :space="space"
          :type="verifyType"
          @on-close="onClose"
          @on-error="onError"
          @on-ready="onReady"
          @on-success="onSuccess"
        />
      </div>
    </div>
  </div>
</template>
