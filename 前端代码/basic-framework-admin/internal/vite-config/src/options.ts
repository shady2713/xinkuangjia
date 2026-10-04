/** PWA 安装清单默认选项：统一应用名称、描述与图标，供应用与库构建复用。 */
import type {
  ManifestOptions,
  Options as PwaPluginOptions,
} from 'vite-plugin-pwa';

const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * 默认 PWA 选项：本模块始终给出安装清单，因此把 manifest 收窄为对象类型，
 * 调用方与测试无需再排除插件允许的 `false` 取值。
 */
type DefaultPwaOptions = Omit<Partial<PwaPluginOptions>, 'manifest'> & {
  manifest: Partial<ManifestOptions>;
};

/**
 * 构造默认 PWA 选项。
 * @param name 应用名称；开发环境会追加 dev 后缀，便于区分本地与生产安装。
 * @returns 含安装清单的 PWA 插件选项。
 */
const getDefaultPwaOptions = (name: string): DefaultPwaOptions => ({
  manifest: {
    description: 'A modern admin console built with Vue 3.',
    icons: [
      {
        sizes: '192x192',
        src: '/brand-logo.png',
        type: 'image/png',
      },
      {
        sizes: '512x512',
        src: '/brand-logo.png',
        type: 'image/png',
      },
    ],
    name: `${name}${isDevelopment ? ' dev' : ''}`,
    short_name: `${name}${isDevelopment ? ' dev' : ''}`,
  },
});

export { getDefaultPwaOptions };
