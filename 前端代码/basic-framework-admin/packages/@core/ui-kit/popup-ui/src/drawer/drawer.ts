/**
 * 抽屉的类型契约：DrawerProps 与 DrawerState 描述
 * 外观与状态字段，DrawerApiOptions 收拢生命周期
 * 回调，ExtendedDrawerApi 补上 useStore 选择器。
 * 不含运行时逻辑：状态流转在 drawer-api.ts，
 * 视图在 drawer.vue。
 */
import type { Component, Ref } from 'vue';

import type { ClassType, MaybePromise } from '@vben-core/typings';

import type { DrawerApi } from './drawer-api';

/** 抽屉贴靠容器的四条边，决定 Sheet 的展开方向；非移动端下左右方向固定 520px 宽，上下方向改为满宽并限高。 */
export type DrawerPlacement = 'bottom' | 'left' | 'right' | 'top';

/** 页头关闭按钮停靠在标题左侧还是右侧，为 left 时标题区左侧留出按钮与竖分隔线的位置。 */
export type CloseIconPlacement = 'left' | 'right';

/**
 * 抽屉的对外属性契约：描述标题、页头页脚、按钮、遮罩与贴靠方向等可配置项。
 * 这些字段既可作为 props 直接传给抽屉组件，也可由 DrawerApi 写进状态后覆盖；
 * 组件侧通过 usePriorityValues 让状态值优先于同名 props。
 */
export interface DrawerProps {
  /**
   * 是否挂载到内容区域
   * @default false
   */
  appendToMain?: boolean;
  /**
   * 取消按钮文字
   */
  cancelText?: string;
  class?: ClassType;
  /**
   * 是否显示关闭按钮
   * @default true
   */
  closable?: boolean;
  /**
   * 关闭按钮的位置
   */
  closeIconPlacement?: CloseIconPlacement;
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
   * 在关闭时销毁抽屉
   */
  destroyOnClose?: boolean;
  /**
   * 是否显示底部
   * @default true
   */
  footer?: boolean;
  /**
   * 弹窗底部样式
   */
  footerClass?: ClassType;
  /**
   * 是否显示顶栏
   * @default true
   */
  header?: boolean;
  /**
   * 弹窗头部样式
   */
  headerClass?: ClassType;
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
   * 抽屉位置
   * @default right
   */
  placement?: DrawerPlacement;

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
   * 提交中（锁定抽屉状态）
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
   * 抽屉层级
   */
  zIndex?: number;
}

/**
 * 抽屉状态：在 DrawerProps 的可配置项之上补两个运行时字段。
 * isOpen 由 DrawerApi 的开合方法维护；sharedData 是给使用方预留的挂载位，
 * DrawerApi 实际把 setData 的数据放在自身的 sharedData.payload 上，并不写这个状态字段。
 * 其余字段与 DrawerProps 同名同义，状态值优先于同名 props。
 */
export interface DrawerState extends DrawerProps {
  /** 弹窗打开状态 */
  isOpen?: boolean;
  /**
   * 共享数据
   */
  sharedData?: Record<string, unknown>;
}

/**
 * 在 DrawerApi 上补出的状态订阅入口，供抽屉视图按需订阅状态或其中某个字段。
 * useStore 由 useVbenDrawer 在创建 API 后挂载，因此类型上通过交叉声明补齐。
 */
export type ExtendedDrawerApi = {
  /**
   * 订阅抽屉状态；不传选择器时返回整个状态，只读且随状态写入自动更新。
   */
  useStore: <T = NoInfer<DrawerState>>(
    selector?: /** 状态选择器，缺省取整份 */ (state: NoInfer<DrawerState>) => T,
  ) => Readonly<Ref<T>>;
} & DrawerApi;

/**
 * 创建抽屉 API 时可传入的选项：继承全部状态字段，并追加生命周期回调。
 * 回调由 DrawerApi 在对应时机转发，onBeforeClose 是唯一能阻止关闭的钩子。
 */
export interface DrawerApiOptions extends DrawerState {
  /**
   * 独立的抽屉组件
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
