import type {
  ConfigEnv,
  PluginOption,
  UserConfig,
  UserConfigFnPromise,
} from 'vite';
import type { PluginOptions as DtsPluginOptions } from 'vite-plugin-dts';
import type { Options as PwaPluginOptions } from 'vite-plugin-pwa';

/** 构建产物压缩归档插件选项。 */
interface ArchiverPluginOptions {
  /** 输出压缩包名称，不含扩展名。 */
  name?: string;
  /** 压缩包输出目录。 */
  outputDir?: string;
}

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
  ArchiverPluginOptions,
  CommonPluginOptions,
  ConditionPlugin,
  DefineApplicationOptions,
  DefineConfig,
  DefineLibraryOptions,
  LibraryPluginOptions,
  VbenViteConfig,
};
