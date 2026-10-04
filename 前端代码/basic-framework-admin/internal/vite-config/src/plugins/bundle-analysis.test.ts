/**
 * analyze 构建体积报告插件（internal/vite-config 的 bundle-analysis）真实行为回归。
 *
 * 该插件只在分析构建启用，但报告数字被用于定位体积问题：分块字节若按字符串长度而不是
 * UTF-8 字节统计会低估中文产物，gzip、模块归属与排序写错会让排名误导优化方向，资产文件
 * 混进分块列表会让报告出现并不存在的“分块”。用例用真实 gzip 压缩、真实 Buffer 字节数与
 * 真实 Bundle 结构驱动插件钩子，只替代 Rollup 的输出宿主，不替代统计本身。
 */
import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import { bundleAnalysis } from './bundle-analysis.mjs';

/** 被测插件收到的应用根目录；模块归属按它的上两级（前端工程根）计算。 */
const APP_ROOT = '/repo/前端代码/basic-framework-admin/apps/web-ele';

/** Rollup 分块在报告里保留的字段；其余字段不参与统计。 */
interface ChunkLike {
  /** 分块内容，字节数与 gzip 字节都由它真实计算。 */
  code: string;
  /** 当前产物中的文件名。 */
  fileName: string;
  /** 模块标识到渲染元数据的映射。 */
  modules: Record<string, { renderedLength: number }>;
  /** Rollup 输出条目类型，只有 chunk 进入分块报告。 */
  type: string;
}

/** 报告 JSON 的分块记录。 */
interface ReportChunk {
  /** 分块 UTF-8 字节数。 */
  bytes: number;
  /** 分块文件名。 */
  file: string;
  /** 分块 gzip 后的字节数。 */
  gzipBytes: number;
  /** 该分块包含的模块记录。 */
  modules: { module: string; renderedLength: number }[];
}

/** 报告 JSON 顶层结构。 */
interface Report {
  /** 报告版本号，消费方按它判断字段口径。 */
  chunks: ReportChunk[];
  /** 报告格式版本。 */
  format: number;
}

/** 插件 emitFile 收到的资产；只关心报告文件名与正文。 */
interface EmittedAsset {
  /** 产物文件名。 */
  fileName: string;
  /** 产物正文。 */
  source: string;
  /** 产物类型。 */
  type: string;
}

/**
 * 把插件钩子输出的资产按文件名收集起来。
 * @returns 收集数组与可传给插件 `this` 的最小宿主。
 */
function createEmitHost() {
  const emitted: EmittedAsset[] = [];
  return {
    emitted,
    host: {
      /**
       * 记录插件写入的产物，模拟 Rollup 的输出宿主。
       * @param asset 插件提交的资产。
       */
      emitFile(asset: EmittedAsset) {
        emitted.push(asset);
      },
    },
  };
}

/**
 * 按文件名取出插件写入的报告资产，避免依赖 emit 顺序。
 * @param emitted 插件写入的全部资产。
 * @param fileName 期望的报告文件名。
 * @returns 该文件名的资产。
 * @throws Error 报告缺失时抛出，避免用例静默通过。
 */
function findAsset(emitted: EmittedAsset[], fileName: string) {
  const asset = emitted.find(
    /** 按报告文件名匹配插件写入的产物。 */ (item) =>
      item.fileName === fileName,
  );
  if (!asset) {
    throw new Error(`插件未输出 ${fileName}`);
  }
  return asset;
}

/**
 * 构造带多字节内容的分块，用于区分 UTF-8 字节数与字符串长度。
 * @param fileName 分块文件名。
 * @param code 分块内容。
 * @param modules 模块标识与渲染长度。
 * @returns 可放入 Bundle 的分块条目。
 */
function chunk(
  fileName: string,
  code: string,
  modules: Record<string, { renderedLength: number }>,
): ChunkLike {
  return { code, fileName, modules, type: 'chunk' };
}

describe('分析插件装配', /** 插件名与输出目录决定分析构建是否覆盖生产 dist。 */ () => {
  it('暴露分析钩子并使用独立输出目录', /** 覆盖 production dist 会破坏生产产物，钩子顺序错会统计到未完成的产物。 */ () => {
    const plugin = bundleAnalysis(APP_ROOT);

    expect(plugin.name).toBe('weetion:bundle-analysis');
    expect(plugin.config()).toEqual({
      build: {
        emptyOutDir: true,
        outDir: resolve(APP_ROOT, '../../.cache/analyze'),
      },
    });
    expect(plugin.generateBundle.order).toBe('post');
    expect(typeof plugin.generateBundle.handler).toBe('function');
  });
});

