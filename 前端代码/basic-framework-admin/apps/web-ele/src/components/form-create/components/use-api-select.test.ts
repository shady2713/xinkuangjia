/**
 * 接口驱动的选择器工厂（components/form-create/components/use-api-select）真实行为回归。
 *
 * 该模块按 url/method 拉取列表，再按 labelField/valueField（或 parseFunc 声明式映射）归一化
 * 成选项，并按 selectType 渲染成下拉、单选或多选：字段配置解析写错会让选项标签或提交值取错
 * 字段；模板字段缺失未告警会让设计者看不到配置错误；远程搜索未把关键词拼进请求会让搜索失效；
 * 非数组返回未按约定降级会让列表渲染空白；对象值未收窄会让单选框整组渲染失败；默认当前用户
 * 未回填会让新建表单漏掉登录人。
 *
 * 该文件是 TSX 组件工厂。按本轮约束不对 TSX 做真实渲染（会让整份 web 覆盖率证据变成
 * invalid-evidence），改为用受控边界替身隔离：真实调用工厂、真实执行 setup 与渲染函数、
 * 真实调用渲染结果上的远程搜索回调，只把 onMounted/useAttrs 这两个实例边界替换为受控实现，
 * 由用例显式触发挂载钩子。由此产生的限制在报告里说明。
 */
import type { ApiSelectProps } from '#/components/form-create/typing';

import { useUserStore } from '@vben/stores';

import {
  ElCheckbox,
  ElCheckboxGroup,
  ElOption,
  ElRadio,
  ElRadioGroup,
  ElSelect,
} from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import { useApiSelect } from './use-api-select';

/** 挂载钩子与属性边界替身；模块替身与用例读取同一实例。 */
const vueProbe = vi.hoisted(
  /** 建立可注入属性、可手动触发挂载钩子的容器。 */ () => ({
    attrs: {} as Record<string, unknown>,
    mounted: [] as MountedHook[],
  }),
);

vi.mock(
  'vue',
  /** 只替换挂载钩子与属性读取两个实例边界，其余 Vue API 保持真实实现。 */ async (
    importOriginal,
  ) => {
    const actual = await importOriginal<typeof import('vue')>();
    return {
      ...actual,
      /**
       * 记录挂载钩子，由用例显式触发，避免依赖真实组件实例。
       * @param hook 组件声明的挂载钩子。
       */
      onMounted: (hook: MountedHook) => {
        vueProbe.mounted.push(hook);
      },
      /**
       * 返回用例注入的属性表。
       * @returns 当前用例声明的属性。
       */
      useAttrs: () => vueProbe.attrs,
    };
  },
);

vi.mock(
  '#/api/request',
  /** 只替换请求收发边界，选项解析与归一化保持真实实现。 */ () => ({
    requestClient: { get: vi.fn(), post: vi.fn() },
  }),
);

vi.mock(
  '@vben/utils',
  /** 只替换告警输出边界，便于断言配置错误的提示内容；其余工具保持真实实现。 */ async (
    importOriginal,
  ) => {
    const actual = await importOriginal<typeof import('@vben/utils')>();
    return { ...actual, logWarn: vi.fn() };
  },
);

/** 接口返回的列表夹具：覆盖字符串、数字与对象取值。 */
const LIST_FIXTURE = [
  { id: 1, label: 'DUMMY-甲', nickname: '昵称甲', value: 1 },
  { id: 2, label: 'DUMMY-乙', nickname: '昵称乙', value: 2 },
];

/** 组件工厂选项：只声明组件名，其余字段走组件 props 默认值。 */
const FACTORY_OPTION: ApiSelectProps = { name: 'DUMMY-ApiSelect' };

/** 挂载钩子签名：模块注册的初始化回调。 */
type MountedHook = () => unknown;

/** 渲染函数签名：返回组件树根节点。 */
type RenderFunction = () => unknown;

/** 属性默认值工厂签名：返回该属性的默认值。 */
type DefaultFactory = () => unknown;

