/**
 * 验证码组件的公共契约类型：点位坐标、各验证码的 props、
 * 校验通过载荷与滑块动作句柄，供组件与调用方共用。
 * 只有类型声明，不含运行时逻辑与默认值实现。
 */
import type { CSSProperties } from 'vue';

import type { ClassType } from '@vben/types';

/** 验证码交互的原始点位：x、y 为坐标，t 为该点的采集时间戳。 */
export interface CaptchaData {
  /**
   * x
   */
  x: number;
  /**
   * y
   */
  y: number;
  /**
   * 时间戳
   */
  t: number;
}
/** 带序号的点位：在坐标与时间戳之外记录它在点击序列中的下标。 */
export interface CaptchaPoint extends CaptchaData {
  /**
   * 数据索引
   */
  i: number;
}
/** 点选验证码卡片的属性：底图、宽高与内边距、提示标题，默认值见各字段标注。 */
export interface PointSelectionCaptchaCardProps {
  /**
   * 验证码图片
   */
  captchaImage: string;
  /**
   * 验证码图片高度
   * @default '220px'
   */
  height?: number | string;
  /**
   * 水平内边距
   * @default '12px'
   */
  paddingX?: number | string;
  /**
   * 垂直内边距
   * @default '16px'
   */
  paddingY?: number | string;
  /**
   * 标题
   * @default '请按图依次点击'
   */
  title?: string;
  /**
   * 验证码图片宽度
   * @default '300px'
   */
  width?: number | string;
}

/** 点选验证码完整属性：在卡片属性之上增加确定按钮与提示图片、提示文本。 */
export interface PointSelectionCaptchaProps extends PointSelectionCaptchaCardProps {
  /**
   * 是否展示确定按钮
   * @default false
   */
  showConfirm?: boolean;
  /**
   * 提示图片
   * @default ''
   */
  hintImage?: string;
  /**
   * 提示文本
   * @default ''
   */
  hintText?: string;
}

/** 滑块验证码属性：滑块、滑轨、内容与外层容器的样式，以及插槽模式与提示文案。 */
export interface SliderCaptchaProps {
  class?: ClassType;
  /**
   * @description 滑块的样式
   * @default {}
   */
  actionStyle?: CSSProperties;

  /**
   * @description 滑块条的样式
   * @default {}
   */
  barStyle?: CSSProperties;

  /**
   * @description 内容的样式
   * @default {}
   */
  contentStyle?: CSSProperties;

  /**
   * @description 组件的样式
   * @default {}
   */
  wrapperStyle?: CSSProperties;

  /**
   * @description 是否作为插槽使用，用于联动组件，可参考旋转校验组件
   * @default false
   */
  isSlot?: boolean;

  /**
   * @description 验证成功的提示
   * @default '验证通过'
   */
  successText?: string;

  /**
   * @description 提示文字
   * @default '请按住滑块拖动'
   */
  text?: string;
}

/** 旋转验证码属性：角度范围、图片尺寸与样式、图片地址与提示文案。 */
export interface SliderRotateCaptchaProps {
  /**
   * @description 旋转的角度
   * @default 20
   */
  diffDegree?: number;

  /**
   * @description 图片的宽度
   * @default 260
   */
  imageSize?: number;

  /**
   * @description 图片的样式
   * @default {}
   */
  imageWrapperStyle?: CSSProperties;

  /**
   * @description 最大旋转角度
   * @default 270
   */
  maxDegree?: number;

  /**
   * @description 最小旋转角度
   * @default 90
   */
  minDegree?: number;

  /**
   * @description 图片的地址
   */
  src?: string;
  /**
   * @description 默认提示文本
   */
  defaultTip?: string;
}

/** 平移拼图验证码属性：画布与切块尺寸、图片地址、允许误差与提示文案。 */
export interface SliderTranslateCaptchaProps {
  /**
   * @description 拼图的宽度
   * @default 420
   */
  canvasWidth?: number;
  /**
   * @description 拼图的高度
   * @default 280
   */
  canvasHeight?: number;
  /**
   * @description 切块上正方形的长度
   * @default 42
   */
  squareLength?: number;
  /**
   * @description 切块上圆形的半径
   * @default 10
   */
  circleRadius?: number;
  /**
   * @description 图片的地址
   */
  src?: string;
  /**
   * @description 允许的最大差距
   * @default 3
   */
  diffDistance?: number;
  /**
   * @description 默认提示文本
   */
  defaultTip?: string;
}

/** 验证码校验结果：是否通过，以及本次校验耗时（滑块验证码按秒保留一位小数的字符串）。 */
export interface CaptchaVerifyPassingData {
  isPassing: boolean;
  time: number | string;
}

/** 滑块验证码对外暴露的动作句柄：目前只提供恢复初始状态。 */
export interface SliderCaptchaActionType {
  /** 复位到未验证状态：清空耗时与位移，并把滑块与进度条收回起点。 */
  resume: () => void;
}

/** 旋转验证的进度载荷：原始事件、本次移动距离与当前横向位置。 */
export interface SliderRotateVerifyPassingData {
  event: MouseEvent | TouchEvent;
  moveDistance: number;
  moveX: number;
}
