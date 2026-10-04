/**
 * 表单组件适配层（apps/web-ele/src/adapter/component）真实行为回归。
 *
 * 该模块把 Element Plus 与业务组件的差异收敛到一处，并注册到全局共享状态：映射表漏项会让
 * 页面声明了组件类型却渲染不出控件；默认占位文案缺失会让表单出现空白输入框；内部组件实例
 * 方法未通过 Proxy 暴露会让表单层无法调用 focus/blur；多选项组未按 options 生成子项会让
 * 单选框与复选框组渲染为空；按钮类型写错会让默认按钮与主要按钮样式互换；时间与日期范围
 * 控件的 name/id 未按 `_end` 后缀补齐会让表单只校验到起始值。
 *
 * 用例真实调用 initComponentAdapter 并真实渲染每个自定义适配组件，只替换消息提示的展示
 * 观察方式（断言通知落到文档中），其余 Element Plus 组件保持真实实现。
 */

import type { Component } from 'vue';

import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { globalShareState } from '@vben/common-ui';
import { $t } from '@vben/locales';

import { ElNotification } from 'element-plus';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initComponentAdapter } from './index';

vi.mock(
  '#/components/upload',
  /** 只替换上传组件引用，避免适配层测试连带加载真实请求封装；上传组件由自身用例覆盖。 */ () => ({
    FileUpload: { name: 'FileUploadStub' },
    ImageUpload: { name: 'ImageUploadStub' },
  }),
);

/**
 * 逐个替换 Element Plus 组件的样式入口。
 *
 * 这些组件通过 defineAsyncComponent 异步加载，样式入口会连带引入 node_modules 中的 CSS，
 * 而 Vitest 对 node_modules 依赖走 Node 原生 ESM 加载，无法处理 .css 扩展名；happy-dom
 * 也不计算样式，因此样式入口对断言没有影响。组件实现本身保持真实。
 * 每行替身都只替换样式模块，组件实现仍从 element-plus 真实加载。
 */
vi.mock(
  'element-plus/es/components/autocomplete/style/css',
  /** 替换样式入口，避免 CSS 被 Node 原生 ESM 加载。 */ () => ({}),
);
vi.mock(
  'element-plus/es/components/button/style/css',
  /** 替换样式入口，避免 CSS 被 Node 原生 ESM 加载。 */ () => ({}),
);
vi.mock(
  'element-plus/es/components/cascader/style/css',
  /** 替换样式入口，避免 CSS 被 Node 原生 ESM 加载。 */ () => ({}),
);
vi.mock(
  'element-plus/es/components/checkbox/style/css',
  /** 替换样式入口，避免 CSS 被 Node 原生 ESM 加载。 */ () => ({}),
);
vi.mock(
  'element-plus/es/components/checkbox-button/style/css',
  /** 替换样式入口，避免 CSS 被 Node 原生 ESM 加载。 */ () => ({}),
);
vi.mock(
  'element-plus/es/components/checkbox-group/style/css',
  /** 替换样式入口，避免 CSS 被 Node 原生 ESM 加载。 */ () => ({}),
);
vi.mock(
  'element-plus/es/components/date-picker/style/css',
  /** 替换样式入口，避免 CSS 被 Node 原生 ESM 加载。 */ () => ({}),
);
vi.mock(
  'element-plus/es/components/divider/style/css',
  /** 替换样式入口，避免 CSS 被 Node 原生 ESM 加载。 */ () => ({}),
);
vi.mock(
  'element-plus/es/components/input/style/css',
  /** 替换样式入口，避免 CSS 被 Node 原生 ESM 加载。 */ () => ({}),
);
vi.mock(
  'element-plus/es/components/input-number/style/css',
  /** 替换样式入口，避免 CSS 被 Node 原生 ESM 加载。 */ () => ({}),
);
vi.mock(
  'element-plus/es/components/input-tag/style/css',
  /** 替换样式入口，避免 CSS 被 Node 原生 ESM 加载。 */ () => ({}),
);
vi.mock(
  'element-plus/es/components/rate/style/css',
  /** 替换样式入口，避免 CSS 被 Node 原生 ESM 加载。 */ () => ({}),
);
vi.mock(
  'element-plus/es/components/radio/style/css',
  /** 替换样式入口，避免 CSS 被 Node 原生 ESM 加载。 */ () => ({}),
);
vi.mock(
  'element-plus/es/components/radio-button/style/css',
  /** 替换样式入口，避免 CSS 被 Node 原生 ESM 加载。 */ () => ({}),
);
vi.mock(
  'element-plus/es/components/radio-group/style/css',
  /** 替换样式入口，避免 CSS 被 Node 原生 ESM 加载。 */ () => ({}),
);
vi.mock(
  'element-plus/es/components/select-v2/style/css',
  /** 替换样式入口，避免 CSS 被 Node 原生 ESM 加载。 */ () => ({}),
);
vi.mock(
  'element-plus/es/components/space/style/css',
  /** 替换样式入口，避免 CSS 被 Node 原生 ESM 加载。 */ () => ({}),
);
vi.mock(
  'element-plus/es/components/switch/style/css',
  /** 替换样式入口，避免 CSS 被 Node 原生 ESM 加载。 */ () => ({}),
);
vi.mock(
  'element-plus/es/components/time-picker/style/css',
  /** 替换样式入口，避免 CSS 被 Node 原生 ESM 加载。 */ () => ({}),
);
vi.mock(
  'element-plus/es/components/tree-select/style/css',
  /** 替换样式入口，避免 CSS 被 Node 原生 ESM 加载。 */ () => ({}),
);
vi.mock(
  'element-plus/es/components/upload/style/css',
  /** 替换样式入口，避免 CSS 被 Node 原生 ESM 加载。 */ () => ({}),
);

