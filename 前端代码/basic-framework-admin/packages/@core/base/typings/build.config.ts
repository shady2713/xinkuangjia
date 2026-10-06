/**
 * typings 包的 unbuild 打包配置：入口、清理与类型声明。
 * entries 只取 src/index，clean 清掉上次产物。
 * declaration 输出 .d.ts；包内其余声明靠入口聚合。
 */
import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  clean: true,
  declaration: true,
  entries: ['src/index'],
});
