/**
 * [entity-name]弹窗（views/[module]/[entity]/modules/form）真实行为回归。
 *
 * 弹窗按是否已存在主键决定走新增还是修改：主键判断写错会把已有记录改成新增、产生重复记录；
 * 打开编辑时未重新拉取详情会让用户看到列表页的旧值并覆盖他人修改；关闭时未清理上一条记录会
 * 让下一次提交误改上一条记录；提交失败未释放弹窗锁会让弹窗永久停在加载态。用例按真实调用
 * 顺序驱动弹窗回调，只替换弹窗容器、表单渲染、消息提示与网络边界。
 */
import type { VueWrapper } from '@vue/test-utils';
import type { Component } from 'vue';

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { create[Entity], get[Entity], update[Entity] } from '#/api/[module]/[entity]';

import [Entity]Form from './form.vue';

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
      setDisabled: vi.fn(),
      setValues: vi.fn(),
      validate: vi.fn(),
    },
    options: undefined as Record<string, unknown> | undefined,
  }),
);

/** 替身组件缓存：弹窗与表单共用同一个组件定义，避免单文件多组件定义被规范检查拒绝。 */
const stubProbe = vi.hoisted(
  /** 建立惰性创建的替身组件容器。 */ () => ({
    component: undefined as Component | undefined,
  }),
);

/**
 * 取得共享替身组件：只渲染默认插槽，暴露弹窗与表单内部的真实内容。
 * @returns 替身组件；首次调用时创建并缓存。
 */
async function sharedStub(): Promise<Component> {
  if (!stubProbe.component) {
    const { defineComponent, h } = await import('vue');
    stubProbe.component = defineComponent({
      name: 'SlotStub',
      /**
       * 渲染弹窗或表单的默认插槽内容。
       * @param _props 未声明的替身属性，本替身不解释。
       * @param context 组件上下文，用于取用默认插槽。
       * @param context.slots 调用方传入的插槽表。
       * @returns 渲染默认插槽的渲染函数。
       */
      setup(_props, { slots }) {
        return /** 渲染默认插槽，暴露替身内的真实内容。 */ () =>
          h('div', { class: 'slot-stub' }, slots.default?.());
      },
    });
  }
  return stubProbe.component;
}

vi.mock(
  '@vben/common-ui',
  /** 只替换弹窗容器，弹窗自身的主键判断与锁状态逻辑保持真实实现。 */ async () => {
    const Stub = await sharedStub();
    return {
      /**
       * 记录弹窗声明的回调并返回替身组件与替身实例。
       * @param options 弹窗传给 useVbenModal 的配置。
       * @returns 替身弹窗组件与替身 API 的二元组。
       */
      useVbenModal: (options: (typeof modalProbe)['handlers']) => {
        modalProbe.handlers = options;
        return [Stub, modalProbe.api];
      },
    };
  },
);

vi.mock(
  '#/adapter/form',
  /** 只替换表单渲染边界，弹窗声明的表单配置与调用顺序保持真实。 */ async () => {
    const Stub = await sharedStub();
    return {
      /**
       * 记录弹窗声明的表单配置并返回替身组件与替身 API。
       * @param options 弹窗传给 useVbenForm 的配置。
       * @returns 替身表单组件与替身 API 的二元组。
       */
      useVbenForm: (options: Record<string, unknown>) => {
        formProbe.options = options;
        return [Stub, formProbe.api];
      },
    };
  },
);

vi.mock(
  '#/api/[module]/[entity]',
  /** 只替换网络收发边界，弹窗自身的接口选择与参数拼装保持真实实现。 */ () => ({
    create[Entity]: vi.fn(),
    get[Entity]: vi.fn(),
    update[Entity]: vi.fn(),
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
    useFormSchema: () => [{ component: 'Input', fieldName: 'name' }],
  }),
);

/** 构造字段完整的记录，作为编辑路径的数据基线。 */
function [entity]Record() {
  return { id: 5, name: '示例名称', remark: '备注', status: 0 };
}

/**
 * 挂载弹窗并返回驱动弹窗回调所需的能力。
 * @returns 已挂载的组件包装器与组件声明的弹窗回调。
 * @throws Error 组件未声明弹窗回调时抛出，避免用例静默地什么都不验证。
 */
async function mount[Entity]Form() {
  const wrapper = mount([Entity]Form);
  await nextTick();
  const { onConfirm, onOpenChange } = modalProbe.handlers;
  if (!onConfirm || !onOpenChange) {
    throw new Error('[entity-name]弹窗未声明提交或开关回调');
  }
  return { onConfirm, onOpenChange, wrapper };
}

/**
 * 按编辑路径打开弹窗并等待详情加载完成。
 * @param wrapper 已挂载的弹窗。
 * @param onOpenChange 组件声明的弹窗开关回调。
 * @param record 弹窗收到的列表行数据，必须带主键才会走编辑路径。
 */
