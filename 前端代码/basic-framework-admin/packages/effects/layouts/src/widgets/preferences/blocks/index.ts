/**
 * 偏好设置面板零件出口：向右侧偏好抽屉提供分节外壳与各配置分组。
 * Block 是分组容器、SwitchItem 是通用开关行；Animation、General、
 * Breadcrumb、Content、Footer、Copyright、Layout、Header、Navigation、
 * Sidebar、Tabbar、Widget 组装出具体配置项；Theme、ColorMode、FontSize、
 * Radius、BuiltinTheme 与 GlobalShortcutKeys 覆盖外观和快捷键分组。
 * 这些控件都只回传 v-model，读写与持久化偏好由抽屉一侧完成。
 */
export { default as Block } from './block.vue';
export { default as Animation } from './general/animation.vue';
export { default as General } from './general/general.vue';
export { default as Breadcrumb } from './layout/breadcrumb.vue';
export { default as Content } from './layout/content.vue';
export { default as Copyright } from './layout/copyright.vue';
export { default as Footer } from './layout/footer.vue';
export { default as Header } from './layout/header.vue';
export { default as Layout } from './layout/layout.vue';
export { default as Navigation } from './layout/navigation.vue';
export { default as Sidebar } from './layout/sidebar.vue';
export { default as Tabbar } from './layout/tabbar.vue';
export { default as Widget } from './layout/widget.vue';
export { default as GlobalShortcutKeys } from './shortcut-keys/global.vue';
export { default as SwitchItem } from './switch-item.vue';
export { default as BuiltinTheme } from './theme/builtin.vue';
export { default as ColorMode } from './theme/color-mode.vue';
export { default as FontSize } from './theme/font-size.vue';
export { default as Radius } from './theme/radius.vue';
export { default as Theme } from './theme/theme.vue';
