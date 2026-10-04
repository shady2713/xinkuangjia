// @vitest-environment node
/**
 * 首屏加载动画注入插件（vite-config 的 plugins/inject-app-loading）真实行为回归。
 *
 * 该插件在 HTML 处理阶段把主题引导脚本与加载模板插到 `<body>` 之后：找不到模板会让
 * 首屏白屏，注入位置写错会让样式出现在 `head` 之外，默认模板回落写错会让没有自带模板的
 * 应用拿不到加载动画。用例用独立临时工作目录准备自定义模板、空模板与缺失模板三种输入，
 * 驱动真实插件的 `transformIndexHtml` 并断言注入结果的结构与内容。
 *
 * 模板按 `process.cwd()` 解析，因此用例真实切换工作目录；用例结束后恢复原目录，避免影响
 * 同进程的其它用例。
 */
import type { PluginOption } from 'vite';

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { viteInjectAppLoadingPlugin } from '../index';

/** 插件对象中本用例需要驱动的字段；Vite 的联合返回类型此处按真实结构收窄。 */
interface InjectAppLoadingPlugin {
  /** 插件执行时机标记。 */
  enforce?: string;
  /** 插件名称。 */
  name?: string;
  /** HTML 处理钩子，真实实现是带 order 的对象形式。 */
  transformIndexHtml?: {
    /** 把主题脚本与加载模板插到 body 之后。 */
    handler: (html: string) => string;
    /** 钩子执行顺序。 */
    order?: string;
  };
}

/** 进入临时目录前的真实工作目录，用于恢复共享的进程状态。 */
let previousCwd: string;
/** 本用例独占的临时工作目录。 */
let workspace: string;

/**
 * 取出真实插件对象。
 * @param loadingTemplate 自定义加载模板名称，省略时使用默认模板名。
 * @returns 可直接驱动 HTML 钩子的插件对象。
 * @throws 找到模板却没有返回插件时报告契约变化。
 */
async function getPlugin(loadingTemplate?: string) {
  const plugin = await viteInjectAppLoadingPlugin(loadingTemplate);
  if (!plugin) {
    throw new Error('存在加载模板时必须返回插件');
  }
  return plugin as InjectAppLoadingPlugin;
}

/**
 * 通过真实钩子处理一段 HTML。
 * @param plugin 待驱动的插件对象。
 * @param html 待处理的 index.html 文本。
 * @returns 注入后的 HTML。
 * @throws 插件没有按契约暴露 handler 时报告结构变化。
 */
function transform(plugin: InjectAppLoadingPlugin, html: string) {
  const handler = plugin.transformIndexHtml?.handler;
  if (typeof handler !== 'function') {
    throw new TypeError('transformIndexHtml 必须暴露 handler');
  }
  return handler(html);
}

beforeEach(
  /** 每例在独立临时目录中运行，互不共享模板文件。 */ () => {
    previousCwd = process.cwd();
    workspace = mkdtempSync(join(tmpdir(), 'vite-app-loading-'));
    process.chdir(workspace);
  },
);

afterEach(
  /** 恢复真实工作目录并回收临时目录，避免影响后续用例。 */ () => {
    process.chdir(previousCwd);
    rmSync(workspace, { force: true, recursive: true });
  },
);

describe('viteInjectAppLoadingPlugin', /** 加载模板解析与 HTML 注入契约。 */ () => {
  it('按传入模板名注入主题脚本与模板内容', /** 模板名被忽略或注入位置错误会让首屏动画不生效。 */ async () => {
    const template = '<div id="custom-loading">加载中</div>';
    writeFileSync(join(workspace, 'custom-loading.html'), template);
    const plugin = await getPlugin('custom-loading.html');

    const html = transform(plugin, '<html><head></head><body></body></html>');

    expect(plugin.name).toBe('vite:inject-app-loading');
    expect(plugin.enforce).toBe('pre');
    expect(plugin.transformIndexHtml?.order).toBe('pre');
    // 注入脚本自带缩进换行，这里只锁定它紧跟 `<body>` 之后的第一段内容。
    expect(html).toMatch(
      /^<html><head><\/head><body>\s*<script data-app-loading="inject-js">/,
    );
    expect(html.endsWith(`${template}</body></html>`)).toBe(true);
    // 主题脚本必须留在加载模板之前，先定暗色再渲染动画，避免首屏闪白。
    expect(html.indexOf('</script>')).toBeLessThan(html.indexOf(template));
    expect(html).toContain(
      'var configuredTheme = window._VBEN_ADMIN_PRO_APP_CONF_?.VITE_APP_THEME_MODE;',
    );
    expect(html).toContain(
      "matchMedia('(prefers-color-scheme: dark)').matches",
    );
    expect(html).toContain(
      "document.documentElement.classList.toggle('dark', useDarkTheme);",
    );
  });

  it('body 标签带属性时不注入', /** 正则只匹配裸 `<body>`；应用给 body 加属性会静默丢失首屏加载动画。 */ async () => {
    writeFileSync(join(workspace, 'loading.html'), '<div>加载中</div>');
    const plugin = await getPlugin();

    const html = transform(plugin, '<html><body class="app"></body></html>');

    expect(html).toBe('<html><body class="app"></body></html>');
  });

  it('工作目录没有模板时回落到内置默认模板', /** 回落失效会让没有自带模板的应用首屏白屏。 */ async () => {
    const plugin = await getPlugin();

    const html = transform(plugin, '<body></body>');
    const defaultTemplate = readFileSync(
      fileURLToPath(new URL('../default-loading.html', import.meta.url)),
      'utf8',
    );

    expect(html).toContain('data-app-loading="inject-css"');
    expect(html).toContain('id="__app-loading__"');
    expect(html).toContain(defaultTemplate);
  });

  it('模板内容为空时不安装插件', /** 空模板会让注入结果缺少加载动画，必须显式判定为无模板。 */ async () => {
    writeFileSync(join(workspace, 'loading.html'), '');
    const plugin: PluginOption | undefined = await viteInjectAppLoadingPlugin();

    expect(plugin).toBeUndefined();
  });
});
