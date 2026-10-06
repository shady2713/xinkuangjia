/**
 * shadcn-ui 包总出口：聚合 components 与 ui 两层组件，并转出 reka-ui 的
 * createContext、Slot、VisuallyHidden。
 *
 * effects 与 @core 其余包统一从这里按需引入，本文件不加任何逻辑，
 * 组件实现分别落在 components 与 ui 目录。
 */
export * from './components';
export * from './ui';
export { createContext, Slot, VisuallyHidden } from 'reka-ui';
