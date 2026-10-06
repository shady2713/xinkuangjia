/**
 * 启动信息打印插件：接管开发服务器的 printUrls，
 * 在 Vite 自己的本地地址之后追加 infoMap 中的自定义条目。
 * 供应用展示管理端入口等附加地址；只影响终端输出，
 * 不改动服务器配置与页面内容。
 */
import type { PluginOption } from 'vite';

import { colors } from '@vben/node-utils';

/** 打印插件选项：infoMap 是地址标题到地址的映射，会追加到 Vite 输出的地址列表之后。 */
type PrintPluginOptions = {
  infoMap?: Record<string, string>;
};

/**
 * 接管开发服务器的 printUrls，在 Vite 自己的本地地址之后追加 infoMap 中的自定义条目。
 * @param options - 打印选项；infoMap 为空对象时不追加任何行。
 * @returns 只影响终端输出、不改动服务器配置与页面内容的 Vite 插件。
 */
export const vitePrintPlugin = (
  options: PrintPluginOptions = {},
): PluginOption => {
  const { infoMap = {} } = options;

  return {
    /**
     * 包装地址打印：先输出内置地址，再逐行追加 infoMap 中配置的地址。
     * @param server - Vite 开发服务器实例，这里会替换它的 printUrls。
     */
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
