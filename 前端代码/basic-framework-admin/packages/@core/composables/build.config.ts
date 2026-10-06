/**
 * composables 包的 unbuild 构建配置：入口为 src/index，并同时输出类型声明。
 * 只决定打包产物，包内各组合式函数的运行时行为不在此处约束。
 */
import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  clean: true,
  declaration: true,
  entries: ['src/index'],
});
