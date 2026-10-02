<script lang="ts" setup>
/** 图片裁剪与预览组件；裁剪结果以事件交给调用方上传，卸载时释放裁剪实例。 */
import type { CSSProperties } from 'vue';

import type { CropperProps } from './typing';

import { computed, onMounted, onUnmounted, ref, unref, useAttrs } from 'vue';

import { useDebounceFn } from '@vueuse/core';
import Cropper from 'cropperjs';

import { defaultOptions } from './typing';

import 'cropperjs/dist/cropper.css';

defineOptions({ name: 'CropperImage' });

/**
 * 图片裁剪器组件：基于 cropperjs 实现图片裁剪、旋转、缩放，
 * 裁剪过程中按 80ms 防抖实时向父组件抛出裁剪结果，组件卸载时销毁 cropper 实例。
 */
const props = withDefaults(defineProps<CropperProps>(), {
  src: '',
  alt: '',
  circled: false,
  realTimePreview: true,
  height: '360px',
  crossorigin: undefined,
  /** 每个裁剪实例独立持有附加样式，避免共享可变对象。 */
  imageStyle: () => ({}),
  /** 每个实例独立持有 Cropper 配置，由调用方按需覆盖。 */
  options: () => ({}),
});

/**
 * cropend：一次裁剪完成时触发，载荷为 { imgBase64: 裁剪结果 base64, imgInfo: cropperjs 裁剪区域信息 }。
 * ready：cropperjs 初始化完成时触发，载荷为 cropper 实例，父组件可借此调用旋转、缩放等方法。
 * cropendError：裁剪结果读取失败（FileReader 错误）时触发，无载荷。
 */
const emit = defineEmits(['cropend', 'ready', 'cropendError']);
const attrs = useAttrs();

/** 裁剪容器引用允许挂载前和卸载后的空状态。 */
type ElRef<T extends HTMLElement = HTMLDivElement> = null | T;
const imgElRef = ref<ElRef<HTMLImageElement>>();
const cropper = ref<Cropper | null>();
const isReady = ref(false);

const debounceRealTimeCropped = useDebounceFn(realTimeCropped, 80);

const getImageStyle = computed(
  /** 合并默认显示尺寸与调用方图片样式。 */ (): CSSProperties => {
    return {
      height: props.height,
      maxWidth: '100%',
      ...props.imageStyle,
    };
  },
);

const getClass = computed(
  /** 保留外部样式类并标记圆形预览。 */ () => {
    return [
      attrs.class,
      {
        'cropper-image--circled': props.circled,
      },
    ];
  },
);

const getWrapperStyle = computed(
  /** 统一裁剪区域的像素高度，保持图片与容器尺寸一致。 */ (): CSSProperties => {
    return { height: `${`${props.height}`.replace(/px/, '')}px` };
  },
);

onMounted(init);

onUnmounted(
  /** 卸载时释放 Cropper 的 DOM 与事件监听资源。 */ () => {
    cropper.value?.destroy();
  },
);

/** 在挂载后的图片元素上创建 cropper 实例；props.options 最后展开，允许调用方覆盖默认配置和回调 */
async function init() {
  const imgEl = unref(imgElRef);
  if (!imgEl) {
    return;
  }
  cropper.value = new Cropper(imgEl, {
    ...defaultOptions,
    /** 初始化完成后发布首帧预览，并暴露就绪的实例给父组件。 */
    ready: () => {
      isReady.value = true;
      realTimeCropped();
      emit('ready', cropper.value);
    },
    /** 裁剪区域变化后防抖更新预览，避免拖动期间频繁编码图片。 */
    crop() {
      debounceRealTimeCropped();
    },
    /** 缩放变化后同步裁剪预览。 */
    zoom() {
      debounceRealTimeCropped();
    },
    /** 裁剪区域拖动时更新预览，合并连续拖动事件。 */
    cropmove() {
      debounceRealTimeCropped();
    },
    ...props.options,
  });
}

/** 实时预览入口：仅在开启 realTimePreview 时重新计算裁剪结果 */
function realTimeCropped() {
  props.realTimePreview && cropped();
}

/** 读取当前裁剪结果并转为 base64，通过 cropend 事件抛给父组件；读取失败时抛出 cropendError */
function cropped() {
  if (!cropper.value) {
    return;
  }
  const imgInfo = cropper.value.getData();
  const canvas = props.circled
    ? getRoundedCanvas()
    : cropper.value.getCroppedCanvas();
  canvas.toBlob(
    /** 将可用图片二进制转为预览地址；空结果不发布裁剪事件。 */ (blob) => {
      if (!blob) {
        return;
      }
      const fileReader: FileReader = new FileReader();
      fileReader.readAsDataURL(blob);
      fileReader.onloadend =
        /** 编码结束后发布图片地址和裁剪坐标，供预览与上传使用。 */ (e) => {
          emit('cropend', {
            imgBase64: e.target?.result ?? '',
            imgInfo,
          });
        };
      // 此读取器由本次裁剪独占，保留现有单回调注册方式，不在此变更事件生命周期。
      // eslint-disable-next-line unicorn/prefer-add-event-listener
      fileReader.onerror =
        /** 读取失败时通知调用方，使其结束上传或预览的等待状态。 */ () => {
          emit('cropendError');
        };
    },
    'image/png',
  );
}

/** 生成圆形裁剪结果的画布：先用 destination-in 合成圆形遮罩，再由调用方导出为图片 */
function getRoundedCanvas() {
  const sourceCanvas = cropper.value!.getCroppedCanvas();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  canvas.width = width;
  canvas.height = height;
  context.imageSmoothingEnabled = true;
  context.drawImage(sourceCanvas, 0, 0, width, height);
  context.globalCompositeOperation = 'destination-in';
  context.beginPath();
  context.arc(
    width / 2,
    height / 2,
    Math.min(width, height) / 2,
    0,
    2 * Math.PI,
    true,
  );
  context.fill();
  return canvas;
}
</script>

<template>
  <div :class="getClass" :style="getWrapperStyle">
    <img
      v-show="isReady"
      ref="imgElRef"
      :alt="alt"
      :crossorigin="crossorigin"
      :src="src"
      :style="getImageStyle"
      class="h-auto max-w-full"
    />
  </div>
</template>

<style lang="scss">
.cropper-image {
  &--circled {
    .cropper-view-box,
    .cropper-face {
      border-radius: 50%;
    }
  }
}
</style>
