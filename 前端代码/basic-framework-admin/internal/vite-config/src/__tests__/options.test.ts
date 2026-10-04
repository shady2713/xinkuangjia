/**
 * Vite PWA 默认选项（vite-config 的 options.ts）取值回归。
 *
 * `getDefaultPwaOptions` 是各应用 PWA 清单的唯一来源：名称、图标与描述会直接写入
 * 浏览器安装清单，开发环境还必须追加 ` dev` 标记以区分本地安装与生产安装。
 * 用例断言真实返回的清单结构，并在开发环境变量下重新加载模块核对名称后缀。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getDefaultPwaOptions } from '../options';

/** 应用名夹具，用于核对名称与短名称的统一拼接规则。 */
const APP_NAME = '测试管理台';

describe('getDefaultPwaOptions 默认清单', /** 清单字段直接面向浏览器安装入口，取值变化属于对外契约。 */ () => {
  afterEach(
    /** 恢复被替换的环境变量并丢弃开发环境模块实例。 */ () => {
      vi.unstubAllEnvs();
      vi.resetModules();
    },
  );

  it('生成包含描述与双尺寸图标的清单', /** 图标尺寸与路径写错会导致安装后无图标或图标模糊。 */ () => {
    const options = getDefaultPwaOptions(APP_NAME);

    expect(options.manifest).toEqual({
      description: 'A modern admin console built with Vue 3.',
      icons: [
        { sizes: '192x192', src: '/brand-logo.png', type: 'image/png' },
        { sizes: '512x512', src: '/brand-logo.png', type: 'image/png' },
      ],
      name: APP_NAME,
      short_name: APP_NAME,
    });
  });

  it('名称与短名称始终使用同一个应用名', /** 两处取值漂移会让桌面图标与安装清单显示不同名称。 */ () => {
    const options = getDefaultPwaOptions('另一个应用');

    expect(options.manifest?.name).toBe('另一个应用');
    expect(options.manifest?.short_name).toBe('另一个应用');
  });

  it('只返回 manifest 字段，不覆盖其它 PWA 配置', /** 返回多余字段会覆盖插件默认值，影响离线缓存行为。 */ () => {
    const options = getDefaultPwaOptions(APP_NAME);

    expect(Object.keys(options)).toEqual(['manifest']);
  });

  it.each(['test', 'production'])(
    '非开发环境（NODE_ENV=%s）不追加 dev 标记',
    /** 生产安装包名称不能带开发后缀。 */ (nodeEnv) => {
      vi.stubEnv('NODE_ENV', nodeEnv);
      vi.resetModules();

      return import('../options').then(
        /** 读取在第环境变量下重新加载的模块工厂。 */ (module) => {
          expect(module.getDefaultPwaOptions(APP_NAME).manifest?.name).toBe(
            APP_NAME,
          );
        },
      );
    },
  );

  it('开发环境在名称与短名称后追加 dev 标记', /** 本地安装与生产安装需要可区分的名称。 */ async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();

    const module = await import('../options');
    const options = module.getDefaultPwaOptions(APP_NAME);

    expect(options.manifest?.name).toBe(`${APP_NAME} dev`);
    expect(options.manifest?.short_name).toBe(`${APP_NAME} dev`);
    // 追加后缀不能影响描述与图标。
    expect(options.manifest?.description).toBe(
      'A modern admin console built with Vue 3.',
    );
    expect(options.manifest?.icons).toHaveLength(2);
  });
});
