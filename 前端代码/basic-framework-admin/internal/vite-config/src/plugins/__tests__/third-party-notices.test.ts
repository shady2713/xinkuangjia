/**
 * 第三方许可材料插件（vite-config 的 plugins/third-party-notices）真实行为回归。
 *
 * 该插件只登记**本次产物真正包含**的第三方包：模块表反推包根、读包清单拿声明、
 * 把随包许可证正文按内容摘要去重后写成静态资源，材料正文再按摘要引用。用例全部用
 * 系统临时目录里的真实包目录与真实 Rollup 分块模块表驱动，只替换 Rollup 插件上下文的
 * `emitFile`，因此断言的是实际读写行为与最终产物文本，不替身文件系统。
 *
 * 文件系统权限类分支在 root 下不可达（root 绕过读权限检查），相关用例按 uid 跳过，
 * 不放宽断言换取覆盖率。
 *
 * `@vben/node-utils` 按相邻用例的既有做法替换为局部替身：它的 dist 经 jiti 二次装载会
 * 再次加载同一份源码，使 node-utils 自身源码的覆盖率测量出现两套不兼容的映射，属工具侧
 * 已知缺陷，测试侧不得触发。本插件的产物逻辑不依赖这两个函数，替身只用于满足导入链。
 */
// @vitest-environment node
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  collectPackages,
  LICENSES_DIR,
  NOTICES_FILE,
  packageOfModule,
  viteThirdPartyNotices,
} from '../third-party-notices';

vi.mock(
  '@vben/node-utils',
  /** 只替换包清单读取与日期格式化边界，插件自身的读写与遍历逻辑保持真实实现。 */ () => ({
    /** 本组用例不构造许可横幅，这里不会真的被调用。 */
    readPackageJSON: vi.fn(async () => ({})),
    /** 只提供日期格式化形状，满足 license.ts 的导入契约。 */
    dateUtil: () => ({
      /** 固定日期，使断言不依赖运行时刻。 */
      format: () => '2026-01-02',
    }),
  }),
);

/** 用例构造的产物静态资源上下文，记录插件实际输出的文件。 */
interface EmitContext {
  /** 记录一条静态资源输出。 */
  emitFile: (file: Record<string, unknown>) => void;
}

/** 插件结构中本用例需要驱动的字段。 */
type NoticesPlugin = {
  /** 插件执行阶段标记。 */
  apply?: string;
  /** 插件执行时机标记。 */
  enforce?: string;
  /** 产物生成钩子。 */
  generateBundle: {
    /**
     * 驱动一次产物生成。
     * @param options 归一化后的输出选项，本用例不解释。
     * @param bundle 产物集合。
     * @this Rollup 插件上下文，仅需 emitFile。
     */
    handler: (
      this: EmitContext,
      options: unknown,
      bundle: Record<string, unknown>,
    ) => void;
    order?: string;
  };
  /** 插件名称。 */
  name?: string;
};

/** 一个临时包目录及其清单内容。 */
interface FakePackage {
  /** 包根绝对路径。 */
  location: string;
  /** 包名（与目录层级一致）。 */
  name: string;
}

/** 本次用例全部临时目录，逐一清理。 */
let temporaries: string[] = [];

/**
 * 在系统临时目录下造一个工作区根。
 * @returns 工作区根绝对路径。
 */
function createWorkspaceRoot() {
  const root = mkdtempSync(join(tmpdir(), 'vite-notices-'));
  temporaries.push(root);
  return root;
}

/**
 * 在工作区里造一个 pnpm 布局的第三方包。
 * @param root 工作区根。
 * @param name 包名，支持 `@scope/name` 写法。
 * @param manifest 写入的 `package.json` 原文；不传则不写清单。
 * @returns 包根目录与用于构造模块标识的路径前缀。
 */
function createPackage(
  root: string,
  name: string,
  manifest?: string,
): FakePackage {
  const location = join(
    root,
    'node_modules',
    '.pnpm',
    'store',
    'node_modules',
    name,
  );
  mkdirSync(location, { recursive: true });
  if (manifest !== undefined) {
    writeFileSync(join(location, 'package.json'), manifest);
  }
  return { location, name };
}

