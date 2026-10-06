/**
 * 产物归档插件：构建收尾时把 dist 目录压缩成 ZIP，
 * 落到 outputDir 下的 name.zip，默认是工程根目录的 dist.zip。
 *
 * 只在 build 阶段生效，压缩失败只打印错误、不中断构建；
 * 也不负责上传与部署，需要 ZIP 产物的构建方自行装载。
 */
import type { PluginOption } from 'vite';

import type { ArchiverPluginOptions } from '../typing.ts';

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { join } from 'node:path';

import archiver from 'archiver';

/**
 * 产物归档插件：在 closeBundle 阶段把 dist 目录压缩成 ZIP。
 * 压缩被推迟到下一个事件循环执行，失败只打印错误，不影响本次构建结果。
 * @param options - 归档选项；name 默认 dist，outputDir 默认工程根目录。
 * @returns 仅在 build 阶段生效的 Vite 插件。
 */
export const viteArchiverPlugin = (
  options: ArchiverPluginOptions = {},
): PluginOption => {
  return {
    apply: 'build',
    closeBundle: {
      /**
       * 推迟到当前事件循环之后启动压缩，让 Vite 先把产物写完；失败只打印错误。
       */
      handler() {
        const { name = 'dist', outputDir = '.' } = options;

        setTimeout(async () => {
          const folderToZip = 'dist';

          const zipOutputDir = join(process.cwd(), outputDir);
          const zipOutputPath = join(zipOutputDir, `${name}.zip`);
          try {
            await fsp.mkdir(zipOutputDir, { recursive: true });
          } catch {
            // ignore
          }

          try {
            await zipFolder(folderToZip, zipOutputPath);
            console.log(`Folder has been zipped to: ${zipOutputPath}`);
          } catch (error) {
            console.error('Error zipping folder:', error);
          }
        }, 0);
      },
      order: 'post',
    },
    enforce: 'post',
    name: 'vite:archiver',
  };
};

/**
 * 以流的方式把目录压缩为 ZIP。
 * @param folderPath - 待压缩的目录路径，相对进程工作目录解析。
 * @param outputPath - ZIP 的输出路径，父目录需已存在。
 * @returns 输出流关闭后 resolve；归档器报错时 reject 原始错误。
 */
async function zipFolder(
  folderPath: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', {
      zlib: { level: 9 }, // 设置压缩级别为 9 以实现最高压缩率
    });

    output.on('close', () => {
      console.log(
        `ZIP file created: ${outputPath} (${archive.pointer()} total bytes)`,
      );
      resolve();
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    // 使用 directory 方法以流的方式压缩文件夹，减少内存消耗
    archive.directory(folderPath, false);

    // 流式处理完成
    archive.finalize();
  });
}
