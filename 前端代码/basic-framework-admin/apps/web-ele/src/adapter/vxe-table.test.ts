/**
 * 表格适配层（apps/web-ele/src/adapter/vxe-table）真实行为回归。
 *
 * 该模块收敛本应用对 vxe-table 的全部全局定制：表格默认行为、单元格渲染器与格式化器。
 * 默认配置漏项会让所有列表失去分页、序号偏移或工具栏收敛；单元格渲染器写错会让图片列、
 * 标签列、字典列、开关列与操作列渲染成空白或写错数据；开关列的 beforeChange 未按返回值
 * 决定是否写回会让被拦截的变更仍然落库；操作列的二次确认未拦截点击会让删除直接生效；
 * 格式化器注册缺失或单位换算写错会让金额、数量与文件大小显示成裸数字。
 *
 * 用例真实执行模块注册的全局定制回调，并真实调用每个渲染器与格式化器；只把 vxe-table
 * 插件包（重型 UI 库）替换为记录型替身，Element Plus 组件保持真实引用用于类型断言。
 */
import { ElButton, ElImage, ElPopconfirm, ElSwitch, ElTag } from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DictTag } from '#/components/dict-tag';

import { createRequiredValidation, VxeColumn, VxeTable } from './vxe-table';

/** 被捕获的全局定制回调与注册表；模块替身与用例读取同一实例。 */
const vxeProbe = vi.hoisted(
  /** 建立用例可驱动的全局定制容器。 */ () => ({
    configs: [] as unknown[],
    formats: new Map<string, unknown>(),
    options: undefined as unknown,
    renderers: new Map<string, unknown>(),
  }),
);

vi.mock(
  '@vben/plugins/vxe-table',
  /** 只替换 vxe-table 插件包，被测模块注册的全局定制回调保持真实实现。 */ () => ({
    AsyncVxeColumn: { name: 'AsyncVxeColumnStub' },
    AsyncVxeTable: { name: 'AsyncVxeTableStub' },
    /**
     * 返回固定的必填校验规则，供用例核对模块确实透传该能力。
     * @returns 固定的必填规则标识。
     */
    createRequiredValidation: () => 'DUMMY-required',
    /**
     * 记录模块声明的全局定制回调，供用例真实执行。
     * @param options 模块传给 vxe-table 初始化入口的配置。
     */
    setupVbenVxeTable: (options: unknown) => {
      vxeProbe.options = options;
    },
    /**
     * 返回固定的表格容器替身，避免加载真实 vxe-table。
     * @returns 表格组件替身与空 API。
     */
    useVbenVxeGrid: () => [{ name: 'GridStub' }, {}],
  }),
);

vi.mock(
  '@vben/icons',
  /** 只替换图标组件，避免操作列图标按需拉取远端图标集。 */ () => ({
    IconifyIcon: { name: 'IconifyIconStub' },
  }),
);

vi.mock(
  '#/locales',
  /** 只替换翻译边界，便于核对渲染器请求的语言键与参数。 */ () => ({
    /**
     * 把语言键与占位参数拼成可预期的译文。
     * @param key 组件请求的语言键。
     * @param args 语言键的可选占位参数。
     * @returns 带参数时拼接参数，否则回显键名。
     */
    $t: (key: string, args?: string[]) =>
      args ? `${key}(${args.join('/')})` : key,
  }),
);

/** 渲染器定义视图：只驱动默认单元格渲染。 */
interface RendererDefinition {
  /** 渲染默认单元格内容。 */
  renderTableDefault: (
    renderOpts: Record<string, unknown>,
    params: Record<string, unknown>,
  ) => unknown;
}

/** 格式化器定义视图：只驱动单元格格式化方法。 */
interface FormatDefinition {
  /** 按单元格取值与可选位数返回展示文本。 */
  tableCellFormatMethod: (
    params: Record<string, unknown>,
    digits?: number,
  ) => unknown;
}

