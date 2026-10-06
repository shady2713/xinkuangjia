/**
 * vsh check-dep 子命令：对每个 workspace 包运行 depcheck，列出缺失依赖以及未被引用的
 * dependencies、devDependencies。
 *
 * 默认忽略 @vben/* 内部包和构建工具链依赖；只输出报告，不自动改写 package.json，
 * 出错时打印信息但不设置失败退出码。
 */
import type { CAC } from 'cac';

import { getPackages } from '@vben/node-utils';

import depcheck from 'depcheck';

// 默认配置
const DEFAULT_CONFIG = {
  // 需要忽略的依赖匹配
  ignoreMatches: [
    'vite',
    'vitest',
    'unbuild',
    '@vben/tsconfig',
    '@vben/vite-config',
    '@vben/tailwind-config',
    '@types/*',
    '@vben-core/design',
  ],
  // 需要忽略的包
  ignorePackages: [
    '@vben/commitlint-config',
    '@vben/eslint-config',
    '@vben/node-utils',
    '@vben/prettier-config',
    '@vben/stylelint-config',
    '@vben/tailwind-config',
    '@vben/tsconfig',
    '@vben/vite-config',
    '@vben/vsh',
  ],
  // 需要忽略的文件模式
  ignorePatterns: ['dist', 'node_modules', 'public'],
};

/** depcheck 的检查结果：未使用的依赖、未使用的开发依赖，以及缺失依赖到引用文件的映射。 */
interface DepcheckResult {
  dependencies: string[];
  devDependencies: string[];
  missing: Record<string, string[]>;
}

/** depcheck 配置：需要放行的依赖名、需要忽略的包与需要忽略的文件模式。 */
interface DepcheckConfig {
  ignoreMatches?: string[];
  ignorePackages?: string[];
  ignorePatterns?: string[];
}

/** 待检查的包：所在目录与 package.json 中的包名。 */
interface PackageInfo {
  dir: string;
  packageJson: {
    name: string;
  };
}

/**
 * 清理依赖检查结果
 * @param unused - 依赖检查结果
 */
function cleanDepcheckResult(unused: DepcheckResult): void {
  // 删除file:前缀的依赖提示，该依赖是本地依赖
  Reflect.deleteProperty(unused.missing, 'file:');

  // 清理路径依赖
  Object.keys(unused.missing).forEach((key) => {
    unused.missing[key] = (unused.missing[key] || []).filter(
      (item: string) => !item.startsWith('/'),
    );
    if (unused.missing[key].length === 0) {
      Reflect.deleteProperty(unused.missing, key);
    }
  });
}

/**
 * 格式化依赖检查结果
 * @param pkgName - 包名
 * @param unused - 依赖检查结果
 */
function formatDepcheckResult(pkgName: string, unused: DepcheckResult): void {
  const hasIssues =
    Object.keys(unused.missing).length > 0 ||
    unused.dependencies.length > 0 ||
    unused.devDependencies.length > 0;

  if (!hasIssues) {
    return;
  }

  console.log('\n📦 Package:', pkgName);

  if (Object.keys(unused.missing).length > 0) {
    console.log('❌ Missing dependencies:');
    Object.entries(unused.missing).forEach(([dep, files]) => {
      console.log(`  - ${dep}:`);
      files.forEach((file) => console.log(`    → ${file}`));
    });
  }

  if (unused.dependencies.length > 0) {
    console.log('⚠️ Unused dependencies:');
    unused.dependencies.forEach((dep) => console.log(`  - ${dep}`));
  }

  if (unused.devDependencies.length > 0) {
    console.log('⚠️ Unused devDependencies:');
    unused.devDependencies.forEach((dep) => console.log(`  - ${dep}`));
  }
}

/**
 * 运行依赖检查
 * @param config - 配置选项
 */
async function runDepcheck(config: DepcheckConfig = {}): Promise<void> {
  try {
    const finalConfig = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    const { packages } = await getPackages();

    let hasIssues = false;

    await Promise.all(
      packages.map(async (pkg: PackageInfo) => {
        // 跳过需要忽略的包
        if (finalConfig.ignorePackages.includes(pkg.packageJson.name)) {
          return;
        }

        const unused = await depcheck(pkg.dir, {
          ignoreMatches: finalConfig.ignoreMatches,
          ignorePatterns: finalConfig.ignorePatterns,
        });

        cleanDepcheckResult(unused);

        const pkgHasIssues =
          Object.keys(unused.missing).length > 0 ||
          unused.dependencies.length > 0 ||
          unused.devDependencies.length > 0;

        if (pkgHasIssues) {
          hasIssues = true;
          formatDepcheckResult(pkg.packageJson.name, unused);
        }
      }),
    );

    if (!hasIssues) {
      console.log('\n✅ Dependency check completed, no issues found');
    }
  } catch (error) {
    console.error(
      '❌ Dependency check failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * 定义依赖检查命令
 * @param cac - CAC实例
 */
function defineDepcheckCommand(cac: CAC): void {
  cac
    .command('check-dep')
    .option(
      '--ignore-packages <packages>',
      'Packages to ignore, comma separated',
    )
    .option(
      '--ignore-matches <matches>',
      'Dependency patterns to ignore, comma separated',
    )
    .option(
      '--ignore-patterns <patterns>',
      'File patterns to ignore, comma separated',
    )
    .usage('Analyze project dependencies')
    .action(async ({ ignoreMatches, ignorePackages, ignorePatterns }) => {
      const config: DepcheckConfig = {
        ...(ignorePackages && { ignorePackages: ignorePackages.split(',') }),
        ...(ignoreMatches && { ignoreMatches: ignoreMatches.split(',') }),
        ...(ignorePatterns && { ignorePatterns: ignorePatterns.split(',') }),
      };

      await runDepcheck(config);
    });
}

export { defineDepcheckCommand, type DepcheckConfig };
