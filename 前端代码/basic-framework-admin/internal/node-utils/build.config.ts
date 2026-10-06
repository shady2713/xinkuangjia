/**
 * node-utils 的 unbuild 构建配置：入口取 src/index，产出 JS 与类型声明。
 * 每次构建前先清理旧产物；只服务于这个内部工具包，
 * 不参与 apps 与 packages 的应用构建。
 */
import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  clean: true,
  declaration: true,
  entries: ['src/index'],
});