/** 虚拟节点视图：只读取渲染器产出的类型、属性与插槽。 */
interface VNodeView {
  /** 节点类型：组件定义或标签名。 */
  type?: unknown;
  /** 节点声明的属性。 */
  props?: Record<string, unknown>;
  /** 节点子内容：插槽表、数组或文本。 */
  children?: unknown;
}

/** 插槽表视图：按名称读取插槽函数。 */
interface SlotTable {
  /** 默认插槽函数。 */
  default?: () => unknown;
  /** 二次确认弹层引用插槽函数。 */
  reference?: () => unknown;
}

/** 表格全局定制的驱动入口；模块注册时写入。 */
interface VxeUiProbe {
  /** 记录全局配置调用。 */
  setConfig: (config: unknown) => void;
  /** 渲染器注册表。 */
  renderer: {
    /** 注册一个单元格渲染器。 */
    add: (name: string, definition: unknown) => void;
  };
  /** 格式化器注册表。 */
  formats: {
    /** 注册一个单元格格式化器。 */
    add: (name: string, definition: unknown) => void;
  };
}

/** 模块声明的全局定制回调集合。 */
interface VxeSetupOptions {
  /** 收敛全局表格定制并注册渲染器与格式化器的回调。 */
  configVxeTable: (vxeUI: VxeUiProbe) => void;
  /** 模块透传给 vxe-table 的表单实现。 */
  useVbenForm: unknown;
}

/**
 * 取出模块声明的全局定制回调集合。
 * @returns 传给 vxe-table 初始化入口的配置。
 * @throws Error 模块未注册全局定制时抛出，避免用例静默地什么都不验证。
 */
function setupOptions() {
  const options = vxeProbe.options as undefined | VxeSetupOptions;
  if (!options || typeof options.configVxeTable !== 'function') {
    throw new Error('模块未注册全局表格定制');
  }
  return options;
}

/**
 * 执行一次全局定制，把渲染器与格式化器注册到记录表。
 * @returns 注册结果：全局配置调用与两张注册表。
 */
function applyVxeSetup() {
  vxeProbe.configs.length = 0;
  vxeProbe.formats.clear();
  vxeProbe.renderers.clear();
  const probe: VxeUiProbe = {
    /**
     * 记录一次全局配置调用。
     * @param config 模块声明的 vxe-table 全局配置。
     */
    setConfig: (config: unknown) => {
      vxeProbe.configs.push(config);
    },
    renderer: {
      /**
       * 记录一个单元格渲染器。
       * @param name 渲染器名。
       * @param definition 渲染器定义。
       */
      add: (name: string, definition: unknown) => {
        vxeProbe.renderers.set(name, definition);
      },
    },
    formats: {
      /**
       * 记录一个单元格格式化器。
       * @param name 格式化器名。
       * @param definition 格式化器定义。
       */
      add: (name: string, definition: unknown) => {
        vxeProbe.formats.set(name, definition);
      },
    },
  };
  setupOptions().configVxeTable(probe);
  return probe;
}

/**
 * 取出注册的单元格渲染器。
 * @param name 渲染器名。
 * @returns 渲染器定义。
 * @throws Error 未注册该渲染器时抛出，避免用例静默地什么都不验证。
 */
function rendererOf(name: string) {
  const definition = vxeProbe.renderers.get(name);
  if (!definition) {
    throw new Error(`未注册单元格渲染器：${name}`);
  }
  return definition as RendererDefinition;
}

/**
 * 取出注册的单元格格式化器。
 * @param name 格式化器名。
 * @returns 格式化器定义。
 * @throws Error 未注册该格式化器时抛出，避免用例静默地什么都不验证。
 */
function formatOf(name: string) {
  const definition = vxeProbe.formats.get(name);
  if (!definition) {
    throw new Error(`未注册单元格格式化器：${name}`);
  }
  return definition as FormatDefinition;
}

/**
 * 把渲染结果收窄为虚拟节点视图。
 * @param node 渲染器返回的未知结果。
 * @returns 虚拟节点视图。
 * @throws TypeError 结果不是对象时抛出，避免用例静默地什么都不验证。
 */
function asVNode(node: unknown) {
  if (node === null || typeof node !== 'object') {
    throw new TypeError('渲染器未返回虚拟节点');
  }
  return node as VNodeView;
}

