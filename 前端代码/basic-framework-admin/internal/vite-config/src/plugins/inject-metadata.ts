/**
 * 构建元数据注入插件：读取应用 package.json 与工作区清单，
 * 把版本、作者、构建时间和依赖版本写进 __VBEN_ADMIN_METADATA__，
 * 并单独暴露 import.meta.env.VITE_APP_VERSION。
 * catalog: 与 workspace: 协议在此展开为实际版本号；只产出编译期常量，
 * 不读取运行期环境变量，也不改写产物文件。
 */
import type { PluginOption } from 'vite';

import {
  dateUtil,
  findMonorepoRoot,
  getPackages,
  readPackageJSON,
} from '@vben/node-utils';

import { readWorkspaceManifest } from '@pnpm/workspace.read-manifest';

/**
 * 把依赖声明里的 pnpm 协议展开成可写入产物的具体版本号。
 * @param pkgsMeta - 工作区内包名到版本号的映射，用于展开 workspace 协议。
 * @param name - 依赖包名，同时作为另两张表的查找键。
 * @param value - package.json 中声明的原始版本串。
 * @param catalog - pnpm-workspace.yaml 里的 catalog 映射，用于展开 catalog 协议。
 * @returns catalog: 与 workspace 协议展开后的版本；普通版本串原样返回，查不到时可能为 undefined。
 */
function resolvePackageVersion(
  pkgsMeta: Record<string, string>,
  name: string,
  value: string,
  catalog: Record<string, string>,
) {
  if (value.includes('catalog:')) {
    return catalog[name];
  }

  if (value.includes('workspace')) {
    return pkgsMeta[name];
  }

  return value;
}

/**
 * 汇总工作区内所有包的依赖声明，并把 catalog、workspace 协议展开成具体版本。
 * @returns 合并后的 dependencies 与 devDependencies；同名依赖以最后遍历到的包为准。
 */
async function resolveMonorepoDependencies() {
  const { packages } = await getPackages();
  const manifest = await readWorkspaceManifest(findMonorepoRoot());
  const catalog = manifest?.catalog || {};

  const resultDevDependencies: Record<string, string | undefined> = {};
  const resultDependencies: Record<string, string | undefined> = {};
  const pkgsMeta: Record<string, string> = {};

  for (const { packageJson } of packages) {
    pkgsMeta[packageJson.name] = packageJson.version;
  }

  for (const { packageJson } of packages) {
    const { dependencies = {}, devDependencies = {} } = packageJson;
    for (const [key, value] of Object.entries(dependencies)) {
      resultDependencies[key] = resolvePackageVersion(
        pkgsMeta,
        key,
        value,
        catalog,
      );
    }
    for (const [key, value] of Object.entries(devDependencies)) {
      resultDevDependencies[key] = resolvePackageVersion(
        pkgsMeta,
        key,
        value,
        catalog,
      );
    }
  }
  return {
    dependencies: resultDependencies,
    devDependencies: resultDevDependencies,
  };
}

/**
 * Inject project metadata into Vite define.
 * 读取应用 package.json 与工作区依赖清单，把它们写成编译期常量。
 * @param root - 应用根目录，用于定位 package.json。
 * @returns 注入 __VBEN_ADMIN_METADATA__ 与 VITE_APP_VERSION 的插件；读取失败时由调用方的读取函数抛错。
 */
async function viteMetadataPlugin(
  root = process.cwd(),
): Promise<PluginOption | undefined> {
  const { author, description, homepage, license, version } =
    await readPackageJSON(root);

  const buildTime = dateUtil().format('YYYY-MM-DD HH:mm:ss');

  return {
    /**
     * 在解析配置阶段注入元数据常量，包含版本、作者、构建时间与依赖版本。
     * @returns 只含 define 的配置片段，产物中不会保留运行期读取逻辑。
     */
    async config() {
      const { dependencies, devDependencies } =
        await resolveMonorepoDependencies();

      const isAuthorObject = typeof author === 'object';
      const authorName = isAuthorObject ? author.name : author;
      const authorEmail = isAuthorObject ? author.email : null;
      const authorUrl = isAuthorObject ? author.url : null;

      return {
        define: {
          __VBEN_ADMIN_METADATA__: JSON.stringify({
            authorEmail,
            authorName,
            authorUrl,
            buildTime,
            dependencies,
            description,
            devDependencies,
            homepage,
            license,
            version,
          }),
          'import.meta.env.VITE_APP_VERSION': JSON.stringify(version),
        },
      };
    },
    enforce: 'post',
    name: 'vite:inject-metadata',
  };
}

export { viteMetadataPlugin };
