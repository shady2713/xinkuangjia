/**
 * preferences 包的对外入口：转发管理器的读取、更新、重置与初始化方法，
 * 并导出响应式的 preferences 视图、preferencesManager 及 usePreferences。
 * 常量与类型也经此透出，使用方无需深链 src 下的具体文件。
 */
import type { Preferences } from './types';

import { preferencesManager } from './preferences';

/** 直接转发管理器上的读取、更新、重置与初始化方法，调用方无需感知管理器实例。 */
export const {
  getPreferences,
  updatePreferences,
  resetPreferences,
  clearCache,
  initPreferences,
} = preferencesManager;

/** 响应式偏好的只读视图，模块加载时抓取一次；后续变更由管理器就地更新同一对象。 */
export const preferences: Preferences = getPreferences();

export { preferencesManager };

export * from './constants';
export type * from './types';
export * from './use-preferences';