/**
 * 取出节点的默认插槽函数。
 * @param node 渲染器返回的虚拟节点。
 * @returns 默认插槽函数。
 * @throws TypeError 节点没有默认插槽时抛出，避免用例静默地什么都不验证。
 */
function defaultSlot(node: unknown) {
  const children = asVNode(node).children;
  if (children === null || typeof children !== 'object') {
    throw new TypeError('节点没有插槽');
  }
  const slot = (children as SlotTable).default;
  if (typeof slot !== 'function') {
    throw new TypeError('节点没有默认插槽');
  }
  return slot;
}

/**
 * 取出节点的引用插槽函数。
 * @param node 渲染器返回的虚拟节点。
 * @returns 引用插槽函数。
 * @throws TypeError 节点没有引用插槽时抛出，避免用例静默地什么都不验证。
 */
function referenceSlot(node: unknown) {
  const children = asVNode(node).children;
  if (children === null || typeof children !== 'object') {
    throw new TypeError('节点没有插槽');
  }
  const slot = (children as SlotTable).reference;
  if (typeof slot !== 'function') {
    throw new TypeError('节点没有引用插槽');
  }
  return slot;
}

/**
 * 按下标取出子节点。
 * @param node 虚拟节点。
 * @param index 子节点下标。
 * @returns 该下标的子节点。
 * @throws Error 下标越界时抛出，避免用例静默地什么都不验证。
 */
function childAt(node: unknown, index: number) {
  const child = childArray(node)[index];
  if (!child) {
    throw new Error(`子节点下标越界：${index}`);
  }
  return child;
}

/**
 * 把节点的子内容收窄为数组。
 * @param node 渲染器返回的虚拟节点。
 * @returns 子节点数组。
 * @throws TypeError 子内容不是数组时抛出，避免用例静默地什么都不验证。
 */
function childArray(node: unknown) {
  const children = asVNode(node).children;
  if (!Array.isArray(children)) {
    throw new TypeError('节点的子内容不是数组');
  }
  return children as VNodeView[];
}

/** 必填校验工厂替身签名：本替身忽略入参并返回固定标识。 */
type RequiredValidationFactory = (...args: unknown[]) => unknown;

/** 开关变更回调签名：ElSwitch 把新值交给行内处理函数。 */
type SwitchChangeHandler = (value: unknown) => Promise<void>;

/** 无参点击回调签名：操作按钮与二次确认的点击处理。 */
type ClickHandler = () => void;

/** 单元格参数夹具：渲染器按 column.field 取当前列的值。 */
const CELL_PARAMS = {
  column: { align: 'center', field: 'value' },
  row: { id: 7, value: 'DUMMY-取值' },
};

beforeEach(
  /** 每例重建全局定制注册表，避免上一例的注册结果影响断言。 */ () => {
    applyVxeSetup();
  },
);

describe('表格全局配置', /** 全局配置决定所有列表的分页、序号、工具栏与尺寸口径。 */ () => {
  it('注册一次全局配置并透传表单实现', /** 未注册会让列表缺少分页与序号偏移，透传错表单实现会让搜索表单失效。 */ () => {
    expect(vxeProbe.configs).toHaveLength(1);
    expect(setupOptions().useVbenForm).toBeDefined();
  });

  it('对外导出异步表格组件与必填校验能力', /** 导出缺失会让页面无法使用表格容器或必填校验。 */ () => {
    expect(VxeTable).toEqual({ name: 'AsyncVxeTableStub' });
    expect(VxeColumn).toEqual({ name: 'AsyncVxeColumnStub' });
    expect(
      (createRequiredValidation as unknown as RequiredValidationFactory)(),
    ).toBe('DUMMY-required');
  });

  it('关闭 vxe 自带表单与工具栏入口', /** 未关闭自带表单会与 formOptions 冲突，工具栏入口重复会让用户看到两套按钮。 */ () => {
    const config = vxeProbe.configs[0] as {
      grid: {
        formConfig: { enabled: boolean };
        toolbarConfig: Record<string, boolean>;
      };
      table: { resizableConfig: { maxWidth: number } };
    };

    expect(config.table.resizableConfig.maxWidth).toBe(1000);
    expect(config.grid.formConfig.enabled).toBe(false);
    expect(config.grid.toolbarConfig).toEqual({
      custom: false,
      export: false,
      import: false,
      print: false,
      refresh: false,
      zoom: false,
    });
  });

  it('开启代理分页、序号偏移与列表结果字段映射', /** 结果字段写错会让列表拿不到数据，序号未偏移会让翻页后重新从 1 开始。 */ () => {
    const config = vxeProbe.configs[0] as {
      grid: {
        proxyConfig: {
          autoLoad: boolean;
          response: Record<string, string>;
          seq: boolean;
          showActiveMsg: boolean;
          showResponseMsg: boolean;
        };
      };
    };

    expect(config.grid.proxyConfig).toEqual({
      autoLoad: true,
      response: { result: 'list', total: 'total' },
      seq: true,
      showActiveMsg: true,
      showResponseMsg: false,
    });
  });
});