async function openForEdit(
  wrapper: VueWrapper,
  onOpenChange: ModalOpenChange,
  record: Record<string, unknown>,
) {
  modalProbe.api.getData.mockReturnValue(record);
  const opened = onOpenChange(true);
  await nextTick();
  expect(wrapper.find('.slot-stub').exists()).toBe(true);
  await opened;
}

beforeEach(
  /** 清空替身调用与数据，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    modalProbe.api.getData.mockReturnValue(undefined);
    formProbe.api.validate.mockResolvedValue({ valid: true });
    formProbe.api.getValues.mockResolvedValue([entity]Record());
  },
);

describe('[entity-name]弹窗打开', /** 打开路径决定标题、回填与是否误带上一页数据。 */ () => {
  it('新增路径不请求详情并设置新增标题', /** 新增时误请求详情会带入上一条记录。 */ async () => {
    const { onOpenChange } = await mount[Entity]Form();

    await onOpenChange(true);

    expect(modalProbe.api.setState).toHaveBeenCalledWith({
      title: 'ui.actionTitle.create([entity-name])',
    });
    expect(formProbe.api.setValues).not.toHaveBeenCalled();
  });

  it('编辑路径加载最新详情、回填并恢复可编辑', /** 未回填会让用户看到空表单；未恢复可编辑会让弹窗永久不可输入。 */ async () => {
    const { wrapper, onOpenChange } = await mount[Entity]Form();
    const detail = { ...[entity]Record(), name: '服务端最新名称' };
    vi.mocked(get[Entity]).mockResolvedValue(detail);

    await openForEdit(wrapper, onOpenChange, [entity]Record());

    expect(get[Entity]).toHaveBeenCalledWith(5);
    expect(modalProbe.api.setState).toHaveBeenCalledWith({
      title: 'ui.actionTitle.edit([entity-name])',
    });
    expect(formProbe.api.setDisabled).toHaveBeenCalledWith(true);
    expect(formProbe.api.setDisabled).toHaveBeenLastCalledWith(false);
    expect(formProbe.api.setValues).toHaveBeenCalledWith(detail);
  });

  it('详情加载失败也必须恢复可编辑并释放弹窗锁', /** 失败后停在禁用态会让用户无法重试或取消。 */ async () => {
    const { wrapper, onOpenChange } = await mount[Entity]Form();
    vi.mocked(get[Entity]).mockRejectedValue(
      new Error('controlled-detail-failure'),
    );

    await expect(
      openForEdit(wrapper, onOpenChange, [entity]Record()),
    ).rejects.toThrow('controlled-detail-failure');

    expect(formProbe.api.setDisabled).toHaveBeenLastCalledWith(false);
    expect(modalProbe.api.unlock).toHaveBeenCalled();
  });

  it('关闭时清理上一条记录', /** 未清理会让下一次新增提交上一条记录。 */ async () => {
    const { wrapper, onOpenChange } = await mount[Entity]Form();
    vi.mocked(get[Entity]).mockResolvedValue([entity]Record());
    await openForEdit(wrapper, onOpenChange, [entity]Record());

    await onOpenChange(false);
    // 新增路径由页面传入 null，模拟“没有记录可回填”。
    modalProbe.api.getData.mockReturnValue(null);
    formProbe.api.setValues.mockClear();
    await onOpenChange(true);

    expect(formProbe.api.setValues).not.toHaveBeenCalled();
  });
});

describe('[entity-name]弹窗提交', /** 提交路径决定新增与修改的接口选择。 */ () => {
  it('无主键走新增接口并提示成功', /** 新增误走修改接口会把不存在的编号提交给后端。 */ async () => {
    const { onConfirm } = await mount[Entity]Form();

    await onConfirm();

    expect(create[Entity]).toHaveBeenCalledWith([entity]Record());
    expect(update[Entity]).not.toHaveBeenCalled();
    expect(modalProbe.api.close).toHaveBeenCalled();
    expect(modalProbe.api.unlock).toHaveBeenCalled();
  });

  it('有主键走修改接口并带上编号', /** 修改走新增会产生重复记录。 */ async () => {
    const { wrapper, onConfirm, onOpenChange } = await mount[Entity]Form();
    vi.mocked(get[Entity]).mockResolvedValue([entity]Record());
    await openForEdit(wrapper, onOpenChange, [entity]Record());

    await onConfirm();

    expect(update[Entity]).toHaveBeenCalledWith([entity]Record());
    expect(create[Entity]).not.toHaveBeenCalled();
  });

  it('校验失败时不提交并保持弹窗打开', /** 未拦住非法表单会让空名称落库。 */ async () => {
    const { onConfirm } = await mount[Entity]Form();
    formProbe.api.validate.mockResolvedValue({ valid: false });

    await onConfirm();

    expect(create[Entity]).not.toHaveBeenCalled();
    expect(update[Entity]).not.toHaveBeenCalled();
    expect(modalProbe.api.close).not.toHaveBeenCalled();
  });
});
