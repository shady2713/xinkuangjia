/**
 * 关于页（effects/common-ui 的 ui/about/about）构建期元数据分支渲染回归。
 *
 * 关于页把构建期注入的版本、许可证、构建时间、主页、维护者与依赖清单直接展示给运维和排障人员：
 * 元数据缺失时不显示占位会让页面出现空白条目，主页或邮箱判断写反会让链接指向空地址，
 * 维护者名称与主页地址的取舍错误会丢掉联系方式，依赖清单遗漏会让排障时无从确认实际版本。
 * 用例按不同元数据重新求值模块并挂载真实组件（元数据是构建期注入的全局外部输入），
 * 断言真实 DOM 中的条目、链接与依赖清单。
 */
import type { AboutProps } from './about';

import { mount } from '@vue/test-utils';

import { afterEach, describe, expect, it, vi } from 'vitest';

/** 最近一次挂载的关于页，用例结束后统一卸载，避免残留污染后续用例。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载组件并清理全局元数据替身，避免用例之间互相影响。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    vi.unstubAllGlobals();
  },
);

/**
 * 用给定元数据重新求值关于页模块并挂载。
 * @param metadata 构建期注入的管理端元数据；传 undefined 表示注入缺失。
 * @param props 页面属性，用来覆盖标题、系统名称与说明文案。
 * @returns 已挂载的关于页包装器。
 */
async function mountAbout(
  metadata?: Record<string, unknown>,
  props: Partial<AboutProps> = {},
) {
  vi.stubGlobal('__VBEN_ADMIN_METADATA__', metadata);
  vi.resetModules();
  const { default: About } = await import('./about.vue');
  const wrapper = mount(About, { props });
  mounted = wrapper;
  return wrapper;
}

describe('关于页元数据展示', /** 元数据条目决定用户能否确认当前部署的真实版本与许可。 */ () => {
  it('完整元数据渲染基本信息、维护者与依赖清单', /** 条目或链接缺失会让排障人员拿不到版本与联系方式。 */ async () => {
    const wrapper = await mountAbout({
      authorEmail: 'dev@example.test',
      authorName: 'DUMMY-维护者',
      authorUrl: 'https://example.test/author',
      buildTime: 'DUMMY-2026-01-01 00:00:00',
      dependencies: { 'DUMMY-vue': '3.5.0' },
      devDependencies: { 'DUMMY-vite': '7.0.0' },
      homepage: 'https://example.test/home',
      license: 'MIT',
      version: '5.5.9',
    });

    expect(
      wrapper
        .findAll('dt')
        .map(/** 提取条目标题，核对条目顺序与完整性。 */ (node) => node.text()),
    ).toEqual([
      '版本',
      '许可证',
      '构建时间',
      '主页',
      '维护者',
      'DUMMY-vue',
      'DUMMY-vite',
    ]);
    const details = wrapper
      .findAll('dd')
      .map(/** 提取条目内容，核对元数据真实落值。 */ (node) => node.text());
    expect(details.slice(0, 4)).toEqual([
      '5.5.9',
      'MIT',
      'DUMMY-2026-01-01 00:00:00',
      '查看',
    ]);
    expect(details[4]).toContain('DUMMY-维护者');
    expect(details[4]).toContain('dev@example.test');
    expect(details.slice(5)).toEqual(['3.5.0', '7.0.0']);
  });

  it('主页与维护者渲染为新窗口打开的链接', /** 链接地址或打开方式错误会让用户离开当前系统或跳转到空地址。 */ async () => {
    const wrapper = await mountAbout({
      authorEmail: 'dev@example.test',
      authorName: 'DUMMY-维护者',
      authorUrl: 'https://example.test/author',
      homepage: 'https://example.test/home',
    });

    const links = wrapper.findAll('a');
    expect(
      links.map(
        /** 收集链接地址，核对三类链接各自指向真实目标。 */ (node) =>
          node.attributes('href'),
      ),
    ).toEqual([
      'https://example.test/home',
      'https://example.test/author',
      'mailto:dev@example.test',
    ]);
    expect(
      links.map(
        /** 收集链接文案，核对主页入口与联系方式可读。 */ (node) => node.text(),
      ),
    ).toEqual(['查看', 'DUMMY-维护者', 'dev@example.test']);
    for (const link of links) {
      expect(link.attributes('target')).toBe('_blank');
      expect(link.classes()).toContain('vben-link');
    }
  });

  it('调用方传入的标题、系统名称与说明覆盖默认文案', /** 默认文案写死会让业务无法展示自己的系统名称。 */ async () => {
    const wrapper = await mountAbout(
      { version: '5.5.9' },
      {
        description: 'DUMMY-关于页说明',
        name: 'DUMMY-系统名',
        title: 'DUMMY-关于标题',
      },
    );

    expect(wrapper.text()).toContain('DUMMY-关于标题');
    expect(wrapper.text()).toContain('DUMMY-系统名 DUMMY-关于页说明');
  });
});

