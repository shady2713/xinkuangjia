/**
 * form-create 插件装配（plugins/form-create/index）真实行为回归。
 *
 * 该模块把设计器需要的自定义组件与 Element Plus 组件注册到应用全局：注册名取自组件
 * 自身的 name，规则文件按同一个名字声明设计器组件，因此注册名与规则名不一致会让拖入
 * 的控件在画布上解析不到组件；漏注册 Element Plus 组件会让设计器渲染布局类控件时报
 * "Failed to resolve component"；未把 auto-import 插件交给 form-create 会让低代码表单
 * 在运行期缺少 Element Plus 表单组件；未 app.use(formCreate) 则整个设计器不可用。
 * 用例在真实 Vue 应用上执行真实注册流程，只替换无法在测试运行器中加载的 auto-import
 * 模块（该模块直接 import Element Plus 的 CSS，Node 解析 .css 会失败）。
 */
import { createApp } from 'vue';

import formCreate from '@form-create/element-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDictSelectRule } from '#/components/form-create/rules/use-dict-select';
import { useIframeRule } from '#/components/form-create/rules/use-iframe-rule';
import { useUploadFileRule } from '#/components/form-create/rules/use-upload-file-rule';
import { useUploadImagesRule } from '#/components/form-create/rules/use-upload-images-rule';

import { setupFormCreate } from './index';

/** auto-import 模块替身；模块本身在 Node 下无法加载 CSS，用例只核对它被真实转交。 */
const autoImportMock = vi.hoisted(
  /** 建立可清空、可断言的 auto-import 替身函数。 */ () => vi.fn(),
);

vi.mock(
  '@form-create/element-ui/auto-import',
  /** 只替换无法在测试运行器中加载的样式入口，插件装配流程保持真实实现。 */ () => ({
    default: autoImportMock,
  }),
);

// 应用配置在模块导入期即被请求与偏好模块读取；必须在导入被测模块前提供同形状的测试值。
vi.hoisted(
  /** 写入最小运行时配置，使请求与偏好模块能在无浏览器环境完成导入。 */ () => {
    (
      globalThis as unknown as { _VBEN_ADMIN_PRO_APP_CONF_: unknown }
    )._VBEN_ADMIN_PRO_APP_CONF_ = {
      VITE_APP_CAPTCHA_ENABLE: 'false',
      VITE_APP_STORE_SECURE_KEY: 'DUMMY-store-key',
      VITE_GLOB_API_URL: 'https://example.test/admin-api',
      VITE_GLOB_AUTH_DINGDING_CLIENT_ID: '',
      VITE_GLOB_AUTH_DINGDING_CORP_ID: '',
    };
  },
);

/** 应用自有的设计器组件名，必须与规则文件声明的组件名一致。 */
const CUSTOM_COMPONENT_NAMES = [
  'ApiSelect',
  'DeptSelect',
  'DictSelect',
  'FileUpload',
  'IframeComponent',
  'ImageUpload',
  'ImagesUpload',
  'UserSelect',
];

/** 需要注册到全局的 Element Plus 组件名，取自源码中显式声明的清单。 */
const ELEMENT_COMPONENT_NAMES = [
  'ElAlert',
  'ElAside',
  'ElBadge',
  'ElCard',
  'ElCollapse',
  'ElCollapseItem',
  'ElContainer',
  'ElDivider',
  'ElDropdown',
  'ElDropdownItem',
  'ElDropdownMenu',
  'ElFooter',
  'ElHeader',
  'ElMain',
  'ElMenu',
  'ElMenuItem',
  'ElPopconfirm',
  'ElTable',
  'ElTableColumn',
  'ElTabPane',
  'ElTabs',
  'ElTag',
  'ElText',
  'ElTransfer',
];

/** 全部期望注册名：设计器组件 + Element Plus 组件 + ElMessage 的实际注册名 + FormCreate。 */
const EXPECTED_NAMES = [
  ...CUSTOM_COMPONENT_NAMES,
  ...ELEMENT_COMPONENT_NAMES,
  'FormCreate',
  'message',
].toSorted();

/**
 * 建立真实 Vue 应用并执行被测装配。
 * @returns 已完成注册的应用实例。
 */
function createRegisteredApp() {
  const app = createApp({
    /** 渲染空节点；本用例只观察注册结果，不渲染任何组件。 */
    render: () => null,
  });
  setupFormCreate(app);
  return app;
}

beforeEach(
  /** 清空插件替身的调用记录，避免上一例的装配次数影响本例断言。 */ () => {
    vi.clearAllMocks();
  },
);

