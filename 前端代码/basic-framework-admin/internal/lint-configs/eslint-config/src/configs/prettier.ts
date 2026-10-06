/**
 * 格式化规则层：把 Prettier 作为 ESLint 规则运行，使格式差异在 lint 阶段暴露。
 * 只报告格式问题，不参与代码风格决策；实际排版由仓库 Prettier 配置决定。
 */
import type { Linter } from 'eslint';

import { interopDefault } from '../util';

/**
 * 生成 Prettier 格式检查片段。
 * @returns 只开启 prettier/prettier 一条规则的配置数组，格式差异以 lint 错误暴露。
 */
export async function prettier(): Promise<Linter.Config[]> {
  const [pluginPrettier] = await Promise.all([
    interopDefault(import('eslint-plugin-prettier')),
  ] as const);
  return [
    {
      plugins: {
        prettier: pluginPrettier,
      },
      rules: {
        'prettier/prettier': 'error',
      },
    },
  ];
}
