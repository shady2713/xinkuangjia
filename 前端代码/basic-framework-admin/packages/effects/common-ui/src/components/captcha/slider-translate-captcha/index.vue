<script setup lang="ts">
/**
 * 平移拼图验证码：用 Canvas 在底图与切块画布上随机绘制缺口拼图，
 * 拖动滑块把切块移到缺口处，误差小于 diffDistance 即判定通过。
 *
 * 负责绘制、随机缺口位置与位移比对，滑块交互复用 slider-captcha；
 * 图片由 src 传入，校验结果只通过 success 事件交给业务方。
 */
import type {
  CaptchaVerifyPassingData,
  SliderCaptchaActionType,
  SliderRotateVerifyPassingData,
  SliderTranslateCaptchaProps,
} from '../types';

import {
  computed,
  onMounted,
  reactive,
  ref,
  unref,
  useTemplateRef,
  watch,
} from 'vue';

import { $t } from '@vben/locales';

import SliderCaptcha from '../slider-captcha/index.vue';

const props = withDefaults(defineProps<SliderTranslateCaptchaProps>(), {
  defaultTip: '',
  canvasWidth: 420,
  canvasHeight: 280,
  squareLength: 42,
  circleRadius: 10,
  src: '',
  diffDistance: 3,
});

const emit = defineEmits<{
  success: [CaptchaVerifyPassingData];
}>();

const PI: number = Math.PI;
/** 画布绘制操作：Clip 在底图上抠出缺口，Fill 在切块画布上填充形状。 */
enum CanvasOpr {
  Clip = 'clip',

  Fill = 'fill',
}

const modalValue = defineModel<boolean>({ default: false });

const slideBarRef = useTemplateRef<SliderCaptchaActionType>('slideBarRef');
const puzzleCanvasRef = useTemplateRef<HTMLCanvasElement>('puzzleCanvasRef');
const pieceCanvasRef = useTemplateRef<HTMLCanvasElement>('pieceCanvasRef');

const state = reactive({
  dragging: false,
  startTime: 0,
  endTime: 0,
  pieceX: 0,
  pieceY: 0,
  moveDistance: 0,
  isPassing: false,
  showTip: false,
});

const left = ref('0');

/** 拼图切块的定位样式：横向位置跟随滑块位移。 */
const pieceStyle = computed(() => {
  return {
    left: left.value,
  };
});

/** 设置切块的横向偏移，取值为形如 '12px' 的字符串。 */
function setLeft(val: string) {
  left.value = val;
}

/** 验证提示文案：通过时附带按秒保留一位小数的耗时，未通过时提示重试。 */
const verifyTip = computed(() => {
  return state.isPassing
    ? $t('ui.captcha.sliderTranslateSuccessTip', [
        ((state.endTime - state.startTime) / 1000).toFixed(1),
      ])
    : $t('ui.captcha.sliderTranslateFailTip');
});
/** 开始拖动时记录起始时间，用于验证成功后回传耗时。 */
function handleStart() {
  state.startTime = Date.now();
}

/** 拖动中记录滑块位移，并让拼图切块跟随移动。 */
function handleDragBarMove(data: SliderRotateVerifyPassingData) {
  state.dragging = true;
  const { moveX } = data;
  state.moveDistance = moveX;
  setLeft(`${moveX}px`);
}

/** 拖动结束：位移误差达到容差时把切块与滑块一并归零，否则判定通过。 */
function handleDragEnd() {
  const { pieceX } = state;
  const { diffDistance } = props;

  if (Math.abs(pieceX - state.moveDistance) >= (diffDistance || 3)) {
    setLeft('0');
    state.moveDistance = 0;
  } else {
    checkPass();
  }
  state.showTip = true;
  state.dragging = false;
}

/** 判定验证通过并记录结束时间。 */
function checkPass() {
  state.isPassing = true;
  state.endTime = Date.now();
}

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

/** 清空底图与切块两张画布；画布未挂载或取不到 2D 上下文时直接返回。 */
function resetCanvas() {
  const { canvasWidth, canvasHeight } = props;
  const puzzleCanvas = unref(puzzleCanvasRef);
  const pieceCanvas = unref(pieceCanvasRef);
  if (!puzzleCanvas || !pieceCanvas) return;
  pieceCanvas.width = canvasWidth;
  const puzzleCanvasCtx = puzzleCanvas.getContext('2d');
  // Canvas2D: Multiple readback operations using getImageData
  // are faster with the willReadFrequently attribute set to true.
  // See: https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-will-read-frequently (anonymous)
  const pieceCanvasCtx = pieceCanvas.getContext('2d', {
    willReadFrequently: true,
  });
  if (!puzzleCanvasCtx || !pieceCanvasCtx) return;
  puzzleCanvasCtx.clearRect(0, 0, canvasWidth, canvasHeight);
  pieceCanvasCtx.clearRect(0, 0, canvasWidth, canvasHeight);
}

