/**
 * 角色菜单分配弹窗（views/system/role/modules/assign-menu-form）真实行为回归。
 *
 * 弹窗打开时先加载完整菜单树、再按角色编号拉取已授权菜单并回填：菜单树未按父子关系组装
 * 会让树控件丢失层级，全选/展开必须递归收集所有层级的节点编号，授权回填顺序写反会让
 * 勾选状态被空集合覆盖。用例按真实调用顺序驱动弹窗回调与页脚复选框，只替换弹窗容器、
 * 树控件、复选框、消息提示与网络边界，树的组装、递归收集、接口选择与事件顺序全部真实执行。
 */
import type { VueWrapper } from '@vue/test-utils';

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSimpleMenusList } from '#/api/system/menu';
import { assignRoleMenu, getRoleMenuList } from '#/api/system/permission';

import AssignMenuForm from './assign-menu-form.vue';

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
   * 只替换弹窗容器与树控件：弹窗自身加载、回填、全选与展开逻辑保持真实实现，
   * 树控件用可读取属性的替身承接组件传入的节点数据与回调。
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
        defaultExpandedKeys: {
          /** 默认不展开任何节点。 */
          default: () => [],
          type: Array,
        },
        getNodeClass: { default: undefined, type: Function },
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
       * 记录角色菜单弹窗声明的回调并返回替身组件与替身实例。
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
       * 渲染菜单树插槽，使树控件进入真实组件树。
       * @param _props 未声明的表单属性，本替身不解释。
       * @param context 组件上下文，用于取用插槽。
       * @param context.slots 调用方传入的插槽表。
       * @returns 渲染插槽内容的渲染函数。
       */
      setup(_props, { slots }) {
        return /** 渲染 menuIds 插槽，暴露真实的树控件绑定。 */ () =>
          h('div', { class: 'form-stub' }, slots.menuIds?.({}));
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
  '#/api/system/menu',
  /** 只替换菜单树网络边界，弹窗自身的树组装保持真实实现。 */ () => ({
    getSimpleMenusList: vi.fn(),
  }),
);

vi.mock(
  '#/api/system/permission',
  /** 只替换网络边界，弹窗自身的接口选择与参数拼装保持真实实现。 */ () => ({
    assignRoleMenu: vi.fn(),
    getRoleMenuList: vi.fn(),
  }),
);

vi.mock(
  'element-plus',
  /**
   * 只替换页脚复选框与消息提示：复选框保留 change 事件契约，
   * 使全选与展开逻辑仍由真实模板事件驱动。
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
    useAssignMenuFormSchema: () => [
      { component: 'Input', fieldName: 'menuIds' },
    ],
  }),
);

/** 菜单树夹具：一个目录、一个菜单与一个按钮，覆盖三层父子关系。 */
function menuFixture() {
  return [
    { id: 1, name: '系统管理', parentId: 0, type: 1 },
    { id: 2, name: '用户管理', parentId: 1, type: 2 },
    { id: 3, name: '新增用户', parentId: 2, type: 3 },
  ];
}

/** 树控件传入的节点形状：value 是菜单节点数据，index 是同层位置。 */
type MenuTreeNode = {
  index?: number | string;
  value?: { type?: number };
};

/**
 * 树控件的节点样式回调形状。
 * @param node 树控件传入的节点数据。
 * @returns 追加到节点 class 上的样式片段，无样式时为空串。
 */
type NodeClassGetter = (node: MenuTreeNode) => string;

/**
 * 挂载角色菜单弹窗并返回驱动弹窗回调与页脚控件所需的能力。
 * @returns 已挂载的组件包装器、弹窗回调与树控件包装器。
 * @throws Error 组件未声明弹窗回调时抛出，避免用例静默地什么都不验证。
 */
async function mountAssignMenuForm() {
  const wrapper = mount(AssignMenuForm, {
    // 组件用 v-loading 标记菜单加载状态，测试中注册空指令避免解析告警。
    global: { directives: { loading: {} } },
  });
  await nextTick();
  const { onConfirm, onOpenChange } = modalProbe.handlers;
  if (!onConfirm || !onOpenChange) {
    throw new Error('角色菜单弹窗未声明提交或开关回调');
  }
  const tree = wrapper.findComponent({ name: 'TreeStub' });
  return { onConfirm, onOpenChange, tree, wrapper };
}

/**
 * 按角色路径打开弹窗并等待菜单树与授权加载完成。
 * @param wrapper 已挂载的角色菜单弹窗。
 * @param onOpenChange 组件声明的弹窗开关回调。
 * @param record 弹窗收到的列表行数据，必须带主键才会加载授权。
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
 * 点击页脚第 n 个复选框，触发全选或展开逻辑。
 * @param wrapper 已挂载的角色菜单弹窗。
 * @param index 页脚复选框下标，0 为全选、1 为全部展开。
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
    formProbe.api.getValues.mockResolvedValue({ id: 8, menuIds: [2, 3] });
    formProbe.api.setFieldValue.mockResolvedValue(undefined);
    formProbe.api.setValues.mockResolvedValue(undefined);
    modalProbe.api.close.mockResolvedValue(undefined);
    vi.mocked(getSimpleMenusList).mockResolvedValue(menuFixture() as never);
  },
);

describe('角色菜单弹窗装配', /** 表单配置与树控件绑定决定弹窗展示的字段与树行为。 */ () => {
  it('关闭默认操作并沿用页面表单定义', /** 默认操作栏重复出现或表单定义被替换会让弹窗与页面不一致。 */ async () => {
    const { wrapper } = await mountAssignMenuForm();

    expect(formProbe.options).toMatchObject({
      layout: 'horizontal',
      showDefaultActions: false,
    });
    expect(formProbe.options?.schema).toEqual([
      { component: 'Input', fieldName: 'menuIds' },
    ]);
    expect(wrapper.find('.tree-stub').exists()).toBe(true);
  });

  it('按菜单字段绑定树控件', /** 取值字段写错会让树控件读不到节点编号与名称，勾选结果无法回填。 */ async () => {
    const { tree, wrapper } = await mountAssignMenuForm();

    expect(tree.props('multiple')).toBe(true);
    expect(tree.props('bordered')).toBe(true);
    expect(tree.props('valueField')).toBe('id');
    expect(tree.props('labelField')).toBe('name');
    expect(wrapper.findAll('.checkbox-stub')).toHaveLength(2);
  });
});

