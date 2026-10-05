/**
 * 字典类型弹窗（views/system/dict/modules/type-form）真实行为回归。
 *
 * 弹窗按是否已存在主键决定走新增还是修改：主键判断写错会把已有字典类型改成新增、在字典
 * 类型表里产生重复编码；编辑时未重新拉取详情会让用户看到过期数据并覆盖他人修改；加载
 * 详情或提交失败未释放弹窗锁会让弹窗永久停在加载态。用例按真实调用顺序驱动弹窗回调，
 * 只替换弹窗容器、表单渲染、消息提示与网络边界，主键判断与锁状态逻辑真实执行。
 */
import type { VueWrapper } from '@vue/test-utils';

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDictType,
  getDictType,
  updateDictType,
} from '#/api/system/dict/type';

import TypeForm from './type-form.vue';

/** 弹窗开关回调签名：弹窗容器在打开与关闭时驱动弹窗组件。 */
type ModalOpenChange = (isOpen: boolean) => Promise<void> | void;

/** 弹窗替身记录的回调与调用实例；模块替身与用例读取同一实例。 */
const modalProbe = vi.hoisted(
  /** 建立用例可设置数据、可断言的弹窗替身容器。 */ () => ({
    api: {
      close: vi.fn(),
      getData: vi.fn(),
      lock: vi.fn(),
      setState: vi.fn(),
      unlock: vi.fn(),
    },
    handlers: {} as {
      /** 提交回调，由组件在弹窗确认时声明。 */
      onConfirm?: () => Promise<void>;
      /** 开关回调，由组件在弹窗打开或关闭时声明。 */
      onOpenChange?: ModalOpenChange;
    },
  }),
);

/** 表单替身记录的配置与调用实例；模块替身与用例读取同一实例。 */
const formProbe = vi.hoisted(
  /** 建立用例可设置返回值、可断言的表单替身容器。 */ () => ({
    api: {
      getValues: vi.fn(),
      setValues: vi.fn(),
      validate: vi.fn(),
    },
    options: undefined as Record<string, unknown> | undefined,
  }),
);

vi.mock(
  '@vben/common-ui',
  /** 只替换弹窗容器，字典类型弹窗自身的主键判断与锁状态逻辑保持真实实现。 */ async () => {
    const { defineComponent, h } = await import('vue');
    const ModalStub = defineComponent({
      name: 'ModalStub',
      /**
       * 渲染弹窗默认插槽内容，使表单进入真实组件树。
       * @param _props 未声明的弹窗属性，本替身不解释。
       * @param context 组件上下文，用于取用默认插槽。
       * @param context.slots 调用方传入的插槽表。
       * @returns 渲染默认插槽的渲染函数。
       */
      setup(_props, { slots }) {
        return /** 渲染默认插槽，暴露弹窗内的真实内容。 */ () =>
          h('div', { class: 'modal-stub' }, slots.default?.());
      },
    });
    return {
      /**
       * 记录字典类型弹窗声明的回调并返回替身组件与替身实例。
       * @param options 弹窗传给 useVbenModal 的配置。
       * @returns 替身弹窗组件与替身 API 的二元组。
       */
      useVbenModal: (options: (typeof modalProbe)['handlers']) => {
        modalProbe.handlers = options;
        return [ModalStub, modalProbe.api];
      },
    };
  },
);

vi.mock(
  '#/adapter/form',
  /** 只替换表单渲染边界，弹窗声明的表单配置与调用顺序保持真实。 */ async () => {
    const { defineComponent, h } = await import('vue');
    const FormStub = defineComponent({
      name: 'FormStub',
      /**
       * 渲染可定位的表单占位节点。
       * @returns 渲染占位节点的渲染函数。
       */
      setup() {
        return /** 输出可定位节点，便于断言弹窗内容已进入组件树。 */ () =>
          h('div', { class: 'form-stub' });
      },
    });
    return {
      /**
       * 记录弹窗声明的表单配置并返回替身组件与替身 API。
       * @param options 弹窗传给 useVbenForm 的配置。
       * @returns 替身表单组件与替身 API 的二元组。
       */
      useVbenForm: (options: Record<string, unknown>) => {
        formProbe.options = options;
        return [FormStub, formProbe.api];
      },
    };
  },
);

vi.mock(
  '#/api/system/dict/type',
  /** 只替换网络收发边界，弹窗自身的接口选择与锁状态保持真实实现。 */ () => ({
    createDictType: vi.fn(),
    getDictType: vi.fn(),
    updateDictType: vi.fn(),
  }),
);

vi.mock(
  'element-plus',
  /** 只替换消息提示的展示边界，弹窗自身的调用时机保持真实实现。 */ () => ({
    ElMessage: { success: vi.fn() },
  }),
);

