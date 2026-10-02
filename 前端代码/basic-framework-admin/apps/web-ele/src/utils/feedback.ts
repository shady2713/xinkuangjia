import type { MessageHandler } from 'element-plus';

import { ElMessage } from 'element-plus';

const REQUEST_PARAM_PREFIX_RE =
  /^\u8BF7\u6C42\u53C2\u6570\u4E0D\u6B63\u786E[:\uFF1A]\s*/;

function toMessage(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value == null) {
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
