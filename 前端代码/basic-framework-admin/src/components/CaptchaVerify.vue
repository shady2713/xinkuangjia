<script setup lang="ts">
/**
 * 对接后端 anji-plus 滑块验证码组件（blockPuzzle + AES-128-ECB 轨迹校验）。
 */
import { ArrowRight, Check, Close, Refresh } from '@element-plus/icons-vue';
import { onBeforeUnmount, ref } from 'vue';

import { checkCaptchaApi, getCaptchaApi } from '@/api/auth';
import { encryptCaptchaAes } from '@/utils/captcha-aes';

const emit = defineEmits<{
  (e: 'success', payload: { captchaVerification: string }): void;
}>();

const visible = ref(false);
const loading = ref(false);
const backImage = ref('');
const jigsawImage = ref('');
const token = ref('');
const secretKey = ref('');

const IMG_WIDTH = 360;
const IMG_HEIGHT = 180;
const BASE_WIDTH = 310;
const BLOCK_WIDTH = 50;

const dragging = ref(false);
const startX = ref(0);
const moveX = ref(0);
const status = ref<'idle' | 'moving' | 'success' | 'fail'>('idle');
const tipText = ref('');

async function loadChallenge() {
  loading.value = true;
  status.value = 'idle';
  moveX.value = 0;
  tipText.value = '';
  try {
    const resp = await getCaptchaApi({ captchaType: 'blockPuzzle' });
    const body = resp.data;
    if (body?.repCode === '0000' && body.repData) {
      backImage.value = `data:image/png;base64,${body.repData.originalImageBase64}`;
      jigsawImage.value = `data:image/png;base64,${body.repData.jigsawImageBase64}`;
      token.value = body.repData.token || '';
      secretKey.value = body.repData.secretKey || '';
    } else {
      tipText.value = body?.repMsg || '验证码加载失败，请重试';
    }
  } catch {
    tipText.value = '验证码服务异常，请点击刷新';
  } finally {
    loading.value = false;
  }
}

function show() {
  visible.value = true;
  void loadChallenge();
}

function close() {
  visible.value = false;
  detachListeners();
}

function getClientX(e: MouseEvent | TouchEvent): number {
  if ('touches' in e && e.touches.length > 0) {
    return e.touches[0].clientX;
  }
  return (e as MouseEvent).clientX;
}

function onDragStart(e: MouseEvent | TouchEvent) {
  if (loading.value || status.value === 'success') return;
  dragging.value = true;
  status.value = 'moving';
  startX.value = getClientX(e) - moveX.value;
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
  window.addEventListener('touchmove', onDragMove);
  window.addEventListener('touchend', onDragEnd);
}

function onDragMove(e: MouseEvent | TouchEvent) {
  if (!dragging.value) return;
  const maxMove = IMG_WIDTH - BLOCK_WIDTH;
  const next = getClientX(e) - startX.value;
  moveX.value = Math.max(0, Math.min(maxMove, next));
}

function detachListeners() {
  window.removeEventListener('mousemove', onDragMove);
  window.removeEventListener('mouseup', onDragEnd);
  window.removeEventListener('touchmove', onDragMove);
  window.removeEventListener('touchend', onDragEnd);
}

async function onDragEnd() {
  if (!dragging.value) return;
  dragging.value = false;
  detachListeners();

  const scaledX = Math.round((moveX.value * BASE_WIDTH) / IMG_WIDTH);
  const pointStr = JSON.stringify({ x: scaledX, y: 5 });
  const pointJson = secretKey.value
    ? encryptCaptchaAes(pointStr, secretKey.value)
    : pointStr;

  try {
    const resp = await checkCaptchaApi({
      captchaType: 'blockPuzzle',
      pointJson,
      token: token.value,
    });
    const body = resp.data;
    if (body?.repCode === '0000') {
      status.value = 'success';
      tipText.value = '验证通过';
      const rawVerify = `${token.value}---${pointStr}`;
      const captchaVerification = secretKey.value
        ? encryptCaptchaAes(rawVerify, secretKey.value)
        : rawVerify;
      setTimeout(() => {
        visible.value = false;
        emit('success', { captchaVerification });
      }, 450);
    } else {
      status.value = 'fail';
      tipText.value = '验证失败，请重试';
      setTimeout(() => {
        void loadChallenge();
      }, 700);
    }
  } catch {
    status.value = 'fail';
    tipText.value = '校验请求异常，请重试';
    setTimeout(() => {
      void loadChallenge();
    }, 700);
  }
}