describe('角色菜单弹窗打开', /** 打开路径决定菜单树结构与已授权回填，顺序写错会让勾选被清空。 */ () => {
  it('按父子关系组装菜单树', /** 未组装层级会让树控件把所有菜单平铺，用户无法按目录勾选。 */ async () => {
    const { onOpenChange, tree, wrapper } = await mountAssignMenuForm();
    vi.mocked(getRoleMenuList).mockResolvedValue([3]);

    await openForRole(wrapper, onOpenChange, { id: 8 });

    const treeData = tree.props('treeData') as Array<Record<string, unknown>>;
    expect(treeData).toHaveLength(1);
    expect(treeData[0]).toMatchObject({ id: 1, name: '系统管理' });
    const menuLevel = (
      treeData[0]?.children as Array<Record<string, unknown>>
    )?.at(0);
    expect(menuLevel).toMatchObject({ id: 2, name: '用户管理' });
    expect(
      (menuLevel?.children as Array<Record<string, unknown>>)?.at(0),
    ).toMatchObject({ id: 3, name: '新增用户' });
  });

  it('先按角色编号回填已授权菜单再设置表单值', /** 顺序写反会让已授权勾选被空集合覆盖，用户看到的授权全丢。 */ async () => {
    const { onOpenChange, wrapper } = await mountAssignMenuForm();
    vi.mocked(getRoleMenuList).mockResolvedValue([2, 3]);

    await openForRole(wrapper, onOpenChange, { id: 8 });

    expect(getRoleMenuList).toHaveBeenCalledWith(8);
    expect(formProbe.api.setFieldValue).toHaveBeenCalledWith('menuIds', [2, 3]);
    expect(formProbe.api.setValues).toHaveBeenCalledWith({
      id: 8,
      menuIds: [],
    });
    expect(
      formProbe.api.setFieldValue.mock.invocationCallOrder[0],
    ).toBeLessThan(formProbe.api.setValues.mock.invocationCallOrder[0] ?? 0);
  });

  it('没有目标角色时只加载菜单树', /** 无主键仍请求授权会把 undefined 编号发给后端。 */ async () => {
    const { onOpenChange, wrapper } = await mountAssignMenuForm();

    modalProbe.api.getData.mockReturnValue(undefined);
    await onOpenChange(true);
    await nextTick();

    expect(getSimpleMenusList).toHaveBeenCalledTimes(1);
    expect(getRoleMenuList).not.toHaveBeenCalled();
    expect(formProbe.api.setValues).not.toHaveBeenCalled();
    expect(wrapper.find('.tree-stub').exists()).toBe(true);
  });

  it('授权加载失败仍释放弹窗锁', /** 未释放锁会让弹窗永久卡在加载态，只能刷新页面。 */ async () => {
    const { onOpenChange, wrapper } = await mountAssignMenuForm();
    vi.mocked(getRoleMenuList).mockRejectedValue(new Error('授权加载失败'));

    modalProbe.api.getData.mockReturnValue({ id: 8 });
    await expect(onOpenChange(true)).rejects.toThrow('授权加载失败');
    await nextTick();

    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.tree-stub').exists()).toBe(true);
  });

  it('菜单加载失败时仍复位加载状态', /** 未复位会让树控件一直显示加载遮罩，用户无法操作。 */ async () => {
    const { onOpenChange, tree, wrapper } = await mountAssignMenuForm();
    vi.mocked(getSimpleMenusList).mockRejectedValue(new Error('菜单加载失败'));

    await expect(openForRole(wrapper, onOpenChange, { id: 8 })).rejects.toThrow(
      '菜单加载失败',
    );

    expect(tree.props('treeData')).toEqual([]);
  });

  it('关闭弹窗时不做任何加载', /** 关闭时仍请求会让弹窗在不可见时反复打接口。 */ async () => {
    const { onOpenChange } = await mountAssignMenuForm();

    await onOpenChange(false);

    expect(getSimpleMenusList).not.toHaveBeenCalled();
    expect(formProbe.api.setValues).not.toHaveBeenCalled();
  });
});

