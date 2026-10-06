<script lang="ts" setup>
/**
 * 点选验证码：按后端给出的字符顺序依次点击图片，把各点坐标加密后提交校验。
 * @description 依赖 getCaptchaApi/checkCaptchaApi 两个由业务方注入的后端接口；
 * 后端未开启 AES 加密时 secretKey 为空，此时按明文提交坐标。
 */
import type {
  CaptchaPointCoordinate,
  CaptchaRequestBody,
  VerificationProps,
} from './typing';

import {
  getCurrentInstance,
  nextTick,
  onMounted,
  reactive,
  ref,
  toRefs,
} from 'vue';

import { IconifyIcon } from '@vben/icons';
import { $t } from '@vben/locales';

import { AjCaptchaAES } from '@vben-core/shared/utils';

import { resetSize } from './utils/util';

/**
 * VerifyPoints
 * @description 点选验证码：按后端给出的字符顺序依次点击图片，提交各点的坐标密文。
 */

defineOptions({
  name: 'VerifyPoints',
});

const props = withDefaults(defineProps<VerificationProps>(), {
  /** 提示条尺寸默认值：310×40 像素。 */
  barSize: () => ({
    height: '40px',
    width: '310px',
  }),
  captchaType: 'clickWord',
  /** 底图区域尺寸默认值：310×155 像素。 */
  imgSize: () => ({
    height: '155px',
    width: '310px',
  }),
  mode: 'fixed',
  space: 5,
});

const emit = defineEmits(['onSuccess', 'onError', 'onClose', 'onReady']);

const { captchaType, mode, checkCaptchaApi, getCaptchaApi } = toRefs(props);
// setup 一定在组件实例内执行，取不到实例属于框架异常，这里按可空处理并在下游逐处判空
const { proxy } = getCurrentInstance() ?? {};
const secretKey = ref<string>(); // 后端返回的 AES 加密密钥
const checkNum = ref(3); // 默认需要点击的字数
const fontPos = reactive<CaptchaPointCoordinate[]>([]); // 选中的坐标信息
const checkPosArr = reactive<CaptchaPointCoordinate[]>([]); // 用户点击的坐标
const num = ref(1); // 点击的记数
const pointBackImgBase = ref<string>(); // 后端获取到的背景图片
const poinTextList = ref<string[]>([]); // 后端返回的点击字体顺序
const backToken = ref<string>(); // 后端返回的token值
const setSize = reactive({
  barHeight: '0px',
  barWidth: '0px',
  imgHeight: '0px',
  imgWidth: '0px',
});
const tempPoints = reactive<CaptchaPointCoordinate[]>([]);
const text = ref<string>();
const barAreaColor = ref<string>();
const barAreaBorderColor = ref<string>();
const showRefresh = ref(true);
const bindingClick = ref(true);

/**
 * DOM 更新后按真实容器尺寸换算图片区与提示条大小，并通知父级组件就绪。
 * @description 必须等渲染完成，父容器此时才有真实 offsetWidth；
 * 弹层未展开时父级可能还没有尺寸，resetSize 内部会退回到视口尺寸兜底。
 */
function syncSize() {
  const { barHeight, barWidth, imgHeight, imgWidth } = resetSize(proxy, {
    barSize: props.barSize,
    imgSize: props.imgSize,
  });
  setSize.imgHeight = imgHeight;
  setSize.imgWidth = imgWidth;
  setSize.barHeight = barHeight;
  setSize.barWidth = barWidth;
  emit('onReady', proxy);
}

/**
 * 重置画布并重新拉取一张验证码。
 * @description 先清空坐标与计数，避免上一轮的点击点残留在新图上；
 * 等 DOM 更新后再按容器尺寸换算图片区大小，并通知父组件可以开始交互。
 */
function init() {
  // 加载页面
  fontPos.splice(0);
  checkPosArr.splice(0);
  num.value = 1;
  getPictrue();
  nextTick(syncSize);
}

