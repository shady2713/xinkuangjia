/**
 * Nitro mock 插件（vite-config 的 plugins/nitro-mock）真实行为回归。
 *
 * 该插件在开发期为前端提供 mock 接口：端口被占用或 mock 服务包未安装时必须静默跳过，
 * 否则开发者会被无关的启动错误打断；可用时必须把 mock 入口追加到 Vite 打印的地址列表里，
 * 否则前端不知道 mock 服务地址；Nitro 配置变更时只有 runtimeConfig/routeRules 走热更新，
 * 其余变更必须整体重启，否则会带着旧配置继续服务；重启前必须取消旧配置监听并关闭旧实例，
 * 否则旧实例继续占用端口导致重启失败。用例只替换 Nitro 运行时、端口探测、包查询与日志
 * 输出边界，插件自身的判断、顺序与错误处理保持真实实现。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { viteNitroMockPlugin } from '../nitro-mock';

/** 开发服务器地址打印签名：mock 入口会包装它并保留原始输出。 */
type PrintUrls = () => void;

/** Nitro 重启回调签名：整体重启由插件重新创建实例。 */
type RestartHandler = () => Promise<void>;

/** Nitro 实例替身契约：记录关闭、热更新与钩子注册调用。 */
interface NitroStub {
  /** 关闭实例；重启路径必须调用它。 */
  close: ReturnType<typeof vi.fn>;
  /** 一次性钩子注册入口；用例据此取出 restart 回调。 */
  hooks: { hookOnce: ReturnType<typeof vi.fn> };
  /** 实例选项；_c12 模拟 c12 配置对象。 */
  options: { _c12: { unwatch?: ReturnType<typeof vi.fn> } };
  /** 热更新配置入口。 */
  updateConfig: ReturnType<typeof vi.fn>;
}

/** 配置差异条目替身：插件只读取 key 并调用 toString。 */
interface DiffEntryStub {
  /** 差异字段名，决定走热更新还是重启。 */
  key: string;
  /** 打印到日志中的差异描述。 */
  toString: () => string;
}

/** 用例可设置与断言的第三方边界状态。 */
const boundary = vi.hoisted(
  /** 建立端口、包查询、实例与日志替身的共享容器。 */ () => ({
    /** getPort 的解析值；不等于配置端口表示端口已被占用。 */
    availablePort: 5320,
    /** c12 配置对象；用例可移除 unwatch 以验证静态加载分支。 */
    c12: {} as { unwatch?: ReturnType<typeof vi.fn> },
    /** 日志替身集合，用例据此断言启动、跳过与变更日志。 */
    consola: {
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
    },
    /** createNitro 收到的全部参数。 */
    createNitroCalls: [] as Array<[unknown, unknown]>,
    /** 是否在 createNitro 返回前触发一次配置变更回调，用于覆盖实例未就绪的守卫。 */
    earlyUpdate: false,
    /** 提前触发的配置变更回调返回的 Promise，供用例等待其完成。 */
    earlyUpdatePromise: undefined as Promise<void> | undefined,
    /** createDevServer 收到的 Nitro 实例。 */
    devServerCalls: [] as unknown[],
    /** getPackage 的返回值；undefined 表示包未安装。 */
    pkg: { dir: '/DUMMY-mock-pkg' } as undefined | { dir: string },
    /** 每次 createNitro 生成的实例，按创建顺序排列。 */
    nitros: [] as NitroStub[],
    /** 通过 hookOnce 登记的 restart 回调。 */
    restartHandlers: [] as RestartHandler[],
    /** 开发服务器 listen 调用记录。 */
    serverListen: vi.fn(/** 模拟监听成功。 */ async () => {}),
  }),
);

vi.mock(
  '@vben/node-utils',
  /** 只替换包查询、颜色与日志边界，插件的启动顺序与配置判断保持真实实现。 */ () => ({
    colors: {
      /** 原样返回文本，使期望值不包含 ANSI 转义序列。 */
      bold: (value: string) => value,
      /** 原样返回文本，使期望值不包含 ANSI 转义序列。 */
      cyan: (value: string) => value,
      /** 原样返回文本，使期望值不包含 ANSI 转义序列。 */
      green: (value: string) => value,
    },
    consola: boundary.consola,
    getPackage: vi.fn(
      /** 返回用例设置的 mock 服务包信息。 */ async () => boundary.pkg,
    ),
  }),
);

