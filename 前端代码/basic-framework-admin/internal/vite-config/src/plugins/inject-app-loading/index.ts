import type { PluginOption } from 'vite';

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 将首屏加载动画注入 index.html。
 *
 * 首屏主题只读取运行时配置，不再读取浏览器本地偏好缓存。
 *
 * @param loadingTemplate 自定义加载动画模板名称
 * @returns 找到模板时返回 Vite 插件，否则返回 undefined
 */
async function viteInjectAppLoadingPlugin(
  loadingTemplate = 'loading.html',
): Promise<PluginOption | undefined> {
  const loadingHtml = await getLoadingRawByHtmlTemplate(loadingTemplate);

  const injectScript = `
  <script data-app-loading="inject-js">
  var configuredTheme = window._VBEN_ADMIN_PRO_APP_CONF_?.VITE_APP_THEME_MODE;
  var useDarkTheme = configuredTheme === 'dark' ||
    (configuredTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', useDarkTheme);
</script>
`;

  if (!loadingHtml) {
    return;
  }

  return {
    enforce: 'pre',
    name: 'vite:inject-app-loading',
    transformIndexHtml: {
      handler(html) {
        const re = /<body\s*>/;
        return html.replace(re, `<body>${injectScript}${loadingHtml}`);
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
