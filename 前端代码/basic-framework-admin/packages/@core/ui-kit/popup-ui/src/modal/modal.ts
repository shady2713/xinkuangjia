/**
 * 弹窗的类型契约：ModalProps 与 ModalState 描述
 * 外观与状态字段，ModalApiOptions 收拢生命周期回调，
 * ExtendedModalApi 补上 useStore 选择器。
 * 不含运行时逻辑：状态流转在 modal-api.ts，
 * 视图在 modal.vue。
 */
import type { Component, Ref } from 'vue';

import type { MaybePromise } from '@vben-core/typings';

import type { ModalApi } from './modal-api';

/**
 * 弹窗组件的静态选项契约：动画、遮罩、页眉页脚、按钮文案与层级都在这里。
 * 字段全部可选，缺省值由 api 建初始 store 时兜底，视图侧再用优先级合并覆盖。
 */
export interface ModalProps {
  /**
   * 动画类型
   * @default 'slide'
   */
  animationType?: 'scale' | 'slide';
  /**
   * 是否要挂载到内容区域
   * @default false
   */
  appendToMain?: boolean;
  /**
   * 是否显示边框
   * @default false
   */
  bordered?: boolean;
  /**
   * 取消按钮文字
   */
  cancelText?: string;
  /**
   * 是否居中
   * @default false
   */
  centered?: boolean;

  class?: string;

  /**
   * 是否显示右上角的关闭按钮
   * @default true
   */
  closable?: boolean;
  /**
   * 点击弹窗遮罩是否关闭弹窗
   * @default true
   */
  closeOnClickModal?: boolean;
  /**
   * 按下 ESC 键是否关闭弹窗
   * @default true
   */
  closeOnPressEscape?: boolean;
  /**
   * 禁用确认按钮
   */
  confirmDisabled?: boolean;
  /**
   * 确定按钮 loading
   * @default false
   */
  confirmLoading?: boolean;
  /**
   * 确定按钮文字
   */
  confirmText?: string;
  contentClass?: string;
  /**
   * 弹窗描述
   */
  description?: string;
  /**
   * 在关闭时销毁弹窗
   */
  destroyOnClose?: boolean;
  /**
   * 是否可拖拽
   * @default false
   */
  draggable?: boolean;
  /**
   * 是否显示底部
   * @default true
   */
  footer?: boolean;
  footerClass?: string;
  /**
   * 是否全屏
   * @default false
   */
  fullscreen?: boolean;
  /**
   * 是否显示全屏按钮
   * @default true
   */
  fullscreenButton?: boolean;
  /**
   * 是否显示顶栏
   * @default true
   */
  header?: boolean;
  headerClass?: string;
  /**
   * 弹窗是否显示
   * @default false
   */
  loading?: boolean;
  /**
   * 是否显示遮罩
   * @default true
   */
  modal?: boolean;
  /**
   * 是否自动聚焦
   */
  openAutoFocus?: boolean;
  /**
   * 弹窗遮罩模糊效果
   */
  overlayBlur?: number;
  /**
   * 是否显示取消按钮
   * @default true
   */
  showCancelButton?: boolean;
  /**
   * 是否显示确认按钮
   * @default true
   */
  showConfirmButton?: boolean;
  /**
   * 提交中（锁定弹窗状态）
   */
  submitting?: boolean;
  /**
   * 弹窗标题
   */
  title?: string;
  /**
   * 弹窗标题提示
   */
  titleTooltip?: string;
  /**
   * 弹窗层级
   */
  zIndex?: number;
}

/**
 * store 里真正持有的状态：在弹窗选项之上补上 isOpen 这个开关字段，
 * sharedData 则是类型上预留的共享数据位，api 实际把业务负载放在 sharedData.payload。
 */
export interface ModalState extends ModalProps {
  /** 弹窗打开状态 */
  isOpen?: boolean;
  /**
   * 共享数据
   */
  sharedData?: Record<string, unknown>;
}

/**
 * 在 ModalApi 之上补出订阅入口的交叉类型，由 useVbenModal 挂到实例上。
 * 有了它，视图侧能只订阅需要的几个字段，而不必把整个 api 传进组件。
 */
export type ExtendedModalApi = {
  /**
   * 订阅 store 的一段状态，返回只读 ref；不传选择器时拿到整份状态。
   */
  useStore: <T = NoInfer<ModalState>>(
    selector?: /** 状态选择器，省略取整份 */ (state: NoInfer<ModalState>) => T,
  ) => Readonly<Ref<T>>;
} & ModalApi;

/**
 * 创建 api 用的选项：在状态字段之上收拢六个生命周期回调。
 * 回调不参与状态合并，ModalApi 会把它们从选项里拆出来单独留存再转发。
 */
export interface ModalApiOptions extends ModalState {
  /**
   * 独立的弹窗组件
   */
  connectedComponent?: Component;
  /**
   * 关闭前的回调，返回 false 可以阻止关闭
   * @returns
   */
  onBeforeClose?: () => MaybePromise<boolean | undefined>;
  /**
   * 点击取消按钮的回调
   */
  onCancel?: () => void;
  /**
   * 弹窗关闭动画结束的回调
   * @returns
   */
  onClosed?: () => void;
  /**
   * 点击确定按钮的回调
   */
  onConfirm?: () => void;
  /**
   * 弹窗状态变化回调
   * @param isOpen
   * @returns
   */
  onOpenChange?: (isOpen: boolean) => void;
  /**
   * 弹窗打开动画结束的回调
   * @returns
   */
  onOpened?: () => void;
}
