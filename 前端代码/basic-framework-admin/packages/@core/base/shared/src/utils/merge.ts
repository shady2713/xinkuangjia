/**
 * 对象合并工具：透传 defu 的 merge 与 createMerge，并补充数组覆盖语义。
 * mergeWithArrayOverride 遇到数组时整体替换而非逐项深合并，供配置合并使用。
 */
import { createDefu } from 'defu';

export { createDefu as createMerge, defu as merge } from 'defu';

export const mergeWithArrayOverride = createDefu((originObj, key, updates) => {
  if (Array.isArray(originObj[key]) && Array.isArray(updates)) {
    originObj[key] = updates;
    return true;
  }
});