/**
 * 生成指向包内文件的 Rollup 模块标识。
 * @param location 包根目录。
 * @param file 包内相对路径。
 * @returns 绝对路径模块标识。
 */
function moduleId(location: string, file: string) {
  return `${join(location, file)}?v=1`;
}

/**
 * 构造带 emitFile 记录的分块产物集合。
 * @param chunkModules 入口分块包含的模块表。
 * @returns 产物集合，附带一个静态资源以验证资源不被当成模块处理。
 */
function createBundle(
  chunkModules: Record<string, { renderedLength: number }>,
) {
  return {
    'assets/logo.svg': {
      fileName: 'assets/logo.svg',
      source: '<svg />',
      type: 'asset',
    },
    'index.js': {
      fileName: 'index.js',
      isEntry: true,
      modules: chunkModules,
      type: 'chunk',
    },
    'vendor.js': {
      fileName: 'vendor.js',
      isEntry: false,
      modules: {},
      type: 'chunk',
    },
  };
}

/**
 * 记录插件输出的静态资源。
 * @returns emitFile 上下文与按文件名索引的输出表。
 */
function createContext() {
  const files = new Map<string, Record<string, unknown>>();
  const context: EmitContext = {
    /** 按文件名收录静态资源，同名后写覆盖先写。 */
    emitFile: (file) => {
      files.set(String(file.fileName), file);
    },
  };
  return { context, files };
}

/**
 * 按许可证正文内容算出与插件一致的摘要短前缀。
 * @param content 许可证正文。
 * @returns 十六进制摘要前 16 位。
 */
function digestOf(content: string) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * 把插件工厂返回值收窄到本用例驱动所需的字段。
 * @param plugin 插件工厂返回值。
 * @returns 窄类型视图。
 */
function toNoticesPlugin(plugin: unknown) {
  return plugin as NoticesPlugin;
}

/** 每个用例结束后删除本次造出的全部临时目录，避免在系统临时目录留下残留。 */
afterEach(() => {
  for (const dir of temporaries) {
    rmSync(dir, { force: true, recursive: true });
  }
  temporaries = [];
});

describe('模块标识解析', /** 包根与包名取错会让整个登记信息指向别人的清单。 */ () => {
  it('取最后一个 node_modules 之后的目录作为包根与包名', /** pnpm 隔离布局里中间的 .pnpm 段不能被当成包。 */ () => {
    const id =
      '/ws/node_modules/.pnpm/axios@1.7.9/node_modules/axios/dist/index.mjs';

    expect(packageOfModule(id)).toEqual({
      location: '/ws/node_modules/.pnpm/axios@1.7.9/node_modules/axios',
      name: 'axios',
    });
  });

  it('带作用域的包名取两级目录', /** 只取 `@scope` 会让两个同名包互相覆盖。 */ () => {
    const id =
      '/ws/node_modules/.pnpm/@ctrl+core@1.2.3/node_modules/@ctrl/core/index.mjs';

    expect(packageOfModule(id)).toEqual({
      location:
        '/ws/node_modules/.pnpm/@ctrl+core@1.2.3/node_modules/@ctrl/core',
      name: '@ctrl/core',
    });
  });

  it('windows 分隔符与查询后缀不影响解析', /** Rollup 在部分平台会给出反斜杠路径与虚拟查询串。 */ () => {
    const id = String.raw`C:\ws\node_modules\vue\dist\vue.runtime.esm-bundler.js?v=abc`;

    expect(packageOfModule(id)).toEqual({
      location: 'C:/ws/node_modules/vue',
      name: 'vue',
    });
  });

  it('识别不出包时返回空值而不是猜一个包名', /** 猜出来的包名会把自有源码登记成第三方包。 */ () => {
    expect(packageOfModule('/ws/apps/web-ele/src/main.ts')).toEqual({
      location: '',
      name: '',
    });
    expect(packageOfModule('')).toEqual({ location: '', name: '' });
    expect(packageOfModule('/ws/node_modules/')).toEqual({
      location: '',
      name: '',
    });
  });
});

