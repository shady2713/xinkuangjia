/**
 * 通用页面容器的属性契约：标题、描述、页头页脚类名与内容区高度自适应开关。
 * 只声明对外可配置项，高度测量与滚动布局由同目录 page.vue 实现。
 */
export interface PageProps {
  title?: string;
  description?: string;
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
