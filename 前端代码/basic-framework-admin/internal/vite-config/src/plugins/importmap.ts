/**
 * 基于现有 importmap 能力按项目需要做定制调整
 */
import type { GeneratorOptions } from '@jspm/generator';
import type { Plugin } from 'vite';

import { Generator } from '@jspm/generator';
import { load } from 'cheerio';
import { minify } from 'html-minifier-terser';

const DEFAULT_PROVIDER = 'jspm.io';

type pluginOptions = GeneratorOptions & {
  debug?: boolean;
  defaultProvider?: 'esm.sh' | 'jsdelivr' | 'jspm.io';
  importmap?: Array<{ name: string; range?: string }>;
};

// async function getLatestVersionOfShims() {
//   const result = await fetch('https://ga.jspm.io/npm:es-module-shims');
//   const version = result.text();
//   return version;
// }

async function getShimsUrl(provide: string) {
  // const version = await getLatestVersionOfShims();
  const version = '1.10.0';

  const shimsSubpath = `dist/es-module-shims.js`;
  const providerShimsMap: Record<string, string> = {
    'esm.sh': `https://esm.sh/es-module-shims@${version}/${shimsSubpath}`,
    // unpkg: `https://unpkg.com/es-module-shims@${version}/${shimsSubpath}`,
    jsdelivr: `https://cdn.jsdelivr.net/npm/es-module-shims@${version}/${shimsSubpath}`,

    // 下面两个CDN不稳定，暂时不用
    'jspm.io': `https://ga.jspm.io/npm:es-module-shims@${version}/${shimsSubpath}`,
  };

  return providerShimsMap[provide] || providerShimsMap[DEFAULT_PROVIDER];
}

let generator: Generator;

/**
 * 生成在构建期为依赖安装 import map 并改写 HTML 的 Vite 插件组。
 *
 * 仅在非 SSR 的生产构建中生效：先把 inputMap 与 importmap 选项里的依赖交给 jspm 安装，
 * 再由 external 插件把这些依赖标记为 external，最后把生成的 import map 注入 HTML。
 * 安装失败时 buildEnd 会抛错终止构建，避免产出缺少依赖映射的产物。
 *
 * @param pluginOptions jspm 生成器配置与需要纳入 import map 的依赖清单
 * @returns 按 pre、post 顺序返回的插件数组
 */
async function viteImportMapPlugin(
  pluginOptions?: pluginOptions,
): Promise<Plugin[]> {
  const { importmap } = pluginOptions || {};

  let isSSR = false;
  let isBuild = false;
  let installed = false;
  let installError: Error | null = null;

  const options: pluginOptions = Object.assign(
    {},
    {
      debug: false,
      defaultProvider: 'jspm.io',
      env: ['production', 'browser', 'module'],
      importmap: [],
    },
    pluginOptions,
  );

  generator = new Generator({
    ...options,
    baseUrl: process.cwd(),
  });

  if (options?.debug) {
    (async () => {
      for await (const { message, type } of generator.logStream()) {
        console.log(`${type}: ${message}`);
      }
    })();
  }

  const imports = options.inputMap?.imports ?? {};
  const scopes = options.inputMap?.scopes ?? {};
  const firstLayerKeys = Object.keys(scopes);
  const inputMapScopes: string[] = [];
  firstLayerKeys.forEach((key) => {
    inputMapScopes.push(...Object.keys(scopes[key] || {}));
  });
  const inputMapImports = Object.keys(imports);

  const allDepNames: string[] = [
    ...(importmap?.map((item) => item.name) || []),
    ...inputMapImports,
    ...inputMapScopes,
  ];
  const depNames = new Set<string>(allDepNames);

  const installDeps = importmap?.map((item) => ({
    range: item.range,
    target: item.name,
  }));

  return [
    {
      async config(_, { command, isSsrBuild }) {
        isBuild = command === 'build';
        isSSR = !!isSsrBuild;
      },
      enforce: 'pre',
      name: 'importmap:external',
      resolveId(id) {
        if (isSSR || !isBuild) {
          return null;
        }

        if (!depNames.has(id)) {
          return null;
        }
        return { external: true, id };
      },
    },
    {
      enforce: 'post',
      name: 'importmap:install',
      /**
       * 在首次解析依赖时触发 jspm 安装，保证 import map 早于 external 标记生成。
       *
       * @returns 恒为 null；本插件不改写模块解析结果，只负责触发安装副作用
       */
      async resolveId() {
        if (isSSR || !isBuild || installed) {
          return null;
        }
        try {
          installed = true;
          await Promise.allSettled(
            (installDeps || []).map((dep) => generator.install(dep)),
          );
        } catch (error) {
          // 生成器安装依赖失败时保留原始错误，buildEnd 会打印它并中止构建以免产出错误的产物。
          installError =
            error instanceof Error ? error : new Error(String(error));
          installed = false;
        }
        return null;
      },
    },
    {
      buildEnd() {
        // 未生成importmap时，抛出错误，防止被turbo缓存
        if (!installed && !isSSR) {
          installError && console.error(installError);
          throw new Error('Importmap installation failed.');
        }
      },
      enforce: 'post',
      name: 'importmap:html',
      transformIndexHtml: {
        async handler(html) {
          if (isSSR || !isBuild) {
            return html;
          }

          const importmapJson = generator.getMap();

          if (!importmapJson) {
            return html;
          }

          const esModuleShimsSrc = await getShimsUrl(
            options.defaultProvider || DEFAULT_PROVIDER,
          );

          const resultHtml = await injectShimsToHtml(
            html,
            esModuleShimsSrc || '',
          );
          html = await minify(resultHtml || html, {
            collapseWhitespace: true,
            minifyCSS: true,
            minifyJS: true,
            removeComments: false,
          });

          return {
            html,
            tags: [
              {
                attrs: {
                  type: 'importmap',
                },
                injectTo: 'head-prepend',
                tag: 'script',
                children: `${JSON.stringify(importmapJson)}`,
              },
            ],
          };
        },
        order: 'post',
      },
    },
  ];
}

async function injectShimsToHtml(html: string, esModuleShimUrl: string) {
  const $ = load(html);

  const $script = $(`script[type='module']`);

  if (!$script) {
    return;
  }

  const entry = $script.attr('src');

  $script.removeAttr('type');
  $script.removeAttr('crossorigin');
  $script.removeAttr('src');
  $script.html(`
if (!HTMLScriptElement.supports || !HTMLScriptElement.supports('importmap')) {
  self.importShim = function () {
      const promise = new Promise((resolve, reject) => {
          document.head.appendChild(
              Object.assign(document.createElement('script'), {
                  src: '${esModuleShimUrl}',
                  crossorigin: 'anonymous',
                  async: true,
                  onload() {
                      if (!importShim.$proxy) {
                          resolve(importShim);
                      } else {
                          reject(new Error('No globalThis.importShim found:' + esModuleShimUrl));
                      }
                  },
                  onerror(error) {
                      reject(error);
                  },
              }),
          );
      });
      importShim.$proxy = true;
      return promise.then((importShim) => importShim(...arguments));
  };
}

var modules = ['${entry}'];
typeof importShim === 'function'
  ? modules.forEach((moduleName) => importShim(moduleName))
  : modules.forEach((moduleName) => import(moduleName));
 `);
  $('body').after($script);
  $('head').remove(`script[type='module']`);
  return $.html();
}

export { viteImportMapPlugin };