/** 组件定义视图：只驱动 props 默认值与 setup。 */
interface ComponentDefinitionView {
  /** 组件名。 */
  name?: string;
  /** 组件声明的属性表。 */
  props: Record<string, { default?: unknown; type?: unknown }>;
  /** 组件初始化函数。 */
  setup: (
    props: Record<string, unknown>,
    context: {
      attrs: Record<string, unknown>;
      emit: unknown;
      slots: Record<string, unknown>;
    },
  ) => RenderFunction;
}

/** 虚拟节点视图：只读取渲染结果。 */
interface VNodeView {
  /** 节点类型。 */
  type?: unknown;
  /** 节点声明的属性。 */
  props?: Record<string, unknown>;
  /** 节点子内容。 */
  children?: unknown;
}

/** 远程搜索回调签名：ElSelect 把当前输入文本交给组件。 */
type RemoteMethod = (query: string) => Promise<void>;

/**
 * 构造组件属性夹具。
 * @param overrides 需要覆盖的属性。
 * @returns 与工厂声明的 props 一一对应的属性对象。
 */
function propsFixture(overrides: Record<string, unknown> = {}) {
  return {
    data: '',
    defaultCurrentUser: false,
    labelField: 'label',
    method: 'GET',
    multiple: false,
    parseFunc: '',
    remote: false,
    remoteField: 'label',
    returnType: 'id',
    selectType: 'select',
    url: '/DUMMY/api',
    valueField: 'value',
    ...overrides,
  };
}

/**
 * 调用组件工厂并执行一次 setup，返回渲染函数。
 * @param props 组件属性。
 * @param option 工厂选项。
 * @returns 组件定义与渲染函数。
 */
function buildComponent(
  props: Record<string, unknown>,
  option: ApiSelectProps = FACTORY_OPTION,
) {
  const definition = useApiSelect(option) as unknown as ComponentDefinitionView;
  const emit = vi.fn();
  const render = definition.setup(props, { attrs: {}, emit, slots: {} });
  return { definition, emit, render };
}

/**
 * 把渲染结果收窄为虚拟节点视图。
 * @param node 渲染函数返回的未知结果。
 * @returns 虚拟节点视图。
 * @throws TypeError 结果不是对象时抛出，避免用例静默地什么都不验证。
 */
function asVNode(node: unknown) {
  if (node === null || typeof node !== 'object') {
    throw new TypeError('渲染函数未返回虚拟节点');
  }
  return node as VNodeView;
}

/**
 * 取出渲染结果中的唯一子节点。
 * @param node 渲染函数返回的根节点（片段）。
 * @returns 片段内的控件节点。
 * @throws TypeError 根节点不是片段或没有子节点时抛出，避免用例静默地什么都不验证。
 */
function singleChild(node: unknown) {
  const children = asVNode(node).children;
  if (!Array.isArray(children) || children.length === 0) {
    throw new TypeError('渲染结果没有子节点');
  }
  return asVNode(children[0]);
}

/**
 * 取出控件渲染出的默认插槽内容。
 * @param node 控件虚拟节点。
 * @returns 默认插槽的渲染结果。
 * @throws TypeError 控件未声明默认插槽时抛出，避免用例静默地什么都不验证。
 */
function defaultSlot(node: unknown) {
  const children = asVNode(node).children;
  if (children === null || typeof children !== 'object') {
    throw new TypeError('控件没有插槽');
  }
  const slot = (children as { default?: unknown }).default;
  if (typeof slot !== 'function') {
    throw new TypeError('控件没有默认插槽');
  }
  return (slot as RenderFunction)();
}

/**
 * 取出控件渲染出的选项子节点。
 * @param node 控件虚拟节点。
 * @returns 选项子节点数组。
 * @throws TypeError 默认插槽未返回数组时抛出，避免用例静默地什么都不验证。
 */