onMounted(() => {
  // 禁止拖拽
  init();
  proxy?.$el?.addEventListener('selectstart', () => {
    return false;
  });
});
const canvas = ref<HTMLElement | null>(null);

/** 图片区的实际像素尺寸，键名与 setSize 保持一致，供坐标换算使用。 */
interface RenderedCaptchaSize {
  imgHeight: string;
  imgWidth: string;
}

/**
 * 读取点击位置在图片内的相对坐标。
 * @param _canvas 图片元素，当前实现用 offsetX/offsetY 自行换算，故不使用该参数
 * @param e 原生点击事件
 * @returns 以图片左上角为原点的坐标
 */
const getMousePos = function (_canvas: HTMLElement | null, e: MouseEvent) {
  const x = e.offsetX;
  const y = e.offsetY;
  return { x, y };
};
/**
 * 在画布上标记一个已点击的点。
 * @param pos 点击坐标
 * @returns 下一个点击序号
 */
const createPoint = function (pos: CaptchaPointCoordinate) {
  tempPoints.push({ ...pos });
  return num.value + 1;
};

/**
 * 把原始点击坐标按比例换算到后端约定的 310x155 基准画布。
 * @description 后端按固定基准尺寸比对坐标，因此必须先按显示尺寸归一化，
 * 否则图片被 CSS 缩放后所有坐标都会偏移。
 * @param pointArr 原始点击坐标列表
 * @param imgSize 图片区的实际像素尺寸
 * @returns 换算到基准画布的坐标列表
 */
const pointTransfrom = function (
  pointArr: CaptchaPointCoordinate[],
  imgSize: RenderedCaptchaSize,
) {
  const newPointArr = pointArr.map(
    /**
     * 换算单个点击点的坐标。
     * @param p 原始点击坐标
     * @returns 换算到基准画布的坐标
     */
    (p) => {
      const x = Math.round((310 * p.x) / Number.parseInt(imgSize.imgWidth));
      const y = Math.round((155 * p.y) / Number.parseInt(imgSize.imgHeight));
      return { x, y };
    },
  );
  return newPointArr;
};

/**
 * 刷新验证码。
 * @description 清空全部交互状态并重新请求图片，成功后重新开放刷新入口
 * @returns 新验证码加载完成
 */
const refresh = async function () {
  tempPoints.splice(0);
  barAreaColor.value = '#000';
  barAreaBorderColor.value = '#ddd';
  bindingClick.value = true;
  fontPos.splice(0);
  checkPosArr.splice(0);
  num.value = 1;
  await getPictrue();
  showRefresh.value = true;
};

/**
 * 处理图片上的点击。
 * @description 未点满 checkNum 个字时只累计坐标；点满后按基准画布换算坐标，
 * 等坐标点绘制完成再延迟提交校验，避免用户看到坐标圈先于请求结果出现。
 * @param e 原生点击事件
 */
