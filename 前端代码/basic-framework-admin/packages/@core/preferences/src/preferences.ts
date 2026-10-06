/**
 * 偏好设置管理器：合并项目覆盖项与默认值，维护唯一的响应式偏好状态。
 * 主题字段变化时写入 CSS 变量，灰阶与色弱开关变化时切换根节点类名，
 * 另监听系统主题与断点；只保留内存状态，启动时清理历史遗留的本地缓存键。
 */
import type { DeepPartial } from '@vben-core/typings';

import type { InitialOptions, Preferences } from './types';

import { markRaw, reactive, readonly, watch } from 'vue';

import { StorageManager } from '@vben-core/shared/cache';
import { isMacOs, merge } from '@vben-core/shared/utils';

import { breakpointsTailwind, useBreakpoints } from '@vueuse/core';

import { defaultPreferences } from './config';
import { updateCSSVariables } from './update-css-variables';

const STORAGE_KEYS = {
  MAIN: 'preferences',
  LOCALE: 'preferences-locale',
  THEME: 'preferences-theme',
} as const;

/** 偏好设置的唯一持有者：负责默认值合并、变更下发与初始化期的各类监听。 */
class PreferenceManager {
  private cache: StorageManager;
  private initialPreferences: Preferences = defaultPreferences;
  private isInitialized = false;
  private state: Preferences;

  /**
   * 建立初始状态：缓存管理器先用默认前缀，状态用默认偏好的浅拷贝包成响应式对象。
   * 真正的命名空间与项目覆盖项要等 initPreferences 才会写入。
   */
  constructor() {
    this.cache = new StorageManager();
    this.state = reactive<Preferences>({ ...defaultPreferences });
  }

  /**
   * 清除历史版本遗留的本地偏好缓存。
   *
   * 当前版本不再读取或写入这些缓存键，此方法仅用于升级清理及兼容现有调用方。
   */
  clearCache = () => {
    Object.values(STORAGE_KEYS).forEach((key) => this.cache.removeItem(key));
  };

  /**
   * 获取初始化偏好设置
   */
  getInitialPreferences = () => {
    return this.initialPreferences;
  };

  /**
   * 获取当前偏好设置（只读）
   */
  getPreferences = () => {
    return readonly(this.state);
  };

  /**
   * 初始化偏好设置
   * @param options - 初始化配置项
   * @param options.namespace - 命名空间，用于隔离不同应用的配置
   * @param options.overrides - 要覆盖的偏好设置
   */
  initPreferences = async ({ namespace, overrides }: InitialOptions) => {
    // 防止重复初始化
    if (this.isInitialized) {
      return;
    }

    // 使用命名空间初始化存储管理器
    this.cache = new StorageManager({ prefix: namespace });
    // 新版本仅使用代码配置，启动时清理历史版本遗留的本地偏好。
    this.clearCache();

    // 合并初始偏好设置
    this.initialPreferences = merge({}, overrides, defaultPreferences);

    // 项目配置优先于框架默认值，不再合并浏览器本地偏好。
    const mergedPreference = merge({}, overrides, defaultPreferences);

    // 更新偏好设置
    this.updatePreferences(mergedPreference);

    // 设置监听器
    this.setupWatcher();

    // 初始化平台标识
    this.initPlatform();

    this.isInitialized = true;
  };

  /**
   * 重置偏好设置到初始状态
   */
  resetPreferences = () => {
    // 将状态重置为初始偏好设置
    Object.assign(this.state, this.initialPreferences);

    // 直接触发 UI 更新
    this.handleUpdates(this.state);
  };

  /**
   * 更新偏好设置
   * @param updates - 要更新的偏好设置
   */
  updatePreferences = (updates: DeepPartial<Preferences>) => {
    // 深度合并更新内容和当前状态
    const mergedState = merge({}, updates, markRaw(this.state));
    Object.assign(this.state, mergedState);

    // 根据更新的值执行更新
    this.handleUpdates(updates);
  };

  /**
   * 处理更新
   * @param updates - 更新的偏好设置
   */
  private handleUpdates(updates: DeepPartial<Preferences>) {
    const { theme, app } = updates;

    if (
      theme &&
      (Object.keys(theme).length > 0 || Reflect.has(theme, 'fontSize'))
    ) {
      updateCSSVariables(this.state);
    }

    if (
      app &&
      (Reflect.has(app, 'colorGrayMode') || Reflect.has(app, 'colorWeakMode'))
    ) {
      this.updateColorMode(this.state);
    }
  }

  /**
   * 初始化平台标识
   */
  private initPlatform() {
    document.documentElement.dataset.platform = isMacOs() ? 'macOs' : 'window';
  }

  /**
   * 监听状态和系统偏好设置的变化
   */
  private setupWatcher() {
    if (this.isInitialized) {
      return;
    }

    // 监听断点，判断是否移动端
    const breakpoints = useBreakpoints(breakpointsTailwind);
    const isMobile = breakpoints.smaller('md');

    watch(
      () => isMobile.value,
      (val) => {
        this.updatePreferences({
          app: { isMobile: val },
        });
      },
      { immediate: true },
    );

    // 监听系统主题偏好设置变化
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', ({ matches: isDark }) => {
        // 仅在自动模式下跟随系统主题
        if (this.state.theme.mode === 'auto') {
          // 先应用实际的主题
          this.updatePreferences({
            theme: { mode: isDark ? 'dark' : 'light' },
          });
          // 再恢复为 auto 模式，保持跟随系统的状态
          this.updatePreferences({
            theme: { mode: 'auto' },
          });
        }
      });
  }

  /**
   * 更新页面颜色模式（灰色、色弱）
   * @param preference - 偏好设置
   */
  private updateColorMode(preference: Preferences) {
    const { colorGrayMode, colorWeakMode } = preference.app;
    const dom = document.documentElement;

    dom.classList.toggle('invert-mode', colorWeakMode);
    dom.classList.toggle('grayscale-mode', colorGrayMode);
  }
}

const preferencesManager = new PreferenceManager();

export { PreferenceManager, preferencesManager };