function optionNodes(node: unknown) {
  const items = defaultSlot(node);
  if (!Array.isArray(items)) {
    throw new TypeError('控件默认插槽未返回选项数组');
  }
  // 单个表达式子节点会被 JSX 插件包成一层数组，这里解开一层拿到选项列表。
  if (items.length === 1 && Array.isArray(items[0])) {
    return items[0] as VNodeView[];
  }
  return items as VNodeView[];
}

/**
 * 取出渲染结果上声明的远程搜索回调。
 * @param node 渲染函数返回的根节点。
 * @returns 远程搜索回调。
 * @throws TypeError 未声明远程搜索回调时抛出，避免用例静默地什么都不验证。
 */
function remoteMethodOf(node: unknown) {
  const method = singleChild(node).props?.remoteMethod;
  if (typeof method !== 'function') {
    throw new TypeError('控件未声明远程搜索回调');
  }
  return method as RemoteMethod;
}

/**
 * 触发模块注册的挂载钩子。
 * @returns 挂载钩子执行完成的 Promise。
 * @throws Error 模块未注册挂载钩子时抛出，避免用例静默地什么都不验证。
 */
async function runMounted() {
  const hook = vueProbe.mounted.at(-1);
  if (!hook) {
    throw new Error('模块未注册挂载钩子');
  }
  await hook();
}

beforeEach(
  /** 每例重建属性、挂载钩子、请求替身与用户信息，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    vueProbe.attrs = {};
    vueProbe.mounted.length = 0;
    setActivePinia(createPinia());
    vi.mocked(requestClient.get).mockResolvedValue(LIST_FIXTURE);
    vi.mocked(requestClient.post).mockResolvedValue(LIST_FIXTURE);
  },
);

describe('选择器工厂声明', /** 组件名与属性默认值决定页面上的组件标识与接口配置。 */ () => {
  it('沿用工厂选项声明的组件名', /** 组件名丢失会让设计器无法按名称定位该控件。 */ () => {
    const { definition } = buildComponent(propsFixture());

    expect(definition.name).toBe('DUMMY-ApiSelect');
  });

  it('字段与接口默认值优先取工厂选项，其次取内置默认值', /** 默认值写错会让所有未显式配置的控件指向错误的字段或空接口。 */ () => {
    const withOption = useApiSelect({
      labelField: 'name',
      name: 'DUMMY-ApiSelect',
      url: '/DUMMY/option',
      valueField: 'id',
    }) as unknown as ComponentDefinitionView;
    const withoutOption = useApiSelect(
      FACTORY_OPTION,
    ) as unknown as ComponentDefinitionView;

    expect((withOption.props.labelField?.default as DefaultFactory)()).toBe(
      'name',
    );
    expect((withOption.props.valueField?.default as DefaultFactory)()).toBe(
      'id',
    );
    expect((withOption.props.url?.default as DefaultFactory)()).toBe(
      '/DUMMY/option',
    );
    expect((withoutOption.props.labelField?.default as DefaultFactory)()).toBe(
      'label',
    );
    expect((withoutOption.props.valueField?.default as DefaultFactory)()).toBe(
      'value',
    );
    expect((withoutOption.props.url?.default as DefaultFactory)()).toBe('');
  });

  it('其余属性的默认值保持稳定', /** 默认值写错会让选择器默认多选、默认远程搜索或默认回填当前用户。 */ () => {
    const { definition } = buildComponent(propsFixture());

    expect(definition.props.method?.default).toBe('GET');
    expect(definition.props.parseFunc?.default).toBe('');
    expect(definition.props.data?.default).toBe('');
    expect(definition.props.selectType?.default).toBe('select');
    expect(definition.props.multiple?.default).toBe(false);
    expect(definition.props.remote?.default).toBe(false);
    expect(definition.props.remoteField?.default).toBe('label');
    expect(definition.props.returnType?.default).toBe('id');
    expect(definition.props.defaultCurrentUser?.default).toBe(false);
  });
});

