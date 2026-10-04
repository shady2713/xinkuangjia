/**
 * 部门选择弹窗（views/system/dept/components/select-modal）真实行为回归。
 *
 * 该弹窗把扁平部门列表重组为树供其它表单选择：打开时未回填调用方传入的已选部门会让
 * 用户丢失原有选择；关闭时未清空状态会让下次打开残留上一次的勾选；确认时按错误口径
 * 取主键（受控模式读树、非受控模式读本地状态）会把未勾选的部门交回调用方；单选模式
 * 未收敛到最后一个节点会让选择结果与界面显示不一致；主键缺失的部门被当作合法编号会
 * 让勾选永远无法命中。用例真实渲染弹窗并使用真实的 Element Plus 树组件与真实树拼装，
 * 只替换弹窗容器与网络边界。
 */
import type { SystemDeptApi } from '#/api/system/dept';

import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { ElTree } from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSimpleDeptList } from '#/api/system/dept';

import SelectModal from './select-modal.vue';

/** 弹窗开关回调签名：弹窗容器在打开与关闭时驱动弹窗组件。 */
type ModalOpenChange = (isOpen: boolean) => Promise<void> | void;

/** 弹窗替身记录的回调与调用实例；模块替身与用例读取同一实例。 */
const modalProbe = vi.hoisted(
  /** 建立用例可设置数据、可断言的弹窗替身容器。 */ () => ({
    api: {
      close: vi.fn(),
      getData: vi.fn(),
      lock: vi.fn(),
      unlock: vi.fn(),
    },
    handlers: {} as {
      /** 确认回调，由组件在弹窗确认时声明。 */
      onConfirm?: () => Promise<void>;
      /** 开关回调，由组件在弹窗打开或关闭时声明。 */
      onOpenChange?: ModalOpenChange;
    },
    options: undefined as Record<string, unknown> | undefined,
  }),
);

vi.mock(
  '@vben/common-ui',
  /** 只替换弹窗容器，选择弹窗自身的加载、勾选与确认逻辑保持真实实现。 */ async () => {
    const ModalStub = defineComponent({
      name: 'ModalStub',
      props: {
        /** 弹窗标题，用于核对组件声明的默认标题。 */
        title: { default: '', type: String },
      },
      /**
       * 渲染弹窗默认插槽内容，使部门树进入真实组件树。
       * @param props 弹窗组件声明的属性。
       * @param context 组件上下文，用于取用默认插槽。
       * @param context.slots 调用方传入的插槽表。
       * @returns 渲染默认插槽的渲染函数。
       */
      setup(props, { slots }) {
        return /** 渲染默认插槽并暴露标题，便于断言弹窗契约。 */ () =>
          h(
            'div',
            { class: 'modal-stub', 'data-title': props.title },
            slots.default?.(),
          );
      },
    });
    return {
      /**
       * 记录选择弹窗声明的回调并返回替身组件与替身实例。
       * @param options 弹窗传给 useVbenModal 的配置。
       * @returns 替身弹窗组件与替身 API 的二元组。
       */
      useVbenModal: (options: (typeof modalProbe)['handlers']) => {
        modalProbe.handlers = options;
        modalProbe.options = options;
        return [ModalStub, modalProbe.api];
      },
    };
  },
);

vi.mock(
  '#/api/system/dept',
  /** 只替换部门列表网络边界，部门树拼装保持真实实现。 */ () => ({
    getSimpleDeptList: vi.fn(),
  }),
);

/** 部门夹具：两级父子关系用于验证真实树拼装与勾选。 */
const DEPT_FIXTURE = [
  { id: 1, name: '研发部', parentId: 0 },
  { id: 2, name: '前端组', parentId: 1 },
  { id: 3, name: '后端组', parentId: 1 },
];

/**
 * 取出确认回调。
 * @returns 弹窗确认回调。
 * @throws Error 组件未声明确认回调时抛出，避免用例静默地什么都不验证。
 */
function onConfirmHandler() {
  const handler = modalProbe.handlers.onConfirm;
  if (!handler) {
    throw new Error('弹窗未声明确认回调');
  }
  return handler;
}

/**
 * 取出开关回调。
 * @returns 弹窗开关回调。
 * @throws Error 组件未声明开关回调时抛出，避免用例静默地什么都不验证。
 */
