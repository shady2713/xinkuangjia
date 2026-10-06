/**
 * vsh CLI 的 unbuild 构建配置：入口固定为 src/index，构建前清理旧产物、输出声明文件，
 * 产物由 bin/vsh.mjs 以 dist/index.mjs 加载。
 */
import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  clean: true,
  declaration: true,
  entries: ['src/index'],
});
