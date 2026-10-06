/**
 * shared 包的 unbuild 配置：为 store、constants、utils、color、cache、
 * global-state 六个子路径各产出一份 ESM 与类型声明。
 * entries 即包的公开面，未登记的目录不会进入构建产物。
 */
import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  clean: true,
  declaration: true,
  entries: [
    'src/store',
    'src/constants/index',
    'src/utils/index',
    'src/color/index',
    'src/cache/index',
    'src/global-state',
  ],
});
