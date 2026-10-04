// @vitest-environment node
/**
 * Vite 配置入口（vite-config 的 config/index）真实行为回归。
 *
 * `defineConfig` 是各应用与共享包唯一的构建配置入口：工程类型判定写错会让应用被当成
 * 库来构建，类型分派写错会丢掉插件或产出错误的外部依赖清单，未知类型必须显式拒绝而
 * 不是静默降级。用例在独立临时目录里准备 `index.html` 与 `package.json`，调用真实
 * `defineConfig` 并驱动返回的配置函数，断言合并后的真实配置取值。
 *
 * 本文件是构建工具链代码，按仓库既有做法声明 Node 环境；`@vben/node-utils` 只替换为
 * 局部替身：它的 dist 经 jiti 二次装载会再次加载同一份源码，使 node-utils 的覆盖率
 * 测量出现两套不兼容的映射，属工具侧已知缺陷，测试侧不得触发。
 */
import type { ESBuildOptions, LibraryOptions, UserConfig } from 'vite';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defineConfig } from '../index';

vi.mock(
  '@vben/node-utils',
  /** 只替换构建工具包的读取与着色边界，配置组装逻辑保持真实实现。 */ () => ({
    /** 原样返回文本，使断言不依赖 ANSI 转义序列。 */
    colors: {
      /** 原样返回，避免断言包含颜色控制符。 */
      bold: (value: string) => value,
      /** 原样返回，避免断言包含颜色控制符。 */
      cyan: (value: string) => value,
      /** 原样返回，避免断言包含颜色控制符。 */
      red: (value: string) => value,
    },
    /** 固定内容摘要，避免断言依赖真实哈希实现。 */
    generatorContentHash: () => 'DUMMYHASH',
    /** 返回带版本号的包清单，覆盖运行时配置文件名里的版本片段。 */
    readPackageJSON: async () => ({ version: '5.6.0' }),
  }),
);

/** 本用例独占的临时工作目录，用例结束后整体删除。 */
let workspace: string;
/** 进入临时目录前的真实工作目录，用于恢复共享的进程状态。 */
let previousCwd: string;

/**
 * 建立只含必要文件的临时工作目录。
 * @param options 需要写入的工程文件开关。
 * @param options.indexHtml 是否写入 index.html，用于驱动工程类型自动判定。
 * @param options.packageJson 是否写入 package.json，库配置需要据此推导外部依赖。
 * @returns 临时目录的绝对路径。
 */
function createWorkspace(options: {
  indexHtml: boolean;
  packageJson: boolean;
}) {
  if (options.indexHtml) {
    writeFileSync(join(workspace, 'index.html'), '<html></html>');
  }
  if (options.packageJson) {
    writeFileSync(
      join(workspace, 'package.json'),
      JSON.stringify({
        dependencies: { 'element-plus': '^2.0.0', vue: '^3.5.0' },
        name: 'DUMMY-workspace-package',
        peerDependencies: { 'vue-router': '^4.0.0' },
        version: '0.0.0',
      }),
    );
  }
  return workspace;
}

/**
 * 调用配置入口并取出可执行的配置函数。
 * @param type 工程类型，传给真实 `defineConfig`。
 * @returns 等待 ConfigEnv 的配置函数。
 * @throws 入口没有返回函数时报告契约变化。
 */
function resolveFactory(type: 'application' | 'auto' | 'library') {
  const factory = defineConfig(undefined, type);
  if (typeof factory !== 'function') {
    throw new TypeError('配置入口必须返回配置函数');
  }
  return factory;
}

/**
 * 读取库构建配置；Vite 用 `lib: false` 表示未启用库构建，断言只关心真实对象结构。
 * @param config 被测配置函数返回的完整 Vite 配置。
 * @returns 库构建配置；未启用时为 undefined。
 */
function libraryOptions(config: UserConfig): LibraryOptions | undefined {
  const { lib } = config.build ?? {};
  return lib === false ? undefined : lib;
}

/**
 * 读取 esbuild 配置；Vite 用 `esbuild: false` 表示显式关闭，断言只关心真实对象结构。
 * @param config 被测配置函数返回的完整 Vite 配置。
 * @returns esbuild 配置；显式关闭时为 undefined。
 */
function esbuildOptions(config: UserConfig): ESBuildOptions | undefined {
  const { esbuild } = config;
  return esbuild === false ? undefined : esbuild;
}

beforeEach(
  /** 为每例建立独立临时目录并记录原工作目录。 */ () => {
    workspace = mkdtempSync(join(tmpdir(), 'vite-config-index-'));
    previousCwd = process.cwd();
  },
);

afterEach(
  /** 恢复工作目录并删除临时目录，避免污染其它用例。 */ () => {
    process.chdir(previousCwd);
    rmSync(workspace, { force: true, recursive: true });
  },
);

describe('defineConfig 工程类型自动判定', /** 自动判定决定走应用还是库配置，判错会让应用丢失插件或产出库结构。 */ () => {
  it('存在 index.html 时按应用构建', /** 应用目录必须产出 es2015 目标与开发服务器预热清单。 */ async () => {
    createWorkspace({ indexHtml: true, packageJson: false });
    process.chdir(workspace);

    const config = await resolveFactory('auto')({
      command: 'build',
      mode: 'production',
    });

    expect(config.build?.target).toBe('es2015');
    expect(config.server?.warmup?.clientFiles).toEqual([
      './index.html',
      './src/bootstrap.ts',
      './src/{views,layouts,router,store,api,adapter}/*',
    ]);
    expect(config.build?.lib).toBeUndefined();
  });

  it('没有 index.html 时按库构建', /** 共享包必须产出库结构与包依赖外部化清单。 */ async () => {
    createWorkspace({ indexHtml: false, packageJson: true });
    process.chdir(workspace);

    const config = await resolveFactory('auto')({
      command: 'build',
      mode: 'production',
    });

    expect(libraryOptions(config)?.entry).toBe('src/index.ts');
    expect(config.server).toBeUndefined();
  });
});

