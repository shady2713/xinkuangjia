/**
 * 启动信息打印插件：接管开发服务器的 printUrls，
 * 在 Vite 自己的本地地址之后追加 infoMap 中的自定义条目。
 * 供应用展示管理端入口等附加地址；只影响终端输出，
 * 不改动服务器配置与页面内容。
 */
import type { PluginOption } from 'vite';

import { colors } from '@vben/node-utils';

type PrintPluginOptions = {
  infoMap?: Record<string, string>;
};

export const vitePrintPlugin = (
  options: PrintPluginOptions = {},
): PluginOption => {
  const { infoMap = {} } = options;

  return {
    configureServer(server) {
      const printUrls = server.printUrls;
      server.printUrls = () => {
        printUrls();

        for (const [key, value] of Object.entries(infoMap)) {
          console.log(
            `  ${colors.green('->')}  ${colors.bold(key)}: ${colors.cyan(value)}`,
          );
        }
      };
    },
    enforce: 'pre',
    name: 'vite:print-info',
  };
};