/** 适配层必须注册的组件类型，漏项会让页面声明的控件渲染为空。 */
const EXPECTED_COMPONENTS = [
  'ApiCascader',
  'ApiSelect',
  'ApiTreeSelect',
  'AutoComplete',
  'Checkbox',
  'CheckboxGroup',
  'DatePicker',
  'DefaultButton',
  'Divider',
  'FileUpload',
  'IconPicker',
  'ImageUpload',
  'Input',
  'InputNumber',
  'InputTag',
  'PrimaryButton',
  'RadioGroup',
  'RangePicker',
  'Rate',
  'Select',
  'Space',
  'Switch',
  'Textarea',
  'TimePicker',
  'TreeSelect',
  'Upload',
];

/** 单选项夹具：标签与取值一一对应，用于核对按 options 生成的子项。 */
const OPTION_FIXTURE = [
  { label: 'DUMMY-选项一', value: 'one' },
  { label: 'DUMMY-选项二', value: 'two' },
];

/**
 * 取出注册到全局共享状态的组件适配项。
 * @param name 组件类型名。
 * @returns 对应的组件定义。
 * @throws Error 未注册该组件时抛出，避免用例静默地什么都不验证。
 */
function componentOf(name: string): Component {
  const component = globalShareState.getComponents()[name];
  if (!component) {
    throw new Error(`适配层未注册组件：${name}`);
  }
  return component as Component;
}

/** 就绪判定：返回 true 表示异步子组件已经进入组件树。 */
type RenderReady = (wrapper: ReturnType<typeof mount>) => boolean;

/** 插槽渲染函数签名：返回插槽内容。 */
type SlotRenderer = () => unknown;

/** 挂载选项视图：只读取用例声明的属性与插槽。 */
interface MountOptions {
  /** 传给适配组件的属性。 */
  props?: Record<string, unknown>;
  /** 传给适配组件的非属性值。 */
  attrs?: Record<string, unknown>;
  /** 传给适配组件的插槽。 */
  slots?: Record<string, SlotRenderer>;
}

/** 默认就绪判定：异步组件未解析时宿主根节点是注释节点。 */
const DEFAULT_READY: RenderReady = (wrapper) => wrapper.element.nodeType !== 8;

