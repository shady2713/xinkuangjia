/**
 * 切换组出口：暴露 ToggleGroup 组容器与 ToggleGroupItem 组内选项两个部件。
 * 两者通过 provide/inject 传递尺寸与外观，样式变体仍复用 ../toggle。
 */
export { default as ToggleGroup } from './ToggleGroup.vue';
export { default as ToggleGroupItem } from './ToggleGroupItem.vue';
