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

/** 应用与库构建预设共用的插件开关：调试工具、元数据注入、构建模式与产物分析。 */
interface CommonPluginOptions {
  devtools?: boolean;
  injectMetadata?: boolean;
  isBuild?: boolean;
  mode?: string;
  root?: string;
  visualizer?: boolean;
}

/** 应用构建可开关的插件集合：压缩、PWA、HTML、i18n、importmap、mock 与打包归档等。 */
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

/** 库构建可开关的插件集合：在公共开关之上只增加 dts 声明生成。 */
interface LibraryPluginOptions extends CommonPluginOptions {
  dts?: boolean | DtsPluginOptions;
}

/** 归档插件选项：构建产物打包为 ZIP 时的文件名与输出目录。 */
interface ArchiverPluginOptions {
  name?: string;
  outputDir?: string;
}

/** 带开关的插件条目：condition 为假时整条跳过，plugins 返回真正要装配的插件。 */
interface ConditionPlugin {
  condition?: boolean;
  /** 返回该条目对应的插件列表，支持同步数组或 Promise；条件为假时不会被调用。 */
  plugins: () => PluginOption[] | PromiseLike<PluginOption[]>;
}

/** 应用构建的 defineConfig 回调：按命令与模式返回应用插件开关和用户 vite 配置。 */
type DefineApplicationOptions = (config?: ConfigEnv) => Promise<{
  application?: ApplicationPluginOptions;
  vite?: UserConfig;
}>;

/** 库构建的 defineConfig 回调：按命令与模式返回库插件开关和用户 vite 配置。 */
type DefineLibraryOptions = (config?: ConfigEnv) => Promise<{
  library?: LibraryPluginOptions;
  vite?: UserConfig;
}>;

/** 构建预设的统一入口类型：应用与库两种回调之一，由各包按自身类型选择。 */
type DefineConfig = DefineApplicationOptions | DefineLibraryOptions;

/** 配置工厂的返回值：用户配置对象、配置函数或它们的 Promise。 */
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
