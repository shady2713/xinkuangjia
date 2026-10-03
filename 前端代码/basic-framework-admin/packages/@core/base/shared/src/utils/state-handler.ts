/** 汇集同一条件的所有等待者；重置或否定条件会明确拒绝旧等待。 */
export class StateHandler {
  private condition = false;
  private waiters: Array<{
    /** 条件成立时释放此等待者。 */ reject: (reason: Error) => void;
    /** 条件失效时通知此等待者。 */ resolve: () => void;
  }> = [];

  /**
   * 返回当前条件是否成立。
   * @returns 条件已成立时为 true；仍在等待或已被否定时为 false。
   */
  isConditionTrue(): boolean {
    return this.condition;
  }

  /** 重置为未就绪状态，并取消属于上一个生命周期的全部等待者。 */
  reset() {
    this.setConditionFalse();
  }

  /** 否定条件并拒绝所有挂起等待，避免遗留永不结束的 Promise。 */
  setConditionFalse() {
    this.condition = false;
    const pending = this.waiters.splice(0);
    for (const waiter of pending) waiter.reject(new Error('等待条件已失效'));
  }

  /** 确认条件成立并释放所有等待者，完成后的句柄立即移除。 */
  setConditionTrue() {
    this.condition = true;
    const pending = this.waiters.splice(0);
    for (const waiter of pending) waiter.resolve();
  }

  /** 等待本轮条件成立。
   * @returns 条件已满足或随后被满足时完成的 Promise。
   * @throws {Error} 等待期间条件被否定或生命周期重置。
   */
  waitForCondition(): Promise<void> {
    if (this.condition) return Promise.resolve();
    return new Promise(
      /** 登记独立完成句柄，多个等待者互不覆盖。 */ (resolve, reject) => {
        this.waiters.push({ resolve, reject });
      },
    );
  }
}
