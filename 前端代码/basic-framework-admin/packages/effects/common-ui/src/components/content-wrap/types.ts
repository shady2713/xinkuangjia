/**
 * 内容容器的 props 契约：标题、描述、页眉页脚与正文的类名，以及自适应高度开关。
 * autoContentHeight 开启时才使用 heightOffset 扣减正文高度；message 目前未被模板消费。
 */
export interface ContentWrapProps {
  title?: string;
  description?: string;
  message?: string;
  contentClass?: string;
  /**
   * 根据content可见高度自适应
   */
  autoContentHeight?: boolean;
  headerClass?: string;
  footerClass?: string;
  /**
   * Custom height offset value (in pixels) to adjust content area sizing
   * when used with autoContentHeight
   * @default 0
   */
  heightOffset?: number;
}
