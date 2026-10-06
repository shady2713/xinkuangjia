/**
 * @vben/tailwind-config 的 unbuild 配置：以 src/index 与
 * src/postcss.config 两个入口产出，并额外输出 CJS 供 PostCSS 加载。
 *
 * 只声明打包形态，主题内容与内容扫描范围仍由 src/index.ts 决定。
 */
import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  clean: true,
  declaration: true,
  entries: ['src/index', './src/postcss.config'],
  rollup: {
    emitCJS: true,
  },
});
