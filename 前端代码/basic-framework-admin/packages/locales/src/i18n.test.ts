/**
 * 国际化装配（locales 的 i18n）真实行为回归。
 *
 * 该模块把按目录组织的语言包分片合并成 vue-i18n 消息，并在切换语言时同步 HTML lang
 * 属性。分片合并或非对象导出处理错误会让整份语言包缺键，语言切换未同步 lang 属性
 * 会让屏幕阅读器与浏览器断词使用错误语言，`loadMessages` 兜底缺失会让应用无法追加
 * 自身翻译。用例使用真实 vue-i18n 实例与真实语言包文件，只对语言包映射传入自造模块，
 * 目录解析、合并、语言切换与追加翻译全部按真实实现执行。
 */
import type { App } from 'vue';
import type { Locale } from 'vue-i18n';

import { createApp } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  i18n,
  loadLocaleMessages,
  loadLocalesMap,
  loadLocalesMapFromDir,
  setupI18n,
} from './i18n';

/** 与生产一致的目录语言包正则：语言目录 + 分片文件名。 */
const DIR_REGEXP = /\.\/langs\/([^/]+)\/(.*)\.json$/;

/**
 * 构造只渲染空内容的 Vue 应用，用于装配国际化插件。
 * @returns 未挂载的 Vue 应用实例。
 */
function createTestApp(): App {
  return createApp({
    /** 测试不需要渲染任何界面元素。 */ render: () => null,
  });
}

/**
 * 构造语言包分片的导入函数。
 * @param exported 动态导入解析出的模块内容，可为对象、字符串或空值。
 * @returns 返回该内容的导入函数，形状与 import.meta.glob 的产物一致。
 */
function loadShard(exported: unknown) {
  return /** 返回该模块内容的异步导入函数。 */ () => Promise.resolve(exported);
}

beforeEach(
  /** 清空告警记录，避免缺键告警断言读到上一例的调用。 */ () => {
    vi.restoreAllMocks();
  },
);

describe('语言包映射构建（按文件名）', /** loadLocalesMap 供外部按扁平文件名取语言包，键名规则是它的公开契约。 */ () => {
  it('用文件名作为键并保留原导入函数', /** 键名取错会让调用方按语言名取不到语言包。 */ () => {
    const common = loadShard({ default: { hello: 'hi' } });
    const ui = loadShard({ default: { ok: 'OK' } });

    const map = loadLocalesMap({
      './langs/en-US/common.json': common,
      './langs/en-US/ui.json': ui,
    });

    expect(Object.keys(map)).toEqual(['common', 'ui']);
    expect(map.common).toBe(common);
    expect(map.ui).toBe(ui);
  });

  it('路径里没有 json 文件名时跳过该模块', /** 无文件名可取的模块混进映射会让语言包读取到错误内容。 */ () => {
    const ui = loadShard({ default: { ok: 'OK' } });

    const map = loadLocalesMap({
      './langs/en-US': loadShard({ default: {} }),
      './langs/zh-CN/ui.json': ui,
    });

    expect(Object.keys(map)).toEqual(['ui']);
    expect(map.ui).toBe(ui);
  });

  it('不同语言的同名分片互相覆盖', /** 该函数只按文件名取键，同名分片必然覆盖，故生产改用按目录版本。 */ () => {
    const english = loadShard({ default: { hello: 'hi' } });
    const chinese = loadShard({ default: { hello: '你好' } });

    const map = loadLocalesMap({
      './langs/en-US/common.json': english,
      './langs/zh-CN/common.json': chinese,
    });

    expect(Object.keys(map)).toEqual(['common']);
    expect(map.common).toBe(chinese);
  });
});

