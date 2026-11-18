import type { CAC } from 'cac';

import { extname } from 'node:path';

import { getStagedFiles } from '@vben/node-utils';

import { circularDepsDetect } from 'circular-dependency-scanner';

const DEFAULT_CONFIG = {
  allowedExtensions: ['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx', '.vue'],
  ignoreDirs: ['dist', 'output', 'scripts', 'internal', 'menu-ui/src'],
  threshold: 0,
} as const;

/** 单条循环依赖涉及的模块路径列表。 */
type CircularDependencyResult = string[];

interface CheckCircularConfig {
  allowedExtensions?: string[];
  ignoreDirs?: string[];
  threshold?: number;
}

interface CommandOptions {
  config?: CheckCircularConfig;
  staged: boolean;
  verbose: boolean;
}

const cache = new Map<string, CircularDependencyResult[]>();

/**
 * 格式化输出检测到的运行时循环依赖链路。
 *
 * @param circles 循环依赖结果集合
 */
function formatCircles(circles: CircularDependencyResult[]): void {
  if (circles.length === 0) {
    console.log('[OK] No circular dependencies found');
    return;
  }

  console.error('[ERROR] Circular dependencies found:');
  circles.forEach((circle, index) => {
    console.error(`\nCircular dependency #${index + 1}:`);
    circle.forEach((file) => console.error(`  -> ${file}`));
  });
}

/**
 * 扫描项目运行时循环依赖（忽略纯 TypeScript 类型引用），超出阈值时将进程退出码设为 1。
 *
 * @param options 检查配置对象
 * @param options.config 循环依赖目录忽略与阈值配置
 * @param options.staged 是否仅检查 Git 暂存区关联文件
 * @param options.verbose 是否打印详细链路
 */
async function checkCircular({
  config = {},
  staged,
  verbose,
}: CommandOptions): Promise<void> {
  try {
    const finalConfig = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    const ignorePatterns = finalConfig.ignoreDirs
      .map((dir) => dir.replaceAll('\\', '/').replaceAll(/^\/+|\/+$/gu, ''))
      .filter(Boolean)
      .map((dir) => `**/${dir}/**`);
    const cacheKey = `${staged}-${process.cwd()}-${ignorePatterns.join('|')}`;
    if (cache.has(cacheKey)) {
      const cachedResults = cache.get(cacheKey) ?? [];
      verbose && formatCircles(cachedResults);
      if (cachedResults.length > finalConfig.threshold) {
        process.exitCode = 1;
      }
      return;
    }

    const results = await circularDepsDetect({
      absolute: staged,
      cwd: process.cwd(),
      excludeTypes: true,
      ignore: ignorePatterns,
    });

    let detectedCircles = results;
    if (staged) {
      let files = await getStagedFiles();
      const allowedExtensions = new Set(finalConfig.allowedExtensions);
      files = files.filter((file) => allowedExtensions.has(extname(file)));

      const circularFiles: CircularDependencyResult[] = [];
      for (const file of files) {
        for (const result of results) {
          if (result.flat().includes(file)) {
            circularFiles.push(result);
          }
        }
      }
      detectedCircles = circularFiles;
    }

    cache.set(cacheKey, detectedCircles);
    verbose && formatCircles(detectedCircles);

    if (detectedCircles.length > finalConfig.threshold) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      '[ERROR] Failed to check circular dependencies:',
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  }
}

/**
 * 注册 `vsh check-circular` 子命令。
 *
 * @param cac CAC 命令行实例
 */
function defineCheckCircularCommand(cac: CAC): void {
  cac
    .command('check-circular')
    .option('--staged', 'Only check staged files')
    .option('--verbose', 'Show detailed information')
    .option('--threshold <number>', 'Threshold for circular dependencies', {
      default: 0,
    })
    .option('--ignore-dirs <dirs>', 'Directories to ignore, comma separated')
    .usage('Analyze project circular dependencies')
    .action(async ({ ignoreDirs, staged, threshold, verbose }) => {
      const config: CheckCircularConfig = {
        threshold: Number(threshold),
        ...(ignoreDirs && { ignoreDirs: ignoreDirs.split(',') }),
      };

      await checkCircular({
        config,
        staged,
        verbose: verbose ?? true,
      });
    });
}

export { type CheckCircularConfig, defineCheckCircularCommand };