vi.mock(
  'get-port',
  /** 只替换端口探测边界，端口占用判断保持真实实现。 */ () => ({
    /** 返回用例设置的可用端口。 */
    default: vi.fn(
      /** 静态返回当前可用端口替身。 */ async () => boundary.availablePort,
    ),
  }),
);

vi.mock(
  'nitropack',
  /** 只替换 Nitro 运行时边界，插件自身的启动、重启与配置判断保持真实实现。 */ () => ({
    /** 模拟构建完成。 */
    build: vi.fn(/** 记录一次构建调用。 */ async () => {}),
    /** 生成记录监听的开发服务器替身。 */
    createDevServer: vi.fn(
      /**
       * 记录 Nitro 实例并返回开发服务器替身。
       * @param nitro 插件创建的 Nitro 实例。
       * @returns 只记录 listen 调用的服务器替身。
       */
      (nitro: unknown) => {
        boundary.devServerCalls.push(nitro);
        return { listen: boundary.serverListen };
      },
    ),
    /** 生成可断言的 Nitro 实例并记录启动参数。 */
    createNitro: vi.fn(
      /**
       * 建立 Nitro 实例替身。
       * @param config createNitro 的配置参数。
       * @param options createNitro 的运行时参数，含 c12 回调。
       * @returns 可断言的 Nitro 实例替身。
       */
      async (config: unknown, options: unknown) => {
        boundary.createNitroCalls.push([config, options]);
        const runtimeOptions = options as NitroRuntimeOptions;
        // 配置监听可能先于 createNitro 兑现触发，此处复刻该时序以覆盖实例未就绪的守卫。
        if (boundary.earlyUpdate) {
          boundary.earlyUpdatePromise = runtimeOptions.c12.onUpdate({
            /** 返回一条仅用于触发守卫的配置差异。 */
            getDiff: () => [
              {
                key: 'runtimeConfig.early',
                /** 生成稳定的差异描述，避免断言依赖真实配置内容。 */
                toString: () => 'runtimeConfig.early: DUMMY-old -> DUMMY-new',
              },
            ],
            newConfig: { config: { runtimeConfig: { key: 'DUMMY-early' } } },
          });
        }
        const instance: NitroStub = {
          /** 记录关闭调用。 */
          close: vi.fn(/** 模拟实例关闭完成。 */ async () => {}),
          hooks: {
            hookOnce: vi.fn(
              /** 记录 restart 回调供用例手动触发重启。 */
              (name: string, handler: RestartHandler) => {
                if (name === 'restart') {
                  boundary.restartHandlers.push(handler);
                }
              },
            ),
          },
          options: { _c12: boundary.c12 },
          /** 记录热更新配置。 */
          updateConfig: vi.fn(/** 模拟热更新完成。 */ async () => {}),
        };
        boundary.nitros.push(instance);
        return instance;
      },
    ),
    /** 模拟实例准备完成。 */
    prepare: vi.fn(/** 记录一次准备调用。 */ async () => {}),
  }),
);

/** Nitro 配置变更上下文：c12 在配置变化时提供的取差函数与新配置。 */
interface NitroUpdateContext {
  /** 取出本次配置差异列表。 */
  getDiff: () => DiffEntryStub[];
  /** 合并后的新配置；config 为热更新所需的目标配置。 */
  newConfig: { config: Record<string, unknown> };
}

/** c12 配置对象契约：插件只在其中注册配置变更回调。 */
interface C12Options {
  /** 配置变更回调；插件据此判断走热更新还是整体重启。 */
  onUpdate: (context: NitroUpdateContext) => Promise<void>;
}

/** c12 运行时参数契约：插件在此注册配置变更回调。 */
interface NitroRuntimeOptions {
  /** c12 配置对象，注册配置变更回调。 */
  c12: C12Options;
  /** 是否以 watch 方式加载配置。 */
  watch: boolean;
}

