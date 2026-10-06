/**
 * 抽屉桶文件：对外暴露 Sheet 根、SheetContent 内容、SheetHeader/SheetFooter 页头页脚、
 * SheetTitle/SheetDescription 标题说明与 SheetClose/SheetTrigger 开关入口，并转发方向样式表。
 * 遮罩 SheetOverlay 属内部件，不在此导出，只能经 SheetContent 间接触达。
 */
export * from './sheet';
export { default as Sheet } from './Sheet.vue';
export { default as SheetClose } from './SheetClose.vue';
export { default as SheetContent } from './SheetContent.vue';
export { default as SheetDescription } from './SheetDescription.vue';
export { default as SheetFooter } from './SheetFooter.vue';
export { default as SheetHeader } from './SheetHeader.vue';
export { default as SheetTitle } from './SheetTitle.vue';

export { default as SheetTrigger } from './SheetTrigger.vue';
