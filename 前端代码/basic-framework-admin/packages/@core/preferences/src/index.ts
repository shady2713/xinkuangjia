/**
 * preferences 包的对外入口：转发管理器的读取、更新、重置与初始化方法，
 * 并导出响应式的 preferences 视图、preferencesManager 及 usePreferences。
 * 常量与类型也经此透出，使用方无需深链 src 下的具体文件。
 */
import type { Preferences } from './types';

import { preferencesManager } from './preferences';

export const {
  getPreferences,
  updatePreferences,
  resetPreferences,
  clearCache,
  initPreferences,
} = preferencesManager;

export const preferences: Preferences = getPreferences();

export { preferencesManager };

export * from './constants';
export type * from './types';
export * from './use-preferences';