/** 插件对象中本用例需要驱动的字段；Vite 的联合返回类型此处按实际结构收窄。 */
type NitroMockPlugin = {
  /** 安装到开发服务器上的钩子，本用例只驱动它启动 mock 服务。 */
  configureServer: (server: { printUrls: PrintUrls }) => Promise<void>;
  /** 插件执行时机标记。 */
  enforce?: string;
  /** 插件名称，用于 Vite 内部识别与用户排查。 */
  name?: string;
};

/**
 * 等待被调起的异步启动链路完成；configureServer 不等待 runNitroServer。
 * @param rounds 微任务轮数，覆盖启动链路中的多层 await。
 */
async function flushAsync(rounds = 8) {
  for (let index = 0; index < rounds; index++) {
    await Promise.resolve();
  }
}

/**
 * 取出插件创建的 Nitro 实例。
 * @param index 实例下标，按创建顺序排列。
 * @returns 命中的 Nitro 实例替身。
 * @throws Error 插件没有创建该序号的实例时抛出，避免用例静默地什么都不验证。
 */
function requireNitro(index: number): NitroStub {
  const instance = boundary.nitros[index];
  if (!instance) {
    throw new Error(`插件未创建第 ${index} 个 Nitro 实例`);
  }
  return instance;
}

/**
 * 取出 createNitro 收到的运行时参数。
 * @param index 实例下标，按创建顺序排列。
 * @returns 该次调用的运行时参数。
 * @throws TypeError 该次调用没有运行时参数时抛出，避免读取 undefined。
 */
function requireNitroOptions(index: number) {
  const call = boundary.createNitroCalls[index];
  if (!call) {
    throw new TypeError(`插件未发起第 ${index} 次 createNitro`);
  }
  return call[1] as NitroRuntimeOptions;
}

/**
 * 建立一条配置差异条目。
 * @param key 差异字段名。
 * @returns 可供插件读取 key 与打印描述的条目替身。
 */
function createDiffEntry(key: string): DiffEntryStub {
  return {
    key,
    /** 生成稳定的差异描述，避免断言依赖真实配置内容。 */
    toString: () => `${key}: DUMMY-old -> DUMMY-new`,
  };
}

/**
 * 驱动一次配置变更回调。
 * @param index 实例下标，取对应实例的 onUpdate 回调。
 * @param diff 本次变更的差异条目。
 */
async function triggerConfigUpdate(index: number, diff: DiffEntryStub[]) {
  const options = requireNitroOptions(index);
  await options.c12.onUpdate({
    /** 返回本用例构造的差异列表。 */
    getDiff: () => diff,
    newConfig: { config: { runtimeConfig: { key: 'DUMMY-value' } } },
  });
}

beforeEach(
  /** 重置第三方边界的调用记录与可设置状态，避免上一例影响断言。 */ () => {
    vi.clearAllMocks();
    boundary.availablePort = 5320;
    boundary.c12 = {
      /** 记录取消配置监听的调用。 */
      unwatch: vi.fn(/** 模拟取消监听完成。 */ async () => {}),
    };
    boundary.createNitroCalls.length = 0;
    boundary.earlyUpdate = false;
    boundary.earlyUpdatePromise = undefined;
    boundary.devServerCalls.length = 0;
    boundary.nitros.length = 0;
    boundary.pkg = { dir: '/DUMMY-mock-pkg' };
    boundary.restartHandlers.length = 0;
  },
);

