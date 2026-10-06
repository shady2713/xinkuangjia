/**
 * vsh 子命令：用 publint 校验各包发布字段与产物是否对齐。
 *
 * 由 monorepo 维护者在 lint 阶段调用；跳过私有包，
 * 剔除依赖字段后按内容哈希复用本地缓存，只统计
 * 错误、警告与建议数量，--check 时报告但不退出进程。
 * 不负责修改 package.json，修复由包作者自行完成。
 */
import type { CAC } from 'cac';
import type { Result } from 'publint';

import { basename, dirname, join } from 'node:path';

import {
  colors,
  consola,
  ensureFile,
  findMonorepoRoot,
  generatorContentHash,
  getPackages,
  outputJSON,
  readJSON,
  UNICODE,
} from '@vben/node-utils';

import { publint } from 'publint';
import { formatMessage } from 'publint/utils';

const CACHE_FILE = join(
  'node_modules',
  '.cache',
  'publint',
  '.pkglintcache.json',
);

/** publint 子命令选项：check 为真时只报告问题，不因发现问题而退出进程。 */
interface PubLintCommandOptions {
  /**
   * Only errors are checked, no program exit is performed
   */
  check?: boolean;
}

/**
 * Get files that require lint
 * 解析要校验的 package.json 列表：显式传入时只保留文件名恰为 package.json 的项，
 * 否则取全部工作区包。
 * @param files - 命令行传入的文件路径；非 package.json 的项会被剔除。
 * @returns 待校验的 package.json 路径列表。
 */
async function getLintFiles(files: string[] = []) {
  const lintFiles: string[] = [];

  if (files?.length > 0) {
    return files.filter((file) => basename(file) === 'package.json');
  }

  const { packages } = await getPackages();

  for (const { dir } of packages) {
    lintFiles.push(join(dir, 'package.json'));
  }
  return lintFiles;
}

/** 拼出缓存文件路径：monorepo 根目录下的 node_modules/.cache/publint/.pkglintcache.json。 */
function getCacheFile() {
  const root = findMonorepoRoot();
  return join(root, CACHE_FILE);
}

/**
 * 读取 publint 结果缓存，文件不存在时先创建空文件。
 * @param cacheFile - 缓存文件的绝对路径。
 * @returns 缓存内容；读取或解析失败时返回空对象，相当于本次全部重新校验。
 */
async function readCache(cacheFile: string) {
  try {
    await ensureFile(cacheFile);
    return await readJSON(cacheFile);
  } catch {
    return {};
  }
}

/**
 * 逐包执行 publint 校验：跳过 private 包，命中缓存的包直接复用上次结果。
 * 校验前会剔除三类依赖字段，避免版本变动触发无意义的重新校验；
 * 结束时写回缓存并打印结果，check 为假时发现问题即以状态码 1 退出。
 * @param files - 命令行传入的文件路径，为空时校验全部工作区包。
 * @param options - 子命令选项，check 为真时不退出进程。
 */
async function runPublint(files: string[], { check }: PubLintCommandOptions) {
  const lintFiles = await getLintFiles(files);
  const cacheFile = getCacheFile();

  const cacheData = await readCache(cacheFile);
  const cache: Record<string, { hash: string; result: Result }> = cacheData;

  // private 包与读取失败的包都返回 null，由打印阶段按空值跳过。
  const results = await Promise.all(
    lintFiles.map(async (file) => {
      try {
        const pkgJson = await readJSON(file);

        if (pkgJson.private) {
          return null;
        }

        Reflect.deleteProperty(pkgJson, 'dependencies');
        Reflect.deleteProperty(pkgJson, 'devDependencies');
        Reflect.deleteProperty(pkgJson, 'peerDependencies');
        const content = JSON.stringify(pkgJson);
        const hash = generatorContentHash(content);

        const publintResult: Result =
          cache?.[file]?.hash === hash
            ? (cache?.[file]?.result ?? [])
            : await publint({
                level: 'suggestion',
                pkgDir: dirname(file),
                strict: true,
              });

        cache[file] = {
          hash,
          result: publintResult,
        };

        return { pkgJson, pkgPath: file, publintResult };
      } catch {
        return null;
      }
    }),
  );

  await outputJSON(cacheFile, cache);
  printResult(results, check);
}

/**
 * 打印各包的问题明细并汇总数量。
 * @param results - 各包的校验结果，null 表示该包被跳过或校验失败。
 * @param check - 为真时只报告问题，不调用 process.exit；否则发现问题即退出码 1。
 */
function printResult(
  results: Array<null | {
    pkgJson: Record<string, number | string>;
    pkgPath: string;
    publintResult: Result;
  }>,
  check?: boolean,
) {
  let errorCount = 0;
  let warningCount = 0;
  let suggestionsCount = 0;

  for (const result of results) {
    if (!result) {
      continue;
    }
    const { pkgJson, pkgPath, publintResult } = result;
    const messages = publintResult?.messages ?? [];
    if (messages?.length < 1) {
      continue;
    }

    consola.log('');
    consola.log(pkgPath);
    for (const message of messages) {
      switch (message.type) {
        case 'error': {
          errorCount++;

          break;
        }
        case 'suggestion': {
          suggestionsCount++;
          break;
        }
        case 'warning': {
          warningCount++;

          break;
        }
        // No default
      }
      const ruleUrl = `https://publint.dev/rules#${message.code.toLocaleLowerCase()}`;
      consola.log(
        `  ${formatMessage(message, pkgJson)}${colors.dim(` ${ruleUrl}`)}`,
      );
    }
  }

  const totalCount = warningCount + errorCount + suggestionsCount;
  if (totalCount > 0) {
    consola.error(
      colors.red(
        `${UNICODE.FAILURE} ${totalCount} problem (${errorCount} errors, ${warningCount} warnings, ${suggestionsCount} suggestions)`,
      ),
    );
    !check && process.exit(1);
  } else {
    consola.log(colors.green(`${UNICODE.SUCCESS} No problem`));
  }
}

/** 把 publint 子命令注册到 cac 实例上，命令名与选项在这里固定。 */
function definePubLintCommand(cac: CAC) {
  cac
    .command('publint [...files]')
    .usage('Check if the monorepo package conforms to the publint standard.')
    .option('--check', 'Only errors are checked, no program exit is performed.')
    .action(runPublint);
}

export { definePubLintCommand };