describe('图片与链接单元格渲染器', /** 渲染结果决定图片列与链接列能否正确展示。 */ () => {
  it('图片列按行取值渲染预览图并透传尺寸', /** 取错字段会让图片列显示空白，尺寸未换算会让预览图比例失真。 */ () => {
    const node = asVNode(
      rendererOf('CellImage').renderTableDefault(
        { props: { class: 'rounded', height: 40, width: 60 } },
        CELL_PARAMS,
      ),
    );

    expect(node.type).toBe(ElImage);
    expect(node.props).toMatchObject({
      class: 'rounded',
      previewSrcList: ['DUMMY-取值'],
      previewTeleported: true,
      src: 'DUMMY-取值',
      style: { height: '40px', width: '60px' },
    });
  });

  it('图片列未声明尺寸时保留自适应样式', /** 强行写入 undefined 尺寸会让图片无法按容器自适应。 */ () => {
    const node = asVNode(
      rendererOf('CellImage').renderTableDefault({}, CELL_PARAMS),
    );

    expect(node.props?.style).toEqual({
      height: undefined,
      width: undefined,
    });
  });

  it('链接列渲染为小号文字按钮', /** 渲染成普通按钮会让列表里出现大号实心按钮。 */ () => {
    const node = asVNode(
      rendererOf('CellLink').renderTableDefault(
        { props: { text: 'DUMMY-链接' } },
        CELL_PARAMS,
      ),
    );

    expect(node.type).toBe(ElButton);
    expect(node.props).toEqual({ link: true, size: 'small' });
    expect(defaultSlot(node)()).toBe('DUMMY-链接');
  });
});