describe('运行期闭包汇总', /** 登记范围就是"产物真正包含的第三方包"。 */ () => {
  it('只统计分块里的第三方模块并按包名去重', /** 资源、第三方命名空间与工作区自有源码都不该被登记。 */ () => {
    const root = createWorkspaceRoot();
    const axios = createPackage(
      root,
      'axios',
      JSON.stringify({ license: 'MIT', version: '1.7.9' }),
    );
    const vue = createPackage(
      root,
      'vue',
      JSON.stringify({ version: '3.5.13' }),
    );

    const packages = collectPackages(
      createBundle({
        [moduleId(axios.location, 'dist/index.mjs')]: { renderedLength: 10 },
        [moduleId(axios.location, 'lib/axios.js')]: { renderedLength: 4 },
        [moduleId(vue.location, 'dist/vue.runtime.esm-bundler.js')]: {
          renderedLength: 8,
        },
        [`${join(root, 'apps/web-ele/src/main.ts')}?v=1`]: {
          renderedLength: 2,
        },
      }) as never,
    );

    expect([...packages.keys()].toSorted()).toEqual(['axios', 'vue']);
    expect(packages.get('axios')).toEqual({
      author: '',
      license: 'MIT',
      licenseFiles: [],
      location: axios.location,
      name: 'axios',
      repository: '',
      version: '1.7.9',
    });
  });
});

describe('包清单声明读取', /** 登记信息必须来自清单原文，缺什么就写"未声明"。 */ () => {
  it('字符串与对象两种写法的作者与仓库都能规范化', /** npm 清单两种写法并存，取错会丢掉作者信息。 */ () => {
    const root = createWorkspaceRoot();
    const objectForm = createPackage(
      root,
      'object-form',
      JSON.stringify({
        author: { name: '张三', email: 'a@example.com' },
        license: 'Apache-2.0',
        repository: { url: 'https://example.com/repo' },
        version: '1.0.0',
      }),
    );
    const stringForm = createPackage(
      root,
      'string-form',
      JSON.stringify({
        author: '李四',
        license: 'ISC',
        repository: 'https://example.com/string',
        version: '2.0.0',
      }),
    );
    const oddForm = createPackage(
      root,
      'odd-form',
      JSON.stringify({
        author: 42,
        license: ['MIT'],
        repository: { url: 7 },
        version: null,
      }),
    );
    const noManifest = createPackage(root, 'no-manifest');

    const packages = collectPackages(
      createBundle({
        [moduleId(objectForm.location, 'index.js')]: { renderedLength: 1 },
        [moduleId(stringForm.location, 'index.js')]: { renderedLength: 1 },
        [moduleId(oddForm.location, 'index.js')]: { renderedLength: 1 },
        [moduleId(noManifest.location, 'index.js')]: { renderedLength: 1 },
      }) as never,
    );

    expect(packages.get('object-form')).toMatchObject({
      author: '张三',
      license: 'Apache-2.0',
      repository: 'https://example.com/repo',
      version: '1.0.0',
    });
    expect(packages.get('string-form')).toMatchObject({
      author: '李四',
      license: 'ISC',
      repository: 'https://example.com/string',
      version: '2.0.0',
    });
    // 类型不符的声明一律如实留空，不套用默认值，也不把数组拼成字符串。
    expect(packages.get('odd-form')).toMatchObject({
      author: '',
      license: '',
      repository: '',
      version: '',
    });
    expect(packages.get('no-manifest')).toMatchObject({
      author: '',
      license: '',
      repository: '',
      version: '',
    });
  });

  it('清单存在但内容不是合法 JSON 时按未声明处理', /** 解析失败时继续登记包名，其余字段留空。 */ () => {
    const root = createWorkspaceRoot();
    const broken = createPackage(root, 'broken', '{ not json');
    const packages = collectPackages(
      createBundle({
        [moduleId(broken.location, 'index.js')]: { renderedLength: 1 },
      }) as never,
    );

    expect(packages.get('broken')).toMatchObject({
      license: '',
      name: 'broken',
      version: '',
    });
  });
});

