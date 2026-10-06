/**
 * pnpm 依赖规范：校验 package.json 的 catalog 引用与工作区目录项。
 * 只管依赖声明是否合规，安装与版本升级仍由 pnpm 命令完成。
 */
import type { Linter } from 'eslint';

import { interopDefault } from '../util';

/**
 * 生成 pnpm 依赖声明的规范片段。
 * @returns 对 package.json 校验 catalog 引用与工作区设置，
 *   对 pnpm-workspace.yaml 校验 catalog 项重复与未使用条目的配置数组。
 */
export async function pnpm(): Promise<Linter.Config[]> {
  const [pluginPnpm, parserPnpm, parserJsonc] = await Promise.all([
    interopDefault(import('eslint-plugin-pnpm')),
    interopDefault(import('yaml-eslint-parser')),
    interopDefault(import('jsonc-eslint-parser')),
  ] as const);

  return [
    {
      files: ['package.json', '**/package.json'],
      languageOptions: {
        parser: parserJsonc,
      },
      plugins: {
        pnpm: pluginPnpm,
      },
      rules: {
        'pnpm/json-enforce-catalog': 'error',
        'pnpm/json-prefer-workspace-settings': 'error',
        'pnpm/json-valid-catalog': 'error',
      },
    },
    {
      files: ['pnpm-workspace.yaml'],
      languageOptions: {
        parser: parserPnpm,
      },
      plugins: {
        pnpm: pluginPnpm,
      },
      rules: {
        'pnpm/yaml-no-duplicate-catalog-item': 'error',
        'pnpm/yaml-no-unused-catalog-item': 'error',
      },
    },
  ];
}
