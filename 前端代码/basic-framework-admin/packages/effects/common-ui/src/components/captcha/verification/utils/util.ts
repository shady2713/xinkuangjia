/** 验证码尺寸换算工具：把配置里的百分比尺寸按父级容器换算成像素。 */
import type { CaptchaSize } from '../typing';

/**
 * resetSize 需要的最小宿主契约。
 * @description setup 拿到的是组件公开实例，实例类型无法反映 props 上的 barSize/imgSize，
 * 因此这里只要求根元素，尺寸由调用方从 props 单独传入。
 */
export interface CaptchaSizingHost {
  /** 组件根元素，用于读取父级容器的可视尺寸 */
  $el: HTMLElement;
}

/** 调用方需要提供的尺寸配置，取自组件 props。 */
export interface CaptchaSizingConfig {
  /** 验证码底部的提示条尺寸 */
  barSize: CaptchaSize;
  /** 验证码图片区域的尺寸 */
  imgSize: CaptchaSize;
}

/** 换算后的实际像素尺寸，交给组件内联样式直接使用。 */
export interface CaptchaResolvedSize {
  barHeight: string;
  barWidth: string;
  imgHeight: string;
  imgWidth: string;
}

/**
 * 把配置里的百分比尺寸换算成像素。
 * @description 配置值带 % 时按父级容器尺寸换算，不带 % 时原样返回。
 * @param size 配置尺寸，例如 '310px' 或 '100%'
 * @param parentSize 父级容器的像素尺寸
 * @returns 可直接用于内联样式的像素长度
 */
function resolveLength(size: string, parentSize: number): string {
  return size.includes('%')
    ? `${(Number.parseInt(size) / 100) * parentSize}px`
    : size;
}

/**
 * 按父级容器尺寸换算验证码各区域的像素尺寸。
 * @description 父级容器可能在弹窗挂载后才出现真实尺寸，此时取不到 offsetWidth/offsetHeight，
 * 退回到窗口视口尺寸，保证百分比配置仍有可渲染的兜底值而不是 NaN。
 * @param host 组件公开实例，提供根元素；未就绪时按视口尺寸兜底
 * @param config 组件 props 上的尺寸配置
 * @returns 图片区与提示条的实际像素尺寸
 */
export function resetSize(
  host: CaptchaSizingHost | null | undefined,
  config: CaptchaSizingConfig,
): CaptchaResolvedSize {
  const parentElement = host?.$el?.parentElement;
  const parentWidth = parentElement?.offsetWidth || window.innerWidth;
  const parentHeight = parentElement?.offsetHeight || window.innerHeight;

  return {
    barHeight: resolveLength(config.barSize.height, parentHeight),
    barWidth: resolveLength(config.barSize.width, parentWidth),
    imgHeight: resolveLength(config.imgSize.height, parentHeight),
    imgWidth: resolveLength(config.imgSize.width, parentWidth),
  };
}

export const _code_chars = [
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'q',
  'r',
  's',
  't',
  'u',
  'v',
  'w',
  'x',
  'y',
  'z',
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
];
export const _code_color1 = ['#fffff0', '#f0ffff', '#f0fff0', '#fff0f0'];
export const _code_color2 = [
  '#FF0033',
  '#006699',
  '#993366',
  '#FF9900',
  '#66CC66',
  '#FF33CC',
];