describe('许可证正文收集', /** 正文来源优先用包内自带的原文。 */ () => {
  it('只收录包根下的许可证类文件并按名称排序', /** 子目录与无关文件不是许可证原文。 */ () => {
    const root = createWorkspaceRoot();
    const target = createPackage(root, 'with-license');
    mkdirSync(join(target.location, 'dist'), { recursive: true });
    writeFileSync(join(target.location, 'LICENSE'), 'MIT License\n');
    writeFileSync(join(target.location, 'NOTICE'), 'Notice\n');
    writeFileSync(join(target.location, 'README.md'), 'readme\n');
    writeFileSync(join(target.location, 'dist/LICENSE.txt'), 'nested\n');

    const packages = collectPackages(
      createBundle({
        [moduleId(target.location, 'index.js')]: { renderedLength: 1 },
      }) as never,
    );

    expect(
      packages
        .get('with-license')
        ?.licenseFiles.map((file) => file.split('/').at(-1)),
    ).toEqual(['LICENSE', 'NOTICE']);
  });

  it('包根目录不可读或不是目录时返回空列表', /** 读不到正文只影响原文位置，不影响包的其它登记信息。 */ () => {
    const root = createWorkspaceRoot();
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    // 包根本身是一个文件：existsSync 为真，但列目录会失败。
    const notDirectory = join(root, 'node_modules', 'plain-file');
    writeFileSync(notDirectory, 'x');
    const missing = join(root, 'node_modules', 'not-there');

    const packages = collectPackages(
      createBundle({
        [`${join(notDirectory, 'index.js')}?v=1`]: { renderedLength: 1 },
        [`${join(missing, 'index.js')}?v=1`]: { renderedLength: 1 },
      }) as never,
    );

    expect(packages.get('plain-file')?.licenseFiles).toEqual([]);
    expect(packages.get('not-there')?.licenseFiles).toEqual([]);
  });
});

