/**
 * StateHandler 的条件等待测试。
 *
 * 覆盖等待者在条件成立时被释放、在条件被否定或 reset 时被拒绝，
 * 以及多等待者与跨生命周期等待者的隔离行为。
 */
import { describe, expect, it } from 'vitest';

import { StateHandler } from '../state-handler';

describe('stateHandler', /** 条件状态机的基础行为：成立后释放等待者，reset 后拒绝挂起者。 */ () => {
  it('should resolve when condition is set to true', /** 条件在等待期间成立时，等待者必须被释放。 */ async () => {
    const handler = new StateHandler();

    // 模拟异步设置 condition 为 true
    setTimeout(
      /** 模拟挂起后再由外部满足条件。 */
      () => {
        handler.setConditionTrue(); // 明确触发 condition 为 true
      },
      10,
    );

    // 等待条件被设置为 true
    await handler.waitForCondition();
    expect(handler.isConditionTrue()).toBe(true);
  });

  it('should resolve immediately if condition is already true', /** 条件已经成立时，等待请求应立即完成而不是挂起。 */ async () => {
    const handler = new StateHandler();
    handler.setConditionTrue(); // 提前设置为 true

    // 立即 resolve，因为 condition 已经是 true
    await handler.waitForCondition();
    expect(handler.isConditionTrue()).toBe(true);
  });

  it('should reject when condition is set to false after waiting', /** 等待期间条件被否定，等待者必须被拒绝而不是永久挂起。 */ async () => {
    const handler = new StateHandler();

    // 模拟异步设置 condition 为 false
    setTimeout(
      /** 模拟等待开始后再否定条件。 */
      () => {
        handler.setConditionFalse(); // 明确触发 condition 为 false
      },
      10,
    );

    // 等待过程中，期望 Promise 被 reject
    await expect(handler.waitForCondition()).rejects.toThrow();
    expect(handler.isConditionTrue()).toBe(false);
  });

  it('should reset condition to false', /** reset 把条件退回未成立状态。 */ () => {
    const handler = new StateHandler();
    handler.setConditionTrue(); // 设置为 true
    handler.reset(); // 重置为 false

    expect(handler.isConditionTrue()).toBe(false);
  });

  it('should resolve when condition is set to true after reset', /** reset 之后重新等待，仍然可以被下一次条件成立释放。 */ async () => {
    const handler = new StateHandler();
    handler.reset(); // 确保初始为 false

    setTimeout(
      /** 模拟 reset 之后再由外部满足条件。 */
      () => {
        handler.setConditionTrue(); // 重置后设置为 true
      },
      10,
    );

    await handler.waitForCondition();
    expect(handler.isConditionTrue()).toBe(true);
  });

  it('should release every waiter registered before the condition turns true', /** 多个等待者必须全部被释放，后注册者不能覆盖先注册者的句柄。 */ async () => {
    const handler = new StateHandler();
    const order: number[] = [];

    const waiters = [1, 2, 3].map(
      /**
       * 为一个序号注册等待者并返回其完成记录。
       * @param index 等待者的序号，用于核对完成顺序。
       * @returns 该等待者完成后兑现的 Promise。
       */
      (index) =>
        handler.waitForCondition().then(
          /** 等待成立后把序号记入完成顺序，用于核对没有等待者被漏掉。 */
          () => {
            order.push(index);
          },
        ),
    );

    handler.setConditionTrue();
    await Promise.all(waiters);

    expect(order).toHaveLength(3);
    expect(order.toSorted()).toEqual([1, 2, 3]);
  });

  it('should resolve only the waiters registered so far when the condition turns true', /** 条件成立后新注册的等待者应立即完成，不受后续生命周期影响。 */ async () => {
    const handler = new StateHandler();

    const first = handler.waitForCondition();
    handler.setConditionTrue();
    await expect(first).resolves.toBeUndefined();

    // 条件已成立后，新等待者应立即完成而不是挂起。
    await expect(handler.waitForCondition()).resolves.toBeUndefined();
  });

  it('should reject every pending waiter on reset', /** reset 必须拒绝全部挂起者，不允许留下永久挂起的 Promise。 */ async () => {
    const handler = new StateHandler();
    handler.setConditionTrue();

    const waiters = [handler.waitForCondition(), handler.waitForCondition()];
    // 条件已成立时不会挂起，先否定条件再注册真正的等待者。
    handler.setConditionFalse();

    const pending = [handler.waitForCondition(), handler.waitForCondition()];

    handler.reset();

    await expect(Promise.allSettled(pending)).resolves.toEqual([
      { reason: expect.any(Error), status: 'rejected' },
      { reason: expect.any(Error), status: 'rejected' },
    ]);
    // reset 之后条件为 false，且不会留下未处理的挂起等待。
    expect(handler.isConditionTrue()).toBe(false);
    await Promise.all(waiters);
  });

  it('should not let a waiter from a previous lifecycle resolve in the next one', /** 上一轮挂起的等待者不能被下一轮的条件成立释放。 */ async () => {
    const handler = new StateHandler();

    // 上一轮挂起的等待者：reset 会明确拒绝它。
    const stale = handler.waitForCondition();
    handler.reset();

    // 下一轮重新等待，并由新的一次条件成立释放。
    const fresh = handler.waitForCondition();
    handler.setConditionTrue();

    await expect(stale).rejects.toThrow('等待条件已失效');
    await expect(fresh).resolves.toBeUndefined();
  });

  it('should reject a waiter of the new lifecycle when that lifecycle is reset too', /** reset 之后注册的等待者属于新生命周期，不会被上一次 reset 顺带拒绝，只由下一次 reset 明确拒绝。 */ async () => {
    const handler = new StateHandler();
    handler.setConditionTrue();
    handler.reset();

    // 新生命周期开始后注册的等待者：上一次 reset 已经结束，不应影响它。
    const pending = handler.waitForCondition();
    // 结束新生命周期才应该拒绝它。
    handler.reset();

    await expect(pending).rejects.toThrow('等待条件已失效');
  });
});