describe('mock 服务启动条件', /** 端口占用与包缺失都必须静默跳过，不能打断主应用启动。 */ () => {
  it('声明插件名与前置执行时机', /** 名称或时机写错会让 mock 服务在错误阶段启动。 */ () => {
    const plugin = viteNitroMockPlugin() as NitroMockPlugin;

    expect(plugin.name).toBe('vite:mock-server');
    expect(plugin.enforce).toBe('pre');
  });

  it('端口被占用时静默跳过', /** 抢占他人端口会让开发服务启动失败。 */ async () => {
    boundary.availablePort = 5400;
    const plugin = viteNitroMockPlugin() as NitroMockPlugin;

    await plugin.configureServer({ printUrls: vi.fn() });
    await flushAsync();

    expect(boundary.createNitroCalls).toHaveLength(0);
    expect(boundary.consola.log).not.toHaveBeenCalled();
  });

  it('mock 服务包未安装时打印跳过日志', /** 静默跳过会让开发者不知道 mock 接口为何不可用。 */ async () => {
    boundary.pkg = undefined;
    const plugin = viteNitroMockPlugin({
      mockServerPackage: '@vben/backend-mock',
    }) as NitroMockPlugin;

    await plugin.configureServer({ printUrls: vi.fn() });
    await flushAsync();

    expect(boundary.consola.log).toHaveBeenCalledWith(
      'Package @vben/backend-mock not found. Skip mock server.',
    );
    expect(boundary.createNitroCalls).toHaveLength(0);
  });

  it('按包目录与配置端口启动 mock 服务', /** rootDir 或端口传错会让 mock 服务加载错配置或监听错端口。 */ async () => {
    const plugin = viteNitroMockPlugin({ port: 5320 }) as NitroMockPlugin;

    await plugin.configureServer({ printUrls: vi.fn() });
    await flushAsync();

    expect(boundary.createNitroCalls).toHaveLength(1);
    expect(boundary.createNitroCalls[0]?.[0]).toEqual({
      dev: true,
      preset: 'nitro-dev',
      rootDir: '/DUMMY-mock-pkg',
    });
    expect(requireNitroOptions(0).watch).toBe(true);
    expect(boundary.serverListen).toHaveBeenCalledWith(5320, {
      showURL: false,
    });
    expect(boundary.consola.success).toHaveBeenCalledWith(
      'Nitro Mock Server started.',
    );
    expect(requireNitro(0).hooks.hookOnce).toHaveBeenCalledWith(
      'restart',
      expect.any(Function),
    );
  });

  it('verbose 关闭时不打印启动日志', /** 静默模式仍打印会让 CI 日志出现无关噪音。 */ async () => {
    const plugin = viteNitroMockPlugin({ verbose: false }) as NitroMockPlugin;

    await plugin.configureServer({ printUrls: vi.fn() });
    await flushAsync();

    expect(boundary.createNitroCalls).toHaveLength(1);
    expect(boundary.consola.success).not.toHaveBeenCalled();
  });

  it('把 mock 入口追加到 Vite 打印的地址列表', /** 不追加地址会让前端不知道 mock 服务从哪里访问。 */ async () => {
    const printUrls = vi.fn();
    const plugin = viteNitroMockPlugin({ port: 5320 }) as NitroMockPlugin;
    const server = { printUrls };

    await plugin.configureServer(server);
    await flushAsync();
    server.printUrls();

    expect(printUrls).toHaveBeenCalledTimes(1);
    expect(boundary.consola.log).toHaveBeenLastCalledWith(
      '  ->  Nitro Mock Server: http://localhost:5320/api',
    );
  });
});