/** 组件内部实例视图：只读取 defineExpose 暴露的方法表。 */
interface ExposedInstance {
  /** 组件内部实例，提供 expose 结果。 */
  $: { exposed?: Record<string, unknown> };
}

/**
 * 取出适配组件通过 defineExpose 暴露的方法表。
 * @param wrapper 已挂载的宿主包装器。
 * @param name 组件类型名。
 * @returns 暴露的方法表。
 * @throws TypeError 组件未暴露方法表时抛出，避免用例静默地什么都不验证。
 */
function exposedMethods(wrapper: ReturnType<typeof mount>, name: string) {
  const instance = wrapper.findComponent(componentOf(name))
    .vm as unknown as ExposedInstance;
  const exposed = instance.$?.exposed;
  if (!exposed) {
    throw new TypeError(`组件未暴露内部实例：${name}`);
  }
  return exposed;
}

/**
 * 挂载适配后的组件并等待异步子组件进入组件树。
 *
 * Element Plus 组件经 defineAsyncComponent 异步加载，首次解析需要等待模块加载完成；
 * 同时异步组件不适合作为根组件（挂载结果拿不到实例），因此统一包一层宿主组件。
 * @param name 组件类型名。
 * @param options 挂载选项，含 props、attrs 与插槽。
 * @param ready 就绪判定；默认以根节点不再是注释节点为准。
 * @returns 已挂载的宿主组件包装器。
 */
async function mountComponent(
  name: string,
  options: MountOptions = {},
  ready: RenderReady = DEFAULT_READY,
) {
  const component = componentOf(name);
  const Host = defineComponent({
    name: 'AdapterHost',
    /**
     * 渲染被测适配组件并透传属性与插槽。
     * @returns 适配组件的渲染结果。
     */
    setup() {
      return /** 渲染适配组件并透传属性与插槽。 */ () =>
        h(
          component,
          { ...options.props, ...options.attrs },
          options.slots as Parameters<typeof h>[2],
        );
    },
  });
  const wrapper = mount(Host);
  await vi.waitFor(
    /** 轮询等待异步组件解析并完成渲染。 */ async () => {
      await flushPromises();
      await wrapper.vm.$nextTick();
      expect(ready(wrapper)).toBe(true);
    },
    { timeout: 5000 },
  );
  return wrapper;
}

beforeAll(
  /** 注册一次适配层，后续用例共用同一份真实映射表。 */ async () => {
    await initComponentAdapter();
  },
);

afterAll(
  /** 关闭用例期间弹出的通知，避免残留节点影响其它用例。 */ () => {
    ElNotification.closeAll();
  },
);

describe('适配层组件注册', /** 映射表决定页面声明的控件能否渲染。 */ () => {
  it('注册全部表单组件适配项', /** 漏项会让页面声明了组件类型却渲染不出控件。 */ () => {
    const components = globalShareState.getComponents();

    for (const name of EXPECTED_COMPONENTS) {
      expect(components[name], `缺少适配项：${name}`).toBeDefined();
    }
  });

  it('把复制成功提示注册为右下角常驻成功通知', /** 提示注册缺失会让偏好设置的复制反馈静默失效。 */ async () => {
    const message = globalShareState.getMessage();
    const handler = message.copyPreferencesSuccess;

    expect(typeof handler).toBe('function');
    handler?.('DUMMY-复制标题', 'DUMMY-复制内容');
    await flushPromises();

    expect(document.body.textContent).toContain('DUMMY-复制标题');
    expect(document.body.textContent).toContain('DUMMY-复制内容');
  });
});

