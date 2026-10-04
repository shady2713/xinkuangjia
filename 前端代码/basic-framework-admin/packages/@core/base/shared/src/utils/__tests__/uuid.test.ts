/** 随机标识生成工具的测试：验证 UUID 位数、字符集与短标识的单调自增后缀。 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildShortUUID, buildUUID } from '../uuid';

afterEach(
  /** 恢复真实随机源与时钟，避免固定值影响其它用例。 */ () => {
    vi.restoreAllMocks();
  },
);

/** 从固定随机位与固定时间戳的短标识里取出中间的自增计数。
 * @param id 由 buildShortUUID 生成、且随机位与时间戳已被固定为 0 和 1 的标识。
 * @returns 标识中的自增计数。
 */
function uniqueOf(id: string): number {
  return Number.parseInt(id.replace(/^k_0/u, '').replace(/1$/u, ''), 10);
}

describe('buildUUID', /** 生成 32 位十六进制标识，占位符字符与随机位都必须落在十六进制字符集内。 */ () => {
  it('输出 32 位十六进制字符串', /** 标准 UUID 去横线后固定 32 位，可直接作为主键或令牌。 */ () => {
    expect(buildUUID()).toMatch(/^[\da-f]{32}$/u);
  });

  it('随机位覆盖十六进制全部取值', /** 固定随机源后应逐位产出 0-f，确认随机位没有被写死成单一字符。 */ () => {
    /** 依次返回 0、1/16、…、15/16，让十六个取值都被命中。 */
    const samples = Array.from(
      { length: 16 },
      /** 按下标生成 0/16…15/16 的固定随机序列。 */ (_, index) => index / 16,
    );
    let cursor = 0;
    vi.spyOn(Math, 'random').mockImplementation(
      /** 按游标循环给出固定随机序列。 */ () => {
        const value = samples[cursor % samples.length] ?? 0;
        cursor += 1;
        return value;
      },
    );

    const characters = new Set(buildUUID());

    expect(characters.size).toBeGreaterThan(12);
    expect(
      [...characters].every(
        /** 逐个字符确认落在十六进制字符集内。 */ (char) =>
          /[\da-f]/u.test(char),
      ),
    ).toBe(true);
  });

  it('第 15 位固定为版本号 4', /** UUID v4 的版本位是协议要求，不能参与随机。 */ () => {
    /** 让随机源恒定，便于断言固定位。 */
    vi.spyOn(Math, 'random').mockReturnValue(0);

    expect(buildUUID()[12]).toBe('4');
  });

  it('多次生成互不相同', /** 同一毫秒内连续调用也必须得到不同标识。 */ () => {
    expect(buildUUID()).not.toBe(buildUUID());
  });
});

describe('buildShortUUID', /** 短标识用于日志与文件名等不需要完整 UUID 的场景。 */ () => {
  it('带前缀时以分隔符连接', /** 前缀便于按来源检索短标识。 */ () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    expect(buildShortUUID('order')).toMatch(
      /^order_500000000\d+1700000000000$/u,
    );
  });

  it('不带前缀时直接以分隔符开头', /** 不传前缀不能留下 undefined 文本。 */ () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(Date, 'now').mockReturnValue(1);

    expect(buildShortUUID()).toMatch(/^_0\d+1$/u);
  });

  it('连续调用后缀自增', /** 自增计数保证同一毫秒内多次调用不会撞号。 */ () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(Date, 'now').mockReturnValue(1);

    const first = buildShortUUID('k');
    const second = buildShortUUID('k');

    expect(first).not.toBe(second);
    expect(
      /** 随机位固定为 0、时间戳固定为 1，中间剩下的数字就是自增计数。 */ uniqueOf(
        second,
      ),
    ).toBe(uniqueOf(first) + 1);
  });
});
