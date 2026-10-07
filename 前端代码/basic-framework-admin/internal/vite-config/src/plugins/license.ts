/**
 * 许可证材料插件（生产构建）：给入口分块顶部拼接版权横幅，并把工作区许可证原文随产物输出。
 *
 * 横幅的许可行取自应用 `package.json` 自身声明的 `license` 字段，**不在代码里硬编码任何
 * 许可证**：清单未声明时如实写"未声明"，避免构建产物替权利方做许可选择。
 * 同时把工作区根目录已有的 `LICENSE` 原文作为静态资源输出，使随包分发的站点自带许可证文本。
 */
import type {
  NormalizedOutputOptions,
  OutputBundle,
  OutputChunk,
  PluginContext,
} from 'rollup';
import type { PluginOption } from 'vite';

import { existsSync, readFileSync } from 'node:fs';
import { EOL } from 'node:os';
import { resolve } from 'node:path';

import { dateUtil, readPackageJSON } from '@vben/node-utils';

/** 工作区根下的许可证文本文件名；只随包分发已存在的原文，不新建、不改写。 */
const WORKSPACE_LICENSE = 'LICENSE';
/** 清单未声明许可时横幅里的如实说明，不代替权利方选择。 */
const UNDECLARED_LICENSE = '未在包清单中声明（待有权者决定）';

/**
 * 构造许可证材料插件：拼接入口横幅并输出工作区许可证原文。
 * @param root 应用根目录，用于读取 package.json 与定位工作区根。
 * @returns 生产构建使用的 Vite 插件；包清单读取失败时返回 undefined。
 */
async function viteLicensePlugin(
  root = process.cwd(),
): Promise<PluginOption | undefined> {
  const {
    author,
    description = '',
    homepage = '',
    license = '',
    name = 'Admin Console',
    version = '',
  } = await readPackageJSON(root);
  const authorName =
    typeof author === 'string' ? author : (author?.name ?? 'project-team');
  const authorEmail = typeof author === 'string' ? '' : (author?.email ?? '');
  const declaredLicense =
    typeof license === 'string' && license.trim() !== ''
      ? license.trim()
      : UNDECLARED_LICENSE;
  const workspaceLicense = resolve(root, '..', '..', WORKSPACE_LICENSE);

  return {
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      /**
       * 拼接入口横幅，并把工作区许可证原文写入产物。
       * @param _options - Rollup 传入的输出选项，本插件不使用。
       * @param bundle - 本次构建的产物集合，入口分块的 code 会被就地改写。
       * @this - Rollup 插件上下文，用于把许可证原文输出为静态资源。
       */
      handler(
        this: PluginContext,
        _options: NormalizedOutputOptions,
        bundle: OutputBundle,
      ) {
        const date = dateUtil().format('YYYY-MM-DD');
        const copyrightText = `/*!
  * ${name}
  * Version: ${version}
  * Author: ${authorName}
  * Declared License: ${declaredLicense}
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
        if (existsSync(workspaceLicense)) {
          this.emitFile({
            fileName: WORKSPACE_LICENSE,
            source: readFileSync(workspaceLicense, 'utf8'),
            type: 'asset',
          });
        }
      },
      order: 'post',
    },
    name: 'vite:license',
  };
}

/**
 * 定位工作区许可证原文的绝对路径，供第三方许可材料插件在说明中引用。
 * @param root 应用根目录。
 * @returns 许可证原文路径；文件不存在时返回空串。
 */
function workspaceLicensePath(root: string): string {
  const candidate = resolve(root, '..', '..', WORKSPACE_LICENSE);
  return existsSync(candidate) ? candidate : '';
}

export { viteLicensePlugin, workspaceLicensePath, WORKSPACE_LICENSE };
