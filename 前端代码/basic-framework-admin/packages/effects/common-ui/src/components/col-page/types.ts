/**
 * 分栏页面的 props 契约：在 Page 属性之上追加左右两栏尺寸约束与折叠开关。
 * leftWidth/rightWidth 等取值是面板占比的百分数，默认左 30、右 70，
 * resizable/splitLine/splitHandle 依次控制拖拽条、分割线与拖拽手柄。
 */
import type { PageProps } from '../page/types';

export interface ColPageProps extends PageProps {
  /**
   * 左侧宽度
   * @default 30
   */
  leftWidth?: number;
  leftMinWidth?: number;
  leftMaxWidth?: number;
  leftCollapsedWidth?: number;
  leftCollapsible?: boolean;
  /**
   * 右侧宽度
   * @default 70
   */
  rightWidth?: number;
  rightMinWidth?: number;
  rightCollapsedWidth?: number;
  rightMaxWidth?: number;
  rightCollapsible?: boolean;

  resizable?: boolean;
  splitLine?: boolean;
  splitHandle?: boolean;
}
