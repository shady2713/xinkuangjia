import type { CAC } from 'cac';

import { getPackages } from '@vben/node-utils';

import depcheck from 'depcheck';

const DEFAULT_CONFIG = {
  ignoreMatches: [
    'vite',
    'vitest',
    'unbuild',
    '@playwright/test',
    '@vue/test-utils',
    '@vben/tsconfig',
    '@vben/vite-config',
    '@vben/tailwind-config',
    '@types/*',
    '@vben-core/design',
    '@vben-core/typings',
  ],
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
  ignorePatterns: ['dist', 'node_modules', 'public'],
};

interface DepcheckResult {
  dependencies: string[];
  devDependencies: string[];
  missing: Record<string, string[]>;
}

interface DepcheckConfig {
  ignoreMatches?: string[];
  ignorePackages?: string[];
  ignorePatterns?: string[];
}

interface PackageInfo {
  dir: string;
  packageJson: {
    name: string;
  };
}

/** 清理本地路径依赖误报。 */
function cleanDepcheckResult(unused: DepcheckResult): void {
  Reflect.deleteProperty(unused.missing, 'file:');

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
 * 输出单个包的缺失依赖或未使用依赖详情。
 *
 * @param pkgName 工作区包名
 * @param unused depcheck 扫描结果
 */
function formatDepcheckResult(pkgName: string, unused: DepcheckResult): void {
  const hasIssues =
    Object.keys(unused.missing).length > 0 ||
    unused.dependencies.length > 0 ||
    unused.devDependencies.length > 0;

  if (!hasIssues) {
    return;
  }

  console.error('\n[Package]', pkgName);

  if (Object.keys(unused.missing).length > 0) {
    console.error('[Missing dependencies]:');
    Object.entries(unused.missing).forEach(([dep, files]) => {
      console.error(`  - ${dep}:`);
      files.forEach((file) => console.error(`    -> ${file}`));
    });
  }

  if (unused.dependencies.length > 0) {
    console.error('[Unused dependencies]:');
    unused.dependencies.forEach((dep) => console.error(`  - ${dep}`));
  }

  if (unused.devDependencies.length > 0) {
    console.error('[Unused devDependencies]:');
    unused.devDependencies.forEach((dep) => console.error(`  - ${dep}`));
  }
}

/**
 * 扫描工作区包依赖声明一致性；存在未声明或未使用依赖时以非零状态码失败。
 *
 * @param config depcheck 忽略规则配置
 */
async function runDepcheck(config: DepcheckConfig = {}): Promise<void> {
  try {
    const finalConfig = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    const { packages } = await getPackages();
    let hasIssues = false;

    /**
     * 检查单个工作区包的依赖声明完整性。
     *
     * @param pkg 工作区包描述信息
     */
    async function inspectPackageDeps(pkg: PackageInfo): Promise<void> {
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
    }

    await Promise.all(packages.map((pkg) => inspectPackageDeps(pkg)));

    if (hasIssues) {
      process.exitCode = 1;
      return;
    }
    console.log('\n[OK] Dependency check completed, no issues found');
  } catch (error) {
    console.error(
      '[ERROR] Dependency check failed:',
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  }
}

/** 注册 `vsh check-dep` 子命令。 */
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
