/**
 * turbo-run 的命令行入口：用 cac 注册 `turbo-run [script]`，把脚本名交给 run 执行，
 * 未知子命令报错并以状态码 1 退出。
 *
 * 只做参数解析与退出码处理，跨包查找和执行细节在 ./run。
 */
import { colors, consola } from '@vben/node-utils';

import { cac } from 'cac';

import { run } from './run';

try {
  const turboRun = cac('turbo-run');

  turboRun
    .command('[script]')
    .usage(`Run turbo interactively.`)
    .action(async (command: string) => {
      run({ command });
    });

  // Invalid command
  turboRun.on('command:*', () => {
    consola.error(colors.red('Invalid command!'));
    process.exit(1);
  });

  turboRun.usage('turbo-run');
  turboRun.help();
  turboRun.parse();
} catch (error) {
  consola.error(error);
  process.exit(1);
}
