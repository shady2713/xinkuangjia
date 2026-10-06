/**
 * vite-config 的公共类型声明：约定应用与库两类构建预设可开关的插件选项，
 * 以及 defineConfig 回调与返回值的形状。
 * 只描述配置结构，不含运行时实现；插件装配在 plugins/index.ts。
 */
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

/** 归档插件选项：构建产物打包为 ZIP 时的文件名与输出目录。 */
interface ArchiverPluginOptions {
  name?: string;
  outputDir?: string;
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
