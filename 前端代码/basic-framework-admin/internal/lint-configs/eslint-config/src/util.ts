/**
 * 配置工具：解包动态 import 的 CommonJS 互操作包装。
 * 各 configs 片段加载 ESLint 插件时统一走 interopDefault，
 * 只在能确认对象带 default 字段时取该字段，否则原样返回；
 * 不校验插件形态，也不缓存加载结果。
 */
export type Awaitable<T> = Promise<T> | T;

/**
 * 归一化动态 import 的返回值：CommonJS 依赖经打包器互操作后会多包一层 default，
 * 这里统一取出 default；没有该包装时按原样返回。
 *
 * @param m 模块导入结果或模块本身
 * @returns default 存在时为其值，否则为原始入参
 */
export async function interopDefault<T>(
  m: Awaitable<T>,
): Promise<T extends { default: infer U } ? U : T> {
  const resolved = await m;
  // 运行时无法从泛型推导出 default 的存在性，这里只在能确认是对象时读取该字段。
  if (
    typeof resolved === 'object' &&
    resolved !== null &&
    'default' in resolved
  ) {
    return resolved.default as T extends { default: infer U } ? U : T;
  }
  return resolved as T extends { default: infer U } ? U : T;
}