describe('标签与字典单元格渲染器', /** 渲染结果决定标签列与字典列能否正确展示。 */ () => {
  it('单标签列按行取值渲染彩色标签', /** 取错字段会让标签列空白，颜色未透传会让标签失去语义配色。 */ () => {
    const node = asVNode(
      rendererOf('CellTag').renderTableDefault(
        { props: { color: 'blue' } },
        CELL_PARAMS,
      ),
    );

    expect(node.type).toBe(ElTag);
    expect(node.props).toEqual({ color: 'blue' });
    expect(defaultSlot(node)()).toBe('DUMMY-取值');
  });

  it('多标签列在空值与非数组时返回空串', /** 空列渲染出空容器会让表格出现多余的空白块。 */ () => {
    const renderer = rendererOf('CellTags');

    expect(
      renderer.renderTableDefault(
        {},
        { column: { field: 'v' }, row: { v: [] } },
      ),
    ).toBe('');
    expect(
      renderer.renderTableDefault(
        {},
        { column: { field: 'v' }, row: { v: undefined } },
      ),
    ).toBe('');
    expect(
      renderer.renderTableDefault(
        {},
        { column: { field: 'v' }, row: { v: 'DUMMY' } },
      ),
    ).not.toBe('');
  });

  it('多标签列逐个渲染标签并把未知元素收敛为文本', /** 未逐个渲染会让标签列只显示一个标签，未知元素直接渲染会让 Vue 抛错。 */ () => {
    const node = asVNode(
      rendererOf('CellTags').renderTableDefault(
        { props: { color: 'green' } },
        { column: { field: 'tags' }, row: { tags: ['甲', 2] } },
      ),
    );
    // 元素节点的默认插槽会在 h() 内立即求值，子内容直接是标签节点数组。
    const items = childArray(node);

    expect(node.type).toBe('div');
    expect(node.props).toEqual({
      class: 'flex items-center justify-center',
    });
    expect(items).toHaveLength(2);
    expect(asVNode(items[0]).type).toBe(ElTag);
    expect(asVNode(items[0]).props).toEqual({ color: 'green' });
    expect(defaultSlot(items[0])()).toBe('甲');
    expect(defaultSlot(items[1])()).toBe('2');
  });

  it('字典列缺少配置时返回空串', /** 缺少字典配置仍渲染会让单元格出现空标签。 */ () => {
    expect(rendererOf('CellDict').renderTableDefault({}, CELL_PARAMS)).toBe('');
  });

  it('字典列把行取值转成字典标签组件', /** 字典类型写错会让标签取不到文案，未转字符串会让数字取值匹配失败。 */ () => {
    const node = asVNode(
      rendererOf('CellDict').renderTableDefault(
        { props: { type: 'common_status' } },
        { column: { field: 'status' }, row: { status: 0 } },
      ),
    );

    expect(node.type).toBe(DictTag);
    expect(node.props).toEqual({ type: 'common_status', value: '0' });
  });
});

describe('开关单元格渲染器', /** 开关列决定管理员能否在列表内改状态。 */ () => {
  it('按行取值渲染开关并透传文案与取值', /** 取值写错会让开关方向相反，文案缺失会让用户不知道开关含义。 */ () => {
    const node = asVNode(
      rendererOf('CellSwitch').renderTableDefault(
        { attrs: {}, props: { activeValue: 9 } },
        { column: { field: 'status' }, row: { status: 0 } },
      ),
    );

    expect(node.type).toBe(ElSwitch);
    expect(node.props).toMatchObject({
      activeText: 'common.enabled',
      activeValue: 9,
      inactiveText: 'common.disabled',
      inactiveValue: 0,
      inlinePrompt: true,
      loading: false,
      modelValue: 0,
    });
  });

  it('变更被 beforeChange 放行时写回行数据', /** 未写回会让用户看到开关弹回原状态。 */ async () => {
    const beforeChange = vi.fn(/** 放行本次变更。 */ async () => true);
    const row: Record<string, unknown> = { status: 0 };
    const node = asVNode(
      rendererOf('CellSwitch').renderTableDefault(
        { attrs: { beforeChange } },
        { column: { field: 'status' }, row },
      ),
    );
    const onChange = node.props?.['onUpdate:modelValue'] as SwitchChangeHandler;

    await onChange(1);

    expect(beforeChange).toHaveBeenCalledWith(1, row);
    expect(row.status).toBe(1);
    expect(row.__loading_status).toBe(false);
  });

  it('变更被 beforeChange 拦截时不写回行数据', /** 忽略拦截结果会让二次确认形同虚设。 */ async () => {
    const row: Record<string, unknown> = { status: 0 };
    const node = asVNode(
      rendererOf('CellSwitch').renderTableDefault(
        {
          attrs: {
            /** 拦截本次变更。 */
            beforeChange: async () => false,
          },
        },
        { column: { field: 'status' }, row },
      ),
    );
    const onChange = node.props?.['onUpdate:modelValue'] as SwitchChangeHandler;

    await onChange(1);

    expect(row.status).toBe(0);
  });

  it('未声明 beforeChange 时直接写回行数据', /** 缺少钩子时仍拦截会让开关完全无法使用。 */ async () => {
    const row: Record<string, unknown> = { status: 0 };
    const node = asVNode(
      rendererOf('CellSwitch').renderTableDefault(
        { attrs: {} },
        { column: { field: 'status' }, row },
      ),
    );
    const onChange = node.props?.['onUpdate:modelValue'] as SwitchChangeHandler;

    await onChange(1);

    expect(row.status).toBe(1);
  });

  it('变更失败时仍清除行内加载标记', /** 未清除加载标记会让开关永久停在加载态。 */ async () => {
    const row: Record<string, unknown> = { status: 0 };
    const node = asVNode(
      rendererOf('CellSwitch').renderTableDefault(
        {
          attrs: {
            /** 抛出写库失败。 */
            beforeChange: async () => {
              throw new Error('DUMMY-写库失败');
            },
          },
        },
        { column: { field: 'status' }, row },
      ),
    );
    const onChange = node.props?.['onUpdate:modelValue'] as SwitchChangeHandler;

    await expect(onChange(1)).rejects.toThrow('DUMMY-写库失败');
    expect(row.__loading_status).toBe(false);
  });
});

