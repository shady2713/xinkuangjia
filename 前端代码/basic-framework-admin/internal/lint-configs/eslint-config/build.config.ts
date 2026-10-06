/**
 * ESLint 配置包的构建入口：由 src/index 产出 dist 与类型声明。
 * 只负责打包，规则与配置实现留在 src 目录。
 */
import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  clean: true,
  declaration: true,
  entries: ['src/index'],
});