describe('语言包映射构建（按目录）', /** 按目录版本按语言分组合并分片，是生产实际使用的装配入口。 */ () => {
  it('按语言合并各分片的 default 导出', /** 少合并一个分片会让该语言的整块文案缺键。 */ async () => {
    const map = loadLocalesMapFromDir(DIR_REGEXP, {
      './langs/en-US/common.json': loadShard({ default: { hello: 'hi' } }),
      './langs/en-US/ui.json': loadShard({ default: { ok: 'OK' } }),
      './langs/zh-CN/common.json': loadShard({ default: { hello: '你好' } }),
    });

    expect(Object.keys(map).toSorted()).toEqual(['en-US', 'zh-CN']);
    await expect(map['en-US']?.()).resolves.toEqual({
      default: { common: { hello: 'hi' }, ui: { ok: 'OK' } },
    });
    await expect(map['zh-CN']?.()).resolves.toEqual({
      default: { common: { hello: '你好' } },
    });
  });

  it('非对象导出与缺少 default 的分片被跳过', /** 把字符串或 undefined 当消息写入会让 vue-i18n 报错并整包不可用。 */ async () => {
    const map = loadLocalesMapFromDir(DIR_REGEXP, {
      './langs/en-US/nodflt.json': loadShard({ hello: 'x' }),
      './langs/en-US/null.json': loadShard(null),
      './langs/en-US/ok.json': loadShard({ default: { ok: 'OK' } }),
      './langs/en-US/text.json': loadShard('plain text'),
    });

    await expect(map['en-US']?.()).resolves.toEqual({
      default: { ok: { ok: 'OK' } },
    });
  });

  it('不匹配目录规则的文件不进入映射', /** 目录外的文件混进语言集合会让语言下拉出现无效语言。 */ async () => {
    const map = loadLocalesMapFromDir(DIR_REGEXP, {
      './langs/extra.json': loadShard({ default: { ok: 'OK' } }),
    });

    expect(Object.keys(map)).toEqual([]);
  });

  it('按语言缓存分片列表，重复调用重新读取', /** 分片列表在构建时固化，重复调用必须仍返回完整消息。 */ async () => {
    const map = loadLocalesMapFromDir(DIR_REGEXP, {
      './langs/en-US/common.json': loadShard({ default: { hello: 'hi' } }),
    });

    await expect(map['en-US']?.()).resolves.toEqual({
      default: { common: { hello: 'hi' } },
    });
    await expect(map['en-US']?.()).resolves.toEqual({
      default: { common: { hello: 'hi' } },
    });
  });
});

describe('应用国际化装配', /** setupI18n 决定应用启动时的语言、消息来源与缺键提示。 */ () => {
  it('默认语言加载内置语言包并同步 HTML lang', /** 未加载内置语言包会让首屏文案全部显示成语言键。 */ async () => {
    await setupI18n(createTestApp());

    expect(i18n.global.locale.value).toBe('zh-CN');
    expect(i18n.global.t('ui.actionMessage.operationSuccess')).toBe('操作成功');
    expect(document.querySelector('html')?.getAttribute('lang')).toBe('zh-CN');
  });

  it('未提供追加语言包时使用空消息兜底', /** 兜底缺失会让应用在没有追加翻译时直接抛错。 */ async () => {
    const app = createTestApp();

    await expect(setupI18n(app)).resolves.toBeUndefined();
    expect(i18n.global.t('ui.actionMessage.operationSuccess')).toBe('操作成功');
  });

  it('追加语言包与内置语言包合并', /** 合并方向写反会让应用自身翻译覆盖框架内置文案。 */ async () => {
    await setupI18n(createTestApp(), {
      defaultLocale: 'en-US',
      /** 返回应用自己的增量翻译，验证合并而不是替换。 */
      loadMessages: async (lang) => ({ extra: { language: lang } }),
    });

    expect(i18n.global.locale.value).toBe('en-US');
    expect(i18n.global.t('extra.language')).toBe('en-US');
    expect(i18n.global.t('ui.actionMessage.operationSuccess')).toBe(
      'Operation succeeded',
    );
    expect(document.querySelector('html')?.getAttribute('lang')).toBe('en-US');
  });

  it('重复切换同一语言时直接同步语言属性', /** 重复切换必须仍然可用，否则界面会停在上一语言。 */ async () => {
    await setupI18n(createTestApp(), { defaultLocale: 'zh-CN' });

    await expect(loadLocaleMessages('zh-CN')).resolves.toBeUndefined();

    expect(i18n.global.locale.value).toBe('zh-CN');
    expect(document.querySelector('html')?.getAttribute('lang')).toBe('zh-CN');
  });

  it('开启缺键告警时按语言键提示', /** 缺键告警能帮助定位漏翻的语言键，关闭时不得输出。 */ async () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(/** 抑制告警输出，只记录调用。 */ () => {});
    await setupI18n(createTestApp(), { missingWarn: true });

    i18n.global.t('missingSection.missingKey');

    expect(
      warn.mock.calls.some(
        /** 命中缺键提示的调用。 */ ([message]) =>
          String(message).includes('missingSection.missingKey'),
      ),
    ).toBe(true);
  });

  it('关闭缺键告警时不输出提示', /** 未开启告警仍输出会污染生产控制台。 */ async () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(/** 抑制告警输出，只记录调用。 */ () => {});
    await setupI18n(createTestApp(), { missingWarn: false });

    i18n.global.t('anotherSection.anotherKey');

    expect(warn).not.toHaveBeenCalled();
  });

  it('真实语言目录与支持的语言集合一致', /** 目录缺失或多余会让语言下拉出现空语言包或漏掉已支持语言。 */ async () => {
    const map = loadLocalesMapFromDir(
      DIR_REGEXP,
      import.meta.glob('./langs/**/*.json'),
    );
    const locales = Object.keys(map) as Locale[];

    expect(locales.toSorted()).toEqual(['en-US', 'zh-CN']);
    const english = await map['en-US']?.();
    expect(Object.keys(english?.default ?? {}).toSorted()).toEqual([
      'authentication',
      'common',
      'preferences',
      'profile',
      'ui',
    ]);
  });
});
