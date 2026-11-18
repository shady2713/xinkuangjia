/** 生产构建入口分块许可证头部注入插件。 */
import type { PluginOption, Rollup } from 'vite';

import { EOL } from 'node:os';

import { dateUtil, readPackageJSON } from '@vben/node-utils';

/**
 * 在入口分块头部注入包元信息与开源许可证注释。
 *
 * @param root 应用根目录
 * @returns 仅在生产构建后置阶段执行的插件
 */
async function viteLicensePlugin(
  root = process.cwd(),
): Promise<PluginOption | undefined> {
  const {
    author,
    description = '',
    homepage = '',
    name = 'Admin Console',
    version = '',
  } = await readPackageJSON(root);
  const authorObject =
    typeof author === 'object' && author !== null ? author : undefined;
  const authorName =
    typeof author === 'string'
      ? author
      : (authorObject?.name ?? 'project-team');
  const authorEmail =
    typeof author === 'string' ? '' : (authorObject?.email ?? '');

  return {
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      /**
       * 遍历输出分块并为入口分块前置写入版权注释。
       *
       * @param _options Rollup 归一化输出配置
       * @param bundle 当前轮次生成的产物集合
       */
      handler: (
        _options: Rollup.NormalizedOutputOptions,
        bundle: Rollup.OutputBundle,
      ) => {
        const date = dateUtil().format('YYYY-MM-DD');
        const copyrightText = `/*!
  * ${name}
  * Version: ${version}
  * Author: ${authorName}
  * License: MIT License
  * Description: ${description}
  * Date Created: ${date}
  * Homepage: ${homepage}
  * Contact: ${authorEmail}
*/`.trim();

        for (const [, fileContent] of Object.entries(bundle)) {
          if (fileContent.type === 'chunk' && fileContent.isEntry) {
            const chunkContent = fileContent as Rollup.OutputChunk;
            chunkContent.code = `${copyrightText}${EOL}${chunkContent.code}`;
          }
        }
      },
      order: 'post',
    },
    name: 'vite:license',
  };
}

export { viteLicensePlugin };