describe('默认占位文案包装', /** 占位文案决定表单是否出现空白输入框。 */ () => {
  it('未声明占位时按控件种类补默认文案', /** 缺少默认占位会让用户不知道输入框要填什么。 */ async () => {
    const wrapper = await mountComponent(
      'Input',
      {},
      /** 等待输入框渲染完成。 */ (item) => item.find('input').exists(),
    );

    expect(wrapper.find('input').attributes('placeholder')).toBe(
      $t('ui.placeholder.input'),
    );
  });

  it('选择类控件使用下拉默认文案', /** 下拉控件沿用输入框文案会让提示语义不符。 */ async () => {
    const wrapper = await mountComponent(
      'TreeSelect',
      {},
      /** 等待下拉占位节点渲染完成。 */ (item) =>
        item.find('.el-select__placeholder').exists(),
    );

    expect(wrapper.find('.el-select__placeholder').text()).toBe(
      $t('ui.placeholder.select'),
    );
  });

  it('调用方声明的占位覆盖默认文案', /** 覆盖失效会让自定义占位不起作用。 */ async () => {
    const wrapper = await mountComponent(
      'Input',
      { attrs: { placeholder: 'DUMMY-自定义占位' } },
      /** 等待输入框渲染完成。 */ (item) => item.find('input').exists(),
    );

    expect(wrapper.find('input').attributes('placeholder')).toBe(
      'DUMMY-自定义占位',
    );
  });

  it('文本域包装追加多行属性', /** 缺少行数会让备注类字段只显示一行。 */ async () => {
    const wrapper = await mountComponent(
      'Textarea',
      {},
      /** 等待多行输入框渲染完成。 */ (item) => item.find('textarea').exists(),
    );
    const textarea = wrapper.find('textarea');

    expect(textarea.exists()).toBe(true);
    expect(textarea.attributes('rows')).toBe('3');
  });

  it('通过 Proxy 暴露内部组件实例方法', /** 未暴露实例方法会让表单层无法调用 focus/blur。 */ async () => {
    const wrapper = await mountComponent(
      'Input',
      {},
      /** 等待输入框渲染完成。 */ (item) => item.find('input').exists(),
    );
    const exposed = exposedMethods(wrapper, 'Input');

    expect('focus' in exposed).toBe(true);
    expect(typeof exposed.focus).toBe('function');
    expect(typeof exposed.blur).toBe('function');
    expect(exposed.notExistingMethod).toBeUndefined();
  });
});

