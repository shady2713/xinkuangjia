/**
 * common-ui 组件总出口：应用与上层包从此处取组件，
 * 覆盖 ellipsis-text、icon-picker、iframe、
 * json-viewer、loading、page、tree 等子目录，
 * 并转发 form-ui、popup-ui、shadcn-ui 的文档演示组件
 * 与 globalShareState；本文件不含实现逻辑。
 */
export * from './api-component';
export * from './captcha';
export * from './card/comparison-card';
export * from './card/statistic-card';
export * from './card/summary-card';
export * from './col-page';
export * from './content-wrap';
export * from './count-to';
export * from './cropper';
export * from './doc-alert';
export * from './ellipsis-text';
export * from './icon-picker';
export * from './iframe';
export * from './json-viewer';
export * from './loading';
export * from './page';
export * from './resize';
export * from './tippy';
export * from './tree';
export * from '@vben-core/form-ui';
export * from '@vben-core/popup-ui';

// 给文档用
export {
  VbenAvatar,
  VbenButton,
  VbenButtonGroup,
  VbenCheckbox,
  VbenCheckButtonGroup,
  VbenContextMenu,
  VbenCountToAnimator,
  VbenFullScreen,
  VbenInputPassword,
  VbenLoading,
  VbenLogo,
  VbenPinInput,
  VbenSelect,
  VbenSpinner,
} from '@vben-core/shadcn-ui';

export type { FlattenedItem } from '@vben-core/shadcn-ui';
export { globalShareState } from '@vben-core/shared/global-state';
