/**
 * Pinia 状态管理初始化与生命周期复位入口，配置持久化存储适配器。
 */
import type { Pinia } from 'pinia';

import type { App } from 'vue';

import { createPinia } from 'pinia';
import SecureLS from 'secure-ls';

let pinia: Pinia;

export interface InitStoreOptions {
  /** 应用状态持久化键前缀。 */
  namespace: string;
}

/** 兼容读取宿主运行时全局配置的窗口结构声明。 */
interface StoreRuntimeWindow {
  /** 宿主运行时注入的应用全局配置。 */
  _VBEN_ADMIN_PRO_APP_CONF_?: {
    /** 本地持久化存储加密密钥。 */
    VITE_APP_STORE_SECURE_KEY?: string;
  };
}

/**
 * 初始化 Pinia 实例与本地持久化插件；仅当配置非空密钥时在生产启用 SecureLS 混淆，
 * 未配置时直接复用原生 localStorage，避免使用空密钥执行伪 AES 加密。真实 XSS 防护由严格 CSP 保证。
 *
 * @param app Vue 应用实例
 * @param options 状态库初始化选项
 * @returns 已挂载的 Pinia 实例
 */
export async function initStores(app: App, options: InitStoreOptions) {
  const { createPersistedState } = await import('pinia-plugin-persistedstate');
  pinia = createPinia();
  const { namespace } = options;
  const encryptionSecret =
    (
      window as unknown as StoreRuntimeWindow
    )._VBEN_ADMIN_PRO_APP_CONF_?.VITE_APP_STORE_SECURE_KEY?.trim() ?? '';
  const ls =
    !import.meta.env.DEV && encryptionSecret.length > 0
      ? new SecureLS({
          encodingType: 'aes',
          encryptionSecret,
          isCompression: true,
          // secure-ls 类型定义未覆盖 metaKey，运行时稳定支持该字段。
          // @ts-ignore secure-ls does not have a type definition for metaKey
          metaKey: `${namespace}-secure-meta`,
        })
      : null;
  pinia.use(
    createPersistedState({
      /** 按应用命名空间生成隔离的持久化键名。 */
      key: (storeKey) => `${namespace}-${storeKey}`,
      storage: ls
        ? {
            /**
             * 通过 SecureLS 读取混淆持久化条目。
             *
             * @param key 持久化键名
             * @returns 解码后的字符串内容，不存在或校验失败时为空
             */
            getItem(key) {
              return ls.get(key);
            },
            /**
             * 通过 SecureLS 写入混淆持久化条目。
             *
             * @param key 持久化键名
             * @param value 待存储的序列化内容
             */
            setItem(key, value) {
              ls.set(key, value);
            },
          }
        : localStorage,
    }),
  );
  app.use(pinia);
  return pinia;
}

/**
 * 重置所有已注册的 Pinia Store 状态（例如登出清理会话态）。
 */
export function resetAllStores() {
  if (!pinia) {
    console.error('Pinia is not installed');
    return;
  }
  const allStores = (pinia as any)._s;
  for (const [_key, store] of allStores) {
    store.$reset();
  }
}
