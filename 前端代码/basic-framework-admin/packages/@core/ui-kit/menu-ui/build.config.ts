/**
 * 菜单包构建配置：unbuild 用 mkdist 转译 Vue 与 TS 源码。
 *
 * 构建前清空 dist，只产出 ESM 与类型声明，不参与应用侧打包。
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
