/**
 * 基于现有 importmap 能力按项目需要做定制调整
 */
import type { GeneratorOptions } from '@jspm/generator';
import type { Plugin } from 'vite';

import { Generator } from '@jspm/generator';
import { load } from 'cheerio';
import { minify } from 'html-minifier-terser';

const DEFAULT_PROVIDER = 'jspm.io';

/**
 * import map 插件选项：在 jspm 生成器配置之上增加调试开关、CDN 供应商与需要纳入映射的依赖清单。
 */
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

/**
 * 按供应商返回 es-module-shims 的 CDN 地址，供不支持 import map 的浏览器兜底加载。
 * @param provide - 供应商标识；取值不在表内时回落到 jspm.io。
 * @returns es-module-shims 脚本的完整 URL，版本号当前硬编码为 1.10.0。
 */
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

  // 汇总三类来源的依赖名：importmap 显式声明、inputMap.imports 与各 scope 下的键。
  const allDepNames: string[] = [
    ...(importmap?.map((item) => item.name) || []),
    ...inputMapImports,
    ...inputMapScopes,
  ];
  const depNames = new Set<string>(allDepNames);

  // 转成 jspm 的安装参数：target 是包名，range 省略时由生成器自行挑选版本。
  const installDeps = importmap?.map((item) => ({
    range: item.range,
    target: item.name,
  }));

  return [
    {
      /**
       * 记录本次构建的命令与是否 SSR，供同组插件判断是否需要介入。
       * @param _ - Vite 传入的用户配置对象，本插件不使用其内容。
       * 第二个入参由 Vite 解构传入 command 与 isSsrBuild，分别表示命令类型与是否 SSR 构建。
       */
      async config(_, { command, isSsrBuild }) {
        isBuild = command === 'build';
        isSSR = !!isSsrBuild;
      },
      enforce: 'pre',
      name: 'importmap:external',
      /**
       * 把 import map 覆盖到的依赖标记为 external，交由浏览器按映射自行加载。
       * @param id - Vite 正在解析的模块标识。
       * @returns 命中依赖名单时返回 external 标记；SSR、非构建阶段或未命中时返回 null，交给后续插件处理。
       */
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
      /**
       * 构建收尾时校验 import map 是否已生成，未生成就中止构建，避免产出缺少依赖映射的产物。
       * @throws 非 SSR 构建中 jspm 安装未成功（含安装过程本身抛错）时抛出 Error，同时打印保留的原始错误。
       */
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
        /**
         * 把 es-module-shims 与生成的 import map 注入 index.html 并压缩输出。
         * @param html - Vite 传入的 index.html 原文。
         * @returns 改写后的 HTML 与一条 type=importmap 的 script 标签；
         *   SSR、非构建阶段或没有生成映射时原样返回入参 html。
         */
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

/**
 * 把入口 script 改写为「先按需加载 es-module-shims，再导入入口模块」的内联脚本，
 * 并把改写结果移到 body 之后，供不支持 import map 的浏览器使用。
 * @param html - 待改写的 HTML 原文。
 * @param esModuleShimUrl - es-module-shims 的 CDN 地址，会被写进内联脚本。
 * @returns 改写后的 HTML；页面里没有 type=module 的 script 时返回 undefined。
 */
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
