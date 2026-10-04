/**
 * Vite 元数据注入插件（vite-config 的 plugins/inject-metadata）真实行为回归。
 *
 * 该插件把作者、版本、构建时间与整个 monorepo 的依赖清单写进 `define`，供运行期展示：
 * `catalog:` 与 `workspace:` 两类协议版本必须换成真实版本号，否则产物里会出现无法解析的
 * 占位字符串；依赖与开发依赖都要收录，漏掉开发依赖会让版本面板信息不完整；作者既可能是
 * 字符串也可能是对象，取值口径写错会让作者名或联系方式丢失；构建时间必须来自注入的
 * 时钟，否则断言与产物内容都不可复现。用例只把包清单读取与日期工具替换为局部替身：
 * 它们来自 `@vben/node-utils`，其 dist 经 jiti 二次装载会污染该包源码的覆盖率测量。
 */
import { describe, expect, it, vi } from 'vitest';

import { viteMetadataPlugin } from '../inject-metadata';

/** 元数据插件对象中本用例需要驱动的字段；Vite 的联合返回类型此处按实际结构收窄。 */
type MetadataPlugin = {
  /** 配置钩子，返回要注入 Vite define 的键值。 */
  config: () => Promise<{ define: Record<string, string> }>;
  /** 插件执行时机标记。 */
  enforce?: string;
  /** 插件名称，用于 Vite 内部识别与用户排查。 */
  name?: string;
};

/** 注入后的应用元数据形状，与插件写进 define 的 JSON 内容一致。 */
interface InjectedMetadata {
  /** 作者邮箱；作者为字符串时为 null。 */
  authorEmail: null | string;
  /** 作者名称；包清单未声明作者时为 undefined。 */
  authorName?: string;
  /** 作者主页；作者为字符串时为 null。 */
  authorUrl: null | string;
  /** 构建时间，来自注入的日期替身。 */
  buildTime: string;
  /** 汇总后的运行期依赖版本。 */
  dependencies: Record<string, string>;
  /** 包描述。 */
  description?: string;
  /** 汇总后的开发依赖版本。 */
  devDependencies: Record<string, string>;
  /** 包主页。 */
  homepage?: string;
  /** 许可证标识。 */
  license?: string;
  /** 包版本号。 */
  version?: string;
}

/** 用例可设置的外部边界内容：包清单、monorepo 包集合与工作区清单。 */
const boundary = vi.hoisted(
  /** 建立包清单、日期与 monorepo 元数据的可设置容器。 */ () => ({
    /** 固定日期，使断言不依赖运行时刻。 */
    date: '2026-01-02 03:04:05',
    /** 工作区清单内容；null 表示读取不到清单。 */
    manifest: null as null | { catalog?: Record<string, string> },
    /** 当前包的清单内容。 */
    packageJSON: {} as Record<string, unknown>,
    /** monorepo 中全部包的清单内容。 */
    packages: [] as Array<Record<string, unknown>>,
  }),
);

vi.mock(
  '@vben/node-utils',
  /** 只替换包清单读取与日期格式化边界，插件自身的版本解析与 define 拼装逻辑保持真实实现。 */ () => ({
    /** 记录调用参数的日期替身，只实现 format。 */
    dateUtil: vi.fn(
      /** 返回只实现固定日期格式化的替身。 */ () => ({
        format: vi.fn(
          /** 返回固定日期，使断言不依赖运行时刻。 */ () => boundary.date,
        ),
      }),
    ),
    /** 返回固定的 monorepo 根目录，避免真实工作区探测。 */
    findMonorepoRoot: vi.fn(
      /** 返回用例约定的仓库根路径。 */ () => '/DUMMY-monorepo-root',
    ),
    /** 返回 monorepo 中的包清单集合。 */
    getPackages: vi.fn(
      /** 把容器中的包清单包装成 getPackages 的返回结构。 */ async () => ({
        packages: boundary.packages.map(
          /** 每个包只暴露插件读取的 packageJson 字段。 */ (packageJson) => ({
            packageJson,
          }),
        ),
      }),
    ),
    /** 返回用例设置的当前包清单内容。 */
    readPackageJSON: vi.fn(
      /** 静态返回当前包清单替身。 */ async () => boundary.packageJSON,
    ),
  }),
);

vi.mock(
  '@pnpm/workspace.read-manifest',
  /** 只替换工作区清单读取边界，catalog 版本的取值逻辑保持真实实现。 */ () => ({
    /** 返回用例设置的工作区清单。 */
    readWorkspaceManifest: vi.fn(
      /** 静态返回工作区清单替身。 */ async () => boundary.manifest,
    ),
  }),
);

/**
 * 把包清单内容换成指定值，并清空 monorepo 包集合。
 * @param packageJSON 当前包清单内容。
 */
function setPackageJSON(packageJSON: Record<string, unknown>) {
  boundary.packageJSON = packageJSON;
  boundary.packages = [];
}

/**
 * 取出插件注入到 define 的应用元数据。
 * @returns 注入到 define 的原始键值与解析后的应用元数据。
 * @throws TypeError 插件未声明元数据或声明内容不是合法 JSON 时抛出。
 */
