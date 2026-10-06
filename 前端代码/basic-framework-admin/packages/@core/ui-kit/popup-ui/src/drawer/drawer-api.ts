/**
 * 抽屉状态机：Store 承载 isOpen、loading、
 * submitting 等状态，open、close、lock、unlock
 * 改状态并转发 onOpenChange、onBeforeClose 等回调。
 * close 会先询问 onBeforeClose，返回 false 时保持打开。
 * 不接触 DOM，界面由 drawer.vue 订阅同一 store 呈现。
 */
import type { DrawerApiOptions, DrawerState } from './drawer';

import { Store } from '@vben-core/shared/store';
import { bindMethods, isFunction } from '@vben-core/shared/utils';

/**
 * 抽屉的命令式入口：内部只维护一个 Store 作为唯一状态源，
 * 开合、锁定、共享数据与状态合并写入都落在这一个 Store 上，
 * 视图侧只需订阅同一份状态即可保持同步。
 * 写操作统一返回自身便于链式调用；生命周期回调由 use-drawer 传入的选项持有，
 * 本类不直接触碰 DOM，也不判断业务数据形状。
 */
export class DrawerApi {
  // 共享数据；payload 由 setData 写入，形状完全由调用方决定
  public sharedData: Record<'payload', unknown> = {
    payload: {},
  };
  public store: Store<DrawerState>;

  private api: Pick<
    DrawerApiOptions,
    | 'onBeforeClose'
    | 'onCancel'
    | 'onClosed'
    | 'onConfirm'
    | 'onOpenChange'
    | 'onOpened'
  >;

  // private prevState!: DrawerState;
  private state!: DrawerState;

  /**
   * 建立状态存储并登记回调：把调用方传入的选项与类内默认外观合并成初始状态，
   * connectedComponent 等只服务于外层的键在此剔除，不会进入 Store。
   * 之后每次状态写入都会与上一份快照比对，只有 isOpen 真正翻转才转发 onOpenChange。
   * @param options 初始状态与生命周期回调；省略时按类内默认外观初始化，isOpen 为 false。
   */
  constructor(options: DrawerApiOptions = {}) {
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

    const defaultState: DrawerState = {
      class: '',
      closable: true,
      closeIconPlacement: 'right',
      closeOnClickModal: true,
      closeOnPressEscape: true,
      confirmLoading: false,
      contentClass: '',
      footer: true,
      header: true,
      isOpen: false,
      loading: false,
      modal: true,
      openAutoFocus: false,
      placement: 'right',
      showCancelButton: true,
      showConfirmButton: true,
      submitting: false,
      title: '',
    };

    this.store = new Store<DrawerState>(
      {
        ...defaultState,
        ...storeState,
      },
      {
        /**
         * 状态写入后的钩子：只有 isOpen 相对上次快照发生翻转时才通知外部，
         * 标题、位置这类纯外观变化不会触发 onOpenChange，避免上层重复响应。
         */
        onUpdate: () => {
          const state = this.store.state;
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
   * 关闭抽屉
   * @description 关闭抽屉时会调用 onBeforeClose 钩子函数，如果 onBeforeClose 返回 false，则不关闭弹窗
   */
  async close() {
    // 通过 onBeforeClose 钩子函数来判断是否允许关闭弹窗
    // 如果 onBeforeClose 返回 false，则不关闭弹窗
    const allowClose = (await this.api.onBeforeClose?.()) ?? true;
    if (allowClose) {
      this.store.setState((prev) => ({
        ...prev,
        isOpen: false,
        submitting: false,
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
   * 锁定抽屉状态（用于提交过程中的等待状态）
   * @description 锁定状态将禁用默认的取消按钮，使用spinner覆盖抽屉内容，隐藏关闭按钮，阻止手动关闭弹窗，将默认的提交按钮标记为loading状态
   * @param isLocked 是否锁定
   * @returns 抽屉 API 自身，可接着写其它状态字段
   */
  lock(isLocked: boolean = true) {
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
   * 打开抽屉：只把 isOpen 置为 true，不询问 onBeforeClose 之类的确认。
   * 抽屉是否真的展示由视图订阅状态后决定，本方法不等待动画也不处理焦点。
   */
  open() {
    this.store.setState((prev) => ({ ...prev, isOpen: true }));
  }

  /**
   * 写入抽屉内容要消费的共享数据，形状完全由调用方决定，本类不校验也不转换。
   * @param payload 传给抽屉内容的业务数据，整体覆盖旧值而不是浅合并。
   * @returns 抽屉 API 自身，便于把写入数据与后续设置状态串成一次调用。
   */
  setData<T>(payload: T) {
    this.sharedData.payload = payload;
    return this;
  }

  /**
   * 写入抽屉状态：传对象时与当前状态浅合并，传函数时由调用方基于上一份状态计算。
   * 每次写入都会触发 Store 更新钩子，其中 isOpen 变化会额外转发 onOpenChange。
   * @param stateOrFn 要覆盖的状态片段，或接收上一份状态并返回覆盖字段的函数。
   * @returns 抽屉 API 自身，便于连续改写多个状态字段。
   */
  // 保持单行：prettier 会把括号内的 JSDoc 上提到括号外，使函数类型的中文说明脱离节点。
  // prettier-ignore
  setState(
    stateOrFn:
      | (/** 函数形式：由上一份状态算出要覆盖的字段。 */ (prev: DrawerState) => Partial<DrawerState>)
      | Partial<DrawerState>,
  ) {
    if (isFunction(stateOrFn)) {
      this.store.setState(stateOrFn);
    } else {
      this.store.setState((prev) => ({ ...prev, ...stateOrFn }));
    }
    return this;
  }

  /**
   * 解除抽屉的锁定状态
   * @description 解除由lock方法设置的锁定状态，是lock(false)的别名
   * @returns 抽屉 API 自身，等价于调用 lock(false) 的结果
   */
  unlock() {
    return this.lock(false);
  }
}
