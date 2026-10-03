import { execaCommand, getPackages } from '@vben/node-utils';

import { cancel, isCancel, select } from '@clack/prompts';

interface RunOptions {
  command?: string;
}

/**
 * 交互式选择并执行某个 workspace 包的 script。
 *
 * 只列出 package.json 中声明了该 script 的包；命中多个时让用户选择，命中唯一时直接执行，
 * 一个都没有则以错误码 1 退出。命令通过 `pnpm --filter=<包名> run <command>` 执行。
 *
 * @param options 目标命令名；缺省时打印错误并退出
 */
export async function run(options: RunOptions) {
  const { command } = options;
  if (!command) {
    console.error('Please enter the command to run');
    process.exit(1);
  }
  const { packages } = await getPackages();

  // 只显示有对应命令的包；@manypkg 读取的 packageJson 运行时含 scripts，但类型未声明该字段
  const selectPkgs = packages.filter(
    /** 判断该包是否声明了目标命令，用于过滤出真正可执行的包。 */
    (pkg) =>
      (pkg?.packageJson as { scripts?: Record<string, string> })?.scripts?.[
        command
      ],
  );

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

/**
 * 过滤app包
 * @param root
 * @param packages
 */
// async function findApps(root: string, packages: Package[]) {
//   // apps内的
//   const appPackages = packages.filter((pkg) => {
//     const viteConfigExists = fs.existsSync(join(pkg.dir, 'vite.config.mts'));
//     return pkg.dir.startsWith(join(root, 'apps')) && viteConfigExists;
//   });

//   return appPackages;
// }