describe('选项拉取与解析', /** 拉取与解析决定选择器能否拿到选项。 */ () => {
  it('挂载后按 url 发起 GET 请求并渲染数组选项', /** 未拉取会让选择器为空，未渲染会让用户看不到任何选项。 */ async () => {
    const { render } = buildComponent(propsFixture());

    await runMounted();

    expect(requestClient.get).toHaveBeenCalledWith('/DUMMY/api');
    const select = singleChild(render());
    expect(select.type).toBe(ElSelect);
    const items = optionNodes(select);
    expect(items).toHaveLength(2);
    expect(items[0]?.type).toBe(ElOption);
    expect(items[0]?.props).toMatchObject({
      label: 'DUMMY-甲',
      value: 1,
    });
  });

  it('接口返回分页对象时读取 list 字段', /** 未读取 list 会让分页接口的选择器一直为空。 */ async () => {
    vi.mocked(requestClient.get).mockResolvedValue({ list: LIST_FIXTURE });
    const { render } = buildComponent(propsFixture());

    await runMounted();

    expect(optionNodes(singleChild(render()))).toHaveLength(2);
  });

  it('接口返回非约定结构时告警并保持空选项', /** 静默清空会让设计者查不到接口返回形状不符。 */ async () => {
    const { logWarn } = await import('@vben/utils');
    vi.mocked(requestClient.get).mockResolvedValue({ data: LIST_FIXTURE });
    const { render } = buildComponent(propsFixture());

    await runMounted();

    expect(logWarn).toHaveBeenCalledWith(
      'api-select',
      '接口[/DUMMY/api] 返回结果不符合默认约定，建议使用自定义解析函数处理',
    );
    expect(optionNodes(singleChild(render()))).toHaveLength(0);
  });

  it('未声明 url 时不发起请求', /** 无接口仍发请求会让空控件打出无效请求。 */ async () => {
    const { render } = buildComponent(propsFixture({ url: '' }));

    await runMounted();

    expect(requestClient.get).not.toHaveBeenCalled();
    expect(optionNodes(singleChild(render()))).toHaveLength(0);
  });

  it('pOST 方法把 data 解析为请求体', /** 未解析请求体字符串会让后端收到无效载荷。 */ async () => {
    const { render } = buildComponent(
      propsFixture({ data: '{"pageNo":1}', method: 'POST' }),
    );

    await runMounted();

    expect(requestClient.post).toHaveBeenCalledWith('/DUMMY/api', {
      pageNo: 1,
    });
    expect(optionNodes(singleChild(render()))).toHaveLength(2);
  });

  it('未声明的方法名不发起请求', /** 未知方法名静默发请求会让后端收到非预期调用。 */ async () => {
    const { render } = buildComponent(propsFixture({ method: 'PUT' }));

    await runMounted();

    expect(requestClient.get).not.toHaveBeenCalled();
    expect(requestClient.post).not.toHaveBeenCalled();
    expect(optionNodes(singleChild(render()))).toHaveLength(0);
  });
});

