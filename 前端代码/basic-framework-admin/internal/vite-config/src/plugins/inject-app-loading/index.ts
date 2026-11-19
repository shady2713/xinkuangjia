import type { PluginOption } from 'vite';

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 首屏暗色主题初始化外部脚本文件名（配合严格 CSP `script-src 'self'` 避免内联脚本）。 */
const THEME_INIT_FILENAME = '_app-loading-theme.js';

/** 依据运行时配置预先切换根元素 dark 类名，消除首屏亮暗闪烁。 */
const THEME_INIT_SOURCE = [
  'var configuredTheme = window._VBEN_ADMIN_PRO_APP_CONF_?.VITE_APP_THEME_MODE;',
  "var useDarkTheme = configuredTheme === 'dark' || (configuredTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);",
  "document.documentElement.classList.toggle('dark', useDarkTheme);",
].join('\n');

/** 设置开发服务器 HTTP 响应头的回调函数签名。 */
type HeaderSetter = (name: string, value: string) => void;

/** 结束开发服务器 HTTP 响应并写出正文的回调函数签名。 */
type ResponseEnder = (chunk: string) => void;

/**
 * 若当前开发请求命中外置首屏主题初始化脚本路径，则直接写出 JS 响应。
 *
 * @param reqUrl 请求原始 URL
 * @param basePath 当前站点规范化公共路径前缀
 * @param setHeader 设置响应头回调
 * @param end 结束响应并输出正文回调
 * @returns 已拦截处理返回 true，否则放行返回 false
 */
function tryServeThemeAsset(
  reqUrl: string | undefined,
  basePath: string,
  setHeader: HeaderSetter,
  end: ResponseEnder,
): boolean {
  const requestPath = reqUrl?.split('?')[0];
  if (
    requestPath !== `${basePath}${THEME_INIT_FILENAME}` &&
    requestPath !== `/${THEME_INIT_FILENAME}`
  ) {
    return false;
  }
  setHeader('Content-Type', 'application/javascript; charset=utf-8');
  end(THEME_INIT_SOURCE);
  return true;
}

/**
 * 将首屏加载动画及外置主题初始化脚本注入 index.html。
 *
 * 首屏主题只读取运行时配置，并以独立静态脚本下发以兼容禁止 inline script 的 CSP 策略。
 *
 * @param loadingTemplate 自定义加载动画模板名称
 * @returns 找到模板时返回 Vite 插件，否则返回 undefined
 */
async function viteInjectAppLoadingPlugin(
  loadingTemplate = 'loading.html',
): Promise<PluginOption | undefined> {
  const loadingHtml = await getLoadingRawByHtmlTemplate(loadingTemplate);

  if (!loadingHtml) {
    return;
  }

  let basePath = '/';

  return {
    /**
     * 记录规范化的公共路径前缀，保证开发环境和 `/admin/` 子路径构建均能命中同源外部脚本。
     *
     * @param config 已解析的 Vite 配置
     */
    configResolved(config) {
      basePath = config.base.endsWith('/') ? config.base : `${config.base}/`;
    },
    /**
     * 开发服务器直接响应主题初始化脚本，避免本地 dev 阶段 404 回退到 index.html。
     *
     * @param server Vite 开发服务器实例
     */
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (
          !tryServeThemeAsset(
            req.url,
            basePath,
            res.setHeader.bind(res),
            res.end.bind(res),
          )
        ) {
          next();
        }
      });
    },
    enforce: 'pre',
    /**
     * 构建阶段将首屏主题脚本作为独立资产输出到产物根目录。
     */
    generateBundle() {
      this.emitFile({
        fileName: THEME_INIT_FILENAME,
        source: THEME_INIT_SOURCE,
        type: 'asset',
      });
    },
    name: 'vite:inject-app-loading',
    transformIndexHtml: {
      /**
       * 在 body 开头注入外部主题初始化脚本引用与加载骨架 DOM。
       *
       * @param html 原始 HTML 字符串
       * @returns 注入外部脚本与 loading 占位后的 HTML
       */
      handler(html) {
        const re = /<body\s*>/;
        const scriptTag = `<script src="${basePath}${THEME_INIT_FILENAME}" data-app-loading="inject-js"></script>`;
        return html.replace(re, `<body>\n${scriptTag}\n${loadingHtml}`);
      },
      order: 'pre',
    },
  };
}

/**
 * 读取首屏加载动画模板。
 *
 * @param loadingTemplate 自定义模板名称
 * @returns 模板 HTML 内容
 */
async function getLoadingRawByHtmlTemplate(loadingTemplate: string) {
  let appLoadingPath = join(process.cwd(), loadingTemplate);

  if (!fs.existsSync(appLoadingPath)) {
    const dirname = fileURLToPath(new URL('.', import.meta.url));
    appLoadingPath = join(dirname, './default-loading.html');
  }

  return await fsp.readFile(appLoadingPath, 'utf8');
}

export { viteInjectAppLoadingPlugin };
