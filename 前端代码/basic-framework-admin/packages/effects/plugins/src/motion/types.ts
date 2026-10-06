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

/** 动效预设名：取自 MotionPresets 的字面量联合，用于约束动效指令 preset 的合法取值。 */
export type MotionPreset = (typeof MotionPresets)[number];
