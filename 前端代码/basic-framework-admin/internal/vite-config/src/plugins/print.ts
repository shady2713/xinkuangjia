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