/** 加载图片并绘制拼图：底图抠出缺口、切块画布截取对应区域，图片未加载完成前不绘制。 */
function initCanvas() {
  const { canvasWidth, canvasHeight, squareLength, circleRadius, src } = props;
  const puzzleCanvas = unref(puzzleCanvasRef);
  const pieceCanvas = unref(pieceCanvasRef);
  if (!puzzleCanvas || !pieceCanvas) return;
  const puzzleCanvasCtx = puzzleCanvas.getContext('2d');
  // Canvas2D: Multiple readback operations using getImageData
  // are faster with the willReadFrequently attribute set to true.
  // See: https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-will-read-frequently (anonymous)
  const pieceCanvasCtx = pieceCanvas.getContext('2d', {
    willReadFrequently: true,
  });
  if (!puzzleCanvasCtx || !pieceCanvasCtx) return;
  const img = new Image();
  // 解决跨域
  img.crossOrigin = 'Anonymous';
  img.src = src;
  img.addEventListener('load', () => {
    draw(puzzleCanvasCtx, pieceCanvasCtx);
    puzzleCanvasCtx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
    pieceCanvasCtx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
    const pieceLength = squareLength + 2 * circleRadius + 3;
    const sx = state.pieceX;
    const sy = state.pieceY - 2 * circleRadius - 1;
    const imageData = pieceCanvasCtx.getImageData(
      sx,
      sy,
      pieceLength,
      pieceLength,
    );
    pieceCanvas.width = pieceLength;
    pieceCanvasCtx.putImageData(imageData, 0, sy);
    setLeft('0');
  });
}

/** 在 [start, end) 上取随机数并四舍五入取整；四舍五入后可能取到 end。 */
function getRandomNumberByRange(start: number, end: number) {
  return Math.round(Math.random() * (end - start) + start);
}

// 绘制拼图
function draw(ctx1: CanvasRenderingContext2D, ctx2: CanvasRenderingContext2D) {
  const { canvasWidth, canvasHeight, squareLength, circleRadius } = props;
  state.pieceX = getRandomNumberByRange(
    squareLength + 2 * circleRadius,
    canvasWidth - (squareLength + 2 * circleRadius),
  );
  state.pieceY = getRandomNumberByRange(
    3 * circleRadius,
    canvasHeight - (squareLength + 2 * circleRadius),
  );
  drawPiece(ctx1, state.pieceX, state.pieceY, CanvasOpr.Fill);
  drawPiece(ctx2, state.pieceX, state.pieceY, CanvasOpr.Clip);
}

// 绘制拼图切块
function drawPiece(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  opr: CanvasOpr,
) {
  const { squareLength, circleRadius } = props;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(
    x + squareLength / 2,
    y - circleRadius + 2,
    circleRadius,
    0.72 * PI,
    2.26 * PI,
  );
  ctx.lineTo(x + squareLength, y);
  ctx.arc(
    x + squareLength + circleRadius - 2,
    y + squareLength / 2,
    circleRadius,
    1.21 * PI,
    2.78 * PI,
  );
  ctx.lineTo(x + squareLength, y + squareLength);
  ctx.lineTo(x, y + squareLength);
  ctx.arc(
    x + circleRadius - 2,
    y + squareLength / 2,
    circleRadius + 0.4,
    2.76 * PI,
    1.24 * PI,
    true,
  );
  ctx.lineTo(x, y);
  ctx.lineWidth = 2;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.stroke();
  opr === CanvasOpr.Clip ? ctx.clip() : ctx.fill();
  ctx.globalCompositeOperation = 'destination-over';
}

/** 复位：隐藏提示、清空通过状态与切块坐标，让滑块回起点后重新绘制拼图。 */
function resume() {
  state.showTip = false;
  const basicEl = unref(slideBarRef);
  if (!basicEl) {
    return;
  }
  state.dragging = false;
  state.isPassing = false;
  state.pieceX = 0;
  state.pieceY = 0;

  basicEl.resume();
  resetCanvas();
  initCanvas();
}

onMounted(() => {
  initCanvas();
});
</script>

<template>
  <div class="relative flex flex-col items-center">
    <div
      class="border-border relative flex cursor-pointer overflow-hidden border shadow-md"
    >
      <canvas
        ref="puzzleCanvasRef"
        :width="canvasWidth"
        :height="canvasHeight"
        @click="resume"
      ></canvas>
      <canvas
        ref="pieceCanvasRef"
        :width="canvasWidth"
        :height="canvasHeight"
        :style="pieceStyle"
        class="absolute"
        @click="resume"
      ></canvas>
      <div
        class="h-15 absolute bottom-3 left-0 z-10 block w-full text-center text-xs leading-[30px] text-white"
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
          {{ defaultTip || $t('ui.captcha.sliderTranslateDefaultTip') }}
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
