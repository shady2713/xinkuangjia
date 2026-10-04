/**
 * 分配角色弹窗（views/system/user/modules/assign-role-form）真实行为回归。
 *
 * 弹窗打开时必须按用户编号重新拉取已授权角色再回填，直接沿用列表行会让用户看到过期授权
 * 并覆盖他人修改；提交时未校验会让空集合覆盖已有分配，失败时未释放弹窗锁会让弹窗永久
 * 停在加载态。用例按真实调用顺序驱动弹窗回调，只替换弹窗容器、表单渲染、消息提示与网络
 * 边界，接口选择、参数拼装、锁状态与事件顺序全部按组件真实实现执行。
 */
import type { VueWrapper } from '@vue/test-utils';

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assignUserRole, getUserRoleList } from '#/api/system/permission';

import AssignRoleForm from './assign-role-form.vue';

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
      setValues: vi.fn(),
      validate: vi.fn(),
    },
    options: undefined as Record<string, unknown> | undefined,
  }),
);

vi.mock(
  '@vben/common-ui',
  /** 只替换弹窗容器，分配角色弹窗自身的加载与提交顺序保持真实实现。 */ async () => {
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
       * 记录分配角色弹窗声明的回调并返回替身组件与替身实例。
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
  '#/api/system/permission',
  /** 只替换网络边界，弹窗自身的接口选择与参数拼装保持真实实现。 */ () => ({
    assignUserRole: vi.fn(),
    getUserRoleList: vi.fn(),
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
  /** 只替换翻译边界，便于核对弹窗请求的语言键。 */ () => ({
    /** 回显语言键，使断言不依赖真实语言包。 */
    $t: (key: string) => `译文:${key}`,
  }),
);

vi.mock(
  '../data',
  /** 只替换页面表单定义，弹窗对表单配置的传递保持真实实现。 */ () => ({
    /** 返回最小可识别的表单定义，用于核对透传。 */
    useAssignRoleFormSchema: () => [
      { component: 'Select', fieldName: 'roleIds' },
    ],
  }),
);

/**
 * 挂载分配角色弹窗并返回驱动弹窗回调所需的能力。
 * @returns 已挂载的组件包装器与组件声明的弹窗回调。
 * @throws Error 组件未声明弹窗回调时抛出，避免用例静默地什么都不验证。
 */
async function mountAssignRoleForm() {
  const wrapper = mount(AssignRoleForm);
  await nextTick();
  const { onConfirm, onOpenChange } = modalProbe.handlers;
  if (!onConfirm || !onOpenChange) {
    throw new Error('分配角色弹窗未声明提交或开关回调');
  }
  return { onConfirm, onOpenChange, wrapper };
}

/**
 * 按用户路径打开弹窗并等待角色回填完成。
 * @param wrapper 已挂载的分配角色弹窗。
 * @param onOpenChange 组件声明的弹窗开关回调。
 * @param record 弹窗收到的列表行数据，必须带主键才会加载授权。
 */
async function openForUser(
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
    formProbe.api.getValues.mockResolvedValue({ id: 9, roleIds: [2, 3] });
    formProbe.api.setValues.mockResolvedValue(undefined);
    modalProbe.api.close.mockResolvedValue(undefined);
  },
);

describe('分配角色弹窗装配', /** 表单配置决定弹窗里展示哪些字段与默认行为。 */ () => {
  it('关闭默认操作并沿用页面表单定义', /** 默认操作栏重复出现或表单定义被替换会让弹窗与页面不一致。 */ async () => {
    const { wrapper } = await mountAssignRoleForm();

    expect(formProbe.options).toMatchObject({
      layout: 'horizontal',
      showDefaultActions: false,
    });
    expect(formProbe.options?.schema).toEqual([
      { component: 'Select', fieldName: 'roleIds' },
    ]);
    expect(wrapper.find('.form-stub').exists()).toBe(true);
  });
});

describe('分配角色弹窗打开', /** 打开路径决定回填的授权，数据过期会让用户误改他人授权。 */ () => {
  it('按用户编号重新拉取已授权角色并回填', /** 直接沿用列表行会让用户看到过期授权并覆盖他人修改。 */ async () => {
    const { onOpenChange, wrapper } = await mountAssignRoleForm();
    vi.mocked(getUserRoleList).mockResolvedValue([4, 6]);

    await openForUser(wrapper, onOpenChange, { id: 9, username: 'zhangsan' });

    expect(getUserRoleList).toHaveBeenCalledWith(9);
    expect(formProbe.api.setValues).toHaveBeenCalledWith({
      id: 9,
      roleIds: [4, 6],
    });
  });

  it('接口未返回授权时回填空集合', /** undefined 直接进入表单会让多选组件报错或残留旧勾选。 */ async () => {
    const { onOpenChange, wrapper } = await mountAssignRoleForm();
    vi.mocked(getUserRoleList).mockResolvedValue(undefined as never);

    await openForUser(wrapper, onOpenChange, { id: 9 });

    expect(formProbe.api.setValues).toHaveBeenCalledWith({
      id: 9,
      roleIds: [],
    });
  });

  it('加载授权期间先锁定再释放锁', /** 锁状态顺序颠倒会让弹窗在数据回填后仍显示加载中。 */ async () => {
    const { onOpenChange, wrapper } = await mountAssignRoleForm();
    vi.mocked(getUserRoleList).mockResolvedValue([4]);

    await openForUser(wrapper, onOpenChange, { id: 9 });

    expect(modalProbe.api.lock.mock.invocationCallOrder[0]).toBeLessThan(
      modalProbe.api.unlock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('授权加载失败仍释放弹窗锁', /** 未释放锁会让弹窗永久卡在加载态，只能刷新页面。 */ async () => {
    const { onOpenChange, wrapper } = await mountAssignRoleForm();
    vi.mocked(getUserRoleList).mockRejectedValue(new Error('授权加载失败'));

    modalProbe.api.getData.mockReturnValue({ id: 9 });
    await expect(onOpenChange(true)).rejects.toThrow('授权加载失败');
    await nextTick();

    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.form-stub').exists()).toBe(true);
  });

  it('没有目标用户时不加载授权', /** 无主键仍请求会把 undefined 编号发给后端。 */ async () => {
    const { onOpenChange, wrapper } = await mountAssignRoleForm();

    modalProbe.api.getData.mockReturnValue(undefined);
    await onOpenChange(true);
    await nextTick();

    expect(getUserRoleList).not.toHaveBeenCalled();
    expect(formProbe.api.setValues).not.toHaveBeenCalled();
    expect(wrapper.find('.form-stub').exists()).toBe(true);
  });

  it('关闭弹窗时保留未提交的勾选', /** 关闭即清空会让用户误以为勾选已被丢弃。 */ async () => {
    const { onOpenChange } = await mountAssignRoleForm();

    await onOpenChange(false);

    expect(getUserRoleList).not.toHaveBeenCalled();
    expect(formProbe.api.setValues).not.toHaveBeenCalled();
  });
});

describe('分配角色弹窗提交', /** 提交路径决定授权落库内容，参数形状写错会让后端收到错误分配。 */ () => {
  it('校验不通过时不提交也不锁定弹窗', /** 无效数据提交会把后端拒绝的错误暴露给用户并留下锁定态。 */ async () => {
    const { onConfirm, wrapper } = await mountAssignRoleForm();
    formProbe.api.validate.mockResolvedValue({ valid: false });

    await onConfirm();

    expect(assignUserRole).not.toHaveBeenCalled();
    expect(modalProbe.api.lock).not.toHaveBeenCalled();
    expect(wrapper.emitted('success')).toBeUndefined();
  });

  it('按用户编号与角色编号提交', /** 参数名写错会让后端收到空分配并清空用户已有角色。 */ async () => {
    const { onConfirm, wrapper } = await mountAssignRoleForm();
    formProbe.api.getValues.mockResolvedValue({ id: 9, roleIds: [2, 3] });
    vi.mocked(assignUserRole).mockResolvedValue(true);

    await onConfirm();

    expect(assignUserRole).toHaveBeenCalledWith({ roleIds: [2, 3], userId: 9 });
    expect(modalProbe.api.close).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('success')).toHaveLength(1);
  });

  it('提交期间锁定并在成功后释放', /** 未锁定会让用户重复点击提交而产生重复授权请求。 */ async () => {
    const { onConfirm } = await mountAssignRoleForm();
    vi.mocked(assignUserRole).mockResolvedValue(true);

    await onConfirm();

    expect(modalProbe.api.lock).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
  });

  it('提交失败时释放锁且不提示成功', /** 未释放锁会让弹窗卡住，误报成功会让用户以为授权已生效。 */ async () => {
    const { onConfirm, wrapper } = await mountAssignRoleForm();
    vi.mocked(assignUserRole).mockRejectedValue(new Error('分配失败'));

    await expect(onConfirm()).rejects.toThrow('分配失败');

    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.close).not.toHaveBeenCalled();
    expect(wrapper.emitted('success')).toBeUndefined();
  });

  it('成功后提示操作成功文案', /** 缺少成功提示会让用户无法确认授权是否已保存。 */ async () => {
    const { onConfirm } = await mountAssignRoleForm();
    vi.mocked(assignUserRole).mockResolvedValue(true);
    const { ElMessage } = await import('element-plus');

    await onConfirm();

    expect(vi.mocked(ElMessage.success)).toHaveBeenCalledWith(
      '译文:ui.actionMessage.operationSuccess',
    );
  });
});
