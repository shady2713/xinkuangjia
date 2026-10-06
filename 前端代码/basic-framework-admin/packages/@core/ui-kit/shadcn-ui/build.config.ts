/**
 * 基础 UI 库的构建清单：用 unbuild 的 mkdist 把 src 下
 * 的 .vue 与 .ts 转译到 dist，并输出类型声明。
 * 只做转译不打包依赖，产物由应用侧继续打包。
 */
import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  clean: true,
  declaration: true,
  entries: [
    {
      builder: 'mkdist',
      input: './src',

      pattern: ['**/*'],
    },
    {
      builder: 'mkdist',
      input: './src',
      loaders: ['vue'],
      pattern: ['**/*.vue'],
    },
    {
      builder: 'mkdist',
      format: 'esm',
      input: './src',
      loaders: ['js'],
      pattern: ['**/*.ts'],
    },
  ],
});
