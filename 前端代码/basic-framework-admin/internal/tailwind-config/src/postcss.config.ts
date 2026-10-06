/**
 * 应用侧 PostCSS 插件链：接入共享 Tailwind 预设、嵌套写法与自动前缀，
 * 生产环境再叠加 cssnano 压缩。
 *
 * postcss-antd-fixes 同时覆盖 ant 与 el 前缀；不承担 Sass 编译与文件监听。
 */
import config from '.';

export default {
  plugins: {
    ...(process.env.NODE_ENV === 'production' ? { cssnano: {} } : {}),
    autoprefixer: {},
    'postcss-antd-fixes': { prefixes: ['ant', 'el'] },
    'postcss-import': {},
    'postcss-preset-env': {},
    tailwindcss: { config },
    'tailwindcss/nesting': {},
  },
};