describe('材料生成', /** 材料是随包分发的第三方声明，唯一来源是本次构建的真实读数。 */ () => {
  it('输出 notices 与去重后的许可证正文，并如实记录未声明项', /** 这是随包材料的真实结构与文本。 */ () => {
    const root = createWorkspaceRoot();
    const mitText = 'MIT License\n\nCopyright (c) 2024 Someone\n';
    const first = createPackage(
      root,
      'first-pkg',
      JSON.stringify({
        author: '张三',
        license: 'MIT',
        repository: 'https://example.com/first',
        version: '1.0.0',
      }),
    );
    writeFileSync(join(first.location, 'LICENSE'), mitText);
    // 第二个包正文与第一个完全相同，验证按内容摘要去重后只输出一份。
    const second = createPackage(
      root,
      'second-pkg',
      JSON.stringify({ license: 'MIT', version: '2.0.0' }),
    );
    writeFileSync(join(second.location, 'LICENSE.md'), mitText);
    // 清单什么都没写的包，材料里必须写"包清单未声明"与"未随附原文"。
    const bare = createPackage(
      root,
      'bare-pkg',
      JSON.stringify({ version: '3.0.0' }),
    );
    const noVersion = createPackage(
      root,
      'no-version',
      JSON.stringify({ license: 'MIT' }),
    );

    const plugin = toNoticesPlugin(
      viteThirdPartyNotices(join(root, 'apps/web-ele')),
    );
    const { context, files } = createContext();

    plugin.generateBundle.handler.call(
      context,
      {},
      createBundle({
        [moduleId(first.location, 'index.js')]: { renderedLength: 1 },
        [moduleId(second.location, 'index.js')]: { renderedLength: 1 },
        [moduleId(bare.location, 'index.js')]: { renderedLength: 1 },
        [moduleId(noVersion.location, 'index.js')]: { renderedLength: 1 },
      }) as never,
    );

    const digest = digestOf(mitText);
    // 相同正文只输出一次：4 个包共用 2 份不同来源，加 notices 本身共 3 个文件。
    expect([...files.keys()].toSorted()).toEqual([
      NOTICES_FILE,
      `${LICENSES_DIR}/${digest}.txt`,
    ]);
    expect(files.get(`${LICENSES_DIR}/${digest}.txt`)?.source).toBe(mitText);

    const notices = String(files.get(NOTICES_FILE)?.source);
    expect(notices).toContain('本次构建实际包含的第三方包：4 个');
    expect(notices).toContain('--- bare-pkg@3.0.0 ---');
    expect(notices).toContain('许可证声明：包清单未声明');
    expect(notices).toContain(
      '许可证原文位置：包内未随附许可证文本文件；条款地址见包清单声明。',
    );
    // 没有声明作者与仓库的行，避免材料出现空字段。
    expect(notices).not.toContain('声明作者：\n');
    expect(notices).not.toContain('声明仓库：\n');
    expect(notices).toContain(
      '--- first-pkg@1.0.0 ---\n许可证声明：MIT\n声明作者：张三\n声明仓库：https://example.com/first',
    );
    expect(notices).toContain(`  LICENSE → ${LICENSES_DIR}/${digest}.txt`);
    expect(notices).toContain(`  LICENSE.md → ${LICENSES_DIR}/${digest}.txt`);
    // 版本缺失时如实写"未知版本"，不编造版本号。
    expect(notices).toContain('--- no-version@未知版本 ---');
    expect(notices).toContain(
      '工作区根目录未找到 LICENSE 原文，产物不提供该文件。',
    );
    expect(notices).toContain('不构成对自有代码的许可授予');
  });

  it('工作区存在 LICENSE 原文时如实说明其继承范围', /** 随包 LICENSE 只覆盖继承来的代码，材料必须写清楚。 */ () => {
    const root = createWorkspaceRoot();
    const appRoot = join(root, 'apps', 'web-ele');
    mkdirSync(appRoot, { recursive: true });
    writeFileSync(join(root, 'LICENSE'), 'MIT License\n');

    const plugin = toNoticesPlugin(viteThirdPartyNotices(appRoot));
    const { context, files } = createContext();
    plugin.generateBundle.handler.call(context, {}, createBundle({}) as never);

    const notices = String(files.get(NOTICES_FILE)?.source);
    expect(notices).toContain(
      '产物根目录的 LICENSE 逐字取自工作区根目录已有的同名文件',
    );
    expect(notices).toContain('只覆盖继承来的前端代码，不覆盖本项目新增代码');
  });

  it.skipIf(process.getuid?.() === 0)(
    '正文存在但读不出来时如实写未收录而不编造原文',
    /** 读不到正文只影响引用，登记信息与材料结构仍要完整。 */ async () => {
      const root = createWorkspaceRoot();
      const target = createPackage(
        root,
        'unreadable',
        JSON.stringify({ license: 'MIT', version: '1.0.0' }),
      );
      const licensePath = join(target.location, 'LICENSE');
      writeFileSync(licensePath, 'secret\n');
      chmodSync(licensePath, 0o000);

      const plugin = toNoticesPlugin(
        viteThirdPartyNotices(join(root, 'apps/web-ele')),
      );
      const { context, files } = createContext();
      plugin.generateBundle.handler.call(
        context,
        {},
        createBundle({
          [moduleId(target.location, 'index.js')]: { renderedLength: 1 },
        }) as never,
      );

      // 读不到内容时不输出 licenses/ 下的任何正文，材料里如实标注未收录。
      expect([...files.keys()]).toEqual([NOTICES_FILE]);
      expect(String(files.get(NOTICES_FILE)?.source)).toContain(
        '  LICENSE：未收录',
      );
    },
  );

  it('固定为构建阶段的后置钩子', /** 阶段或顺序被改动会让材料在产物写完之后才生成。 */ () => {
    const plugin = toNoticesPlugin(viteThirdPartyNotices());

    expect(plugin.name).toBe('vite:third-party-notices');
    expect(plugin.apply).toBe('build');
    expect(plugin.enforce).toBe('post');
    expect(plugin.generateBundle.order).toBe('post');
  });
});
