import type {
  NormalizedOutputOptions,
  OutputBundle,
  OutputChunk,
} from 'rollup';
import type { PluginOption } from 'vite';

import { EOL } from 'node:os';

import { dateUtil, readPackageJSON } from '@vben/node-utils';

/**
 * Inject license header into entry chunks.
 */
async function viteLicensePlugin(
  root = process.cwd(),
): Promise<PluginOption | undefined> {
  const {
    author = {},
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