async function injectedMetadata(): Promise<{
  define: Record<string, string>;
  metadata: InjectedMetadata;
}> {
  const plugin = (await viteMetadataPlugin(
    '/DUMMY-app-root',
  )) as MetadataPlugin;
  const { define } = await plugin.config();
  const raw = define.__VBEN_ADMIN_METADATA__;
  if (typeof raw !== 'string') {
    throw new TypeError('插件未注入应用元数据');
  }
  return { define, metadata: JSON.parse(raw) as InjectedMetadata };
}

describe('元数据插件装配', /** 插件名称与执行时机决定它在 Vite 流水线中的位置。 */ () => {
  it('声明插件名与后置执行时机', /** 名称写错会让构建报告无法定位该插件，时机写错会覆盖业务 define。 */ async () => {
    setPackageJSON({ version: '1.2.3' });
    const plugin = (await viteMetadataPlugin(
      '/DUMMY-app-root',
    )) as MetadataPlugin;

    expect(plugin.name).toBe('vite:inject-metadata');
    expect(plugin.enforce).toBe('post');
  });
});

describe('作者信息注入', /** 作者形态不同，取值口径必须分开处理。 */ () => {
  it('作者为对象时取名称、邮箱与主页', /** 对象作者按字符串读取会得到 "[object Object]" 或丢字段。 */ async () => {
    setPackageJSON({
      author: {
        email: 'DUMMY-author@example.com',
        name: '张三',
        url: 'https://example.com/author',
      },
      version: '1.2.3',
    });

    const { metadata } = await injectedMetadata();

    expect(metadata.authorName).toBe('张三');
    expect(metadata.authorEmail).toBe('DUMMY-author@example.com');
    expect(metadata.authorUrl).toBe('https://example.com/author');
    expect(metadata.version).toBe('1.2.3');
  });

  it('作者为字符串时邮箱与主页留空', /** 把字符串当对象读取会让构建直接失败。 */ async () => {
    setPackageJSON({ author: '李四', version: '2.0.0' });

    const { metadata } = await injectedMetadata();

    expect(metadata.authorName).toBe('李四');
    expect(metadata.authorEmail).toBeNull();
    expect(metadata.authorUrl).toBeNull();
  });

  it('包清单缺少可选字段时不注入空字符串', /** 用空串代替缺失字段会让版本面板显示空白项。 */ async () => {
    setPackageJSON({ version: '3.0.0' });

    const { metadata } = await injectedMetadata();

    expect(metadata.authorName).toBeUndefined();
    expect(metadata.description).toBeUndefined();
    expect(metadata.homepage).toBeUndefined();
    expect(metadata.license).toBeUndefined();
  });
});

describe('依赖版本解析', /** catalog 与 workspace 协议必须换成可直接展示的真实版本。 */ () => {
  it('按协议分别解析 catalog、workspace 与固定版本', /** 协议值原样注入会让产物出现无法解析的占位字符串。 */ async () => {
    setPackageJSON({ version: '1.2.3' });
    boundary.packages = [
      { name: '@vben/utils', version: '5.6.0' },
      {
        dependencies: {
          '@vben/utils': 'workspace:*',
          vue: 'catalog:',
          'vue-router': '^4.5.0',
        },
        devDependencies: { vitest: 'catalog:' },
        name: '@vben/web-ele',
        version: '5.6.0',
      },
    ];
    boundary.manifest = { catalog: { vitest: '3.2.4', vue: '3.5.31' } };

    const { metadata } = await injectedMetadata();

    expect(metadata.dependencies).toEqual({
      '@vben/utils': '5.6.0',
      vue: '3.5.31',
      'vue-router': '^4.5.0',
    });
    expect(metadata.devDependencies).toEqual({ vitest: '3.2.4' });
  });

  it('多个包的依赖合并后以最后一次声明为准', /** 合并口径写错会让不同包看到不一致的版本。 */ async () => {
    setPackageJSON({ version: '1.2.3' });
    boundary.packages = [
      { dependencies: { dayjs: '^1.11.0' }, name: '@vben/a', version: '1.0.0' },
      {
        dependencies: { dayjs: 'catalog:' },
        name: '@vben/b',
        version: '1.0.0',
      },
    ];
    boundary.manifest = { catalog: { dayjs: '1.11.19' } };

    const { metadata } = await injectedMetadata();

    expect(metadata.dependencies).toEqual({ dayjs: '1.11.19' });
  });

  it('工作区清单缺少 catalog 时丢弃无法解析的协议版本', /** 注入 undefined 会让 JSON 里出现悬空版本键。 */ async () => {
    setPackageJSON({ version: '1.2.3' });
    boundary.packages = [
      {
        dependencies: { vue: 'catalog:', 'vue-router': '^4.5.0' },
        name: '@vben/web-ele',
        version: '5.6.0',
      },
    ];
    boundary.manifest = null;

    const { metadata } = await injectedMetadata();

    expect(metadata.dependencies).toEqual({ 'vue-router': '^4.5.0' });
  });
});

describe('构建标识注入', /** 版本与构建时间直接展示在页面上，取错会让运维判断错版本。 */ () => {
  it('注入版本号与固定格式的构建时间', /** 缺少版本或时间格式不符会让用户无法判断当前部署。 */ async () => {
    setPackageJSON({ version: '5.6.0' });
    boundary.manifest = {};

    const { define, metadata } = await injectedMetadata();

    expect(define['import.meta.env.VITE_APP_VERSION']).toBe(
      JSON.stringify('5.6.0'),
    );
    expect(metadata.buildTime).toBe(boundary.date);
  });
});
