/**
 * 全局错误文案工具（utils/feedback）的取值优先级与消息输出契约回归。
 *
 * 该模块是请求层与页面共用的唯一错误提示出口：候选字段顺序、前缀剥离与兜底文案决定了
 * 用户看到的原因，消息通道选错（成功/警告/错误）会让失败看起来像成功。用例只替换
 * Element Plus 的消息 UI 边界，文案归一化、候选字段收集与兜底逻辑保持真实实现。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  extractErrorMessage,
  normalizeErrorMessage,
  showError,
  showErrorMessage,
  showLoadingMessage,
  showSuccessMessage,
  showWarningMessage,
} from './feedback';

const message = vi.hoisted(
  /** 建立可被逐例断言的消息替身，同时保留可调用的默认消息入口。 */ () => {
    const factory = vi.fn();
    return Object.assign(factory, {
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
    });
  },
);

vi.mock(
  'element-plus',
  /** 只替换消息 UI 边界；文案处理与兜底链路保持真实实现。 */ () => ({
    ElMessage: message,
  }),
);

describe('feedback utils', /** 覆盖后端错误前缀剥离与消息回退链路的取值优先级。 */ () => {
  beforeEach(
    /** 每例独立记录消息调用，避免相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('strips the bad request prefix', /** 后端统一前缀对用户没有信息量，展示前必须剥离。 */ () => {
    expect(normalizeErrorMessage('请求参数不正确:手机号格式不正确')).toBe(
      '手机号格式不正确',
    );
  });

  it('prefers backend response messages', /** 响应体 msg 比异常自身的信息更贴近业务原因。 */ () => {
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

  it('falls back to the error message field', /** 没有响应体时退回异常自身的 message。 */ () => {
    expect(extractErrorMessage(new Error('系统异常'), '操作失败')).toBe(
      '系统异常',
    );
  });

  it('把非字符串候选字段转成文案', /** 后端偶尔下发数字错误码，直接丢弃会只剩兜底文案。 */ () => {
    expect(extractErrorMessage({ data: { msg: 404 } }, '操作失败')).toBe('404');
    expect(extractErrorMessage({ message: 500 }, '操作失败')).toBe('500');
  });

  it('空载荷与非空载荷都收敛到约定文案', /** 空值必须回退，字符串载荷必须同样剥离前缀。 */ () => {
    expect(extractErrorMessage(null, '操作失败')).toBe('操作失败');
    expect(extractErrorMessage(undefined, '操作失败')).toBe('操作失败');
    expect(extractErrorMessage('', '操作失败')).toBe('操作失败');
    expect(extractErrorMessage('请求参数不正确:手机号格式不正确')).toBe(
      '手机号格式不正确',
    );
    expect(extractErrorMessage({}, '操作失败')).toBe('操作失败');
  });
});

describe('消息输出', /** 五个消息入口分别对应不同的用户反馈通道与兜底文案。 */ () => {
  beforeEach(
    /** 每例独立记录消息调用，避免相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('错误提示剥离前缀并在空文案时使用兜底', /** 空文案会让用户看不到任何失败原因。 */ () => {
    const handler = { close: vi.fn() };
    message.error.mockReturnValue(handler);

    expect(showErrorMessage('请求参数不正确:邮箱格式不正确')).toBe(handler);
    expect(message.error).toHaveBeenNthCalledWith(1, '邮箱格式不正确');

    showErrorMessage(undefined);
    expect(message.error).toHaveBeenNthCalledWith(2, '操作失败');

    showErrorMessage('   ', '自定义失败');
    expect(message.error).toHaveBeenNthCalledWith(3, '自定义失败');
  });

  it('从任意错误对象取文案后按错误通道输出', /** 错误对象与兜底文案都要经同一归一化入口，不能直接透传原始载荷。 */ () => {
    const handler = { close: vi.fn() };
    message.error.mockReturnValue(handler);

    expect(showError(new Error('系统异常'), '操作失败')).toBe(handler);
    expect(message.error).toHaveBeenNthCalledWith(1, '系统异常');

    showError({ response: { data: { msg: '请求参数不正确:邮箱格式不正确' } } });
    expect(message.error).toHaveBeenNthCalledWith(2, '邮箱格式不正确');

    showError({}, '自定义失败');
    expect(message.error).toHaveBeenNthCalledWith(3, '自定义失败');
  });

  it('警告与成功提示原样输出文案', /** 这两个入口不做前缀剥离，改动会让页面提示与传入文案不一致。 */ () => {
    const handler = { close: vi.fn() };
    message.warning.mockReturnValue(handler);
    message.success.mockReturnValue(handler);

    expect(showWarningMessage('请先选择数据')).toBe(handler);
    expect(message.warning).toHaveBeenCalledWith('请先选择数据');

    expect(showSuccessMessage('操作成功')).toBe(handler);
    expect(message.success).toHaveBeenCalledWith('操作成功');
  });

  it('加载提示使用朴素样式的成功消息', /** 加载中提示复用成功通道但必须带 plain 与 type，否则会渲染成带图标的成功提示。 */ () => {
    const handler = { close: vi.fn() };
    message.mockReturnValue(handler);

    expect(showLoadingMessage('正在导出')).toBe(handler);
    expect(message).toHaveBeenCalledWith({
      message: '正在导出',
      plain: true,
      type: 'success',
    });
  });
});