describe('多选项组适配', /** 子项生成决定单选框与复选框组能否按选项渲染。 */ () => {
  it('复选框组按 options 生成普通复选框', /** 未生成子项会让复选框组渲染为空。 */ async () => {
    const wrapper = await mountComponent(
      'CheckboxGroup',
      { attrs: { options: OPTION_FIXTURE } },
      /** 等待两个复选框渲染完成。 */ (item) =>
        item.findAll('.el-checkbox').length === 2,
    );

    expect(wrapper.findAll('.el-checkbox')).toHaveLength(2);
    expect(wrapper.text()).toContain('DUMMY-选项一');
    expect(wrapper.findAll('.el-checkbox-button')).toHaveLength(0);
  });

  it('复选框组在按钮模式下生成按钮样式子项', /** 按钮模式判断写错会让分组退化成普通复选框。 */ async () => {
    const wrapper = await mountComponent(
      'CheckboxGroup',
      { attrs: { isButton: true, options: OPTION_FIXTURE } },
      /** 等待两个按钮样式复选框渲染完成。 */ (item) =>
        item.findAll('.el-checkbox-button').length === 2,
    );

    expect(wrapper.findAll('.el-checkbox-button')).toHaveLength(2);
  });

  it('复选框组优先使用调用方插槽', /** 忽略插槽会让自定义子项无法渲染。 */ async () => {
    const wrapper = await mountComponent(
      'CheckboxGroup',
      {
        attrs: { options: OPTION_FIXTURE },
        slots: {
          /**
           * 渲染自定义子项。
           * @returns 自定义子项文本。
           */
          default: () => 'DUMMY-自定义子项',
        },
      },
      /** 等待复选框组渲染完成。 */ (item) =>
        item.find('.el-checkbox-group').exists(),
    );

    expect(wrapper.text()).toContain('DUMMY-自定义子项');
    expect(wrapper.text()).not.toContain('DUMMY-选项一');
  });

  it('复选框组在选项非数组时不生成子项', /** 非数组选项被当成列表会让渲染抛错。 */ async () => {
    const wrapper = await mountComponent(
      'CheckboxGroup',
      { attrs: { options: null } },
      /** 等待复选框组渲染完成。 */ (item) =>
        item.find('.el-checkbox-group').exists(),
    );

    expect(wrapper.findAll('.el-checkbox')).toHaveLength(0);
  });

  it('单选框组按 options 生成普通单选项', /** 未生成子项会让单选框组渲染为空。 */ async () => {
    const wrapper = await mountComponent(
      'RadioGroup',
      { attrs: { options: OPTION_FIXTURE } },
      /** 等待两个单选项渲染完成。 */ (item) =>
        item.findAll('.el-radio').length === 2,
    );

    expect(wrapper.findAll('.el-radio')).toHaveLength(2);
    expect(wrapper.findAll('.el-radio-button')).toHaveLength(0);
  });

  it('单选框组在按钮模式下生成按钮样式子项', /** 按钮模式判断写错会让分组退化成普通单选框。 */ async () => {
    const wrapper = await mountComponent(
      'RadioGroup',
      { attrs: { isButton: true, options: OPTION_FIXTURE } },
      /** 等待两个按钮样式单选项渲染完成。 */ (item) =>
        item.findAll('.el-radio-button').length === 2,
    );

    expect(wrapper.findAll('.el-radio-button')).toHaveLength(2);
  });

  it('单选框组优先使用调用方插槽', /** 忽略插槽会让自定义子项无法渲染。 */ async () => {
    const wrapper = await mountComponent(
      'RadioGroup',
      {
        attrs: { options: OPTION_FIXTURE },
        slots: {
          /**
           * 渲染自定义子项。
           * @returns 自定义子项文本。
           */
          default: () => 'DUMMY-自定义单选项',
        },
      },
      /** 等待单选框组渲染完成。 */ (item) =>
        item.find('.el-radio-group').exists(),
    );

    expect(wrapper.text()).toContain('DUMMY-自定义单选项');
    expect(wrapper.text()).not.toContain('DUMMY-选项一');
  });

  it('单选框组在选项非数组时不生成子项', /** 非数组选项被当成列表会让渲染抛错。 */ async () => {
    const wrapper = await mountComponent(
      'RadioGroup',
      { attrs: { options: null } },
      /** 等待单选框组渲染完成。 */ (item) =>
        item.find('.el-radio-group').exists(),
    );

    expect(wrapper.findAll('.el-radio')).toHaveLength(0);
  });
});

describe('按钮与下拉适配', /** 按钮类型与下拉实现决定交互外观与取值方式。 */ () => {
  it('默认按钮渲染为 default 样式', /** 类型写错会让默认按钮显示成主要按钮。 */ async () => {
    const wrapper = await mountComponent(
      'DefaultButton',
      {
        slots: {
          /**
           * 渲染按钮文案。
           * @returns 按钮文案。
           */
          default: () => 'DUMMY-默认按钮',
        },
      },
      /** 等待按钮渲染完成。 */ (item) => item.find('button').exists(),
    );
    const button = wrapper.find('button');

    expect(button.text()).toBe('DUMMY-默认按钮');
    expect(button.classes()).toContain('el-button--default');
  });

  it('主要按钮渲染为 primary 样式', /** 类型写错会让主要按钮显示成默认按钮。 */ async () => {
    const wrapper = await mountComponent(
      'PrimaryButton',
      {
        slots: {
          /**
           * 渲染按钮文案。
           * @returns 按钮文案。
           */
          default: () => 'DUMMY-主要按钮',
        },
      },
      /** 等待按钮渲染完成。 */ (item) => item.find('button').exists(),
    );
    const button = wrapper.find('button');

    expect(button.text()).toBe('DUMMY-主要按钮');
    expect(button.classes()).toContain('el-button--primary');
  });

  it('下拉组件渲染为虚拟滚动选择器', /** 换成普通下拉会让大数据量选项渲染变慢。 */ async () => {
    const wrapper = await mountComponent(
      'Select',
      { attrs: { options: OPTION_FIXTURE } },
      /** 等待下拉渲染完成。 */ (item) => item.find('.el-select').exists(),
    );

    expect(wrapper.find('.el-select').exists()).toBe(true);
  });
});

