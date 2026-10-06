/**
 * turbo-run CLI 的 unbuild 构建配置：以 src/index 为唯一入口，构建前清理旧产物，
 * 并输出类型声明，供 bin/turbo-run.mjs 加载 dist/index.mjs。
 */
import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  clean: true,
  declaration: true,
  entries: ['src/index'],
});
