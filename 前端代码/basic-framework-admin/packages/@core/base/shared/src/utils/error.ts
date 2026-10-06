/**
 * 错误信息提取与日志出口：把任意抛出值收敛成可展示文案与可检索元数据。
 * 供请求层与业务 catch 分支统一取 message，并按作用域输出到控制台；
 * 不做上报与弹窗，取不到信息时返回调用方给出的兜底文案。
 */
type ErrorLike = {
  code?: number | string;
  message?: string;
  name?: string;
  response?: {
    data?: unknown;
    status?: number;
  };
  status?: number;
};

/**
 * 把未知抛出值收窄成可安全读取字段的错误对象。
 * @param error - 任意抛出值。
 * @returns 原对象引用；null、undefined 与字符串等非对象一律返回空对象，避免读取字段时报错。
 */
function toErrorLike(error: unknown): ErrorLike {
  if (!error || typeof error !== 'object') {
    return {};
  }
  return error as ErrorLike;
}

/**
 * 按优先级从任意抛出值里提取可展示的错误文案。
 * 依次尝试字符串本身、Error 实例的 message、普通对象上的 message，以及响应体里的 error/message/msg。
 * @param error - 任意抛出值；null、undefined 与数字等都会走到兜底分支。
 * @param fallback - 所有来源都取不到时使用的文案，可传空串。
 * @returns 第一个非空文案；除 fallback 本身为空串外不会返回空串，也不会再次抛出。
 */
export function getErrorMessage(error: unknown, fallback = 'Unknown error') {
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  const errorLike = toErrorLike(error);
  if (typeof errorLike.message === 'string' && errorLike.message) {
    return errorLike.message;
  }
  const responseData = errorLike.response?.data;
  if (responseData && typeof responseData === 'object') {
    const data = responseData as {
      error?: string;
      message?: string;
      msg?: string;
    };
    if (typeof data.error === 'string' && data.error) {
      return data.error;
    }
    if (typeof data.message === 'string' && data.message) {
      return data.message;
    }
    if (typeof data.msg === 'string' && data.msg) {
      return data.msg;
    }
  }
  return fallback;
}

/**
 * 提取错误里可用于检索的元数据，供日志按单行输出。
 * 只取 name、code 与 status（无顶层 status 时回退到 response.status），其余字段忽略。
 * @param error - 任意抛出值；非对象时得不到任何字段。
 * @returns 字段名到字符串或数字的映射；一个字段都没取到时为空对象。
 */
function getErrorMeta(error: unknown) {
  const errorLike = toErrorLike(error);
  const meta: Record<string, number | string> = {};
  if (typeof errorLike.name === 'string' && errorLike.name) {
    meta.name = errorLike.name;
  }
  if (
    typeof errorLike.code === 'string' ||
    typeof errorLike.code === 'number'
  ) {
    meta.code = errorLike.code;
  }
  if (typeof errorLike.status === 'number') {
    meta.status = errorLike.status;
  } else if (typeof errorLike.response?.status === 'number') {
    meta.status = errorLike.response.status;
  }
  return meta;
}

/**
 * 按级别把错误输出到控制台，并在同一条日志里附上可定位的业务元数据。
 * 错误缺省时只输出作用域，不伪造错误对象，避免把"没有错误"记成一次异常。
 * @param level 输出级别，warn 走 console.warn，其余走 console.error。
 * @param scope 出错的作用域名，用于在控制台中区分来源。
 * @param error 原始错误；为空时视为没有可提取的信息。
 */
function formatLogMessage(
  level: 'error' | 'warn',
  scope: string,
  error?: unknown,
) {
  // 错误缺省时给出占位文案与空元数据：空值不是错误对象，交由兜底分支处理。
  const absent = error === null || error === undefined;
  const message = absent ? '' : getErrorMessage(error, 'Unknown error');
  const meta = absent ? {} : getErrorMeta(error);
  const suffix = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  const base = `[${scope}]${message ? ` ${message}` : ''}${suffix}`;
  if (level === 'warn') {
    console.warn(base);
    return;
  }
  console.error(base);
}

/**
 * 以 warn 级别输出一条带作用域的错误日志。
 * @param scope - 出错的作用域名，会作为 `[作用域]` 前缀出现在同一条日志里。
 * @param error - 原始错误；省略或为空时只输出作用域，不附加任何元数据。
 */
export function logWarn(scope: string, error?: unknown) {
  formatLogMessage('warn', scope, error);
}

/**
 * 以 error 级别输出一条带作用域的错误日志。
 * @param scope - 出错的作用域名，会作为 `[作用域]` 前缀出现在同一条日志里。
 * @param error - 原始错误；省略或为空时只输出作用域，不附加任何元数据。
 */
export function logError(scope: string, error?: unknown) {
  formatLogMessage('error', scope, error);
}
