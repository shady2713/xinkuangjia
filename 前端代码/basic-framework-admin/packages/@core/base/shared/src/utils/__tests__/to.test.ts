/** Promise 转元组工具的测试：成功返回 [null, data]，失败返回 [error, undefined]。 */
import { describe, expect, it } from 'vitest';

import { to } from '../to';

describe('to', /** 把 Promise 的 reject 转成可解构的返回值，避免调用方到处 try/catch。 */ () => {
  it('兑现时返回 [null, 数据]', /** 第一项恒为 null，调用方用真值判断即可区分成败。 */ async () => {
    await expect(to(Promise.resolve('ok'))).resolves.toEqual([null, 'ok']);
  });

  it('拒绝时返回 [错误, undefined]', /** 错误对象原样透出，调用方自行决定提示文案。 */ async () => {
    const failure = new Error('接口失败');

    const [error, value] = await to(Promise.reject(failure));

    expect(error).toBe(failure);
    expect(value).toBeUndefined();
  });

  it('附加信息会合并进错误对象', /** errorExt 用于补充上下文；原始 Error 的 message/stack 是不可枚举属性，Object.assign 不会复制，因此这里只能断言附加字段。 */ async () => {
    const [error] = await to<never, Error & { code: number }>(
      Promise.reject(new Error('余额不足')),
      { code: 402 },
    );

    expect(error?.code).toBe(402);
  });
});