describe('关于页元数据缺失分支', /** 构建期注入在开发与裁剪构建中可能不完整，缺失分支必须安全降级。 */ () => {
  it('缺少主页时不渲染主页条目', /** 主页条目取值失败会渲染出一个指向空地址的链接。 */ async () => {
    const wrapper = await mountAbout({ authorName: 'DUMMY-维护者' });

    expect(
      wrapper
        .findAll('dt')
        .map(/** 提取条目标题，核对主页条目未被渲染。 */ (node) => node.text()),
    ).toEqual(['版本', '许可证', '构建时间', '维护者']);
    expect(wrapper.findAll('a')).toHaveLength(0);
  });

  it('维护者只有名称时渲染纯文本而不渲染链接', /** 没有主页地址却渲染链接会让用户点击后跳转到空地址。 */ async () => {
    const wrapper = await mountAbout({ authorName: 'DUMMY-维护者' });

    const author = wrapper
      .findAll('dt')
      .find(
        /** 定位维护者条目，读取其内容。 */ (node) => node.text() === '维护者',
      );
    expect(author?.element.nextElementSibling?.textContent).toBe(
      'DUMMY-维护者',
    );
    expect(wrapper.find('a').exists()).toBe(false);
  });

  it('维护者只有邮箱时渲染邮件链接', /** 丢掉邮箱会让用户失去唯一的反馈渠道。 */ async () => {
    const wrapper = await mountAbout({ authorEmail: 'dev@example.test' });

    const link = wrapper.get('a');
    expect(link.attributes('href')).toBe('mailto:dev@example.test');
    expect(link.text()).toBe('dev@example.test');
    expect(
      wrapper
        .findAll('dt')
        .map(/** 提取条目标题，核对主页条目未被渲染。 */ (node) => node.text()),
    ).toEqual(['版本', '许可证', '构建时间', '维护者']);
  });

  it('元数据整体缺失时版本三项显示占位符且依赖清单为空', /** 缺少占位符会让基本信息区出现空白，用户无法判断是缺失还是加载失败。 */ async () => {
    const wrapper = await mountAbout(undefined);

    expect(
      wrapper
        .findAll('dd')
        .map(
          /** 提取条目内容，核对缺失时统一显示占位符。 */ (node) => node.text(),
        ),
    ).toEqual(['-', '-', '-']);
    const lists = wrapper.findAll('dl');
    // 生产依赖与开发依赖两个列表在元数据缺失时都必须保持为空，而不是渲染空条目。
    expect(lists).toHaveLength(3);
    expect(lists[1]?.findAll('dt')).toHaveLength(0);
    expect(lists[2]?.findAll('dt')).toHaveLength(0);
  });

  it('未传属性时使用默认标题与说明', /** 默认文案缺失会让关于页标题和说明变成空白。 */ async () => {
    const wrapper = await mountAbout({ version: '5.5.9' });

    expect(wrapper.text()).toContain('关于系统');
    expect(wrapper.text()).toContain(
      '基础框架 基于 Vue 3 的管理后台前端项目。',
    );
  });
});
