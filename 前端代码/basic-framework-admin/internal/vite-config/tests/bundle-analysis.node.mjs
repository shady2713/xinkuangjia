/** 使用真实 Rollup 输出验证体积报告的钩子顺序，不写入工程产物。 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';

import { rollup } from 'rollup';

import { bundleAnalysis } from '../src/plugins/bundle-analysis.mjs';

test('分析输出独立于生产目录', /** 核对分析模式的输出只归属当前前端缓存。 */ () => {
  const root = resolve('apps/web-ele');
  const config = bundleAnalysis(root).config();
  assert.equal(config.build.outDir, resolve('.cache/analyze'));
  assert.notEqual(config.build.outDir, resolve(root, 'dist'));
});

test('报告统计常规插件修改后的实际分块', /** 生成内存产物并核对实际 UTF-8 字节与同运行时 gzip 字节。 */ async () => {
  const bundle = await rollup({
    input: 'fixture',
    plugins: [
      bundleAnalysis(resolve('apps/web-ele')),
      {
        name: 'test:final-output',
        /**
         * 只接管私有虚拟模块，不加载文件系统。
         * @param id - 待解析标识。
         * @returns 虚拟模块标识或空值。
         */
        resolveId(id) {
          return id === 'fixture' ? id : null;
        },
        /**
         * 为虚拟入口提供含中文的有效代码。
         * @returns 内存中的入口源码。
         */
        load() {
          return 'export const text = "中文体积";';
        },
        /**
         * 模拟分析插件之后的常规钩子追加代码。
         * @param options - 当前输出配置。
         * @param output - 可变分块集合。
         */
        generateBundle(options, output) {
          for (const item of Object.values(output)) {
            if (item.type === 'chunk') item.code += '\n/* 最终附加内容 */';
          }
        },
      },
    ],
  });
  try {
    const { output } = await bundle.generate({ format: 'es' });
    const chunk = output.find(
      /** 选取唯一 JavaScript 入口。 */ (item) => item.type === 'chunk',
    );
    const report = output.find(
      /** 选取生成的 JSON 报告。 */ (item) =>
        item.fileName === '构建体积报告.json',
    );
    const data = JSON.parse(report.source);
    assert.equal(data.chunks.length, 1);
    assert.equal(data.chunks[0].bytes, Buffer.byteLength(chunk.code));
    assert.equal(data.chunks[0].gzipBytes, gzipSync(chunk.code).length);
    assert.ok(data.chunks[0].modules.length > 0);
  } finally {
    await bundle.close();
  }
});
