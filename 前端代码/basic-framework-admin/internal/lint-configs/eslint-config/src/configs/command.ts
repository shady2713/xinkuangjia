/**
 * 注释指令配置：由 eslint-plugin-command 提供的 /// 注释改写能力。
 * 该插件默认不报错，只在开发者写下指令注释并执行修复时才生效。
 */
import createCommand from 'eslint-plugin-command/config';

export async function command() {
  return [
    {
      ...createCommand(),
    },
  ];
}