describe('操作列渲染器', /** 操作列决定列表内的编辑、删除与自定义操作能否触发。 */ () => {
  it('未配置操作项时给出编辑与删除默认项', /** 默认项缺失会让所有列表的操作列空白。 */ () => {
    const node = asVNode(
      rendererOf('CellOperation').renderTableDefault({}, CELL_PARAMS),
    );
    const buttons = childArray(node);

    expect(node.type).toBe('div');
    expect(node.props).toMatchObject({ class: 'flex table-operations' });
    expect(buttons).toHaveLength(2);
  });

  it('按列对齐方式换算按钮组对齐', /** 对齐换算写错会让操作按钮挤在错误一侧。 */ () => {
    const renderer = rendererOf('CellOperation');
    const cases = [
      ['center', 'center'],
      ['left', 'start'],
      ['right', 'end'],
    ] as const;

    for (const [align, expected] of cases) {
      const node = asVNode(
        renderer.renderTableDefault(
          {},
          { column: { align, field: 'value' }, row: {} },
        ),
      );
      expect(node.props?.style).toEqual({ justifyContent: expected });
    }
  });

  it('未知操作码回退为操作码本身作为文案', /** 回退成空文案会让自定义操作按钮显示成空白。 */ () => {
    const node = asVNode(
      rendererOf('CellOperation').renderTableDefault(
        { options: ['DUMMY-自定义'] },
        CELL_PARAMS,
      ),
    );
    const button = childAt(node, 0);
    const content = defaultSlot(button)() as unknown[];

    expect(button.props?.code).toBe('DUMMY-自定义');
    expect(content).toContain('DUMMY-自定义');
  });

  it('函数型操作属性按当前行求值', /** 配置期求值会让 show、disabled 依赖不到行数据。 */ () => {
    const node = asVNode(
      rendererOf('CellOperation').renderTableDefault(
        {
          options: [
            {
              code: 'edit',
              /** 按当前行计算按钮文案。 */
              text: (row: Record<string, unknown>) => `改${row.id}`,
            },
          ],
        },
        CELL_PARAMS,
      ),
    );
    const button = childAt(node, 0);

    expect(button.props?.text).toBe('改7');
  });

  it('show 为 false 的操作项被过滤', /** 未过滤会让无权限操作仍然显示入口。 */ () => {
    const node = asVNode(
      rendererOf('CellOperation').renderTableDefault(
        {
          options: [
            { code: 'edit' },
            {
              code: 'delete',
              show: false,
            },
          ],
        },
        CELL_PARAMS,
      ),
    );

    expect(childArray(node)).toHaveLength(1);
  });

  it('普通操作按钮点击后回传操作码与当前行', /** 未回传会让页面拿不到要操作哪一行。 */ () => {
    const onClick = vi.fn();
    const node = asVNode(
      rendererOf('CellOperation').renderTableDefault(
        {
          attrs: { onClick },
          options: [{ code: 'edit', icon: 'lucide:edit' }],
        },
        CELL_PARAMS,
      ),
    );
    const button = childAt(node, 0);
    const content = defaultSlot(button)() as unknown[];

    expect(content).toHaveLength(2);
    (button.props?.onClick as ClickHandler)();
    expect(onClick).toHaveBeenCalledWith({
      code: 'edit',
      row: CELL_PARAMS.row,
    });
  });

  it('删除操作渲染为二次确认弹层', /** 未加确认会让误点直接删数据，确认文案缺名称会让管理员无法确认删哪一条。 */ () => {
    const onClick = vi.fn();
    const node = asVNode(
      rendererOf('CellOperation').renderTableDefault(
        {
          attrs: { nameField: 'value', nameTitle: 'DUMMY-记录', onClick },
          options: ['delete'],
        },
        CELL_PARAMS,
      ),
    );
    const confirm = childAt(node, 0);
    const reference = asVNode(referenceSlot(confirm)());

    expect(confirm.type).toBe(ElPopconfirm);
    expect(confirm.props).toMatchObject({
      title: 'ui.actionTitle.delete(DUMMY-记录)',
      width: 'auto',
    });
    expect(reference.type).toBe(ElButton);
    expect(reference.props?.onClick).toBeUndefined();
    expect(defaultSlot(confirm)()).toBeDefined();
    (confirm.props?.onConfirm as ClickHandler)();
    expect(onClick).toHaveBeenCalledWith({
      code: 'delete',
      row: CELL_PARAMS.row,
    });
  });

  it('二次确认正文展示当前行名称', /** 名称取错字段会让管理员看到空白的确认文案。 */ () => {
    const node = asVNode(
      rendererOf('CellOperation').renderTableDefault(
        { attrs: { nameField: 'value' }, options: ['delete'] },
        CELL_PARAMS,
      ),
    );
    const confirm = childAt(node, 0);
    const body = asVNode(defaultSlot(confirm)());

    expect(body.type).toBe('div');
    expect(body.children).toBe('ui.actionMessage.deleteConfirm(DUMMY-取值)');
  });
});

