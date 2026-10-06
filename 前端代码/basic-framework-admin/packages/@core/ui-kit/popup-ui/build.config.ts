/**
 * 弹窗 UI 包的构建配置：用 unbuild 的 mkdist 分别产出组件与工具代码。
 * .vue 交给 vue 加载器保持组件形态，.ts 以 ESM 输出，同时清理旧产物并生成类型声明。
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
