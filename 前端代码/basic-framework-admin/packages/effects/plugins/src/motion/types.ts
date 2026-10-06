/**
 * 动效预设名单：罗列 fade、roll、pop、slide 各方向可用的预设名，
 * 供调用方按 MotionPreset 取值获得类型提示；动画实现由 @vueuse/motion 提供。
 */
export const MotionPresets = [
  'fade',
  'fadeVisible',
  'fadeVisibleOnce',
  'rollBottom',
  'rollLeft',
  'rollRight',
  'rollTop',
  'rollVisibleBottom',
  'rollVisibleLeft',
  'rollVisibleRight',
  'rollVisibleTop',
  'pop',
  'popVisible',
  'popVisibleOnce',
  'slideBottom',
  'slideLeft',
  'slideRight',
  'slideTop',
  'slideVisibleBottom',
  'slideVisibleLeft',
  'slideVisibleRight',
  'slideVisibleTop',
] as const;

export type MotionPreset = (typeof MotionPresets)[number];
