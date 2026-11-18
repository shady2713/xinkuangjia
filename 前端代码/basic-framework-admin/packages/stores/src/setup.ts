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
 * 初始化 Pinia 实例与本地持久化插件。
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
    (window as unknown as StoreRuntimeWindow)._VBEN_ADMIN_PRO_APP_CONF_
      ?.VITE_APP_STORE_SECURE_KEY ?? '';
  const ls = new SecureLS({
    encodingType: 'aes',
    encryptionSecret,
    isCompression: true,
    // @ts-ignore secure-ls does not have a type definition for this
    metaKey: `${namespace}-secure-meta`,
  });
  pinia.use(
    createPersistedState({
      // key $appName-$store.id
      key: (storeKey) => `${namespace}-${storeKey}`,
      storage: import.meta.env.DEV
        ? localStorage
        : {
            getItem(key) {
              return ls.get(key);
            },
            setItem(key, value) {
              ls.set(key, value);
            },
          },
    }),
  );
  app.use(pinia);
  return pinia;
}

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
