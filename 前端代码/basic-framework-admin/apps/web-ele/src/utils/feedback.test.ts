import { describe, expect, it } from 'vitest';
import { extractErrorMessage, normalizeErrorMessage } from './feedback';

/** 反馈文案工具的单测 */
function describeFeedbackUtils() {
  it('strips the bad request prefix', () => {
    expect(normalizeErrorMessage('请求参数不正确:手机号格式不正确')).toBe(
      '手机号格式不正确',
    );
  });

  it('prefers backend response messages', () => {
    expect(
      extractErrorMessage({
        response: {
          data: {
            msg: '请求参数不正确:邮箱格式不正确',
          },
        },
      }),
    ).toBe('邮箱格式不正确');
  });

  it('falls back to the error message field', () => {
    expect(extractErrorMessage(new Error('系统异常'), '操作失败')).toBe(
      '系统异常',
    );
  });
}

describe('feedback utils', describeFeedbackUtils);
