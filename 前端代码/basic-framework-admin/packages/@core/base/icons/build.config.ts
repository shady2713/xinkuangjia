/**
 * icons 包的 unbuild 配置：以 src/index 为唯一入口产出 ESM 与类型声明。
 * 每次构建前清空 dist；包的对外出口由 package.json 的 exports 决定，
 * 此处不再拆分子入口。
 */
import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  clean: true,
  declaration: true,
  entries: ['src/index'],
});