describe('defineConfig 库工程配置', /** 库构建的外部化清单与入口名直接决定产物体积和可被谁消费。 */ () => {
  it('把包依赖与对等依赖全部外部化', /** 漏掉依赖会把第三方库打进产物，导致使用方出现重复实例。 */ async () => {
    createWorkspace({ indexHtml: false, packageJson: true });
    process.chdir(workspace);

    const config = await resolveFactory('library')({
      command: 'build',
      mode: 'production',
    });

    expect(config.build?.rollupOptions?.external).toEqual([
      'element-plus',
      'vue',
      'vue-router',
    ]);
    expect(libraryOptions(config)?.formats).toEqual(['es']);
    // fileName 允许字符串或按格式取名函数，两种形态都必须得到同一个入口文件名。
    const fileName = libraryOptions(config)?.fileName;
    expect(
      typeof fileName === 'function' ? fileName('es', 'index') : fileName,
    ).toBe('index.mjs');
    expect(config.build?.sourcemap).toBe(false);
    expect(config.build?.target).toBe('es2018');
    expect(Array.isArray(config.plugins)).toBe(true);
  });

  it('使用方配置覆盖库默认值', /** 共享包需要自定义输出目录或目标语法时，默认值不能被写死。 */ async () => {
    createWorkspace({ indexHtml: false, packageJson: true });
    process.chdir(workspace);

    const factory = defineConfig(
      /** 提供只覆盖构建目标的使用方配置。 */ async () => ({
        vite: { build: { target: 'es2020' } },
      }),
      'library',
    );
    if (typeof factory !== 'function') {
      throw new TypeError('配置入口必须返回配置函数');
    }

    const config = await factory({ command: 'build', mode: 'production' });

    expect(config.build?.target).toBe('es2020');
    expect(libraryOptions(config)?.entry).toBe('src/index.ts');
  });
});

describe('defineConfig 应用工程配置', /** 应用构建的入口命名、语法降级与开发服务器参数是发布产物的直接来源。 */ () => {
  it('构建模式开启产物命名规则并降级到 es2015', /** 入口命名影响缓存失效，目标语法影响浏览器兼容范围。 */ async () => {
    createWorkspace({ indexHtml: true, packageJson: false });
    process.chdir(workspace);

    const config = await resolveFactory('application')({
      command: 'build',
      mode: 'production',
    });

    expect(config.base).toBe('/');
    expect(config.build?.target).toBe('es2015');
    expect(config.build?.rollupOptions?.output).toMatchObject({
      assetFileNames: '[ext]/[name]-[hash].[ext]',
      chunkFileNames: 'js/[name]-[hash].js',
      entryFileNames: 'js/[name]-[hash].js',
    });
    expect(esbuildOptions(config)?.drop).toEqual(['debugger']);
    expect(config.server?.host).toBe(true);
    expect(config.server?.port).toBe(5173);
    expect(config.build?.chunkSizeWarningLimit).toBe(2000);
    expect(Array.isArray(config.plugins)).toBe(true);
  });

  it('开发模式保留调试语句且不注入全局样式', /** 开发期需要 debugger 断点，关闭全局样式注入时不得留下空的 scss 配置。 */ async () => {
    createWorkspace({ indexHtml: true, packageJson: false });
    process.chdir(workspace);

    const factory = defineConfig(
      /** 关闭全局样式注入以核对空配置分支。 */ async () => ({
        application: { injectGlobalScss: false },
      }),
      'application',
    );
    if (typeof factory !== 'function') {
      throw new TypeError('配置入口必须返回配置函数');
    }

    const config = await factory({ command: 'serve', mode: 'development' });

    expect(esbuildOptions(config)?.drop).toEqual([]);
    expect(config.css?.preprocessorOptions).toEqual({});
  });

  it('使用方配置覆盖应用默认值', /** 应用需要自定义基础路径与代理时，默认值必须可被覆盖。 */ async () => {
    createWorkspace({ indexHtml: true, packageJson: false });
    process.chdir(workspace);

    const factory = defineConfig(
      /** 提供只覆盖基础路径与代理的使用方配置。 */ async () => ({
        vite: {
          base: '/admin/',
          server: { proxy: { '/admin-api': 'http://127.0.0.1:48080' } },
        },
      }),
      'application',
    );
    if (typeof factory !== 'function') {
      throw new TypeError('配置入口必须返回配置函数');
    }

    const config = await factory({ command: 'serve', mode: 'development' });

    expect(config.base).toBe('/admin/');
    expect(config.server?.proxy).toEqual({
      '/admin-api': 'http://127.0.0.1:48080',
    });
    expect(config.server?.port).toBe(5173);
  });
});

describe('defineConfig 未知工程类型', /** 未知类型静默降级会让配置产出与工程实际形态不符。 */ () => {
  it('拒绝并报告原始类型名', /** 错误信息必须包含实际类型，便于定位调用方传参。 */ () => {
    const unsupportedType: string = 'unsupported';

    expect(
      /** 以运行期未知的类型调用真实入口。 */ () =>
        defineConfig(undefined, unsupportedType as never),
    ).toThrow('Unsupported project type: unsupported');
  });
});
