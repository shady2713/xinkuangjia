/**
 * 动效出口：转出 @vueuse/motion 的 Motion 组件、MotionGroup、指令与插件，
 * 并一并导出本项目的动效预设类型，业务侧无需再直接依赖该库。
 */
export * from './types';

export {
  MotionComponent as Motion,
  MotionDirective,
  MotionGroupComponent as MotionGroup,
  MotionPlugin,
} from '@vueuse/motion';