describe('分块体积统计', /** 字节、gzip 与模块归属是体积报告的全部事实来源。 */ () => {
  it('按 UTF-8 字节与真实 gzip 结果统计分块', /** 用字符串长度代替字节会低估中文产物，gzip 填错会让压缩收益失真。 */ () => {
    const code = 'export const 名称 = "构建体积报告";\n';
    const { emitted, host } = createEmitHost();
    const plugin = bundleAnalysis(APP_ROOT);

    plugin.generateBundle.handler.call(
      host,
      {},
      {
        'js/index.js': chunk('js/index.js', code, {
          [`${APP_ROOT}/src/main.ts`]: { renderedLength: 42 },
          '\0virtual:runtime': { renderedLength: 7 },
        }),
      },
    );

    const report = JSON.parse(
      findAsset(emitted, '构建体积报告.json').source,
    ) as Report;

    expect(report.format).toBe(1);
    expect(report.chunks).toHaveLength(1);
    expect(report.chunks[0]?.file).toBe('js/index.js');
    // 中文内容按 UTF-8 字节统计，字符串长度会明显偏小。
    expect(report.chunks[0]?.bytes).toBe(Buffer.byteLength(code));
    expect(report.chunks[0]?.bytes).toBeGreaterThan(code.length);
    expect(report.chunks[0]?.gzipBytes).toBe(gzipSync(code).length);
    expect(report.chunks[0]?.modules).toEqual([
      { module: 'apps/web-ele/src/main.ts', renderedLength: 42 },
      // 虚拟模块的 NUL 前缀必须剥离，否则报告里的模块名不可读。
      { module: expect.stringContaining('virtual:runtime'), renderedLength: 7 },
    ]);
    expect(report.chunks[0]?.modules[1]?.module).not.toContain('\0');
  });

  it('忽略资产条目且分块按字节降序排列', /** 资产混入分块会虚报分块数量，排序错误会让优化目标看错对象。 */ () => {
    const smallCode = 'a';
    const largeCode = '中'.repeat(200);
    const { emitted, host } = createEmitHost();
    const plugin = bundleAnalysis(APP_ROOT);

    plugin.generateBundle.handler.call(host, {}, {
      'assets/logo.svg': {
        fileName: 'assets/logo.svg',
        source: '<svg></svg>',
        type: 'asset',
      },
      'js/large.js': chunk('js/large.js', largeCode, {}),
      'js/small.js': chunk('js/small.js', smallCode, {}),
    } as never);

    const report = JSON.parse(
      findAsset(emitted, '构建体积报告.json').source,
    ) as Report;

    expect(
      report.chunks.map(
        /** 取出分块文件名，核对按字节降序后的顺序。 */ (item) => item.file,
      ),
    ).toEqual(['js/large.js', 'js/small.js']);
    expect(report.chunks[0]?.bytes).toBeGreaterThan(
      report.chunks[1]?.bytes ?? 0,
    );
  });

  it('输出与排序一致的中文 Markdown 排名表', /** 报告正文与 JSON 不一致会让评审依据两份互相矛盾的数字。 */ () => {
    const { emitted, host } = createEmitHost();
    const plugin = bundleAnalysis(APP_ROOT);

    plugin.generateBundle.handler.call(host, {}, {
      'js/big.js': chunk('js/big.js', 'let a = 1;', {
        [`${APP_ROOT}/src/big.ts`]: { renderedLength: 5 },
      }),
      'js/small.js': chunk('js/small.js', 'x', {
        [`${APP_ROOT}/src/small.ts`]: { renderedLength: 1 },
      }),
    } as never);

    const markdown = findAsset(emitted, '构建体积报告.md').source;

    expect(markdown).toContain('# 构建体积报告');
    expect(markdown).toContain('## 分块排名');
    expect(markdown).toContain('| 文件 | 字节 | gzip 字节 | 模块数 |');
    expect(markdown).toContain(
      `| js/big.js | ${Buffer.byteLength('let a = 1;')} | ${gzipSync('let a = 1;').length} | 1 |`,
    );
    expect(markdown.indexOf('js/big.js')).toBeLessThan(
      markdown.indexOf('js/small.js'),
    );
    expect(markdown).toContain('## 开发笔记');
    expect(markdown.endsWith('\n')).toBe(true);
  });

  it('空 Bundle 也输出两份结构与表头完整的报告', /** 空产物直接崩溃会让分析构建无法完成。 */ () => {
    const { emitted, host } = createEmitHost();
    const plugin = bundleAnalysis(APP_ROOT);

    expect(
      /** 以空 Bundle 真实调用一次插件钩子。 */ () =>
        plugin.generateBundle.handler.call(host, {}, {} as never),
    ).not.toThrow();

    const report = JSON.parse(
      findAsset(emitted, '构建体积报告.json').source,
    ) as Report;
    const markdown = findAsset(emitted, '构建体积报告.md').source;

    expect(report.chunks).toEqual([]);
    expect(markdown).toContain('| 文件 | 字节 | gzip 字节 | 模块数 |');
    expect(emitted).toHaveLength(2);
    expect(
      emitted.every(
        /** 核对每个产物都以资产类型写入。 */ (asset) => asset.type === 'asset',
      ),
    ).toBe(true);
  });

  it('不修改传入的 Bundle 内容', /** 统计行为若改写输出集合会破坏真实构建结果。 */ () => {
    const bundle = {
      'js/index.js': chunk('js/index.js', 'let a = 1;', {
        [`${APP_ROOT}/src/main.ts`]: { renderedLength: 1 },
      }),
    };
    const snapshot = structuredClone(bundle);
    const { host } = createEmitHost();
    const plugin = bundleAnalysis(APP_ROOT);

    plugin.generateBundle.handler.call(host, {}, bundle as never);

    expect(bundle).toEqual(snapshot);
  });
});

describe('报告写入次数', /** 重复写入或漏写会让消费方拿到旧报告。 */ () => {
  it('每次调用恰好写入 JSON 与 Markdown 各一份', /** 多写会覆盖同名产物，漏写会让报告缺失。 */ () => {
    const host = { emitFile: vi.fn() };
    const plugin = bundleAnalysis(APP_ROOT);

    plugin.generateBundle.handler.call(host, {}, {} as never);

    expect(host.emitFile).toHaveBeenCalledTimes(2);
    const fileNames = host.emitFile.mock.calls.map(
      /** 取出本次写入的产物文件名。 */ (call) => call[0].fileName,
    );
    expect(fileNames.toSorted()).toEqual([
      '构建体积报告.json',
      '构建体积报告.md',
    ]);
  });
});