describe('远程搜索', /** 远程搜索决定关键词能否传给后端。 */ () => {
  it('远程搜索把关键词拼进无查询串的地址', /** 未拼关键词会让后端始终返回全量数据。 */ async () => {
    const { render } = buildComponent(propsFixture({ remote: true }));
    const remoteMethod = remoteMethodOf(render());

    await remoteMethod('DUMMY-关键词');

    expect(requestClient.get).toHaveBeenCalledWith(
      '/DUMMY/api?label=DUMMY-关键词',
    );
  });

  it('远程搜索把关键词追加到已有查询串之后', /** 覆盖已有查询串会让原有筛选条件丢失。 */ async () => {
    const { render } = buildComponent(
      propsFixture({ remote: true, url: '/DUMMY/api?type=1' }),
    );
    const remoteMethod = remoteMethodOf(render());

    await remoteMethod('DUMMY-关键词');

    expect(requestClient.get).toHaveBeenCalledWith(
      '/DUMMY/api?type=1&label=DUMMY-关键词',
    );
  });

  it('远程搜索支持自定义关键词字段名', /** 字段名写死会让后端拿不到搜索关键词。 */ async () => {
    const { render } = buildComponent(
      propsFixture({ remote: true, remoteField: 'nickname' }),
    );
    const remoteMethod = remoteMethodOf(render());

    await remoteMethod('DUMMY-关键词');

    expect(requestClient.get).toHaveBeenCalledWith(
      '/DUMMY/api?nickname=DUMMY-关键词',
    );
  });

  it('关键词为空时不发起请求', /** 空关键词仍请求会让清空输入时反复打后端。 */ async () => {
    const { render } = buildComponent(propsFixture({ remote: true }));
    const remoteMethod = remoteMethodOf(render());

    await remoteMethod('');

    expect(requestClient.get).not.toHaveBeenCalled();
  });

  it('远程搜索把关键词并入 POST 请求体', /** 未并入请求体会让 POST 接口的搜索失效。 */ async () => {
    const { render } = buildComponent(
      propsFixture({ data: '{"pageNo":1}', method: 'POST', remote: true }),
    );
    const remoteMethod = remoteMethodOf(render());

    await remoteMethod('DUMMY-关键词');

    expect(requestClient.post).toHaveBeenCalledWith('/DUMMY/api', {
      label: 'DUMMY-关键词',
      pageNo: 1,
    });
  });

  it('请求体不是普通对象时按原样提交', /** 强行挂字段会破坏后端约定的载荷形状。 */ async () => {
    const { render } = buildComponent(
      propsFixture({ data: '[1,2]', method: 'POST', remote: true }),
    );
    const remoteMethod = remoteMethodOf(render());

    await remoteMethod('DUMMY-关键词');

    expect(requestClient.post).toHaveBeenCalledWith('/DUMMY/api', [1, 2]);
  });

  it('请求失败后复位加载态并向上抛出错误', /** 未复位加载态会让选择器永久停在加载中。 */ async () => {
    vi.mocked(requestClient.get).mockRejectedValue(new Error('DUMMY-接口失败'));
    const { render } = buildComponent(propsFixture({ remote: true }));
    const remoteMethod = remoteMethodOf(render());

    await expect(remoteMethod('DUMMY-关键词')).rejects.toThrow(
      'DUMMY-接口失败',
    );
    expect(singleChild(render()).props?.loading).toBe(false);
  });

  it('非远程模式下不声明远程搜索回调', /** 非远程模式挂上回调会让每次输入都请求后端。 */ () => {
    const { render } = buildComponent(propsFixture({ remote: false }));

    expect(singleChild(render()).props?.remoteMethod).toBeUndefined();
    expect(singleChild(render()).props?.filterable).toBe(false);
  });
});