vi.mock(
  '#/locales',
  /** 只替换翻译边界，便于核对弹窗请求的语言键与参数。 */ () => ({
    /**
     * 把语言键与占位参数拼成可预期的译文。
     * @param key 组件请求的语言键。
     * @param args 语言键的可选占位参数。
     * @returns 带参数时拼接参数，否则回显键名。
     */
    $t: (key: string, args?: string[]) =>
      args ? `${key}(${args.join('/')})` : `译文:${key}`,
  }),
);

vi.mock(
  '../data',
  /** 只替换页面表单定义，弹窗对表单配置的传递保持真实实现。 */ () => ({
    /** 返回最小可识别的表单定义，用于核对透传。 */
    useTypeFormSchema: () => [{ component: 'Input', fieldName: 'name' }],
  }),
);

/** 构造字段完整的字典类型记录，作为编辑路径的数据基线。 */
function typeRecord() {
  return {
    code: 'DUMMY_dict_type',
    id: 12,
    name: 'DUMMY 字典类型',
    status: 0,
    type: 'DUMMY_type_code',
  };
}

/**
 * 挂载字典类型弹窗并返回驱动弹窗回调所需的能力。
 * @returns 已挂载的组件包装器与组件声明的弹窗回调。
 * @throws Error 组件未声明弹窗回调时抛出，避免用例静默地什么都不验证。
 */
async function mountTypeForm() {
  const wrapper = mount(TypeForm);
  await nextTick();
  const { onConfirm, onOpenChange } = modalProbe.handlers;
  if (!onConfirm || !onOpenChange) {
    throw new Error('字典类型弹窗未声明提交或开关回调');
  }
  return { onConfirm, onOpenChange, wrapper };
}

/**
 * 按编辑路径打开弹窗并等待详情加载完成。
 * @param wrapper 已挂载的字典类型弹窗。
 * @param onOpenChange 组件声明的弹窗开关回调。
 * @param record 弹窗收到的列表行数据，必须带主键才会走编辑路径。
 */
async function openForEdit(
  wrapper: VueWrapper,
  onOpenChange: ModalOpenChange,
  record: Record<string, unknown>,
) {
  modalProbe.api.getData.mockReturnValue(record);
  await onOpenChange(true);
  await nextTick();
  expect(wrapper.find('.form-stub').exists()).toBe(true);
}

beforeEach(
  /** 清空替身调用与数据，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    modalProbe.api.getData.mockReturnValue(undefined);
    formProbe.api.validate.mockResolvedValue({ valid: true });
    formProbe.api.getValues.mockResolvedValue({
      ...typeRecord(),
      id: undefined,
    });
    formProbe.api.setValues.mockResolvedValue(undefined);
    modalProbe.api.close.mockResolvedValue(undefined);
  },
);

describe('字典类型弹窗装配', /** 表单配置决定弹窗里展示哪些字段与默认行为。 */ () => {
  it('关闭默认操作并沿用页面表单定义', /** 默认操作栏重复出现或表单定义被替换会让弹窗与页面不一致。 */ async () => {
    const { wrapper } = await mountTypeForm();

    expect(formProbe.options).toMatchObject({
      layout: 'horizontal',
      showDefaultActions: false,
    });
    expect(formProbe.options?.schema).toEqual([
      { component: 'Input', fieldName: 'name' },
    ]);
    expect(wrapper.find('.form-stub').exists()).toBe(true);
  });
});

