import { execaCommand, getPackages } from '@vben/node-utils';

import { cancel, isCancel, select } from '@clack/prompts';

interface RunOptions {
  command?: string;
}

/**
 * 在声明了目标脚本的工作区包里选出一个包并执行该脚本。
 * 只有一个候选时直接执行；有多个候选时交互选择。未提供命令、没有候选包或用户取消时结束进程。
 * @param options 要运行的 pnpm 脚本名，读取其中的 command
 */
export async function run(options: RunOptions) {
  const { command } = options;
  if (!command) {
    console.error('Please enter the command to run');
    process.exit(1);
  }
  const { packages } = await getPackages();

  // 只显示有对应命令的包
  const selectPkgs = packages.filter((pkg) => {
    return (pkg?.packageJson as Record<string, any>)?.scripts?.[command];
  });

  let selectPkg: string | symbol;
  if (selectPkgs.length > 1) {
    selectPkg = await select<string>({
      message: `Select the app you need to run [${command}]:`,
      options: selectPkgs.map((item) => ({
        label: item?.packageJson.name,
        value: item?.packageJson.name,
      })),
    });

    if (isCancel(selectPkg) || !selectPkg) {
      cancel('👋 Has cancelled');
      process.exit(0);
    }
  } else {
    selectPkg = selectPkgs[0]?.packageJson?.name ?? '';
  }

  if (!selectPkg) {
    console.error('No app found');
    process.exit(1);
  }

  execaCommand(`pnpm --filter=${selectPkg} run ${command}`, {
    stdio: 'inherit',
  });
}
