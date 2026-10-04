/** 为 analyze 构建生成分块实测体积和模块渲染长度报告，生产模式不加载。 */
import { Buffer } from 'node:buffer';
import { relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * 构造当前应用的离线体积报告插件，不生成或公开 sourcemap。
 * @param {string} root - 当前应用根目录。
 * @returns 仅在分析构建启用的 Vite 插件。
 */
export function bundleAnalysis(root) {
  return {
    name: 'weetion:bundle-analysis',
    /**
     * 分析产物独立写入缓存，避免覆盖 production 的 dist。
     * @returns 分析模式专用输出配置。
     */
    config() {
      return {
        build: {
          outDir: resolve(root, '../../.cache/analyze'),
          emptyOutDir: true,
        },
      };
    },
    generateBundle: {
      // 在 Vite 导入预加载等常规输出钩子完成后统计最终内容。
      /** @type {'post'} */
      order: 'post',
      /**
       * 读取实际输出和模块信息，字节与渲染长度分别保存，不混淆两种口径。
       * @param options - Rollup 输出配置，报告不修改其内容。
       * @param bundle - 当前完整输出集合。
       */
      handler(options, bundle) {
        const chunks = [];
        for (const item of Object.values(bundle)) {
          if (item.type !== 'chunk') continue;
          const modules = Object.entries(item.modules).map(
            /**
             * 将模块标识归属到当前工程并保留 Rollup 渲染长度。
             * @param entry - 模块标识与渲染元数据。
             * @returns 不带源码正文的模块记录。
             */ (entry) => ({
              module: relative(
                resolve(root, '../..'),
                entry[0].replaceAll('\0', ''),
              ).replaceAll('\\', '/'),
              renderedLength: entry[1].renderedLength,
            }),
          );
          chunks.push({
            file: item.fileName,
            bytes: Buffer.byteLength(item.code),
            gzipBytes: gzipSync(item.code).length,
            modules,
          });
        }
        chunks.sort(
          /**
           * 按最终分块字节从大到小排序。
           * @param a - 第一个分块。
           * @param b - 第二个分块。
           * @returns 字节数降序的比较结果。
           */ (a, b) => b.bytes - a.bytes,
        );
        this.emitFile({
          type: 'asset',
          fileName: '构建体积报告.json',
          source: JSON.stringify({ format: 1, chunks }, null, 2),
        });
        const lines = [
          '# 构建体积报告',
          '',
          '## 摘要',
          '',
          'bytes 为分块实际 UTF-8 字节，gzipBytes 为单块 gzip 字节；模块 renderedLength 仅用于定位组成，不等于压缩占比或加载耗时。',
          '',
          '-----',
          '',
          '## 分块排名',
          '',
          '| 文件 | 字节 | gzip 字节 | 模块数 |',
          '| --- | ---: | ---: | ---: |',
        ];
        for (const chunk of chunks) {
          lines.push(
            `| ${chunk.file} | ${chunk.bytes} | ${chunk.gzipBytes} | ${chunk.modules.length} |`,
          );
        }
        lines.push(
          '',
          '-----',
          '',
          '## 开发笔记',
          '',
          '<details>',
          '<summary>模块明细</summary>',
          '',
          '同目录 JSON 保存各模块的渲染长度；这里只统计 JavaScript 分块，不包含复制到 public 的静态文件。',
          '',
          '</details>',
          '',
        );
        this.emitFile({
          type: 'asset',
          fileName: '构建体积报告.md',
          source: lines.join('\n'),
        });
      },
    },
  };
}
