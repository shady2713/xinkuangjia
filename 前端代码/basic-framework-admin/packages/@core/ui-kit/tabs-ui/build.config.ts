/**
 * tabs-ui 构建配置：用 unbuild 的 mkdist 产物化 src。
 * .vue 走 vue 加载器、.ts 按 ESM 输出并生成声明文件。
 * 构建前清空旧产物目录，不配置压缩与降级转译。
 */
import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  clean: true,
  declaration: true,
  entries: [
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