describe('字段映射与取值口径', /** 字段映射决定选项标签与提交值取自哪里。 */ () => {
  it('模板字段按自有属性拼接', /** 未按模板拼接会让部门选择器一类控件显示成属性名。 */ async () => {
    const { render } = buildComponent(
      // eslint-disable-next-line no-template-curly-in-string -- 该字符串就是设计器保存的模板字段配置，必须保持 ${属性} 形式。
      propsFixture({ labelField: '${nickname}-${id}' }),
    );

    await runMounted();

    expect(optionNodes(singleChild(render()))[0]?.props?.label).toBe(
      '昵称甲-1',
    );
  });

  it('模板字段缺失时告警并保留 undefined 文本', /** 静默取值会让设计者看不到字段名写错。 */ async () => {
    const { logWarn } = await import('@vben/utils');
    const { render } = buildComponent(
      // eslint-disable-next-line no-template-curly-in-string -- 该字符串就是设计器保存的模板字段配置，必须保持 ${属性} 形式。
      propsFixture({ labelField: '${missingField}' }),
    );

    await runMounted();

    expect(optionNodes(singleChild(render()))[0]?.props?.label).toBe(
      'undefined',
    );
    expect(logWarn).toHaveBeenCalledWith(
      'api-select',
      // eslint-disable-next-line no-template-curly-in-string -- 期望文案就是组件按模板原样拼出的告警文本。
      '接口选择器模板[${missingField}] 解析字段[missingField] 失败，请检查接口返回值字段是否存在',
    );
  });

  it('只读取自有属性，不取原型链成员', /** 取到原型链成员会让选项显示成函数源码。 */ async () => {
    const { render } = buildComponent(propsFixture({ labelField: 'toString' }));

    await runMounted();

    expect(optionNodes(singleChild(render()))[0]?.props?.label).toBe('');
  });

  it('returnType 为 name 时提交值取展示文本', /** 取值口径写错会让后端收到编号而不是名称。 */ async () => {
    const { render } = buildComponent(propsFixture({ returnType: 'name' }));

    await runMounted();

    expect(optionNodes(singleChild(render()))[0]?.props?.value).toBe(
      'DUMMY-甲',
    );
  });

  it('标签收敛为可展示文本、值收敛为可绑定形态', /** 复合标签会让界面出现对象字符串，空值会让选项被意外选中。 */ async () => {
    vi.mocked(requestClient.get).mockResolvedValue([
      { label: { text: '对象标签' }, value: null },
      { label: 12n, value: true },
      {
        label: undefined,
        /** 函数型取值无法提交，应退化为空串。 */
        value: () => 'x',
      },
      { label: 'DUMMY-对象值', value: { id: 3 } },
    ]);
    const { render } = buildComponent(propsFixture());

    await runMounted();
    const items = optionNodes(singleChild(render()));

    expect(items[0]?.props).toMatchObject({ label: '', value: '' });
    expect(items[1]?.props).toMatchObject({ label: '12', value: true });
    expect(items[2]?.props).toMatchObject({ label: '', value: '' });
    expect(items[3]?.props).toMatchObject({
      label: 'DUMMY-对象值',
      value: { id: 3 },
    });
  });
});

describe('声明式映射解析', /** 映射解析决定历史 parseFunc 配置能否安全迁移。 */ () => {
  it('按 JSON 字段映射提取选项', /** 映射未生效会让接口返回的嵌套结构解析不出选项。 */ async () => {
    vi.mocked(requestClient.get).mockResolvedValue({
      data: { rows: LIST_FIXTURE },
    });
    const { render } = buildComponent(
      propsFixture({
        parseFunc:
          '{"listPath":"data.rows","labelField":"label","valueField":"id"}',
      }),
    );

    await runMounted();

    expect(optionNodes(singleChild(render()))[0]?.props).toMatchObject({
      label: 'DUMMY-甲',
      value: 1,
    });
  });

  it('映射配置无效时告警并清空选项', /** 静默忽略无效配置会让设计者以为接口没数据。 */ async () => {
    const { logWarn } = await import('@vben/utils');
    const { render } = buildComponent(
      propsFixture({ parseFunc: 'DUMMY-非法映射' }),
    );

    await runMounted();

    expect(logWarn).toHaveBeenCalledWith(
      'api-select',
      expect.stringContaining('接口选择器映射配置无效：'),
    );
    expect(optionNodes(singleChild(render()))).toHaveLength(0);
  });

  it('映射路径取不到数组时告警并清空选项', /** 未提示路径错误会让设计者反复检查接口而找不到原因。 */ async () => {
    const { logWarn } = await import('@vben/utils');
    vi.mocked(requestClient.get).mockResolvedValue({ data: {} });
    const { render } = buildComponent(
      propsFixture({
        parseFunc:
          '{"listPath":"data.rows","labelField":"label","valueField":"id"}',
      }),
    );

    await runMounted();

    expect(logWarn).toHaveBeenCalledWith(
      'api-select',
      '接口[/DUMMY/api] 未在路径[data.rows]找到数组',
    );
    expect(optionNodes(singleChild(render()))).toHaveLength(0);
  });

  it('旧版简单映射迁移后只告警一次', /** 每次拉取都告警会让控制台刷屏。 */ async () => {
    const { logWarn } = await import('@vben/utils');
    vi.mocked(requestClient.get).mockResolvedValue({ list: LIST_FIXTURE });
    const { render } = buildComponent(
      propsFixture({
        parseFunc:
          'data => data.list.map(item => ({ label: item.label, value: item.id }))',
        remote: true,
      }),
    );
    const remoteMethod = remoteMethodOf(render());

    await runMounted();
    await remoteMethod('DUMMY-关键词');

    const migrateWarnings = vi
      .mocked(logWarn)
      .mock.calls.filter(
        /** 只挑出迁移提示，其余告警与本断言无关。 */ (call) =>
          String(call[1]).includes('已安全迁移旧版简单 map 配置'),
      );
    expect(migrateWarnings).toHaveLength(1);
    expect(optionNodes(singleChild(render()))).toHaveLength(2);
  });
});

