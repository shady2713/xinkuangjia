/**
 * 弹窗状态机：Store 承载 isOpen、fullscreen、
 * submitting 等状态，open、close、lock、unlock
 * 改状态并转发 onOpenChange、onBeforeClose 等回调。
 * 不接触 DOM，全屏与拖拽等交互由 modal.vue 实现。
 */
import type { ModalApiOptions, ModalState } from './modal';

import { Store } from '@vben-core/shared/store';
import { bindMethods, isFunction } from '@vben-core/shared/utils';

/**
 * 弹窗的命令式 API：所有开关与外观字段都放在 store 上，
 * open、close、lock 等方法只改状态并按需转发生命周期回调。
 * 它不接触 DOM，视图由 modal.vue 订阅同一个 store 渲染。
 */
export class ModalApi {
  // 共享数据；payload 由 setData 写入，形状完全由调用方决定
  public sharedData: Record<'payload', unknown> = {
    payload: {},
  };
  public store: Store<ModalState>;

  private api: Pick<
    ModalApiOptions,
    | 'onBeforeClose'
    | 'onCancel'
    | 'onClosed'
    | 'onConfirm'
    | 'onOpenChange'
    | 'onOpened'
  >;

  // private prevState!: ModalState;
  private state!: ModalState;

  /**
   * 用选项搭出初始 store：生命周期回调从状态字段里拆出来单独留存，
   * 其余字段与默认状态合并；connectedComponent 在这里取出后丢弃，由 use-modal 负责连接内外层。
   * @param options 弹窗初始状态与回调，省略时全部取默认状态，初始为关闭。
   */
  constructor(options: ModalApiOptions = {}) {
    const {
      connectedComponent: _,
      onBeforeClose,
      onCancel,
      onClosed,
      onConfirm,
      onOpenChange,
      onOpened,
      ...storeState
    } = options;

    const defaultState: ModalState = {
      bordered: true,
      centered: false,
      class: '',
      closeOnClickModal: true,
      closeOnPressEscape: true,
      confirmDisabled: false,
      confirmLoading: false,
      contentClass: '',
      destroyOnClose: true,
      draggable: false,
      footer: true,
      footerClass: '',
      fullscreen: false,
      fullscreenButton: true,
      header: true,
      headerClass: '',
      isOpen: false,
      loading: false,
      modal: true,
      openAutoFocus: false,
      showCancelButton: true,
      showConfirmButton: true,
      title: '',
      animationType: 'slide',
    };

    this.store = new Store<ModalState>(
      {
        ...defaultState,
        ...storeState,
      },
      {
        /**
         * store 的写入回调：只在 isOpen 真正翻转时转发 onOpenChange，
         * 标题、loading 等其它字段的变化不会打扰调用方。
         */
        onUpdate: () => {
          const state = this.store.state;

          // 每次更新状态时，都会调用 onOpenChange 回调函数
          if (state?.isOpen === this.state?.isOpen) {
            this.state = state;
          } else {
            this.state = state;
            this.api.onOpenChange?.(!!state?.isOpen);
          }
        },
      },
    );

    this.state = this.store.state;

    this.api = {
      onBeforeClose,
      onCancel,
      onClosed,
      onConfirm,
      onOpenChange,
      onOpened,
    };
    bindMethods(this);
  }

  /**
   * 关闭弹窗
   * @description 关闭弹窗时会调用 onBeforeClose 钩子函数，如果 onBeforeClose 返回 false，则不关闭弹窗
   */
  async close() {
    // 通过 onBeforeClose 钩子函数来判断是否允许关闭弹窗
    // 如果 onBeforeClose 返回 false，则不关闭弹窗
    const allowClose = (await this.api.onBeforeClose?.()) ?? true;
    if (allowClose) {
      this.store.setState((prev) => ({
        ...prev,
        isOpen: false,
      }));
    }
  }

  /**
   * 读取 setData 写入的共享数据。
   *
   * @returns 调用方写入的原始负载；未写入过数据时返回空对象而不是 undefined，
   *   因此调用方无需判空即可安全展开
   */
  getData<T extends object = Record<string, unknown>>() {
    return (this.sharedData?.payload ?? {}) as T;
  }

  /**
   * 锁定弹窗状态（用于提交过程中的等待状态）
   * @description 锁定状态将禁用默认的取消按钮，使用spinner覆盖弹窗内容，隐藏关闭按钮，阻止手动关闭弹窗，将默认的提交按钮标记为loading状态
   * @param isLocked 是否锁定
   * @returns api 自身，便于接着链式设置其它状态。
   */
  lock(isLocked = true) {
    return this.setState({ submitting: isLocked });
  }

  /**
   * 取消操作
   */
  onCancel() {
    if (this.api.onCancel) {
      this.api.onCancel?.();
    } else {
      this.close();
    }
  }

  /**
   * 弹窗关闭动画播放完毕后的回调
   */
  onClosed() {
    if (!this.state.isOpen) {
      this.api.onClosed?.();
    }
  }

  /**
   * 确认操作
   */
  onConfirm() {
    this.api.onConfirm?.();
  }

  /**
   * 弹窗打开动画播放完毕后的回调
   */
  onOpened() {
    if (this.state.isOpen) {
      this.api.onOpened?.();
    }
  }

  /**
   * 打开弹窗并顺带解除上一次的提交锁，避免重开时仍停留在 submitting。
   * 开关状态的翻转会由 store 的 onUpdate 转发 onOpenChange(true)。
   */
  open() {
    this.store.setState((prev) => ({
      ...prev,
      isOpen: true,
      submitting: false,
    }));
  }

  /**
   * 写入与状态分离的共享负载，弹窗内容用 getData 取回同一份引用。
   * @param payload 任意形状的负载，不做校验也不深拷贝，按引用保存。
   * @returns api 自身，便于链式写入其它状态。
   */
  setData<T>(payload: T) {
    this.sharedData.payload = payload;
    return this;
  }

  /**
   * 合并式更新弹窗状态：传对象时与当前状态浅合并，
   * 传函数时由 store 用上一份状态算出下一份，避免读到过期状态。
   * @param stateOrFn 要覆盖的状态片段，或基于上一份状态返回新片段的函数。
   * @returns api 自身，open、lock 等方法依赖这个返回值继续链式调用。
   */
  // 保持单行：prettier 会把括号内的 JSDoc 上提到括号外，使函数类型的中文说明脱离节点。
  // prettier-ignore
  setState(
    stateOrFn:
      | (/** 函数形态：拿到上一份状态，返回要覆盖的新片段。 */ (prev: ModalState) => Partial<ModalState>)
      | Partial<ModalState>,
  ) {
    if (isFunction(stateOrFn)) {
      this.store.setState(stateOrFn);
    } else {
      this.store.setState((prev) => ({ ...prev, ...stateOrFn }));
    }
    return this;
  }

  /**
   * 解除弹窗的锁定状态
   * @description 解除由lock方法设置的锁定状态，是lock(false)的别名
   * @returns api 自身，与 lock 的链式用法保持一致。
   */
  unlock() {
    return this.lock(false);
  }
}