describe('日期与时间适配', /** 范围控件的 name/id 补齐决定表单能否校验到结束值。 */ () => {
  it('时间选择器在范围模式下补齐成对的 name 与 id', /** 缺少结束值名称会让表单只校验到起始时间。 */ async () => {
    const wrapper = await mountComponent(
      'TimePicker',
      { props: { id: 'DUMMY-time', isRange: true, name: 'DUMMY-time' } },
      /** 等待两个时间输入框渲染完成。 */ (item) =>
        item.findAll('input').length === 2,
    );
    const inputs = wrapper.findAll('input');

    expect(inputs).toHaveLength(2);
    expect(inputs[0]?.attributes('name')).toBe('DUMMY-time');
    expect(inputs[1]?.attributes('name')).toBe('DUMMY-time_end');
    expect(inputs[0]?.attributes('id')).toBe('DUMMY-time');
    expect(inputs[1]?.attributes('id')).toBe('DUMMY-time_end');
  });

  it('时间选择器在单值模式下保持单个名称', /** 单值模式补成数组会让 Element Plus 取不到值。 */ async () => {
    const wrapper = await mountComponent(
      'TimePicker',
      { props: { id: 'DUMMY-time', isRange: false, name: 'DUMMY-time' } },
      /** 等待单个时间输入框渲染完成。 */ (item) =>
        item.findAll('input').length === 1,
    );
    const inputs = wrapper.findAll('input');

    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.attributes('name')).toBe('DUMMY-time');
  });

  it('日期范围选择器固定为日期时间范围并补齐名称', /** 缺少 datetimerange 会让用户只能选到日期，缺结束名称会让范围值回填不全。 */ async () => {
    const wrapper = await mountComponent(
      'RangePicker',
      { props: { id: 'DUMMY-range', name: 'DUMMY-range' } },
      /** 等待范围选择器渲染完成。 */ (item) =>
        item.findAll('input').length === 2,
    );
    const inputs = wrapper.findAll('input');

    expect(wrapper.find('.el-date-editor--datetimerange').exists()).toBe(true);
    expect(inputs[1]?.attributes('name')).toBe('DUMMY-range_end');
    expect(inputs[1]?.attributes('id')).toBe('DUMMY-range_end');
  });

  it('日期选择器在范围类型下补齐成对名称', /** 范围类型缺结束名称会让表单只校验到起始日期。 */ async () => {
    const wrapper = await mountComponent(
      'DatePicker',
      { props: { id: 'DUMMY-date', name: 'DUMMY-date', type: 'daterange' } },
      /** 等待两个日期输入框渲染完成。 */ (item) =>
        item.findAll('input').length === 2,
    );
    const inputs = wrapper.findAll('input');

    expect(inputs).toHaveLength(2);
    expect(inputs[1]?.attributes('name')).toBe('DUMMY-date_end');
  });

  it('日期选择器在单值类型下保持单个名称', /** 单值模式补成数组会让 Element Plus 取不到值。 */ async () => {
    const wrapper = await mountComponent(
      'DatePicker',
      { props: { id: 'DUMMY-date', name: 'DUMMY-date', type: 'date' } },
      /** 等待单个日期输入框渲染完成。 */ (item) =>
        item.findAll('input').length === 1,
    );
    const inputs = wrapper.findAll('input');

    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.attributes('name')).toBe('DUMMY-date');
  });

  it('日期选择器未声明类型时不补齐名称', /** 未声明类型时补名称会让默认单值选择器渲染出错。 */ async () => {
    const wrapper = await mountComponent(
      'DatePicker',
      { props: { name: 'DUMMY-date' } },
      /** 等待单个日期输入框渲染完成。 */ (item) =>
        item.findAll('input').length === 1,
    );
    const inputs = wrapper.findAll('input');

    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.attributes('name')).toBe('DUMMY-date');
  });
});

