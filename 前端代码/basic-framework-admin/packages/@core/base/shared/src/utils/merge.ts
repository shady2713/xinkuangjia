/**
 * 对象合并工具：透传 defu 的 merge 与 createMerge，并补充数组覆盖语义。
 * mergeWithArrayOverride 遇到数组时整体替换而非逐项深合并，供配置合并使用。
 */
import { createDefu } from 'defu';

export { createDefu as createMerge, defu as merge } from 'defu';

/**
 * 数组整体覆盖的深合并：对象仍按 defu 规则深合并，但默认值与源值同为数组时用源值整体替换，
 * 避免默认配置里的数组元素被逐项并入。
 */
export const mergeWithArrayOverride = createDefu((originObj, key, updates) => {
  if (Array.isArray(originObj[key]) && Array.isArray(updates)) {
    originObj[key] = updates;
    return true;
  }
});
