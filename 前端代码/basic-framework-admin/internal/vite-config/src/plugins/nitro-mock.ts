/**
 * 在开发期按需拉起独立的 Nitro mock 服务。
 *
 * 仅当配置端口未被占用、且 mock 服务包确实安装时才启动；启动后随 Vite 服务一起生效，
 * 并在其打印的地址列表中追加 mock 服务入口。端口被占用时静默跳过，不影响主应用。
 */

import type { Nitro } from 'nitropack';
import type { PluginOption } from 'vite';

import { colors, consola, getPackage } from '@vben/node-utils';

import getPort from 'get-port';
import { build, createDevServer, createNitro, prepare } from 'nitropack';

/** mock 服务插件选项：包名、监听端口，以及是否打印启动与配置变更日志。 */
type NitroMockPluginOptions = {
  mockServerPackage?: string;
  port?: number;
  verbose?: boolean;
};

const hmrKeyRe = /^runtimeConfig\.|routeRules\./;

/**
 * 开发期按需拉起独立的 Nitro mock 服务。
 * 端口被占用或 mock 服务包未安装时静默跳过，不影响主应用启动。
 * @param options - mock 服务选项；解构出的包名、端口与 verbose 均可省略并使用默认值。
 * @returns 只在开发服务器上生效的 Vite 插件，地址列表中会追加 mock 服务入口。
 */
export const viteNitroMockPlugin = ({
  mockServerPackage = '@vben/backend-mock',
  port = 5320,
  verbose = true,
}: NitroMockPluginOptions = {}): PluginOption => {
  return {
    /**
     * 在开发服务器启动时探测端口并拉起 mock 服务，同时把 mock 地址追加到地址列表输出。
     * @param server - Vite 开发服务器实例，这里会接管它的 printUrls。
     */
    async configureServer(server) {
      const availablePort = await getPort({ port });
      if (availablePort !== port) {
        return;
      }

      const pkg = await getPackage(mockServerPackage);
      if (!pkg) {
        consola.log(
          `Package ${mockServerPackage} not found. Skip mock server.`,
        );
        return;
      }

      runNitroServer(pkg.dir, port, verbose);

      const printUrls = server.printUrls;
      server.printUrls = () => {
        printUrls();
        consola.log(
          `  ${colors.green('->')}  ${colors.bold('Nitro Mock Server')}: ${colors.cyan(`http://localhost:${port}/api`)}`,
        );
      };
    },
    enforce: 'pre',
    name: 'vite:mock-server',
  };
};

/**
 * 启动并维护一个监听配置变化的 Nitro mock 服务实例。
 *
 * 首次调用创建实例并完成准备、构建与监听；配置变化时若只涉及 runtimeConfig/routeRules
 * 则走热更新，否则整体重启实例。
 *
 * @param rootDir mock 服务包所在目录，作为 Nitro 的 rootDir
 * @param port mock 服务监听端口
 * @param verbose 是否打印配置变更与启动日志
 * @returns 首次 reload 的完成信号
 */
async function runNitroServer(rootDir: string, port: number, verbose: boolean) {
  // createNitro 完成前 nitro 为空，此时 reload 不做任何事；重启时才需要先关闭旧实例。
  let nitro: Nitro | undefined;
  /**
   * 重建并启动一个 Nitro 实例，替换掉上一个实例。
   *
   * 已有实例时先取消配置监听再关闭，避免旧实例继续占用端口。
   */
  const reload = async () => {
    if (nitro) {
      consola.info('Restarting dev server...');
      // 只有以 watch 方式加载配置时 _c12 才是 ConfigWatcher，才有 unwatch 可调用；
      // 静态加载返回的 ResolvedConfig 上不存在该方法，直接跳过避免运行时报错。
      if ('unwatch' in nitro.options._c12) {
        await nitro.options._c12.unwatch();
      }
      await nitro.close();
    }
    nitro = await createNitro(
      {
        dev: true,
        preset: 'nitro-dev',
        rootDir,
      },
      {
        c12: {
          /**
           * Nitro 配置文件变更回调。
           *
           * @param getDiff c12 提供的变更上下文
           * @param getDiff.getDiff 取出本次配置差异列表
           * @param getDiff.newConfig 合并后的新配置，其 config 字段为热更新所需的目标配置
           */
          async onUpdate({ getDiff, newConfig }) {
            const diff = getDiff();
            if (diff.length === 0) {
              return;
            }
            if (verbose) {
              consola.info(
                `Nitro config updated:\n${diff
                  .map((entry) => `  ${entry.toString()}`)
                  .join('\n')}`,
              );
            }
            // onUpdate 由 c12 的 watch 回调触发，只可能在 createNitro 返回之后才被调用，
            // 此刻 nitro 必然已赋值；这里显式判空只是为了满足闭包内的类型收窄。
            if (!nitro) {
              return;
            }
            await (diff.every((entry) => hmrKeyRe.test(entry.key))
              ? nitro.updateConfig(newConfig.config)
              : reload());
          },
        },
        watch: true,
      },
    );
    nitro.hooks.hookOnce('restart', reload);

    const server = createDevServer(nitro);
    await server.listen(port, { showURL: false });
    await prepare(nitro);
    await build(nitro);

    if (verbose) {
      console.log('');
      consola.success(colors.bold(colors.green('Nitro Mock Server started.')));
    }
  };
  return await reload();
}