describe('mock 服务配置变更', /** 配置变更的处理方式决定前端改配置后能否立即生效。 */ () => {
  it('差异为空时不做任何处理', /** 空差异仍重启会让每次文件触碰都重启 mock 服务。 */ async () => {
    const plugin = viteNitroMockPlugin() as NitroMockPlugin;
    await plugin.configureServer({ printUrls: vi.fn() });
    await flushAsync();

    await triggerConfigUpdate(0, []);

    expect(requireNitro(0).updateConfig).not.toHaveBeenCalled();
    expect(boundary.nitros).toHaveLength(1);
  });

  it('runtimeConfig 与 routeRules 变更走热更新', /** 这两类变更重启会中断正在进行的调试请求。 */ async () => {
    const plugin = viteNitroMockPlugin() as NitroMockPlugin;
    await plugin.configureServer({ printUrls: vi.fn() });
    await flushAsync();

    await triggerConfigUpdate(0, [
      createDiffEntry('runtimeConfig.apiBase'),
      createDiffEntry('routeRules./api/**'),
    ]);

    expect(requireNitro(0).updateConfig).toHaveBeenCalledWith({
      runtimeConfig: { key: 'DUMMY-value' },
    });
    expect(boundary.nitros).toHaveLength(1);
    expect(boundary.consola.info).toHaveBeenCalledWith(
      'Nitro config updated:\n  runtimeConfig.apiBase: DUMMY-old -> DUMMY-new\n  routeRules./api/**: DUMMY-old -> DUMMY-new',
    );
  });

  it('非热更新键变更整体重启实例', /** 带着旧配置继续服务会让 mock 行为与配置不一致。 */ async () => {
    const plugin = viteNitroMockPlugin() as NitroMockPlugin;
    await plugin.configureServer({ printUrls: vi.fn() });
    await flushAsync();

    await triggerConfigUpdate(0, [createDiffEntry('preset')]);
    await flushAsync();

    expect(boundary.nitros).toHaveLength(2);
    expect(boundary.consola.info).toHaveBeenCalledWith(
      'Restarting dev server...',
    );
    expect(boundary.c12.unwatch).toHaveBeenCalledTimes(1);
    expect(requireNitro(0).close).toHaveBeenCalledTimes(1);
    expect(boundary.serverListen).toHaveBeenCalledTimes(2);
  });

  it('热更新与整体重启混合时按整体重启处理', /** 只要有一个非热更新键就必须重启，漏判会留下半套新配置。 */ async () => {
    const plugin = viteNitroMockPlugin() as NitroMockPlugin;
    await plugin.configureServer({ printUrls: vi.fn() });
    await flushAsync();

    await triggerConfigUpdate(0, [
      createDiffEntry('runtimeConfig.apiBase'),
      createDiffEntry('preset'),
    ]);
    await flushAsync();

    expect(requireNitro(0).updateConfig).not.toHaveBeenCalled();
    expect(boundary.nitros).toHaveLength(2);
  });

  it('静态加载的配置对象没有取消监听方法时跳过', /** 对静态配置调用 unwatch 会让重启直接抛错。 */ async () => {
    boundary.c12 = {};
    const plugin = viteNitroMockPlugin() as NitroMockPlugin;
    await plugin.configureServer({ printUrls: vi.fn() });
    await flushAsync();

    await triggerConfigUpdate(0, [createDiffEntry('preset')]);
    await flushAsync();

    expect(requireNitro(0).close).toHaveBeenCalledTimes(1);
    expect(boundary.nitros).toHaveLength(2);
  });

  it('verbose 关闭时不打印配置变更内容', /** 静默模式仍打印差异会泄露本地配置内容。 */ async () => {
    const plugin = viteNitroMockPlugin({ verbose: false }) as NitroMockPlugin;
    await plugin.configureServer({ printUrls: vi.fn() });
    await flushAsync();

    await triggerConfigUpdate(0, [createDiffEntry('runtimeConfig.apiBase')]);

    expect(boundary.consola.info).not.toHaveBeenCalled();
    expect(requireNitro(0).updateConfig).toHaveBeenCalledTimes(1);
  });

  it('实例就绪前收到配置变更时只记录日志，不热更新也不重启', /** 实例未就绪就热更新或重启会抛出空实例错误并留下半套配置。 */ async () => {
    boundary.earlyUpdate = true;
    const plugin = viteNitroMockPlugin() as NitroMockPlugin;

    await plugin.configureServer({ printUrls: vi.fn() });
    await flushAsync();
    await boundary.earlyUpdatePromise;

    expect(boundary.consola.info).toHaveBeenCalledWith(
      'Nitro config updated:\n  runtimeConfig.early: DUMMY-old -> DUMMY-new',
    );
    expect(requireNitro(0).updateConfig).not.toHaveBeenCalled();
    expect(boundary.nitros).toHaveLength(1);
  });

  it('restart 钩子触发整体重启', /** 遗漏该钩子会让 Nitro 主动重启后端口无人接管。 */ async () => {
    const plugin = viteNitroMockPlugin() as NitroMockPlugin;
    await plugin.configureServer({ printUrls: vi.fn() });
    await flushAsync();

    const restart = boundary.restartHandlers[0];
    if (!restart) {
      throw new Error('插件未登记 restart 钩子');
    }
    await restart();
    await flushAsync();

    expect(requireNitro(0).close).toHaveBeenCalledTimes(1);
    expect(boundary.nitros).toHaveLength(2);
  });
});
