/**
 * 警告对话框出口：聚合根节点、内容、标题、说明、确认与取消六个部件。
 * 遮罩由内容层内部引用，不在此暴露，使用方只需组合上述部件。
 */
export { default as AlertDialog } from './AlertDialog.vue';
export { default as AlertDialogAction } from './AlertDialogAction.vue';
export { default as AlertDialogCancel } from './AlertDialogCancel.vue';
export { default as AlertDialogContent } from './AlertDialogContent.vue';
export { default as AlertDialogDescription } from './AlertDialogDescription.vue';
export { default as AlertDialogTitle } from './AlertDialogTitle.vue';