/**
 * 取出应用全局已注册的组件名。
 * @param app 已完成装配的应用实例。
 * @returns 已注册组件名数组。
 */
function registeredNames(app: ReturnType<typeof createApp>) {
  return Object.keys(app._context.components);
}

describe('form-create 插件注册组件', /** 注册结果决定设计器能否解析到画布上的控件。 */ () => {
  it('注册全部设计器组件与 Element Plus 组件', /** 漏注册会让画布或属性面板报组件无法解析。 */ () => {
    const app = createRegisteredApp();

    expect(registeredNames(app).toSorted()).toEqual(EXPECTED_NAMES);
  });

  it('每个注册项都以组件自身的 name 注册', /** 用 undefined 或错名注册会让组件在模板里解析不到。 */ () => {
    const app = createRegisteredApp();
    const mismatched = Object.entries(app._context.components)
      .filter(
        /** 只挑出注册名与组件自身 name 不一致的项，它们无法被模板按名解析。 */
        ([name, component]) =>
          (component as undefined | { name?: string })?.name !== name,
      )
      .map(
        /** 取出错配的注册名与其自身 name，便于定位。 */
        ([name, component]) => [
          name,
          (component as undefined | { name?: string })?.name,
        ],
      );

    expect(mismatched).toEqual([]);
    expect(registeredNames(app)).not.toContain('undefined');
  });

  it('elMessage 按自身 name 注册为 message', /** 该组件是函数式 API，注册名与其 name 一致才能被模板解析。 */ () => {
    const app = createRegisteredApp();

    expect((app.component('message') as { name?: string })?.name).toBe(
      'message',
    );
    expect(app.component('ElMessage')).toBeUndefined();
  });
});

describe('设计器组件名与规则声明一致', /** 规则按名字声明控件，注册名对不上会让拖入的控件解析失败。 */ () => {
  it('上传与字典、内嵌页面规则声明的名字都能解析到组件', /** 跨文件名字漂移是设计器最常见的静默失效来源。 */ () => {
    const app = createRegisteredApp();
    const declaredNames = [
      useUploadFileRule().name,
      useUploadImagesRule().name,
      useDictSelectRule().name,
      useIframeRule().name,
    ];

    expect(declaredNames).toEqual([
      'FileUpload',
      'ImagesUpload',
      'DictSelect',
      'IframeComponent',
    ]);
    for (const name of declaredNames) {
      expect(app.component(name)).toBeDefined();
      expect((app.component(name) as { name?: string })?.name).toBe(name);
    }
  });

  it('自定义组件的注册名与组件自身 name 相同', /** 组件改名而注册清单未同步会让设计器整块控件失效。 */ () => {
    const app = createRegisteredApp();
    const names = CUSTOM_COMPONENT_NAMES.map(
      /** 读取注册结果自身的 name，用于与清单比对。 */
      (name) => (app.component(name) as { name?: string })?.name,
    );

    expect(names).toEqual(CUSTOM_COMPONENT_NAMES);
  });
});

describe('form-create 插件安装', /** 未安装 form-create 会让整个设计器不可用。 */ () => {
  it('把 auto-import 插件交给 form-create', /** 未转交会让低代码表单运行期缺少 Element Plus 表单组件。 */ () => {
    createRegisteredApp();

    expect(autoImportMock).toHaveBeenCalledTimes(1);
    // form-create 的 use 以 (create, option) 调用插件；这里核对插件本体与未传的选项。
    expect(autoImportMock).toHaveBeenCalledWith(
      expect.any(Function),
      undefined,
    );
  });

  it('安装 form-create 并注册其全局组件', /** 未 app.use 会让设计器组件与指令全部缺失。 */ () => {
    const app = createRegisteredApp();
    const registered = app.component('FormCreate') as {
      name?: string;
      render?: unknown;
      setup?: unknown;
    };

    // formCreate.install 注册的是解析后的组件定义，与模块默认导出不是同一个对象。
    expect(registered).toBeDefined();
    expect(registered).not.toBe(formCreate);
    expect(registered.name).toBe('FormCreate');
    expect(typeof registered.render).toBe('function');
    expect(typeof registered.setup).toBe('function');
  });

  it('重复装配不改变注册结果', /** 启动流程重复调用时不应产生错名或重复注册。 */ () => {
    const app = createRegisteredApp();
    setupFormCreate(app);

    expect(registeredNames(app).toSorted()).toEqual(EXPECTED_NAMES);
    expect(autoImportMock).toHaveBeenCalledTimes(2);
  });
});
