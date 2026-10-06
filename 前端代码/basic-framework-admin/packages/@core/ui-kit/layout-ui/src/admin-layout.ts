/**
 * 后台布局的属性契约：声明侧边栏、顶栏、标签栏与内容区的宽度、固定与主题开关。
 * 由 admin-layout.vue 经 defineProps 接收，
 * 排布计算在 hooks/use-layout；这里只给类型，
 * 默认值由组件侧提供。
 */
import type {
  ContentCompactType,
  LayoutHeaderModeType,
  LayoutType,
  ThemeModeType,
} from '@vben-core/typings';

interface VbenLayoutProps {
  /**
   * 内容区域宽度模式。
   * @default 'wide'
   */
  contentCompact?: ContentCompactType;
  /**
   * 固定内容宽度。
   * @default 1200
   */
  contentCompactWidth?: number;
  /**
   * 内容区内边距。
   * @default 16
   */
  contentPadding?: number;
  /**
   * 内容区底部内边距。
   * @default 16
   */
  contentPaddingBottom?: number;
  /**
   * 内容区左侧内边距。
   * @default 16
   */
  contentPaddingLeft?: number;
  /**
   * 内容区右侧内边距。
   * @default 16
   */
  contentPaddingRight?: number;
  /**
   * 内容区顶部内边距。
   * @default 16
   */
  contentPaddingTop?: number;
  /**
   * 是否显示页脚。
   * @default false
   */
  footerEnable?: boolean;
  /**
   * 页脚是否固定。
   * @default true
   */
  footerFixed?: boolean;
  /**
   * 页脚高度。
   * @default 32
   */
  footerHeight?: number;

  /**
   * 顶栏高度。
   * @default 48
   */
  headerHeight?: number;
  /**
   * 是否隐藏顶栏。
   * @default false
   */
  headerHidden?: boolean;
  /**
   * 顶栏布局模式。
   * @default 'fixed'
   */
  headerMode?: LayoutHeaderModeType;
  /**
   * 顶栏主题。
   */
  headerTheme?: ThemeModeType;
  /**
   * 是否显示顶栏中的侧边栏切换按钮。
   * @default true
   */
  headerToggleSidebarButton?: boolean;
  /**
   * 顶栏是否可见。
   * @default true
   */
  headerVisible?: boolean;
  /**
   * 是否为移动端布局。
   * @default false
   */
  isMobile?: boolean;
  /**
   * 整体布局类型。
   * sidebar-nav：侧边栏导航
   * header-nav：顶部导航
   * mixed-nav：侧边栏 + 顶部混合导航
   * sidebar-mixed-nav：侧边栏混合导航
   * full-content：全屏内容布局
   * @default sidebar-nav
   */
  layout?: LayoutType;
  /**
   * 侧边栏是否折叠。
   * @default false
   */
  sidebarCollapse?: boolean;
  /**
   * 是否显示侧边栏折叠按钮。
   * @default true
   */
  sidebarCollapsedButton?: boolean;
  /**
   * 侧边栏折叠后是否显示标题。
   * @default true
   */
  sidebarCollapseShowTitle?: boolean;
  /**
   * 是否启用侧边栏。
   * @default true
   */
  sidebarEnable?: boolean;
  /**
   * 侧边栏折叠后的额外宽度。
   * @default 48
   */
  sidebarExtraCollapsedWidth?: number;
  /**
   * 侧边栏折叠按钮是否固定。
   * @default true
   */
  sidebarFixedButton?: boolean;
  /**
   * 是否隐藏侧边栏。
   * @default false
   */
  sidebarHidden?: boolean;
  /**
   * 混合侧边栏宽度。
   * @default 80
   */
  sidebarMixedWidth?: number;
  /**
   * 侧边栏主题。
   * @default dark
   */
  sidebarTheme?: ThemeModeType;
  /**
   * 侧边栏宽度。
   * @default 210
   */
  sidebarWidth?: number;
  /**
   * 侧边栏折叠宽度。
   * @default 48
   */
  sideCollapseWidth?: number;
  /**
   * 是否显示标签栏。
   * @default true
   */
  tabbarEnable?: boolean;
  /**
   * 标签栏高度。
   * @default 30
   */
  tabbarHeight?: number;
  /**
   * 布局层级。
   * @default 100
   */
  zIndex?: number;
}
export type { VbenLayoutProps };
