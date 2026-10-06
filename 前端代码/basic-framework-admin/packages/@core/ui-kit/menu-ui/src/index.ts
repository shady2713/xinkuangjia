/**
 * 菜单 UI 的公开出口：对外提供 MenuBadge、NormalMenu 与数据驱动的 Menu，
 * 并透出 MenuProps 等类型契约，供布局层声明菜单数据与外观。
 * MenuItem、SubMenu 属于内部渲染单元，不在此暴露。
 */
export { default as MenuBadge } from './components/menu-badge.vue';
export * from './components/normal-menu';
export { default as Menu } from './menu.vue';
export type * from './types';
