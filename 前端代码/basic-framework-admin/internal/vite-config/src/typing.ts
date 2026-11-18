import type {
  ConfigEnv,
  PluginOption,
  UserConfig,
  UserConfigFnPromise,
} from 'vite';
import type { PluginOptions as DtsPluginOptions } from 'vite-plugin-dts';

/** 公共 Vite 插件选项。 */
interface CommonPluginOptions {
  isBuild?: boolean;
  mode?: string;
  root?: string;
}

/** 管理端应用构建插件选项。 */
interface ApplicationPluginOptions extends CommonPluginOptions {
  extraAppConfig?: boolean;
  html?: boolean;
  injectAppLoading?: boolean;
  injectGlobalScss?: boolean;
  vxeTableLazyImport?: boolean;
}

/** 库包构建插件选项。 */
interface LibraryPluginOptions extends CommonPluginOptions {
  dts?: boolean | DtsPluginOptions;
}

/** 按条件加载的 Vite 插件组。 */
interface ConditionPlugin {
  condition?: boolean;
  plugins: () => PluginOption[] | PromiseLike<PluginOption[]>;
}

type DefineApplicationOptions = (config?: ConfigEnv) => Promise<{
  application?: ApplicationPluginOptions;
  vite?: UserConfig;
}>;

type DefineLibraryOptions = (config?: ConfigEnv) => Promise<{
  library?: LibraryPluginOptions;
  vite?: UserConfig;
}>;

type DefineConfig = DefineApplicationOptions | DefineLibraryOptions;

type VbenViteConfig = Promise<UserConfig> | UserConfig | UserConfigFnPromise;

export type {
  ApplicationPluginOptions,
  CommonPluginOptions,
  ConditionPlugin,
  DefineApplicationOptions,
  DefineConfig,
  DefineLibraryOptions,
  LibraryPluginOptions,
  VbenViteConfig,
};
