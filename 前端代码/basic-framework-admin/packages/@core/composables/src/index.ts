/**
 * composables 包的对外唯一入口：聚合导出移动端判定、布局尺寸、滚动锁定、
 * 简易多语言与拖拽排序等组合式函数，并转发 reka-ui 的 props/emits 工具。
 * 各组合式函数在 src 下按文件实现，使用方只从这里导入，不深链具体文件。
 */
export * from './use-is-mobile';
export * from './use-layout-style';
export * from './use-namespace';
export * from './use-priority-value';
export * from './use-scroll-lock';
export * from './use-simple-locale';
export * from './use-sortable';
export {
  useEmitAsProps,
  useForwardExpose,
  useForwardProps,
  useForwardPropsEmits,
} from 'reka-ui';
