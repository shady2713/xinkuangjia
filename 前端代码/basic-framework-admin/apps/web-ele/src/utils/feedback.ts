/**
 * 统一的前端提示文案工具：清洗后端错误文案并封装 Element Plus 消息。
 */
import type { MessageHandler } from 'element-plus';

import { ElMessage } from 'element-plus';

const REQUEST_PARAM_PREFIX_RE =
  /^\u8BF7\u6C42\u53C2\u6570\u4E0D\u6B63\u786E[:\uFF1A]\s*/;

/**
 * 把任意错误载荷转成可展示的文案。
 * @param value 错误载荷，可能是字符串、对象或空值。
 * @returns 去掉“请求参数不正确:”前缀后的文案；载荷为空时返回空串。
 */
function toMessage(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

/**
 * 去掉后端统一包装的“请求参数不正确:”前缀并去除首尾空格。
 * @param message 后端返回的原始提示文案
 * @returns 清洗后的文案；入参为空时返回空串
 */
export function normalizeErrorMessage(message?: null | string) {
  if (!message) {
    return '';
  }
  return message.trim().replace(REQUEST_PARAM_PREFIX_RE, '');
}

/**
 * 把任意值当作可按键读取的对象，用于按候选字段名逐个取错误文案。
 * 非对象值返回空对象，调用方读到的都是 undefined，会自然落到兜底文案。
 * @param value 待读取的值
 * @returns 可安全索引的记录视图
 */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * 依次从响应体与错误对象上取候选文案字段。
 * @param error 任意错误载荷
 * @returns 按 error/message/msg 顺序排列的候选值数组
 */
function collectErrorCandidates(error: unknown): unknown[] {
  const errorObject = asRecord(error);
  const responseData =
    asRecord(errorObject.response).data ??
    errorObject.data ??
    errorObject.error ??
    {};
  const response = asRecord(responseData);
  return [response.error, response.message, response.msg, errorObject.message];
}

/**
 * 从任意错误载荷中提取可展示的文案。
 * @param error 错误对象、字符串或网络层抛出的异常。
 * @param fallback 所有候选字段都取不到文案时返回的兜底文案。
 * @returns 去掉“请求参数不正确:”前缀后的文案；无法识别时返回 fallback。
 */
export function extractErrorMessage(error: unknown, fallback = '') {
  if (!error) {
    return fallback;
  }
  if (typeof error === 'string') {
    return normalizeErrorMessage(error) || fallback;
  }

  for (const candidate of collectErrorCandidates(error)) {
    const message = normalizeErrorMessage(toMessage(candidate));
    if (message) {
      return message;
    }
  }
  return fallback;
}

/**
 * 以错误样式弹出提示，文案取自入参或兜底值。
 * @param message 原始提示文案，可带“请求参数不正确:”前缀
 * @param fallback 文案清洗后为空时使用的兜底提示
 * @returns Element Plus 消息句柄，可用于手动关闭该提示
 */
export function showErrorMessage(
  message?: null | string,
  fallback = '\u64CD\u4F5C\u5931\u8D25',
) {
  return ElMessage.error(normalizeErrorMessage(message) || fallback);
}

/**
 * 从任意错误载荷中提取文案并以错误样式弹出。
 * @param error 错误对象、字符串或网络层抛出的异常
 * @param fallback 无法提取文案时使用的兜底提示
 * @returns Element Plus 消息句柄，可用于手动关闭该提示
 */
export function showError(
  error: unknown,
  fallback = '\u64CD\u4F5C\u5931\u8D25',
) {
  return showErrorMessage(extractErrorMessage(error, fallback), fallback);
}

/**
 * 以警告样式弹出提示。
 * @param message 直接展示的提示文案，不做前缀清洗
 * @returns Element Plus 消息句柄
 */
export function showWarningMessage(message: string): MessageHandler {
  return ElMessage.warning(message);
}

/**
 * 以成功样式弹出提示。
 * @param message 直接展示的提示文案
 * @returns Element Plus 消息句柄
 */
export function showSuccessMessage(message: string): MessageHandler {
  return ElMessage.success(message);
}

/**
 * 以成功样式弹出一条不自动淡出的加载中提示。
 * @param message 直接展示的提示文案
 * @returns Element Plus 消息句柄，需要在加载结束时手动关闭
 */
export function showLoadingMessage(message: string): MessageHandler {
  return ElMessage({
    message,
    plain: true,
    type: 'success',
  });
}
