/**
 * 终端加载指示器（node-utils 的 spinner.ts）编排行为回归。
 *
 * `spinner` 是构建脚本包裹长耗时任务的公共入口：成功时返回回调结果并标记成功文案，
 * 失败时标记失败文案并把原始异常继续抛出，两种情况都必须停止指示器。
 * 终端动画只在真实 TTY 上有意义，因此这里把 `ora` 替换为可断言的受控替身，
 * 被测的编排、返回值与异常传播逻辑保持真实实现。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { spinner } from '../spinner';

/** 记录替身指示器的调用，用于核对外部可观察的编排结果。 */
const spinnerStub = vi.hoisted(
  /** 建立带全部编排方法的替身容器。 */ () => ({
    fail: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    succeed: vi.fn(),
  }),
);

vi.mock(
  'ora',
  /** 终端动画属于外部边界，替换为同一替身实例以便断言开始、标记与停止。 */ () => ({
    /** 返回替身实例，其 start 继续返回自身以贴合真实链式调用。 */
    default: () => {
      spinnerStub.start.mockReturnValue(spinnerStub);
      return spinnerStub;
    },
  }),
);

describe('spinner 任务编排', /** 包裹逻辑决定构建脚本的返回结果、失败传播与指示器状态。 */ () => {
  beforeEach(
    /** 每例清除替身调用记录，避免上例调用混淆断言。 */ () => {
      vi.clearAllMocks();
    },
  );

  it('成功时返回回调结果并使用自定义成功文案', /** 返回值必须透传，否则调用方拿不到构建产物信息。 */ async () => {
    const result = await spinner(
      { successText: '构建完成', title: '构建' },
      /** 模拟成功完成并返回构建结果。 */ async () => 42,
    );

    expect(result).toBe(42);
    expect(spinnerStub.start).toHaveBeenCalledTimes(1);
    expect(spinnerStub.succeed).toHaveBeenCalledWith('构建完成');
    expect(spinnerStub.fail).not.toHaveBeenCalled();
    expect(spinnerStub.stop).toHaveBeenCalledTimes(1);
  });

  it('未提供成功文案时使用默认成功提示', /** 缺少文案不能导致 succeed 收到空值。 */ async () => {
    await spinner(
      { title: '构建' },
      /** 模拟无返回值的成功回调。 */ async () => undefined,
    );

    expect(spinnerStub.succeed).toHaveBeenCalledWith('Success!');
    expect(spinnerStub.stop).toHaveBeenCalledTimes(1);
  });

  it('回调失败时使用自定义失败文案并原样抛出异常', /** 包裹逻辑不能吞掉原始异常或替换错误类型。 */ async () => {
    const failure = new Error('构建失败');

    await expect(
      spinner(
        { failedText: '构建中断', title: '构建' },
        /** 模拟构建过程中的真实失败。 */ async () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
    expect(spinnerStub.fail).toHaveBeenCalledWith('构建中断');
    expect(spinnerStub.succeed).not.toHaveBeenCalled();
    expect(spinnerStub.stop).toHaveBeenCalledTimes(1);
  });

  it('未提供失败文案时使用默认失败提示', /** 失败路径同样必须有稳定文案。 */ async () => {
    await expect(
      spinner(
        { title: '构建' },
        /** 模拟无自定义文案的失败回调。 */ async () => {
          throw new Error('失败');
        },
      ),
    ).rejects.toThrow('失败');

    expect(spinnerStub.fail).toHaveBeenCalledWith('Failed!');
    expect(spinnerStub.stop).toHaveBeenCalledTimes(1);
  });

  it('同步抛出同样走失败与停止分支', /** 回调可能在返回 Promise 之前就失败。 */ async () => {
    const failure = new Error('同步失败');

    await expect(
      spinner(
        { title: '构建' },
        /** 模拟同步抛出的回调。 */ () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
    expect(spinnerStub.fail).toHaveBeenCalledWith('Failed!');
    expect(spinnerStub.stop).toHaveBeenCalledTimes(1);
  });
});
