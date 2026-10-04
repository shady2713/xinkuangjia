/**
 * 角色数据权限弹窗（views/system/role/modules/assign-data-permission-form）真实行为回归。
 *
 * 弹窗按数据范围类型决定提交哪些部门编号：非"指定部门"范围必须提交空集合而不是 undefined，
 * 否则后端会按部门过滤出错误的数据范围；打开时必须先加载部门树再按角色编号回填，顺序写反
 * 会让树控件拿不到部门数据；全选与展开必须递归收集所有层级的部门编号。用例按真实调用顺序
 * 驱动弹窗回调与页脚复选框，只替换弹窗容器、树控件、复选框、消息提示与网络边界。
 */
import type { VueWrapper } from '@vue/test-utils';

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDeptList } from '#/api/system/dept';
import { assignRoleDataScope } from '#/api/system/permission';
import { getRole } from '#/api/system/role';

import AssignDataPermissionForm from './assign-data-permission-form.vue';

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
      setFieldValue: vi.fn(),
      setValues: vi.fn(),
      validate: vi.fn(),
    },
    options: undefined as Record<string, unknown> | undefined,
  }),
);

vi.mock(
  '@vben/common-ui',
  /**
   * 只替换弹窗容器与树控件：弹窗自身加载、回填、全选与联动逻辑保持真实实现，
   * 树控件用可读取属性的替身承接组件传入的部门数据与回调。
   */ async () => {
    const { defineComponent, h } = await import('vue');
    const ModalStub = defineComponent({
      name: 'ModalStub',
      /**
       * 渲染弹窗默认插槽与页脚前置插槽。
       * @param _props 未声明的弹窗属性，本替身不解释。
       * @param context 组件上下文，用于取用插槽。
       * @param context.slots 调用方传入的插槽表。
       * @returns 渲染插槽内容的渲染函数。
       */
      setup(_props, { slots }) {
        return /** 渲染默认插槽与页脚插槽，暴露弹窗内的真实内容。 */ () =>
          h('div', { class: 'modal-stub' }, [
            slots.default?.(),
            h('div', { class: 'footer-stub' }, slots['prepend-footer']?.()),
          ]);
      },
    });
    const TreeStub = defineComponent({
      name: 'TreeStub',
      props: {
        bordered: { default: false, type: Boolean },
        checkStrictly: { default: false, type: Boolean },
        defaultExpandedKeys: {
          /** 默认不展开任何节点。 */
          default: () => [],
          type: Array,
        },
        labelField: { default: '', type: String },
        multiple: { default: false, type: Boolean },
        treeData: {
          /** 默认没有节点数据。 */
          default: () => [],
          type: Array,
        },
        valueField: { default: '', type: String },
      },
      /**
       * 渲染可定位的树占位节点，属性由用例读取。
       * @returns 渲染占位节点的渲染函数。
       */
      setup() {
        return /** 输出可定位节点，便于断言树控件已进入组件树。 */ () =>
          h('div', { class: 'tree-stub' });
      },
    });
    return {
      Tree: TreeStub,
      /**
       * 记录数据权限弹窗声明的回调并返回替身组件与替身实例。
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
       * 渲染部门树插槽，使树控件进入真实组件树。
       * @param _props 未声明的表单属性，本替身不解释。
       * @param context 组件上下文，用于取用插槽。
       * @param context.slots 调用方传入的插槽表。
       * @returns 渲染插槽内容的渲染函数。
       */
      setup(_props, { slots }) {
        return /** 渲染 dataScopeDeptIds 插槽，暴露真实的树控件绑定。 */ () =>
          h('div', { class: 'form-stub' }, slots.dataScopeDeptIds?.({}));
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
  '#/api/system/dept',
  /** 只替换部门树网络边界，弹窗自身的树组装保持真实实现。 */ () => ({
    getDeptList: vi.fn(),
  }),
);

vi.mock(
  '#/api/system/permission',
  /** 只替换数据范围提交边界，弹窗自身的参数拼装保持真实实现。 */ () => ({
    assignRoleDataScope: vi.fn(),
  }),
);

vi.mock(
  '#/api/system/role',
  /** 只替换角色详情网络边界，弹窗自身的回填口径保持真实实现。 */ () => ({
    getRole: vi.fn(),
  }),
);

vi.mock(
  'element-plus',
  /**
   * 只替换页脚复选框与消息提示：复选框保留 change 事件契约，
   * 使全选、展开与父子联动逻辑仍由真实模板事件驱动。
   */ async () => {
    const { defineComponent, h } = await import('vue');
    const ElCheckboxStub = defineComponent({
      name: 'ElCheckboxStub',
      props: { modelValue: { default: false, type: Boolean } },
      emits: ['change'],
      /**
       * 渲染原生复选框并转发 change 事件，同时渲染调用方传入的标签文本。
       * @param props 复选框的选中状态。
       * @param context 组件上下文，用于抛出事件与取用默认插槽。
       * @param context.emit 组件事件派发函数。
       * @param context.slots 调用方传入的插槽表。
       * @returns 渲染复选框的渲染函数。
       */
      setup(props, { emit, slots }) {
        return /** 输出可点击的复选框与标签文本，点击时抛出 change 事件。 */ () =>
          h('label', { class: 'checkbox-label' }, [
            h('input', {
              checked: props.modelValue,
              class: 'checkbox-stub',
              /** 原生 change 直接转发为组件 change 事件。 */
              onChange: () => emit('change'),
              type: 'checkbox',
            }),
            slots.default?.(),
          ]);
      },
    });
    return {
      ElCheckbox: ElCheckboxStub,
      ElMessage: { success: vi.fn() },
    };
  },
);

vi.mock(
  '#/locales',
  /** 只替换翻译边界，便于核对弹窗请求的语言键。 */ () => ({
    /** 回显语言键，使断言不依赖真实语言包。 */
    $t: (key: string) => `译文:${key}`,
  }),
);

vi.mock(
  '../data',
  /** 只替换页面表单定义，弹窗对表单配置的传递保持真实实现。 */ () => ({
    /** 返回最小可识别的表单定义，用于核对透传。 */
    useAssignDataPermissionFormSchema: () => [
      { component: 'Input', fieldName: 'dataScope' },
    ],
  }),
);

/** 部门树夹具：一个根部门与两个下级部门，覆盖两层父子关系。 */
function deptFixture() {
  return [
    { id: 1, name: '总部', parentId: 0 },
    { id: 2, name: '研发部', parentId: 1 },
    { id: 3, name: '测试部', parentId: 1 },
  ];
}

/**
 * 挂载数据权限弹窗并返回驱动弹窗回调与页脚控件所需的能力。
 * @returns 已挂载的组件包装器、弹窗回调与树控件包装器。
 * @throws Error 组件未声明弹窗回调时抛出，避免用例静默地什么都不验证。
 */
async function mountAssignDataPermissionForm() {
  const wrapper = mount(AssignDataPermissionForm, {
    // 组件用 v-loading 标记部门加载状态，测试中注册空指令避免解析告警。
    global: { directives: { loading: {} } },
  });
  await nextTick();
  const { onConfirm, onOpenChange } = modalProbe.handlers;
  if (!onConfirm || !onOpenChange) {
    throw new Error('数据权限弹窗未声明提交或开关回调');
  }
  const tree = wrapper.findComponent({ name: 'TreeStub' });
  return { onConfirm, onOpenChange, tree, wrapper };
}

/**
 * 按角色路径打开弹窗并等待部门树与角色详情加载完成。
 * @param wrapper 已挂载的数据权限弹窗。
 * @param onOpenChange 组件声明的弹窗开关回调。
 * @param record 弹窗收到的列表行数据，必须带主键才会加载。
 */
async function openForRole(
  wrapper: VueWrapper,
  onOpenChange: ModalOpenChange,
  record: Record<string, unknown>,
) {
  modalProbe.api.getData.mockReturnValue(record);
  await onOpenChange(true);
  await nextTick();
  expect(wrapper.find('.tree-stub').exists()).toBe(true);
}

/**
 * 点击页脚第 n 个复选框，触发全选、展开或父子联动逻辑。
 * @param wrapper 已挂载的数据权限弹窗。
 * @param index 页脚复选框下标，0 为全选、1 为全部展开、2 为父子联动。
 */
async function toggleFooterCheckbox(wrapper: VueWrapper, index: number) {
  await wrapper.findAll('.checkbox-stub')[index]?.trigger('change');
  await nextTick();
}

beforeEach(
  /** 清空替身调用与数据，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    modalProbe.api.getData.mockReturnValue(undefined);
    formProbe.api.validate.mockResolvedValue({ valid: true });
    formProbe.api.getValues.mockResolvedValue({
      dataScope: 2,
      dataScopeDeptIds: [2, 3],
      id: 8,
    });
    formProbe.api.setFieldValue.mockResolvedValue(undefined);
    formProbe.api.setValues.mockResolvedValue(undefined);
    modalProbe.api.close.mockResolvedValue(undefined);
    vi.mocked(getDeptList).mockResolvedValue(deptFixture() as never);
  },
);

describe('数据权限弹窗装配', /** 表单配置与树控件绑定决定弹窗展示的字段与树行为。 */ () => {
  it('关闭默认操作并沿用页面表单定义', /** 默认操作栏重复出现或表单定义被替换会让弹窗与页面不一致。 */ async () => {
    const { wrapper } = await mountAssignDataPermissionForm();

    expect(formProbe.options).toMatchObject({
      layout: 'horizontal',
      showDefaultActions: false,
    });
    expect(formProbe.options?.schema).toEqual([
      { component: 'Input', fieldName: 'dataScope' },
    ]);
    expect(wrapper.find('.tree-stub').exists()).toBe(true);
  });

  it('按部门字段绑定树控件并默认关闭父子联动', /** 取值字段写错会让树控件读不到部门编号，默认联动会让勾选范围超出预期。 */ async () => {
    const { tree, wrapper } = await mountAssignDataPermissionForm();

    expect(tree.props('multiple')).toBe(true);
    expect(tree.props('bordered')).toBe(true);
    expect(tree.props('valueField')).toBe('id');
    expect(tree.props('labelField')).toBe('name');
    // 内部 isCheckStrictly 默认为真，传给树控件的 checkStrictly 取反后为假。
    expect(tree.props('checkStrictly')).toBe(false);
    expect(wrapper.findAll('.checkbox-stub')).toHaveLength(3);
  });
});

describe('数据权限弹窗打开', /** 打开路径决定部门树与数据范围回填，顺序写错会让树控件拿不到数据。 */ () => {
  it('按父子关系组装部门树', /** 未组装层级会让树控件把部门平铺，用户无法按组织架构选择。 */ async () => {
    const { onOpenChange, tree, wrapper } =
      await mountAssignDataPermissionForm();
    vi.mocked(getRole).mockResolvedValue({
      dataScope: 2,
      dataScopeDeptIds: [2],
      id: 8,
    } as never);

    await openForRole(wrapper, onOpenChange, { id: 8 });

    const treeData = tree.props('treeData') as Array<Record<string, unknown>>;
    expect(treeData).toHaveLength(1);
    expect(treeData[0]).toMatchObject({ id: 1, name: '总部' });
    expect(
      (treeData[0]?.children as Array<Record<string, unknown>>)?.map(
        /** 取出下级部门编号，核对层级与顺序。 */ (item) => item.id,
      ),
    ).toEqual([2, 3]);
  });

  it('先加载部门树再按角色详情回填', /** 顺序写反会让树控件在回填时还没有节点，勾选状态无处安放。 */ async () => {
    const { onOpenChange, wrapper } = await mountAssignDataPermissionForm();
    vi.mocked(getRole).mockResolvedValue({
      dataScope: 2,
      dataScopeDeptIds: [2, 3],
      id: 8,
    } as never);

    await openForRole(wrapper, onOpenChange, { id: 8 });

    expect(getRole).toHaveBeenCalledWith(8);
    expect(vi.mocked(getDeptList).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(getRole).mock.invocationCallOrder[0] ?? 0,
    );
    expect(formProbe.api.setValues).toHaveBeenCalledWith({
      dataScope: 2,
      dataScopeDeptIds: [2, 3],
      id: 8,
    });
  });

  it('角色未返回可空部门编号时回填空集合', /** undefined 直接进入表单会让多选树残留上一次的勾选。 */ async () => {
    const { onOpenChange, wrapper } = await mountAssignDataPermissionForm();
    vi.mocked(getRole).mockResolvedValue({
      dataScope: 1,
      id: 8,
    } as never);

    await openForRole(wrapper, onOpenChange, { id: 8 });

    expect(formProbe.api.setValues).toHaveBeenCalledWith({
      dataScope: 1,
      dataScopeDeptIds: [],
      id: 8,
    });
  });

  it('角色详情为空时仍释放弹窗锁', /** 提前返回未释放锁会让弹窗永久卡在加载态。 */ async () => {
    const { onOpenChange, wrapper } = await mountAssignDataPermissionForm();
    vi.mocked(getRole).mockResolvedValue(undefined as never);

    await openForRole(wrapper, onOpenChange, { id: 8 });

    expect(formProbe.api.setValues).not.toHaveBeenCalled();
    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
  });

  it('角色详情加载失败仍释放弹窗锁', /** 未释放锁会让弹窗卡住，只能刷新页面。 */ async () => {
    const { onOpenChange, wrapper } = await mountAssignDataPermissionForm();
    vi.mocked(getRole).mockRejectedValue(new Error('详情加载失败'));

    modalProbe.api.getData.mockReturnValue({ id: 8 });
    await expect(onOpenChange(true)).rejects.toThrow('详情加载失败');
    await nextTick();

    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.tree-stub').exists()).toBe(true);
  });

  it('没有目标角色时不加载部门树', /** 无主键仍请求会把 undefined 编号发给后端并白拉一次部门树。 */ async () => {
    const { onOpenChange, wrapper } = await mountAssignDataPermissionForm();

    modalProbe.api.getData.mockReturnValue(undefined);
    await onOpenChange(true);
    await nextTick();

    expect(getDeptList).not.toHaveBeenCalled();
    expect(getRole).not.toHaveBeenCalled();
    expect(formProbe.api.setValues).not.toHaveBeenCalled();
    expect(wrapper.find('.tree-stub').exists()).toBe(true);
  });

  it('关闭弹窗时不做任何加载', /** 关闭时仍请求会让弹窗在不可见时反复打接口。 */ async () => {
    const { onOpenChange } = await mountAssignDataPermissionForm();

    await onOpenChange(false);

    expect(getDeptList).not.toHaveBeenCalled();
    expect(formProbe.api.setValues).not.toHaveBeenCalled();
  });
});

describe('部门全选与展开', /** 页脚控件决定批量勾选、展开与联动，递归收集漏层会让部分部门漏选。 */ () => {
  it('全选递归收集所有层级的部门编号', /** 只收集第一层会让下级部门漏选，用户以为已授权整棵组织树。 */ async () => {
    const { onOpenChange, wrapper } = await mountAssignDataPermissionForm();
    vi.mocked(getRole).mockResolvedValue({ dataScope: 2, id: 8 } as never);
    await openForRole(wrapper, onOpenChange, { id: 8 });

    await toggleFooterCheckbox(wrapper, 0);

    expect(formProbe.api.setFieldValue).toHaveBeenLastCalledWith(
      'dataScopeDeptIds',
      [1, 2, 3],
    );
  });

  it('再次点击全选时清空勾选', /** 取消全选无效会让用户无法收回数据范围授权。 */ async () => {
    const { onOpenChange, wrapper } = await mountAssignDataPermissionForm();
    vi.mocked(getRole).mockResolvedValue({ dataScope: 2, id: 8 } as never);
    await openForRole(wrapper, onOpenChange, { id: 8 });

    await toggleFooterCheckbox(wrapper, 0);
    await toggleFooterCheckbox(wrapper, 0);

    expect(formProbe.api.setFieldValue).toHaveBeenLastCalledWith(
      'dataScopeDeptIds',
      [],
    );
  });

  it('全部展开时把全部节点编号交给树控件，再次点击折叠', /** 展开键未同步会让按钮点击后树没有任何变化。 */ async () => {
    const { onOpenChange, tree, wrapper } =
      await mountAssignDataPermissionForm();
    vi.mocked(getRole).mockResolvedValue({ dataScope: 2, id: 8 } as never);
    await openForRole(wrapper, onOpenChange, { id: 8 });
    expect(tree.props('defaultExpandedKeys')).toEqual([]);

    await toggleFooterCheckbox(wrapper, 1);
    expect(tree.props('defaultExpandedKeys')).toEqual([1, 2, 3]);

    await toggleFooterCheckbox(wrapper, 1);
    expect(tree.props('defaultExpandedKeys')).toEqual([]);
  });

  it('父子联动开关控制传给树控件的联动口径', /** 开关写反会让父子联动与用户选择相反，勾选范围失控。 */ async () => {
    const { tree, wrapper } = await mountAssignDataPermissionForm();
    expect(tree.props('checkStrictly')).toBe(false);

    await toggleFooterCheckbox(wrapper, 2);

    // 内部标记取反后传给树控件的仍是取反值，关闭联动即打开严格模式。
    expect(tree.props('checkStrictly')).toBe(true);
  });
});

describe('数据权限弹窗提交', /** 提交路径决定数据范围落库内容，部门集合口径写错会放大或缩小可见数据。 */ () => {
  it('校验不通过时不提交也不锁定弹窗', /** 无效数据提交会把后端拒绝的错误暴露给用户并留下锁定态。 */ async () => {
    const { onConfirm, wrapper } = await mountAssignDataPermissionForm();
    formProbe.api.validate.mockResolvedValue({ valid: false });

    await onConfirm();

    expect(assignRoleDataScope).not.toHaveBeenCalled();
    expect(modalProbe.api.lock).not.toHaveBeenCalled();
    expect(wrapper.emitted('success')).toBeUndefined();
  });

  it('指定部门范围时提交勾选的部门编号', /** 自定义范围丢失部门集合会让用户看到空数据。 */ async () => {
    const { onConfirm, wrapper } = await mountAssignDataPermissionForm();
    formProbe.api.getValues.mockResolvedValue({
      dataScope: 2,
      dataScopeDeptIds: [2, 3],
      id: 8,
    });
    vi.mocked(assignRoleDataScope).mockResolvedValue(true);

    await onConfirm();

    expect(assignRoleDataScope).toHaveBeenCalledWith({
      dataScope: 2,
      dataScopeDeptIds: [2, 3],
      roleId: 8,
    });
    expect(modalProbe.api.close).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('success')).toHaveLength(1);
  });

  it('非指定部门范围时提交空集合', /** 传 undefined 会让后端按旧部门集合过滤，数据范围与用户选择不符。 */ async () => {
    const { onConfirm } = await mountAssignDataPermissionForm();
    formProbe.api.getValues.mockResolvedValue({
      dataScope: 1,
      dataScopeDeptIds: [2, 3],
      id: 8,
    });
    vi.mocked(assignRoleDataScope).mockResolvedValue(true);

    await onConfirm();

    expect(assignRoleDataScope).toHaveBeenCalledWith({
      dataScope: 1,
      dataScopeDeptIds: [],
      roleId: 8,
    });
  });

  it('提交失败时释放锁且不提示成功', /** 未释放锁会让弹窗卡住，误报成功会让用户以为数据范围已生效。 */ async () => {
    const { onConfirm, wrapper } = await mountAssignDataPermissionForm();
    vi.mocked(assignRoleDataScope).mockRejectedValue(new Error('分配失败'));

    await expect(onConfirm()).rejects.toThrow('分配失败');

    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.close).not.toHaveBeenCalled();
    expect(wrapper.emitted('success')).toBeUndefined();
  });

  it('成功后提示操作成功文案', /** 缺少成功提示会让用户无法确认数据范围是否已保存。 */ async () => {
    const { onConfirm } = await mountAssignDataPermissionForm();
    vi.mocked(assignRoleDataScope).mockResolvedValue(true);
    const { ElMessage } = await import('element-plus');

    await onConfirm();

    expect(vi.mocked(ElMessage.success)).toHaveBeenCalledWith(
      '译文:ui.actionMessage.operationSuccess',
    );
  });
});
