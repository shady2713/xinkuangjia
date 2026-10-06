/**
 * 通用杂项工具：收纳尚未独立成模块的小函数，供各业务包按需引用。
 * 含实例方法绑定、按路径取值、地址栏参数读取、字段拷贝、分组与 JSON 解析。
 * 函数间不共享状态，失败策略各自独立，如 jsonParse 回退原串。
 */
/**
 * 把原型链上的方法绑定到实例自身，使方法脱离原调用者后仍能访问实例状态。
 *
 * @param instance 待绑定的实例；只读取原型链上的方法，不修改原型本身
 */
export function bindMethods<T extends object>(instance: T): void {
  const prototype = Object.getPrototypeOf(instance);
  const propertyNames = Object.getOwnPropertyNames(prototype);

  propertyNames.forEach((propertyName) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyName);
    const propertyValue = instance[propertyName as keyof T];

    if (
      typeof propertyValue === 'function' &&
      propertyName !== 'constructor' &&
      descriptor &&
      !descriptor.get &&
      !descriptor.set
    ) {
      instance[propertyName as keyof T] = propertyValue.bind(instance);
    }
  });
}

/**
 * 按字符串键读取任意值上的属性，同时兼容数组下标。
 * 路径分段的含义由调用方在运行时决定（对象属性名或数组下标），静态类型无法表达，
 * 因此在唯一的取值入口做一次收窄，取到的值一律按 unknown 继续传递。
 * @param source 待取值的容器，可以是对象、数组或其他任意值。
 * @param key 属性名或数组下标。
 * @returns 命中的值；source 不是对象（含 null）或键不存在时返回 undefined。
 */
function readKeyValue(source: unknown, key: string): unknown {
  if (source === null || typeof source !== 'object') {
    return undefined;
  }
  return (source as Record<string, unknown>)[key];
}

/**
 * 获取嵌套对象的字段值
 * @param obj - 要查找的对象
 * @param path - 用于查找字段的路径，使用小数点分隔
 * @returns 字段值，或者未找到时返回 undefined。结果按 unknown 暴露，调用方需按自身口径收窄。
 * @throws path 不是非空字符串时抛出 Error。空路径会退回「返回整个对象」，
 * 与「按路径取值」的语义冲突，属于调用方错误，因此显式失败而不是静默返回根对象。
 */
export function getNestedValue<T>(obj: T, path: string): unknown {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('Path must be a non-empty string');
  }
  // 把路径字符串按 "." 分割成数组
  const keys = path.split('.');

  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = readKeyValue(current, key);
  }

  return current;
}

/**
 * 获取链接的参数值（值类型）
 * @param key 参数键名
 * @param urlStr 链接地址，默认为当前浏览器的地址
 */
export function getUrlNumberValue(
  key: string,
  urlStr: string = location.href,
): number {
  return Number(getUrlValue(key, urlStr));
}

/**
 * 获取链接的参数值
 * @param key 参数键名
 * @param urlStr 链接地址，默认为当前浏览器的地址
 */
export function getUrlValue(
  key: string,
  urlStr: string = location.href,
): string {
  if (!urlStr || !key) return '';
  const url = new URL(decodeURIComponent(urlStr));
  return url.searchParams.get(key) ?? '';
}

/**
 * 将值复制到目标对象，且以目标对象属性为准，例：target: {a:1} source:{a:2,b:3} 结果为：{a:2}
 * @param target 目标对象，函数会把结果直接写回该对象
 * @param source 源对象，只取 target 已有的同名属性
 */
export function copyValueToTarget<T extends object>(
  target: T,
  source: object,
): void {
  // 泛型 T 只保证是对象，不保证有字符串索引签名，因此显式指定合并结果的容器类型
  const newObj: Record<string, unknown> = Object.assign<
    Record<string, unknown>,
    object,
    object
  >({}, target, source);
  // 源对象多出来的键不属于目标结构，必须剔除，否则会污染 target
  const targetKeys = new Set(Object.keys(target));
  Object.keys(newObj).forEach(
    /**
     * 剔除源对象多出来的键。
     * @param key 当前待检查的合并结果键名。
     */
    (key) => {
      if (!targetKeys.has(key)) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete newObj[key];
      }
    },
  );
  // 更新目标对象值
  Object.assign(target, newObj);
}

/**
 * 按指定字段把数组分组，等价于 Lodash 的 groupBy。
 * @param array 待分组的数组，元素必须是对象。
 * @param key 分组依据的字段名。
 * @returns 以字段值的字符串形式为键、元素数组为值的分组结果。
 * 字段值会经 String 转换后作键，缺失字段的元素归入 "undefined" 分组。
 */
export function groupBy<T extends object>(
  array: T[],
  key: string,
): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of array) {
    const groupKey = String((item as Record<string, unknown>)[key]);
    // 首次见到该分组时先建桶，避免每次都重建数组
    result[groupKey] ??= [];
    result[groupKey].push(item);
  }
  return result;
}

/**
 * 解析 JSON 字符串
 *
 * @param str
 */
export function jsonParse(str: string) {
  try {
    return JSON.parse(str);
  } catch {
    console.warn(`str[${str}] 不是一个 JSON 字符串`);
    return str;
  }
}
