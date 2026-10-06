/**
 * Turbo 规则片段：注册 eslint-config-turbo 提供的 turbo 插件命名空间。
 * 该片段不带规则与文件范围，因此默认不校验任何内容；
 * 需要检查未声明环境变量的包自行引用 turbo/no-undeclared-env-vars。
 */
import type { Linter } from 'eslint';

import { interopDefault } from '../util';

/**
 * 生成 Turbo 插件的命名空间片段。
 * @returns 只注册 turbo 插件、不带规则与 files 范围的配置数组；
 *   需要检查未声明环境变量的包需自行引用 turbo/no-undeclared-env-vars。
 */
export async function turbo(): Promise<Linter.Config[]> {
  const [pluginTurbo] = await Promise.all([
    interopDefault(import('eslint-config-turbo')),
  ] as const);

  return [
    {
      plugins: {
        turbo: pluginTurbo,
      },
    },
  ];
}
