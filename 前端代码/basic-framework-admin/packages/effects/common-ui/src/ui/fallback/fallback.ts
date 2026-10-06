/**
 * 兜底页的属性契约：约定状态类型及标题、描述、配图与首页路径。
 *
 * 供 fallback.vue 声明入参，状态取值决定默认文案与图标。
 */
interface FallbackProps {
  /**
   * 描述
   */
  description?: string;
  /**
   *  @zh_CN 首页路由地址
   *  @default /
   */
  homePath?: string;
  /**
   * @zh_CN 默认显示的图片
   * @default pageNotFoundSvg
   */
  image?: string;
  /**
   *  @zh_CN 内置类型
   */
  status?: '403' | '404' | '500' | 'coming-soon' | 'offline';
  /**
   *  @zh_CN 页面提示语
   */
  title?: string;
}
export type { FallbackProps };