onBeforeUnmount(() => {
  detachListeners();
});

defineExpose({ show, close });
</script>

<template>
  <el-dialog
    v-model="visible"
    title="安全验证"
    width="408px"
    :close-on-click-modal="false"
    append-to-body
    @close="detachListeners"
  >
    <div v-loading="loading" class="select-none">
      <div
        class="relative overflow-hidden rounded-md border border-[#e4e4e7] bg-[#f4f4f5]"
        :style="{ width: `${IMG_WIDTH}px`, height: `${IMG_HEIGHT}px` }"
      >
        <img
          v-if="backImage"
          :src="backImage"
          alt="验证码底图"
          class="h-full w-full object-cover"
          draggable="false"
        />
        <img
          v-if="jigsawImage"
          :src="jigsawImage"
          alt="验证码滑块"
          class="absolute top-0 left-0 h-full"
          :style="{
            width: `${Math.round((47 * IMG_WIDTH) / BASE_WIDTH)}px`,
            transform: `translateX(${moveX}px)`,
          }"
          draggable="false"
        />
        <button
          type="button"
          class="absolute top-2 right-2 flex h-7 w-7 cursor-pointer items-center justify-center rounded bg-black/45 text-white hover:bg-black/65"
          title="换一张"
          @click="loadChallenge"
        >
          <el-icon><Refresh /></el-icon>
        </button>
        <div
          v-if="tipText"
          class="absolute inset-x-0 bottom-0 py-1 text-center text-xs text-white"
          :class="status === 'success' ? 'bg-[#16a34a]/85' : 'bg-[#dc2626]/85'"
        >
          {{ tipText }}
        </div>
      </div>

      <div
        class="relative mt-3 flex h-10 items-center justify-center rounded-md border border-[#e4e4e7] bg-[#f8fafc] text-xs text-[#64748b]"
        :style="{ width: `${IMG_WIDTH}px` }"
      >
        <div
          class="absolute top-0 bottom-0 left-0 rounded-l-md transition-colors"
          :class="{
            'bg-[#006be6]/15': status === 'moving',
            'bg-[#16a34a]/20': status === 'success',
            'bg-[#dc2626]/20': status === 'fail',
          }"
          :style="{ width: `${moveX + BLOCK_WIDTH / 2}px` }"
        />
        <span v-if="status === 'idle'">向右拖动滑块完成拼图</span>
        <div
          class="absolute top-0 left-0 flex h-full cursor-grab items-center justify-center rounded border bg-white shadow-sm active:cursor-grabbing"
          :class="{
            'border-[#006be6] bg-[#006be6] text-white': status === 'moving',
            'border-[#16a34a] bg-[#16a34a] text-white': status === 'success',
            'border-[#dc2626] bg-[#dc2626] text-white': status === 'fail',
            'border-[#d4d4d8] text-[#475569]': status === 'idle',
          }"
          :style="{
            width: `${BLOCK_WIDTH}px`,
            transform: `translateX(${moveX}px)`,
          }"
          @mousedown="onDragStart"
          @touchstart.prevent="onDragStart"
        >
          <el-icon>
            <Check v-if="status === 'success'" />
            <Close v-else-if="status === 'fail'" />
            <ArrowRight v-else />
          </el-icon>
        </div>
      </div>
    </div>
  </el-dialog>
</template>
