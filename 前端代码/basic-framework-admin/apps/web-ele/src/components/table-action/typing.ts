/** 表格操作按钮的类型契约：按钮属性、权限编码、显示条件与二次确认配置。 */
import type { ButtonProps, ElTooltipProps } from 'element-plus';

export type ButtonType =
  | 'danger'
  | 'default'
  | 'info'
  | 'primary'
  | 'success'
  | 'text'
  | 'warning';

export interface PopConfirm {
  title: string;
  okText?: string;
  cancelText?: string;
  confirm: () => void;
  cancel?: () => void;
  icon?: string;
  disabled?: boolean;
}

export interface ActionItem extends Partial<ButtonProps> {
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
  ifShow?: ((action: ActionItem) => boolean) | boolean;
  /**
   * 提示文案。可直接给字符串；给对象时整体透传给 ElTooltip，
   * 其中 content 为必填提示文案，其余为 ElTooltip 支持的属性（如 placement、effect）。
   */
  tooltip?: (ElTooltipProps & { content: string }) | string;
}
