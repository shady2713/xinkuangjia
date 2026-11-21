/** 基于状态条件的异步等待控制器，同一未就绪周期的并发等待共享同一 Promise。 */
/** 状态就绪回调签名。 */
type ResolveCondition = () => void;
/** 状态失败回调签名。 */
type RejectCondition = (reason?: unknown) => void;

/** 管理组件或表单挂载前的异步条件等待周期。 */
export class StateHandler {
  private condition: boolean = false;
  private pendingPromise: null | Promise<void> = null;
  private rejectCondition: null | RejectCondition = null;
  private resolveCondition: null | ResolveCondition = null;

  /**
   * 判断当前条件是否已经就绪。
   *
   * @returns 已就绪返回 true，否则返回 false
   */
  isConditionTrue(): boolean {
    return this.condition;
  }

  /**
   * 重置状态条件并清理当前周期的待决回调。
   */
  reset() {
    this.condition = false;
    this.clearPromises();
  }

  /**
   * 标记条件失败并唤醒拒绝当前周期所有挂起调用。
   */
  setConditionFalse() {
    this.condition = false;
    const reject = this.rejectCondition;
    this.clearPromises();
    reject?.(new Error('StateHandler condition rejected'));
  }

  /**
   * 标记条件就绪并唤醒当前周期所有等待中的并发调用。
   */
  setConditionTrue() {
    this.condition = true;
    const resolve = this.resolveCondition;
    this.clearPromises();
    resolve?.();
  }

  /**
   * 等待条件变为就绪；同一未就绪挂载周期内的多次调用共享同一 Promise。
   *
   * @returns 条件就绪后完成的 Promise
   */
  waitForCondition(): Promise<void> {
    if (this.condition) {
      return Promise.resolve();
    }
    if (!this.pendingPromise) {
      /**
       * 注册共享等待 Promise 的成功与失败回调引用。
       *
       * @param resolve 就绪唤醒回调
       * @param reject 失败拒绝回调
       */
      const registerWaiter = (
        resolve: ResolveCondition,
        reject: RejectCondition,
      ) => {
        this.resolveCondition = resolve;
        this.rejectCondition = reject;
      };
      this.pendingPromise = new Promise<void>(registerWaiter);
    }
    return this.pendingPromise;
  }

  /** 清理当前等待周期的共享 Promise 与回调引用。 */
  private clearPromises() {
    this.pendingPromise = null;
    this.resolveCondition = null;
    this.rejectCondition = null;
  }
}