describe('选择器形态渲染', /** 形态渲染决定下拉、单选与多选控件的真实外观。 */ () => {
  it('多选下拉开启多选并透传属性', /** 未开启多选会让用户只能选一个值。 */ async () => {
    const { render } = buildComponent(
      propsFixture({ multiple: true, remote: true }),
    );

    await runMounted();
    const select = singleChild(render());

    expect(select.type).toBe(ElSelect);
    expect(select.props).toMatchObject({
      filterable: true,
      multiple: true,
      remote: true,
    });
    expect(select.props?.class).toBe('w-1/1');
    expect(optionNodes(select)[0]?.props).toMatchObject({
      label: 'DUMMY-甲',
      value: 1,
    });
  });

  it('多选框组按选项渲染子项', /** 未渲染子项会让多选组显示为空。 */ async () => {
    const { render } = buildComponent(propsFixture({ selectType: 'checkbox' }));

    await runMounted();
    const group = singleChild(render());
    const items = optionNodes(group);

    expect(group.type).toBe(ElCheckboxGroup);
    expect(items[0]?.type).toBe(ElCheckbox);
    expect(items[0]?.props?.label).toBe(1);
    expect(defaultSlot(items[0])).toEqual(['DUMMY-甲']);
  });

  it('多选框组在无选项时补占位项', /** 无占位项会让设计器预览是一片空白。 */ () => {
    const { render } = buildComponent(
      propsFixture({ selectType: 'checkbox', url: '' }),
    );
    const items = optionNodes(singleChild(render()));

    expect(items).toHaveLength(2);
    expect(items[0]?.props?.label).toBe('选项1');
    expect(items[1]?.props?.label).toBe('选项2');
  });

  it('单选框组把对象值收窄为可绑定标量', /** 对象值会让整组单选项渲染失败；非标量标签收敛为空串，选项仍可见但无文案。 */ async () => {
    vi.mocked(requestClient.get).mockResolvedValue([
      { label: 'DUMMY-对象', value: { id: 9 } },
    ]);
    const { render } = buildComponent(propsFixture({ selectType: 'radio' }));

    await runMounted();
    const group = singleChild(render());
    const items = optionNodes(group);

    expect(group.type).toBe(ElRadioGroup);
    expect(items[0]?.type).toBe(ElRadio);
    expect(items[0]?.props?.label).toBe('');
    expect(defaultSlot(items[0])).toEqual(['DUMMY-对象']);
  });

  it('单选框组在无选项时补占位项', /** 无占位项会让设计器预览是一片空白。 */ () => {
    const { render } = buildComponent(
      propsFixture({ selectType: 'radio', url: '' }),
    );
    const items = optionNodes(singleChild(render()));

    expect(items).toHaveLength(2);
    expect(items[0]?.type).toBe(ElRadio);
  });

  it('未知形态回退为下拉选择器', /** 回退缺失会让配置写错时控件整体渲染失败。 */ async () => {
    const { render } = buildComponent(
      propsFixture({ selectType: 'DUMMY-未知' }),
    );

    await runMounted();

    expect(singleChild(render()).type).toBe(ElSelect);
  });
});