describe('字典类型弹窗打开', /** 打开路径决定标题与回填数据，主键判断错会改错记录。 */ () => {
  it('新增时设置新增标题且不请求详情', /** 无主键却请求详情会让新增弹窗出现多余的失败请求。 */ async () => {
    const { onOpenChange, wrapper } = await mountTypeForm();

    await onOpenChange(true);
    await nextTick();

    expect(modalProbe.api.setState).toHaveBeenCalledWith({
      title: 'ui.actionTitle.create(字典类型)',
    });
    expect(getDictType).not.toHaveBeenCalled();
    // 新增路径不回填表单，避免把上一次编辑的残留值带进新增。
    expect(formProbe.api.setValues).not.toHaveBeenCalled();
    expect(wrapper.find('.form-stub').exists()).toBe(true);
  });

  it('编辑时按主键重新拉取详情并回填', /** 直接用列表行会让用户看到过期数据并覆盖他人修改。 */ async () => {
    const { onOpenChange, wrapper } = await mountTypeForm();
    const detail = { ...typeRecord(), name: '最新字典类型名' };
    vi.mocked(getDictType).mockResolvedValue(detail as never);

    await openForEdit(wrapper, onOpenChange, typeRecord());

    expect(modalProbe.api.setState).toHaveBeenCalledWith({
      title: 'ui.actionTitle.edit(字典类型)',
    });
    expect(getDictType).toHaveBeenCalledWith(12);
    expect(formProbe.api.setValues).toHaveBeenCalledWith(detail);
  });

  it('加载详情期间先锁定再释放锁', /** 锁状态顺序颠倒会让弹窗在数据回填后仍显示加载中。 */ async () => {
    const { onOpenChange, wrapper } = await mountTypeForm();
    vi.mocked(getDictType).mockResolvedValue(typeRecord() as never);

    await openForEdit(wrapper, onOpenChange, typeRecord());

    expect(modalProbe.api.lock.mock.invocationCallOrder[0]).toBeLessThan(
      modalProbe.api.unlock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('详情加载失败仍释放弹窗锁', /** 未释放锁会让弹窗永久卡在加载态，只能刷新页面。 */ async () => {
    const { onOpenChange, wrapper } = await mountTypeForm();
    vi.mocked(getDictType).mockRejectedValue(new Error('详情加载失败'));

    modalProbe.api.getData.mockReturnValue(typeRecord());
    await expect(onOpenChange(true)).rejects.toThrow('详情加载失败');
    await nextTick();

    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.form-stub').exists()).toBe(true);
  });

  it('关闭弹窗时清理已加载的字典类型', /** 残留数据会让下一次提交误改上一条字典类型。 */ async () => {
    const { onConfirm, onOpenChange, wrapper } = await mountTypeForm();
    vi.mocked(getDictType).mockResolvedValue(typeRecord() as never);
    vi.mocked(createDictType).mockResolvedValue(13);
    await openForEdit(wrapper, onOpenChange, typeRecord());

    await onOpenChange(false);
    await onConfirm();

    // 关闭后已加载记录被清空，再次提交必须走新增而不是修改。
    expect(createDictType).toHaveBeenCalledTimes(1);
    expect(updateDictType).not.toHaveBeenCalled();
  });
});

describe('字典类型弹窗提交', /** 提交路径决定落库目标，主键判断错会产生重复字典类型。 */ () => {
  it('校验不通过时不提交也不锁定弹窗', /** 无效数据提交会把后端拒绝的错误暴露给用户并留下锁定态。 */ async () => {
    const { onConfirm, wrapper } = await mountTypeForm();
    formProbe.api.validate.mockResolvedValue({ valid: false });

    await onConfirm();

    expect(createDictType).not.toHaveBeenCalled();
    expect(updateDictType).not.toHaveBeenCalled();
    expect(modalProbe.api.lock).not.toHaveBeenCalled();
    expect(wrapper.emitted('success')).toBeUndefined();
  });

  it('新增时提交表单值并关闭弹窗', /** 主键缺失却走修改会更新到错误的字典类型。 */ async () => {
    const { onConfirm, wrapper } = await mountTypeForm();
    const values = { name: '新字典类型', type: 'DUMMY_new_type' };
    formProbe.api.getValues.mockResolvedValue(values);
    vi.mocked(createDictType).mockResolvedValue(13);

    await onConfirm();

    expect(createDictType).toHaveBeenCalledWith(values);
    expect(updateDictType).not.toHaveBeenCalled();
    expect(modalProbe.api.close).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('success')).toHaveLength(1);
  });

  it('编辑时按主键走修改接口', /** 主键存在却走新增会产生重复字典类型。 */ async () => {
    const { onConfirm, onOpenChange, wrapper } = await mountTypeForm();
    vi.mocked(getDictType).mockResolvedValue(typeRecord() as never);
    await openForEdit(wrapper, onOpenChange, typeRecord());
    const values = { id: 12, name: '改名后的字典类型' };
    formProbe.api.getValues.mockResolvedValue(values);
    vi.mocked(updateDictType).mockResolvedValue(true);

    await onConfirm();

    expect(updateDictType).toHaveBeenCalledWith(values);
    expect(createDictType).not.toHaveBeenCalled();
  });

  it('提交失败时释放锁且不提示成功', /** 未释放锁会让弹窗卡住，误报成功会让用户以为已保存。 */ async () => {
    const { onConfirm, wrapper } = await mountTypeForm();
    vi.mocked(createDictType).mockRejectedValue(new Error('保存失败'));

    await expect(onConfirm()).rejects.toThrow('保存失败');

    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.close).not.toHaveBeenCalled();
    expect(wrapper.emitted('success')).toBeUndefined();
  });

  it('成功后提示操作成功文案', /** 缺少成功提示会让用户无法确认保存结果。 */ async () => {
    const { onConfirm } = await mountTypeForm();
    vi.mocked(createDictType).mockResolvedValue(13);
    const { ElMessage } = await import('element-plus');

    await onConfirm();

    expect(vi.mocked(ElMessage.success)).toHaveBeenCalledWith(
      '译文:ui.actionMessage.operationSuccess',
    );
  });
});