describe('菜单全选与展开', /** 页脚控件决定批量勾选与展开，递归收集漏层会让部分菜单漏选。 */ () => {
  it('全选递归收集所有层级的菜单编号', /** 只收集第一层会让子菜单漏选，用户以为已授权全部菜单。 */ async () => {
    const { onOpenChange, wrapper } = await mountAssignMenuForm();
    vi.mocked(getRoleMenuList).mockResolvedValue([]);
    await openForRole(wrapper, onOpenChange, { id: 8 });

    await toggleFooterCheckbox(wrapper, 0);

    expect(formProbe.api.setFieldValue).toHaveBeenLastCalledWith(
      'menuIds',
      [1, 2, 3],
    );
  });

  it('再次点击全选时清空勾选', /** 取消全选无效会让用户无法收回授权。 */ async () => {
    const { onOpenChange, wrapper } = await mountAssignMenuForm();
    vi.mocked(getRoleMenuList).mockResolvedValue([]);
    await openForRole(wrapper, onOpenChange, { id: 8 });

    await toggleFooterCheckbox(wrapper, 0);
    await toggleFooterCheckbox(wrapper, 0);

    expect(formProbe.api.setFieldValue).toHaveBeenLastCalledWith('menuIds', []);
  });

  it('全部展开时把全部节点编号交给树控件，再次点击折叠', /** 展开键未同步会让按钮点击后树没有任何变化。 */ async () => {
    const { onOpenChange, tree, wrapper } = await mountAssignMenuForm();
    vi.mocked(getRoleMenuList).mockResolvedValue([]);
    await openForRole(wrapper, onOpenChange, { id: 8 });
    expect(tree.props('defaultExpandedKeys')).toEqual([]);

    await toggleFooterCheckbox(wrapper, 1);
    expect(tree.props('defaultExpandedKeys')).toEqual([1, 2, 3]);

    await toggleFooterCheckbox(wrapper, 1);
    expect(tree.props('defaultExpandedKeys')).toEqual([]);
  });

  it('按钮菜单按同层位置追加缩进样式', /** 缩进样式写错会让按钮类节点与菜单类节点挤在同一列，层级难以辨认。 */ async () => {
    const { tree } = await mountAssignMenuForm();
    const getNodeClass = tree.props('getNodeClass') as NodeClassGetter;

    expect(getNodeClass({ index: 1, value: { type: 3 } })).toBe(
      'inline-flex !pl-0',
    );
    expect(getNodeClass({ index: 3, value: { type: 3 } })).toBe('inline-flex');
    expect(getNodeClass({ index: 1, value: { type: 2 } })).toBe('');
    expect(getNodeClass({})).toBe('');
  });
});

describe('角色菜单弹窗提交', /** 提交路径决定授权落库内容，参数形状写错会让后端收到空授权。 */ () => {
  it('校验不通过时不提交也不锁定弹窗', /** 无效数据提交会把后端拒绝的错误暴露给用户并留下锁定态。 */ async () => {
    const { onConfirm, wrapper } = await mountAssignMenuForm();
    formProbe.api.validate.mockResolvedValue({ valid: false });

    await onConfirm();

    expect(assignRoleMenu).not.toHaveBeenCalled();
    expect(modalProbe.api.lock).not.toHaveBeenCalled();
    expect(wrapper.emitted('success')).toBeUndefined();
  });

  it('按角色编号与菜单编号提交', /** 参数名写错会让后端收到空授权并清空角色已有菜单。 */ async () => {
    const { onConfirm, wrapper } = await mountAssignMenuForm();
    vi.mocked(assignRoleMenu).mockResolvedValue(true);

    await onConfirm();

    expect(assignRoleMenu).toHaveBeenCalledWith({ menuIds: [2, 3], roleId: 8 });
    expect(modalProbe.api.close).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('success')).toHaveLength(1);
  });

  it('提交失败时释放锁且不提示成功', /** 未释放锁会让弹窗卡住，误报成功会让用户以为授权已生效。 */ async () => {
    const { onConfirm, wrapper } = await mountAssignMenuForm();
    vi.mocked(assignRoleMenu).mockRejectedValue(new Error('分配失败'));

    await expect(onConfirm()).rejects.toThrow('分配失败');

    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.close).not.toHaveBeenCalled();
    expect(wrapper.emitted('success')).toBeUndefined();
  });

  it('成功后提示操作成功文案', /** 缺少成功提示会让用户无法确认授权是否已保存。 */ async () => {
    const { onConfirm } = await mountAssignMenuForm();
    vi.mocked(assignRoleMenu).mockResolvedValue(true);
    const { ElMessage } = await import('element-plus');

    await onConfirm();

    expect(vi.mocked(ElMessage.success)).toHaveBeenCalledWith(
      '译文:ui.actionMessage.operationSuccess',
    );
  });
});