function onOpenChangeHandler() {
  const handler = modalProbe.handlers.onOpenChange;
  if (!handler) {
    throw new Error('弹窗未声明开关回调');
  }
  return handler;
}

/**
 * 挂载选择弹窗并等待首次渲染完成。
 * @param props 弹窗属性，用于驱动多选与受控模式。
 * @returns 已挂载的弹窗包装器。
 */
async function mountModal(props: Record<string, unknown> = {}) {
  const wrapper = mount(SelectModal, { props });
  await wrapper.vm.$nextTick();
  return wrapper;
}

beforeEach(
  /** 清空替身调用与数据，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    modalProbe.handlers = {};
    modalProbe.api.getData.mockReturnValue({});
    modalProbe.api.close.mockResolvedValue(undefined);
    // 夹具只保留组件实际读取的部门字段，按接口类型断言后交给真实树拼装。
    vi.mocked(getSimpleDeptList).mockResolvedValue(
      DEPT_FIXTURE as unknown as SystemDeptApi.Dept[],
    );
  },
);

describe('部门选择弹窗默认契约', /** 默认属性决定弹窗标题、按钮文案与选择模式。 */ () => {
  it('按约定声明标题、按钮文案与选择模式', /** 默认值写错会让弹窗标题或按钮文案不符合交互约定。 */ async () => {
    const wrapper = await mountModal();

    expect(wrapper.props('cancelText')).toBe('取消');
    expect(wrapper.props('confirmText')).toBe('确认');
    expect(wrapper.props('multiple')).toBe(true);
    expect(wrapper.props('checkStrictly')).toBe(false);
    expect(wrapper.props('title')).toBe('部门选择');
    expect(wrapper.find('.modal-stub').attributes('data-title')).toBe(
      '部门选择',
    );
    expect(modalProbe.options?.destroyOnClose).toBe(true);
  });

  it('标题可由调用方覆盖', /** 固定标题会让不同业务场景无法区分选择目标。 */ async () => {
    const wrapper = await mountModal({ title: '选择所属部门' });

    expect(wrapper.find('.modal-stub').attributes('data-title')).toBe(
      '选择所属部门',
    );
  });
});

describe('部门选择弹窗打开与关闭', /** 开合链路决定树数据与勾选状态是否被正确加载与清理。 */ () => {
  it('打开时加载部门树并锁定弹窗', /** 未加载会让用户看到空树，未锁定会让用户在加载期间重复操作。 */ async () => {
    const wrapper = await mountModal();

    await onOpenChangeHandler()(true);
    await wrapper.vm.$nextTick();

    expect(getSimpleDeptList).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.lock).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
    const tree = wrapper.findComponent(ElTree);
    expect(tree.exists()).toBe(true);
    const data = tree.props('data') as Array<{ children?: unknown[] }>;
    expect(data).toHaveLength(1);
    expect(data[0]?.children).toHaveLength(2);
  });

  it('打开时回填调用方传入的已选部门', /** 未回填会让用户丢失原有选择并可能误删权限。 */ async () => {
    modalProbe.api.getData.mockReturnValue({
      selectedList: [{ id: 2, name: '前端组' }],
    });
    const wrapper = await mountModal();

    await onOpenChangeHandler()(true);
    await wrapper.vm.$nextTick();

    const tree = wrapper.findComponent(ElTree);
    expect(tree.props('checkStrictly')).toBe(false);
    expect(tree.props('showCheckbox')).toBe(true);
    expect(tree.props('nodeKey')).toBe('id');
    expect(tree.props('props')).toEqual({
      children: 'children',
      label: 'name',
    });
  });

  it('缺少调用方数据时直接返回且不请求部门列表', /** 无目标数据时仍请求会让弹窗在错误场景下发出多余请求。 */ async () => {
    modalProbe.api.getData.mockReturnValue(undefined);
    await mountModal();

    await onOpenChangeHandler()(true);

    expect(getSimpleDeptList).not.toHaveBeenCalled();
    expect(modalProbe.api.lock).not.toHaveBeenCalled();
  });

  it('关闭时清空树与勾选状态', /** 未清空会让下次打开残留上一次的勾选。 */ async () => {
    const wrapper = await mountModal();
    await onOpenChangeHandler()(true);
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(ElTree).exists()).toBe(true);

    await onOpenChangeHandler()(false);
    await wrapper.vm.$nextTick();

    expect(wrapper.findComponent(ElTree).exists()).toBe(false);
  });

  it('加载失败时仍然解锁弹窗', /** 未解锁会让弹窗永久停在加载态，用户无法继续操作。 */ async () => {
    vi.mocked(getSimpleDeptList).mockRejectedValue(new Error('DUMMY-网络失败'));
    await mountModal();

    await expect(onOpenChangeHandler()(true)).rejects.toThrow('DUMMY-网络失败');
    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
  });
});