describe('默认当前用户回填', /** 回填决定新建表单是否自动带上登录人。 */ () => {
  it('用户选择器在未预设值时回填当前用户编号', /** 未回填会让新建表单漏掉登录人。 */ async () => {
    useUserStore().setUserInfo({ id: 42, realName: 'DUMMY-用户' } as never);
    const { emit } = buildComponent(
      propsFixture({ defaultCurrentUser: true }),
      {
        name: 'UserSelect',
      },
    );

    await runMounted();

    expect(emit).toHaveBeenCalledWith('update:modelValue', 42);
  });

  it('多选模式下回填为用户编号数组', /** 回填标量会让多选控件匹配不到选中项。 */ async () => {
    useUserStore().setUserInfo({ id: 42, realName: 'DUMMY-用户' } as never);
    const { emit } = buildComponent(
      propsFixture({ defaultCurrentUser: true, multiple: true }),
      { name: 'UserSelect' },
    );

    await runMounted();

    expect(emit).toHaveBeenCalledWith('update:modelValue', [42]);
  });

  it('已有预设值时保留用户已选内容', /** 覆盖预设值会让编辑态把已选用户改掉。 */ async () => {
    useUserStore().setUserInfo({ id: 42, realName: 'DUMMY-用户' } as never);
    vueProbe.attrs = { modelValue: [7] };
    const { emit } = buildComponent(
      propsFixture({ defaultCurrentUser: true }),
      {
        name: 'UserSelect',
      },
    );

    await runMounted();

    expect(emit).not.toHaveBeenCalled();
  });

  it('预设值为标量时同样保留用户已选内容', /** 标量预设值未被识别会让编辑态把已选用户改掉。 */ async () => {
    useUserStore().setUserInfo({ id: 42, realName: 'DUMMY-用户' } as never);
    vueProbe.attrs = { modelValue: 7 };
    const { emit } = buildComponent(
      propsFixture({ defaultCurrentUser: true }),
      {
        name: 'UserSelect',
      },
    );

    await runMounted();

    expect(emit).not.toHaveBeenCalled();
  });

  it('非开发环境不输出配置告警', /** 生产环境刷屏会让真正的错误被淹没。 */ async () => {
    const { logWarn } = await import('@vben/utils');
    vi.stubEnv('DEV', false);
    vi.mocked(requestClient.get).mockResolvedValue({ data: LIST_FIXTURE });
    const { render } = buildComponent(propsFixture());

    await runMounted();

    expect(logWarn).not.toHaveBeenCalled();
    expect(optionNodes(singleChild(render()))).toHaveLength(0);
    vi.unstubAllEnvs();
  });

  it('未开启回填或非用户选择器时不回填', /** 其它选择器被回填会让表单出现非预期默认值。 */ async () => {
    useUserStore().setUserInfo({ id: 42, realName: 'DUMMY-用户' } as never);
    const withoutFlag = buildComponent(propsFixture(), { name: 'UserSelect' });
    const otherName = buildComponent(
      propsFixture({ defaultCurrentUser: true }),
      FACTORY_OPTION,
    );

    await runMounted();

    expect(withoutFlag.emit).not.toHaveBeenCalled();
    expect(otherName.emit).not.toHaveBeenCalled();
  });

  it('登录信息缺失时不回填', /** 无用户编号仍回填会让表单提交 undefined。 */ async () => {
    const { emit } = buildComponent(
      propsFixture({ defaultCurrentUser: true }),
      {
        name: 'UserSelect',
      },
    );

    await runMounted();

    expect(emit).not.toHaveBeenCalled();
  });
});
