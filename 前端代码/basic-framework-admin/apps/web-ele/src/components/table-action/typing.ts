/** 表格操作按钮的类型契约：按钮属性、权限编码、显示条件与二次确认配置。 */
import type { ButtonProps, ElTooltipProps } from 'element-plus';

/**
 * 按钮语义色型，取值与 Element Plus 的按钮 type 一致。
 * text 表示文字型按钮，table-action 会把这类按钮的间距收窄以贴近表格内容。
 */
export type ButtonType =
  | 'danger'
  | 'default'
  | 'info'
  | 'primary'
  | 'success'
  | 'text'
  | 'warning';

/**
 * 二次确认气泡的配置：确认前的提示标题、按钮文案，
 * 以及确认、取消两个回调；disabled 只屏蔽确认流程，不影响按钮本身。
 */
export interface PopConfirm {
  title: string;
  okText?: string;
  cancelText?: string;
  /**
   * 用户点击确认后执行的动作回调，由调用方提供实际的删除或提交逻辑；
   * 组件只负责弹出确认框并等待结果，不代替业务执行操作。
   */
  confirm: () => void;
  /** 点击取消时执行的动作回调，留空时关闭气泡即结束，不产生其他副作用。 */
  cancel?: () => void;
  icon?: string;
  disabled?: boolean;
}

/**
 * 单个操作按钮的业务配置：在 Element Plus 按钮属性之上追加展示与交互约定，
 * 其中 auth、ifShow 决定按钮是否出现，popConfirm 决定是否需要二次确认。
 */
export interface ActionItem extends Partial<ButtonProps> {
  /**
   * 点击按钮时触发的回调，由调用方注入实际业务动作；
   * 留空时按钮仍会渲染，但点击不会有任何反应。
   */
  onClick?: () => void;
  type?: ButtonType;
  label?: string;
  color?: 'error' | 'success' | 'warning';
  icon?: string;
  popConfirm?: PopConfirm;
  disabled?: boolean;
  divider?: boolean;
  // 权限编码控制是否显示
  auth?: string[];
  // 业务控制是否显示
  /**
   * 显隐控制。函数形式以按钮自身配置为唯一入参，判定为 false 时该按钮不渲染；
   * 布尔形式直接作为显隐结论，为 false 时该按钮不渲染。
   */
  ifShow?: ((action: ActionItem) => boolean) | boolean;
  /**
   * 提示文案。可直接给字符串；给对象时整体透传给 ElTooltip，
   * 其中 content 为必填提示文案，其余为 ElTooltip 支持的属性（如 placement、effect）。
   */
  tooltip?: (ElTooltipProps & { content: string }) | string;
}
