/**
 * @vben/vite-config 的 unbuild 配置：只以 src/index 为入口，
 * 开启产物清理与 .d.ts 声明输出。
 *
 * 只决定本包如何被打包，不涉及应用侧 Vite 配置的具体内容。
 */
import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  clean: true,
  declaration: true,
  entries: ['src/index'],
});
