/**
 * preferences 包的 unbuild 构建配置：入口为 src/index，并输出类型声明。
 * 仅影响该包的打包方式，默认偏好与状态管理逻辑都在 src 内实现。
 */
import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  clean: true,
  declaration: true,
  entries: ['src/index'],
});