describe('其余控件适配', /** 其余控件同样必须能通过适配层真实渲染，否则页面声明后是空白。 */ () => {
  it('自动补全渲染为补全控件', /** 适配项写错会让自动补全退化成普通输入框。 */ async () => {
    const wrapper = await mountComponent(
      'AutoComplete',
      {},
      /** 等待补全控件渲染完成。 */ (item) =>
        item.find('.el-autocomplete').exists(),
    );

    expect(wrapper.find('.el-autocomplete').exists()).toBe(true);
  });

  it('级联选择适配渲染为级联控件', /** 适配项写错会让级联字段退化成普通下拉，层级选择丢失。 */ async () => {
    const wrapper = await mountComponent(
      'ApiCascader',
      {},
      /** 等待级联控件渲染完成。 */ (item) =>
        item.find('.el-cascader').exists(),
    );

    expect(wrapper.find('.el-cascader').exists()).toBe(true);
  });

  it('分割线渲染为分隔元素', /** 缺少 role 会让读屏软件读不出分隔语义。 */ async () => {
    const wrapper = await mountComponent(
      'Divider',
      {},
      /** 等待分割线渲染完成。 */ (item) => item.find('.el-divider').exists(),
    );

    expect(wrapper.find('.el-divider').attributes('role')).toBe('separator');
  });

  it('数字输入渲染为带步进按钮的控件', /** 换成普通输入会让用户无法用按钮调整数值。 */ async () => {
    const wrapper = await mountComponent(
      'InputNumber',
      {},
      /** 等待数字输入渲染完成。 */ (item) =>
        item.find('.el-input-number').exists(),
    );

    expect(wrapper.find('.el-input-number').exists()).toBe(true);
  });

  it('标签输入渲染为多值输入控件', /** 换成单值输入会让用户无法录入多个标签。 */ async () => {
    const wrapper = await mountComponent(
      'InputTag',
      {},
      /** 等待标签输入渲染完成。 */ (item) =>
        item.find('.el-input-tag').exists(),
    );

    expect(wrapper.find('.el-input-tag').exists()).toBe(true);
  });

  it('间距容器渲染为弹性布局容器', /** 适配项写错会让表单布局间距失效。 */ async () => {
    const wrapper = await mountComponent(
      'Space',
      {
        slots: {
          /**
           * 渲染间距容器内的子项。
           * @returns 子项文本。
           */
          default: () => 'DUMMY-间距内容',
        },
      },
      /** 等待间距容器渲染完成。 */ (item) => item.find('.el-space').exists(),
    );

    expect(wrapper.find('.el-space').text()).toBe('DUMMY-间距内容');
  });

  it('开关渲染为开关控件', /** 适配项写错会让布尔字段退化成文本输入。 */ async () => {
    const wrapper = await mountComponent(
      'Switch',
      {},
      /** 等待开关渲染完成。 */ (item) => item.find('.el-switch').exists(),
    );

    expect(wrapper.find('.el-switch').exists()).toBe(true);
  });

  it('上传渲染为上传控件', /** 适配项写错会让文件字段无法选择文件。 */ async () => {
    const wrapper = await mountComponent(
      'Upload',
      {},
      /** 等待上传控件渲染完成。 */ (item) => item.html().includes('el-upload'),
    );

    expect(wrapper.html()).toContain('el-upload');
  });

  it('评分渲染为评分控件', /** 适配项写错会让评分字段退化成数字输入。 */ async () => {
    const wrapper = await mountComponent(
      'Rate',
      {},
      /** 等待评分控件渲染完成。 */ (item) => item.find('.el-rate').exists(),
    );

    expect(wrapper.find('.el-rate').exists()).toBe(true);
  });
});
