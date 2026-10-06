/**
 * 应用偏好设置出口：defineOverridesPreferences 供各应用登记自己的默认偏好覆盖，
 * 其余能力原样再导出 @vben-core/preferences。
 * 默认值合并与持久化由核心包完成，这里不做校验、转换与存取。
 */
import type { Preferences } from '@vben-core/preferences';
import type { DeepPartial } from '@vben-core/typings';

/**
 * 如果你想所有的app都使用相同的默认偏好设置，你可以在这里定义
 * @param preferences
 * @returns
 */

function defineOverridesPreferences(preferences: DeepPartial<Preferences>) {
  return preferences;
}

export { defineOverridesPreferences };

export * from '@vben-core/preferences';