function canvasClick(e: MouseEvent) {
  checkPosArr.push(getMousePos(canvas.value, e));
  if (num.value === checkNum.value) {
    num.value = createPoint(getMousePos(canvas.value, e));
    // 按比例转换坐标值
    const arr = pointTransfrom(checkPosArr, setSize);
    checkPosArr.length = 0;
    checkPosArr.push(...arr);
    // 等创建坐标执行完
    setTimeout(
      /**
       * 延迟提交校验，让坐标圈先绘制完成再等后端结果。
       */
      () => {
        // 发送后端请求
        const captchaVerification = secretKey.value
          ? AjCaptchaAES.encrypt(
              `${backToken.value}---${JSON.stringify(checkPosArr)}`,
              secretKey.value,
            )
          : `${backToken.value}---${JSON.stringify(checkPosArr)}`;
        const data: CaptchaRequestBody = {
          captchaType: captchaType.value,
          pointJson: secretKey.value
            ? AjCaptchaAES.encrypt(JSON.stringify(checkPosArr), secretKey.value)
            : JSON.stringify(checkPosArr),
          token: backToken.value,
        };
        checkCaptchaApi?.value?.(data).then(
          /**
           * 按后端返回的处理校验结果。
           * @param response 后端响应；接口未配置时为 undefined，视为校验未通过
           */
          (response) => {
            const res = response?.data;
            if (res?.repCode === '0000') {
              barAreaColor.value = '#4cae4c';
              barAreaBorderColor.value = '#5cb85c';
              text.value = $t('ui.captcha.sliderSuccessText');
              bindingClick.value = false;
              if (mode.value === 'pop') {
                setTimeout(
                  /** 弹层模式下停留 1.5 秒让用户看清成功提示，再自动收起并换图。 */
                  () => {
                    emit('onClose');
                    refresh();
                  },
                  1500,
                );
              }
              emit('onSuccess', { captchaVerification });
            } else {
              emit('onError', proxy);
              barAreaColor.value = '#d9534f';
              barAreaBorderColor.value = '#d9534f';
              text.value = $t('ui.captcha.sliderRotateFailTip');
              setTimeout(
                /** 失败提示停留 0.7 秒后换图，避免用户来不及看清失败原因。 */
                () => {
                  refresh();
                },
                700,
              );
            }
          },
        );
      },
      400,
    );
  }
  if (num.value < checkNum.value)
    num.value = createPoint(getMousePos(canvas.value, e));
}

/**
 * 请求背景图片和文字顺序。
 * @description 后端未开启加密时 secretKey 为空，此时提交明文坐标；
 * 失败时直接把 repMsg 展示到提示条上，不静默吞掉错误。
 * @returns 验证码数据加载完成
 */
async function getPictrue() {
  const data = {
    captchaType: captchaType.value,
  };
  const res = await getCaptchaApi?.value?.(data);
  const repData = res?.data?.repData;

  if (res?.data?.repCode === '0000' && repData) {
    pointBackImgBase.value = `data:image/png;base64,${repData.originalImageBase64 ?? ''}`;
    backToken.value = repData.token;
    secretKey.value = repData.secretKey;
    poinTextList.value = repData.wordList ?? [];
    text.value = `${$t('ui.captcha.clickInOrder')}【${poinTextList.value.join(',')}】`;
  } else {
    text.value = res?.data?.repMsg;
  }
}
defineExpose({
  init,
  refresh,
});
</script>

<template>
  <div style="position: relative">
    <div class="verify-img-out">
      <div
        :style="{
          width: setSize.imgWidth,
          height: setSize.imgHeight,
          'background-size': `${setSize.imgWidth} ${setSize.imgHeight}`,
          'margin-bottom': `${space}px`,
        }"
        class="verify-img-panel"
      >
        <div
          v-show="showRefresh"
          class="verify-refresh"
          style="z-index: 3"
          @click="refresh"
        >
          <IconifyIcon icon="lucide:refresh-ccw" class="mr-2 size-5" />
        </div>
        <img
          ref="canvas"
          :src="pointBackImgBase"
          alt=""
          style="display: block; width: 100%; height: 100%"
          @click="bindingClick ? canvasClick($event) : undefined"
        />

        <div
          v-for="(tempPoint, index) in tempPoints"
          :key="index"
          :style="{
            'background-color': '#1abd6c',
            color: '#fff',
            'z-index': 9999,
            width: '20px',
            height: '20px',
            'text-align': 'center',
            'line-height': '20px',
            'border-radius': '50%',
            position: 'absolute',
            top: `${tempPoint.y - 10}px`,
            left: `${tempPoint.x - 10}px`,
          }"
          class="point-area"
        >
          {{ index + 1 }}
        </div>
      </div>
    </div>
    <!-- 'height': this.barSize.height, -->
    <div
      :style="{
        width: setSize.imgWidth,
        color: barAreaColor,
        'border-color': barAreaBorderColor,
        'line-height': barSize.height,
      }"
      class="verify-bar-area"
    >
      <span class="verify-msg">{{ text }}</span>
    </div>
  </div>
</template>