describe('部门选择弹窗确认', /** 确认口径决定交回调用方的部门列表是否与界面勾选一致。 */ () => {
  it('多选模式按本地勾选状态交回部门并关闭弹窗', /** 未按勾选交回会让调用方拿到未选中的部门。 */ async () => {
    modalProbe.api.getData.mockReturnValue({
      selectedList: [{ id: 2, name: '前端组' }],
    });
    const wrapper = await mountModal();
    await onOpenChangeHandler()(true);
    await wrapper.vm.$nextTick();

    await onConfirmHandler()();
    await wrapper.vm.$nextTick();

    const emitted = wrapper.emitted('confirm');
    expect(emitted).toHaveLength(1);
    // 交回的是树节点本身（含父节点信息），调用方可直接复用部门响应模型。
    expect(emitted?.[0]?.[0]).toEqual([{ id: 2, name: '前端组', parentId: 1 }]);
    expect(modalProbe.api.close).toHaveBeenCalledTimes(1);
  });

  it('受控模式按树的勾选结果交回部门', /** 读本地状态而不是树会让受控选择与界面显示不一致。 */ async () => {
    modalProbe.api.getData.mockReturnValue({});
    const wrapper = await mountModal({ checkStrictly: true });
    await onOpenChangeHandler()(true);
    await wrapper.vm.$nextTick();

    const tree = wrapper.findComponent(ElTree);
    tree.vm.setCheckedKeys([3]);
    await wrapper.vm.$nextTick();

    await onConfirmHandler()();
    await wrapper.vm.$nextTick();

    const emitted = wrapper.emitted('confirm');
    expect(emitted?.[0]?.[0]).toEqual([{ id: 3, name: '后端组', parentId: 1 }]);
  });

  it('主键缺失的部门不会被交回', /** 未落库的部门无法被勾选命中，混入结果会让调用方拿到无效编号。 */ async () => {
    modalProbe.api.getData.mockReturnValue({
      selectedList: [{ name: 'DUMMY-未落库部门' }],
    });
    const wrapper = await mountModal();
    await onOpenChangeHandler()(true);
    await wrapper.vm.$nextTick();

    await onConfirmHandler()();
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('confirm')?.[0]?.[0]).toEqual([]);
  });
});

describe('部门选择弹窗勾选处理', /** 勾选处理决定单选与多选模式下的本地状态口径。 */ () => {
  it('多选模式把字符串主键统一成数字', /** 未归一化会让后续按编号匹配失败。 */ async () => {
    const wrapper = await mountModal();
    await onOpenChangeHandler()(true);
    await wrapper.vm.$nextTick();

    wrapper
      .findComponent(ElTree)
      .vm.$emit('check', {}, { checkedKeys: ['2', 3] });
    await wrapper.vm.$nextTick();

    await onConfirmHandler()();
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('confirm')?.[0]?.[0]).toEqual([
      { id: 2, name: '前端组', parentId: 1 },
      { id: 3, name: '后端组', parentId: 1 },
    ]);
  });

  it('单选模式只保留最后一个节点并让树收敛', /** 保留多个节点会让选择结果与界面显示不一致。 */ async () => {
    const wrapper = await mountModal({ multiple: false });
    await onOpenChangeHandler()(true);
    await wrapper.vm.$nextTick();
    const tree = wrapper.findComponent(ElTree);

    tree.vm.$emit('check', {}, { checkedKeys: ['1', 3] });
    await wrapper.vm.$nextTick();

    expect(tree.vm.getCheckedKeys()).toEqual([3]);
    await onConfirmHandler()();
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('confirm')?.[0]?.[0]).toEqual([
      { id: 3, name: '后端组', parentId: 1 },
    ]);
  });
});
