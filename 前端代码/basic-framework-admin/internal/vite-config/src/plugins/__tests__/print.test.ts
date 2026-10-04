/**
 * Vite 启动信息打印插件（vite-config 的 plugins/print）的真实行为回归。
 *
 * 该插件包装开发服务器的 printUrls，在原始地址之后追加部署提示（例如管理端入口）：
 * 包装顺序写错会丢掉 Vite 自己的本地地址，infoMap 遍历写错会漏印或多印提示行。
 * 用例用真实插件对象驱动一个只记录调用的服务器替身，断言调用顺序与逐行输出内容。
 *
 * 颜色工具只替换为原样返回文本的实现：断言因此不依赖 ANSI 转义，也避免经构建产物
 * （dist 的 jiti 装载）再次加载整个工具包源码，使同一源码出现两套不兼容的语句映射。
 */
import { describe, expect, it, vi } from 'vitest';

import { vitePrintPlugin } from '../print';

vi.mock(
  '@vben/node-utils',
  /** 只替换颜色输出边界，插件自身的包装与遍历逻辑保持真实实现。 */ () => {
    /** 原样返回文本，使期望值不包含 ANSI 转义序列。 */
    const identity = (value: string) => value;
    return { colors: { bold: identity, cyan: identity, green: identity } };
  },
);

/** 开发服务器替身中本用例需要驱动的字段。 */
type PrintServer = {
  /** 服务器原有的地址打印入口；插件必须保留它并在其后追加提示。 */
  printUrls: () => void;
};

/** 插件对象中本用例需要驱动的字段；Vite 的联合返回类型此处按实际结构收窄。 */
type PrintPlugin = {
  /** 安装到开发服务器上的钩子，本用例只驱动它替换 printUrls 的行为。 */
  configureServer: (server: PrintServer) => void;
  /** 插件执行时机标记。 */
  enforce?: string;
  /** 插件名称，用于 Vite 内部识别与用户排查。 */
  name?: string;
};

/** 建立只记录调用的开发服务器替身，避免启动真实 Vite。 */
function createServer() {
  const printUrls = vi.fn();
  return { printUrls, server: { printUrls } };
}

describe('vitePrintPlugin', /** 原始地址打印与自定义信息行的顺序和内容。 */ () => {
  it('保留 Vite 自身的地址打印并追加部署提示行', /** 丢掉原始 printUrls 会让开发者看不到本地访问地址。 */ () => {
    const log = vi
      .spyOn(console, 'log')
      .mockImplementation(/** 静默预期内的输出，避免污染测试结果。 */ () => {});
    const { printUrls, server } = createServer();
    const plugin = vitePrintPlugin({
      infoMap: { 'Admin UI': 'http://127.0.0.1:5173/admin/' },
    }) as PrintPlugin;

    plugin.configureServer(server);
    server.printUrls();

    expect(printUrls).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      '  ->  Admin UI: http://127.0.0.1:5173/admin/',
    );

    log.mockRestore();
  });

  it('按配置顺序逐行输出多条提示', /** 多条提示漏印会让部分入口地址不可见。 */ () => {
    const log = vi
      .spyOn(console, 'log')
      .mockImplementation(/** 静默预期内的输出，避免污染测试结果。 */ () => {});
    const { printUrls, server } = createServer();
    const plugin = vitePrintPlugin({
      infoMap: {
        'Admin UI': 'http://127.0.0.1:5173/admin/',
        Docs: 'http://127.0.0.1:5173/docs/',
      },
    }) as PrintPlugin;

    plugin.configureServer(server);
    server.printUrls();

    expect(printUrls).toHaveBeenCalledTimes(1);
    expect(
      log.mock.calls.map(/** 逐行取出实际打印的提示文本。 */ (call) => call[0]),
    ).toEqual([
      '  ->  Admin UI: http://127.0.0.1:5173/admin/',
      '  ->  Docs: http://127.0.0.1:5173/docs/',
    ]);

    log.mockRestore();
  });

  it('未配置提示时只保留 Vite 自身的地址打印', /** 缺省配置不能引入空输出或额外空行。 */ () => {
    const log = vi
      .spyOn(console, 'log')
      .mockImplementation(/** 静默预期内的输出，避免污染测试结果。 */ () => {});
    const { printUrls, server } = createServer();
    const plugin = vitePrintPlugin() as PrintPlugin;

    plugin.configureServer(server);
    server.printUrls();

    expect(printUrls).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();

    log.mockRestore();
  });

  it('插件标识固定为 vite:print-info 且前置执行', /** 名称或时机被改动会让 Vite 无法按预期顺序安装该钩子。 */ () => {
    const plugin = vitePrintPlugin() as PrintPlugin;

    expect(plugin.name).toBe('vite:print-info');
    expect(plugin.enforce).toBe('pre');
  });
});
