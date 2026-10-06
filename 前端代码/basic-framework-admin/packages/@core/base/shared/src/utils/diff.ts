/**
 * 比较两个数组是否相等
 * 忽略元素顺序，按各元素出现次数做多重集比较，重复元素会参与计数。
 * @param a - 基准数组，只读取不改写。
 * @param b - 待比较数组，长度与 a 不同时直接判为不相等。
 * @returns 长度相同且每个元素出现次数一致时为 true；元素按 Map 键比较，因此对象按引用判定。
 */
function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const counter = new Map<T, number>();
  for (const value of a) {
    counter.set(value, (counter.get(value) || 0) + 1);
  }
  for (const value of b) {
    const count = counter.get(value);
    if (count === undefined || count === 0) {
      return false;
    }
    counter.set(value, count - 1);
  }
  return true;
}

/**
 * 差异结果：与对比对象同形，只保留存在差异的键；嵌套对象继续向下递归。
 */
type DiffResult<T> = Partial<{
  [K in keyof T]: T[K] extends object ? DiffResult<T[K]> : T[K];
}>;

/**
 * 递归比较两个值，返回与 obj2 形状一致的差异部分。
 * 参与比较的层级在运行时才知道，因此按 unknown 逐层收窄并继续向下递归。
 * @param o1 旧值，任意类型。
 * @param o2 新值，任意类型。
 * @returns 存在差异时返回差异值（与 o2 形状一致的对象，或 o2 本身）；无差异时返回 undefined。
 */
function findDifferences(o1: unknown, o2: unknown): unknown {
  if (Array.isArray(o1) && Array.isArray(o2)) {
    if (!arraysEqual(o1, o2)) {
      return o2;
    }
    return undefined;
  }

  if (
    typeof o1 === 'object' &&
    typeof o2 === 'object' &&
    o1 !== null &&
    o2 !== null
  ) {
    const diffResult: Record<string, unknown> = {};

    const keys = new Set([...Object.keys(o1), ...Object.keys(o2)]);
    keys.forEach(
      /**
       * 逐键递归比较，只把存在差异的键写入差异对象。
       * @param key 当前待比较的键名，值取自新旧两侧对象的并集。
       */
      (key) => {
        const valueDiff = findDifferences(
          (o1 as Record<string, unknown>)[key],
          (o2 as Record<string, unknown>)[key],
        );
        if (valueDiff !== undefined) {
          diffResult[key] = valueDiff;
        }
      },
    );

    return Object.keys(diffResult).length > 0 ? diffResult : undefined;
  }

  return o1 === o2 ? undefined : o2;
}

/**
 * 深度比较两个对象，返回 obj2 相对 obj1 的差异部分。
 * 数组按整体比较（内容不同即返回 obj2 的整个数组），不逐项递归。
 * @param obj1 基准对象。
 * @param obj2 对比对象，差异值取自它。
 * @returns 有差异时返回与 obj2 形状一致的差异对象；完全一致时返回 undefined。
 */
function diff<T extends object>(obj1: T, obj2: T): DiffResult<T> | undefined {
  // 运行时只能保证结果是 undefined、原始值本身或由 findDifferences 逐层构造的普通对象，
  // 与泛型 T 的映射关系无法在运行时校验，因此在此处一次性对齐到声明的返回类型。
  return findDifferences(obj1, obj2) as DiffResult<T> | undefined;
}

export { arraysEqual, diff };