describe('表格格式化器', /** 格式化器决定金额、数量、时间与文件大小的展示口径。 */ () => {
  it('相对时间格式化器透传单元格取值', /** 未透传取值会让时间列全部显示为当前时间。 */ () => {
    const formatted = formatOf('formatPast2').tableCellFormatMethod({
      cellValue: new Date(2024, 2, 4, 5, 6, 7),
    });

    expect(typeof formatted).toBe('string');
    expect(formatted).not.toBe('');
  });

  it('三位数量格式化器保留三位小数', /** 位数写错会让数量精度丢失或出现多余小数。 */ () => {
    expect(
      formatOf('formatAmount3').tableCellFormatMethod({ cellValue: 1.234_56 }),
    ).toBe('1.235');
  });

  it('数量格式化器对空值返回空串', /** 空值强行格式化会让空单元格显示成 0。 */ () => {
    expect(
      formatOf('formatAmount3').tableCellFormatMethod({ cellValue: null }),
    ).toBe('');
    expect(
      formatOf('formatAmount3').tableCellFormatMethod({ cellValue: undefined }),
    ).toBe('');
  });

  it('两位数量格式化器按传入位数换算', /** 忽略传入位数会让调用方无法覆盖默认精度。 */ () => {
    expect(
      formatOf('formatAmount2').tableCellFormatMethod({ cellValue: 1.234_56 }),
    ).toBe('1.23');
    expect(
      formatOf('formatAmount2').tableCellFormatMethod(
        { cellValue: 1.234_56 },
        3,
      ),
    ).toBe('1.235');
  });

  it('分转元格式化器先换算再按位数格式化', /** 未换算会让金额放大一百倍。 */ () => {
    expect(
      formatOf('formatFenToYuanAmount').tableCellFormatMethod({
        cellValue: 123_456,
      }),
    ).toBe('1234.56');
  });

  it('文件大小格式化器按位数换算单位', /** 未换算会让用户看到裸字节数。 */ () => {
    expect(
      formatOf('formatFileSize').tableCellFormatMethod({ cellValue: 2048 }),
    ).toBe('2 KB');
    expect(
      formatOf('formatFileSize').tableCellFormatMethod({ cellValue: 2048 }, 0),
    ).toBe('2 KB');
  });
});
