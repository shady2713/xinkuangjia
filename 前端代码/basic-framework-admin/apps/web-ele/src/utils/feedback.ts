import type { MessageHandler } from 'element-plus';

import { ElMessage } from 'element-plus';

const REQUEST_PARAM_PREFIX_RE =
  /^\u8BF7\u6C42\u53C2\u6570\u4E0D\u6B63\u786E[:\uFF1A]\s*/;

const ERROR_MESSAGE_HANDLED_KEY = '__errorMessageHandled';

/**
 * 判断未知异常对象是否已被请求拦截器或外层错误处理展示过提示，避免上传等上层回调重复弹窗。
 *
 * @param error 捕获到的异常对象或响应错误载体
 * @returns 已被消费提示返回 true，否则返回 false
 */
export function isErrorMessageHandled(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (error as Record<string, unknown>)[ERROR_MESSAGE_HANDLED_KEY],
  );
}

/**
 * 把未知错误值转成可展示的字符串。
 * @param value 原始错误信息
 * @returns 字符串原文；空值时返回空字符串
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

export function normalizeErrorMessage(message?: null | string) {
  if (!message) {
    return '';
  }
  return message.trim().replace(REQUEST_PARAM_PREFIX_RE, '');
}

/**
 * 从未知异常对象或响应载体中提取可读错误文案并去除参数前缀。
 *
 * @param error 捕获到的异常对象、响应体或错误字符串
 * @param fallback 未提取到有效文案时的默认兜底提示
 * @returns 规范化后的错误展示文案
 */
export function extractErrorMessage(error: unknown, fallback = '') {
  if (!error) {
    return fallback;
  }
  if (typeof error === 'string') {
    return normalizeErrorMessage(error) || fallback;
  }

  const errorObject = error as Record<string, any>;
  const responseData =
    errorObject.response?.data ?? errorObject.data ?? errorObject.error ?? {};
  const candidates = [
    responseData.error,
    responseData.message,
    responseData.msg,
    errorObject.msg,
    errorObject.message,
  ];
  for (const candidate of candidates) {
    const message = normalizeErrorMessage(toMessage(candidate));
    if (message) {
      return message;
    }
  }
  return fallback;
}

export function showErrorMessage(
  message?: null | string,
  fallback = '\u64CD\u4F5C\u5931\u8D25',
) {
  return ElMessage.error(normalizeErrorMessage(message) || fallback);
}

export function showError(
  error: unknown,
  fallback = '\u64CD\u4F5C\u5931\u8D25',
) {
  return showErrorMessage(extractErrorMessage(error, fallback), fallback);
}

export function showWarningMessage(message: string): MessageHandler {
  return ElMessage.warning(message);
}

export function showSuccessMessage(message: string): MessageHandler {
  return ElMessage.success(message);
}

export function showLoadingMessage(message: string): MessageHandler {
  return ElMessage({
    message,
    plain: true,
    type: 'success',
  });
}
