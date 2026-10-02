import type {
  ConfigEnv,
  PluginOption,
  UserConfig,
  UserConfigFnPromise,
} from 'vite';
import type { PluginOptions as DtsPluginOptions } from 'vite-plugin-dts';
import type { Options as PwaPluginOptions } from 'vite-plugin-pwa';

interface CommonPluginOptions {
  devtools?: boolean;
  injectMetadata?: boolean;
  isBuild?: boolean;
  mode?: string;
  root?: string;
  visualizer?: boolean;
}

interface ApplicationPluginOptions extends CommonPluginOptions {
  archiver?: boolean;
  compress?: boolean;
  compressTypes?: ('brotli' | 'gzip')[];
  extraAppConfig?: boolean;
  html?: boolean;
  i18n?: boolean;
  importmap?: boolean;
  injectAppLoading?: boolean;
  injectGlobalScss?: boolean;
  license?: boolean;
  nitroMock?: boolean;
  print?: boolean;
  pwa?: boolean;
  pwaOptions?: Partial<PwaPluginOptions>;
  vxeTableLazyImport?: boolean;
}

interface LibraryPluginOptions extends CommonPluginOptions {
  dts?: boolean | DtsPluginOptions;
}

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
