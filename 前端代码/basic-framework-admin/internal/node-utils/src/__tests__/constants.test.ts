/** 校验终端状态符号常量的真实码点与导出集合，避免构建脚本打印出错误标记。 */
import { describe, expect, it } from 'vitest';

import { UNICODE } from '../constants';

describe('unicode 终端符号常量', /** 常量被 CLI 与构建脚本直接拼进日志，码点变化会让成功/失败提示失去区分度。 */ () => {
  it('成功与失败符号分别使用对勾和叉号码点', /** 断言真实字符而不是长度，防止占位符或转义写错时静默通过。 */ () => {
    expect(UNICODE.SUCCESS).toBe('\u2714');
    expect(UNICODE.FAILURE).toBe('\u2716');
    expect(UNICODE.SUCCESS).not.toBe(UNICODE.FAILURE);
  });

  it('枚举只导出这两个已使用的符号', /** 新增未使用符号会扩大对外契约，这里锁定当前成员集合。 */ () => {
    expect(Object.keys(UNICODE)).toEqual(['FAILURE', 'SUCCESS']);
    expect(Object.values(UNICODE)).toEqual(['\u2716', '\u2714']);
  });
});
