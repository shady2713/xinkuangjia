/**
 * pinia 装配入口：initStores 创建实例并挂载持久化插件，
 * 生产环境经 secure-ls 加密后写入、开发环境直接用 localStorage 便于调试，
 * resetAllStores 借 pinia 内部注册表批量重置，供退出登录等场景清空状态。
 * 各 store 的状态定义不在这里，持久化字段也由 store 自行声明。
 */
import type { Pinia } from 'pinia';

import type { App } from 'vue';

import { createPinia } from 'pinia';
import SecureLS from 'secure-ls';

let pinia: Pinia;

/**
 * secure-ls 自带的类型声明没有覆盖 metaKey，
 * 而元数据键必须按命名空间隔离，这里显式补出该构造参数，而不是压制检查。
 */
type SecureLsOptions = {
  /** 元数据在 localStorage 中的键名。 */
  metaKey: string;
} & ConstructorParameters<typeof SecureLS>[0];

export interface InitStoreOptions {
  namespace: string;
}

/** 已注册 store 实例中本工程实际使用到的契约，只暴露批量重置所需的 $reset。 */
interface ResettableStore {
  /** 把该 store 的状态恢复为 state() 中定义的初始值。 */
  $reset: () => void;
}

/**
 * pinia 内部维护的 store 注册表。
 * @description `_s` 是 pinia 未对外公开、但批量调用 $reset 必须依赖的内部结构；
 * 这里只声明用到的 $reset 契约，不去还原 pinia 的完整内部类型。
 */
type PiniaStoreRegistry = Map<string, ResettableStore>;

/**
 * 初始化并安装 pinia。
 * @description 创建 pinia 实例并挂载持久化插件，生产环境改用 secure-ls 加密存储，
 * 开发环境直接用 localStorage 以便调试。
 * @param app 目标应用实例。
 * @param options 初始化选项，当前只用到存储命名空间。
 * @returns 安装完成的 pinia 实例。
 */
export async function initStores(app: App, options: InitStoreOptions) {
  const { createPersistedState } = await import('pinia-plugin-persistedstate');
  pinia = createPinia();
  const { namespace } = options;
  const ls = new SecureLS({
    encodingType: 'aes',
    encryptionSecret:
      window._VBEN_ADMIN_PRO_APP_CONF_.VITE_APP_STORE_SECURE_KEY,
    isCompression: true,
    // secure-ls 的类型定义没有覆盖 metaKey，这里显式补出该构造参数。
    metaKey: `${namespace}-secure-meta`,
  } as SecureLsOptions);
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

/**
 * 重置所有已注册的 store。
 * @description 依赖 pinia 未公开的 `_s` 注册表遍历调用 $reset，
 * 因此只能重置已安装 pinia 之后创建的 store；未安装时打印错误并直接返回。
 */
export function resetAllStores() {
  if (!pinia) {
    console.error('Pinia is not installed');
    return;
  }
  const allStores = (pinia as Pinia & { _s: PiniaStoreRegistry })._s;
  for (const [_key, store] of allStores) {
    store.$reset();
  }
}
