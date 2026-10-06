/**
 * 注释指令配置：由 eslint-plugin-command 提供的 /// 注释改写能力。
 * 该插件默认不报错，只在开发者写下指令注释并执行修复时才生效。
 */
import createCommand from 'eslint-plugin-command/config';

/**
 * 生成注释指令（`///`）的配置片段。
 * @returns 只含 eslint-plugin-command 一个配置项的数组，不设 files 范围，也不主动报错。
 */
export async function command() {
  return [
    {
      ...createCommand(),
    },
  ];
}
