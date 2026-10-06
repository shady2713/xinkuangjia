/**
 * Alert 的类型与上下文契约：AlertProps 与 PromptProps
 * 描述弹窗和输入框的选项，useAlertContext 供内容区
 * 的自定义元素触发确认或取消。只定义类型与注入；
 * 渲染与关闭拦截在 alert.vue，
 * 命令式实现在 AlertBuilder.ts。
 */
import type { Component, VNode, VNodeArrayChildren } from 'vue';

import type { Recordable } from '@vben-core/typings';

import { createContext } from '@vben-core/shadcn-ui';

/** 弹窗图标的内置类型名，取值对应按语义色区分的内置图标；传组件实例时不走这套映射。 */
export type IconType = 'error' | 'info' | 'question' | 'success' | 'warning';

/** 关闭前回调收到的上下文，只用 isConfirm 区分本次关闭是确认还是取消。 */
export type BeforeCloseScope = {
  isConfirm: boolean;
};

/**
 * 弹窗的完整选项契约：content 必填（字符串或组件），
 * 其余字段决定标题、图标、按钮文案与对齐、遮罩模糊、边框居中，
 * 以及返回 false 即可拦下关闭动作的 beforeClose。
 */
export type AlertProps = {
  /** 关闭前的回调，如果返回false，则终止关闭 */
  beforeClose?: (
    scope: BeforeCloseScope,
  ) => boolean | Promise<boolean | undefined> | undefined;
  /** 边框 */
  bordered?: boolean;
  /**
   * 按钮对齐方式
   * @default 'end'
   */
  buttonAlign?: 'center' | 'end' | 'start';
  /** 取消按钮的标题 */
  cancelText?: string;
  /** 是否居中显示 */
  centered?: boolean;
  /** 确认按钮的标题 */
  confirmText?: string;
  /** 弹窗容器的额外样式 */
  containerClass?: string;
  /** 弹窗提示内容 */
  content: Component | string;
  /** 弹窗内容的额外样式 */
  contentClass?: string;
  /** 执行beforeClose回调期间，在内容区域显示一个loading遮罩*/
  contentMasking?: boolean;
  /** 弹窗底部内容（与按钮在同一个容器中） */
  footer?: Component | string;
  /** 弹窗的图标（在标题的前面） */
  icon?: Component | IconType;
  /**
   * 弹窗遮罩模糊效果
   */
  overlayBlur?: number;
  /** 是否显示取消按钮 */
  showCancel?: boolean;
  /** 弹窗标题 */
  title?: string;
};

/** 渲染函数形态的插槽内容：调用后得到要挂到输入组件上的节点。 */
type PromptSlotsRenderer = () => unknown;

/**
 * 输入组件的插槽内容。可传渲染函数、插槽对象或已创建的 VNode；
 * 具体形态由输入组件决定，这里按不透明值透传。
 */
type PromptComponentSlots =
  | PromptSlotsRenderer
  | Recordable<unknown>
  | VNode
  | VNodeArrayChildren;

/**
 * Prompt 属性
 *
 * @typeParam T 输入值与返回值的类型；不指定时按 unknown 处理，由调用方在使用处收窄
 */
export type PromptProps<T = unknown> = {
  /** 关闭前的回调，如果返回false，则终止关闭 */
  beforeClose?: (scope: {
    isConfirm: boolean;
    value: T | undefined;
  }) => boolean | Promise<boolean | undefined> | undefined;
  /** 用于接受用户输入的组件 */
  component?: Component;
  /** 输入组件的属性 */
  componentProps?: Recordable<unknown>;
  /** 输入组件的插槽 */
  componentSlots?: PromptComponentSlots;
  /** 默认值 */
  defaultValue?: T;
  /** 输入组件的值属性名 */
  modelPropName?: string;
} & Omit<AlertProps, 'beforeClose'>;

/**
 * Alert上下文
 */
export type AlertContext = {
  /** 执行取消操作 */
  doCancel: () => void;
  /** 执行确认操作 */
  doConfirm: () => void;
};

/**
 * Alert 上下文的注入与提供函数对：alert.vue 在根上 provide，
 * 内容区里的自定义元素 inject 后即可触发确认或取消。
 */
export const [injectAlertContext, provideAlertContext] =
  createContext<AlertContext>('VbenAlertContext');

/**
 * 获取Alert上下文
 * @returns 注入的上下文对象，含 doConfirm 与 doCancel 两个动作；拿不到上下文时直接抛错，不会返回空值。
 * @throws 在 Alert 组件之外调用时抛出，提示必须位于提供上下文的子树内。
 */
export function useAlertContext() {
  const context = injectAlertContext();
  if (!context) {
    throw new Error('useAlertContext must be used within an AlertProvider');
  }
  return context;
}
