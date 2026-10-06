/**
 * 许可证头插件：仅在 build 阶段给入口 chunk 顶部拼接版权声明。
 * 名称、版本、作者取自应用 package.json，缺失字段回落到内置默认值。
 * 只改写入口分块，静态资源与非入口分包保持原样。
 */
import type {
  NormalizedOutputOptions,
  OutputBundle,
  OutputChunk,
} from 'rollup';
import type { PluginOption } from 'vite';

import { EOL } from 'node:os';

import { dateUtil, readPackageJSON } from '@vben/node-utils';

/**
 * 构造许可证头注入插件：把包清单里的名称、版本与作者写进入口分块。
 * @param root 应用根目录，用于读取 package.json。
 * @returns 生产构建使用的 Vite 插件；包清单读取失败时返回 undefined。
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
  const authorName =
    typeof author === 'string' ? author : (author?.name ?? 'project-team');
  const authorEmail = typeof author === 'string' ? '' : (author?.email ?? '');

  return {
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      /**
       * 遍历产物分块，只在入口 chunk 顶部拼接版权声明。
       * @param _options - Rollup 传入的输出选项，本插件不使用。
       * @param bundle - 本次构建的产物集合，入口分块的 code 会被就地改写。
       */
      handler: (_options: NormalizedOutputOptions, bundle: OutputBundle) => {
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
            const chunkContent = fileContent as OutputChunk;
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
