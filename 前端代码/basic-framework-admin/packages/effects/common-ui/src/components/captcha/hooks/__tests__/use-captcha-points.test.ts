/**
 * 验证码点位采集（useCaptchaPoints）的真实行为回归。
 *
 * 该组合式函数为验证码组件提供共享的响应式点位数组与增删入口。
 * 断言读取数组真实内容、引用稳定性与响应式通知，不使用内部镜像实现。
 */
import type { CaptchaPoint } from '../../types';

import { nextTick, watch } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import { useCaptchaPoints } from '../useCaptchaPoints';

/**
 * 构造一个采集点位。
 * @param x 点位横坐标。
 * @param y 点位纵坐标。
 * @param i 数据索引，用于区分同一时刻的多个点位。
 * @returns 完整的采集点位。
 */
function point(x: number, y: number, i: number): CaptchaPoint {
  return { i, t: 1_700_000_000_000 + i, x, y };
}

describe('useCaptchaPoints 点位采集', /** 点位数组的增删与响应式契约。 */ () => {
  it('初始为空的响应式点位数组', /** 每次调用返回独立数组，互不共享已采集的点位。 */ () => {
    const first = useCaptchaPoints();
    const second = useCaptchaPoints();

    expect(first.points).toEqual([]);
    expect(Array.isArray(first.points)).toBe(true);
    first.addPoint(point(1, 2, 0));

    // 两次调用互相隔离，一个实例的采集不能出现在另一个实例里。
    expect(first.points).toHaveLength(1);
    expect(second.points).toEqual([]);
  });

  it('addPoint 按调用顺序追加原始点位', /** 采集顺序就是用户点击顺序，坐标与索引不能被改写。 */ () => {
    const { addPoint, points } = useCaptchaPoints();

    addPoint(point(10, 20, 0));
    addPoint(point(30, 40, 1));

    expect(points).toEqual([
      { i: 0, t: 1_700_000_000_000, x: 10, y: 20 },
      { i: 1, t: 1_700_000_000_001, x: 30, y: 40 },
    ]);
  });

  it('clearPoints 清空全部点位并保留同一个响应式数组', /** 清空必须原地清空：替换数组会让已订阅的模板读到旧引用。 */ () => {
    const { addPoint, clearPoints, points } = useCaptchaPoints();
    const identity = points;
    addPoint(point(1, 1, 0));

    clearPoints();

    expect(points).toEqual([]);
    expect(points).toBe(identity);
  });

  it('点位变化会通知响应式订阅者', /** 采集与清空都要触发订阅回调，否则界面不会重绘。 */ () => {
    const { addPoint, clearPoints, points } = useCaptchaPoints();
    const observed = vi.fn();
    const stop = watch(
      /** 订阅点位数组的长度变化。 */ () => points.length,
      /** 记录每次长度变化后的新值。 */ (length) => {
        observed(length);
      },
      // 同步冲刷才能观察到同一批次内的多次变更；默认 pre 冲刷只会看到最终值。
      { flush: 'sync' },
    );

    try {
      addPoint(point(1, 1, 0));
      addPoint(point(2, 2, 1));
      clearPoints();
    } finally {
      stop();
    }

    expect(
      observed.mock.calls.map(/** 取出每次通知的长度值。 */ (call) => call[0]),
    ).toEqual([1, 2, 0]);
  });

  it('追加后的点位可在下一个更新周期被读到', /** 采集发生在事件回调里，模板要能在一次 tick 后读到新点位。 */ async () => {
    const { addPoint, points } = useCaptchaPoints();

    addPoint(point(5, 6, 0));
    await nextTick();

    expect(points.at(-1)).toEqual({
      i: 0,
      t: 1_700_000_000_000,
      x: 5,
      y: 6,
    });
  });
});
