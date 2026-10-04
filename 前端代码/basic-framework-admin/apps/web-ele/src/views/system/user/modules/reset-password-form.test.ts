/**
 * 重置密码弹窗（views/system/user/modules/reset-password-form）真实行为回归。
 *
 * 弹窗只提交新密码且不回显原密码：提交前必须校验表单、把明文密码摘要后再调用重置接口，
 * 失败时未释放弹窗锁会让弹窗永久停在加载态，打开时未清空密码框会把上一位用户输入的
 * 密码残留下来并被误提交。用例按真实调用顺序驱动弹窗回调，只替换弹窗容器、表单渲染、
 * 消息提示与网络边界，摘要、锁状态、事件顺序全部按组件真实实现执行。
 */
import type { VueWrapper } from '@vue/test-utils';

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { md5 } from '@vben/utils';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetUserPassword } from '#/api/system/user';

import ResetPasswordForm from './reset-password-form.vue';

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
  /** 只替换弹窗容器，重置密码弹窗自身的校验与提交顺序保持真实实现。 */ async () => {
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
       * 记录重置密码弹窗声明的回调并返回替身组件与替身实例。
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
  '#/api/system/user',
  /** 只替换网络边界，弹窗自身的摘要与参数拼装保持真实实现。 */ () => ({
    resetUserPassword: vi.fn(),
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
    useResetPasswordFormSchema: () => [
      { component: 'Input', fieldName: 'newPassword' },
    ],
  }),
);

/**
 * 挂载重置密码弹窗并返回驱动弹窗回调所需的能力。
 * @returns 已挂载的组件包装器与组件声明的弹窗回调。
 * @throws Error 组件未声明弹窗回调时抛出，避免用例静默地什么都不验证。
 */
async function mountResetPasswordForm() {
  const wrapper = mount(ResetPasswordForm);
  await nextTick();
  const { onConfirm, onOpenChange } = modalProbe.handlers;
  if (!onConfirm || !onOpenChange) {
    throw new Error('重置密码弹窗未声明提交或开关回调');
  }
  return { onConfirm, onOpenChange, wrapper };
}

/**
 * 按编辑路径打开弹窗并等待回填完成。
 * @param wrapper 已挂载的重置密码弹窗。
 * @param onOpenChange 组件声明的弹窗开关回调。
 * @param record 弹窗收到的列表行数据，必须带主键才会回填。
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
    formProbe.api.getValues.mockResolvedValue({
      id: 5,
      // 显式合成占位口令：本用例只验证摘要调用，不使用任何真实凭据。
      newPassword: 'DUMMY-new-password',
    });
    formProbe.api.setValues.mockResolvedValue(undefined);
    modalProbe.api.close.mockResolvedValue(undefined);
  },
);

describe('重置密码弹窗装配', /** 表单配置决定弹窗里展示哪些字段与默认行为。 */ () => {
  it('关闭默认操作并沿用页面表单定义', /** 默认操作栏重复出现或表单定义被替换会让弹窗与页面不一致。 */ async () => {
    const { wrapper } = await mountResetPasswordForm();

    expect(formProbe.options).toMatchObject({
      layout: 'horizontal',
      showDefaultActions: false,
    });
    expect(formProbe.options?.schema).toEqual([
      { component: 'Input', fieldName: 'newPassword' },
    ]);
    expect(wrapper.find('.form-stub').exists()).toBe(true);
  });
});

describe('重置密码弹窗打开', /** 打开路径决定回填哪些字段，密码残留会被误提交给下一位用户。 */ () => {
  it('打开时只回填用户编号并清空密码', /** 回填原密码会把上一位用户的输入提交出去。 */ async () => {
    const { onOpenChange, wrapper } = await mountResetPasswordForm();

    await openForUser(wrapper, onOpenChange, { id: 5, username: 'zhangsan' });

    expect(formProbe.api.setValues).toHaveBeenCalledWith({
      id: 5,
      newPassword: '',
    });
  });

  it('没有目标用户时不回填', /** 无主键仍回填会让表单带上 undefined 主键并提交失败。 */ async () => {
    const { onOpenChange, wrapper } = await mountResetPasswordForm();

    modalProbe.api.getData.mockReturnValue(undefined);
    await onOpenChange(true);
    await nextTick();

    expect(formProbe.api.setValues).not.toHaveBeenCalled();
    expect(wrapper.find('.form-stub').exists()).toBe(true);
  });

  it('关闭弹窗时不做任何回填', /** 关闭时清空会让用户下次打开时丢失已填的新密码。 */ async () => {
    const { onOpenChange } = await mountResetPasswordForm();

    await onOpenChange(false);

    expect(formProbe.api.setValues).not.toHaveBeenCalled();
    expect(modalProbe.api.lock).not.toHaveBeenCalled();
  });
});

describe('重置密码弹窗提交', /** 提交路径决定落库内容与用户可见结果，摘要或顺序写错会改错密码。 */ () => {
  it('校验不通过时不提交也不锁定弹窗', /** 无效数据提交会把后端拒绝的错误暴露给用户并留下锁定态。 */ async () => {
    const { onConfirm, wrapper } = await mountResetPasswordForm();
    formProbe.api.validate.mockResolvedValue({ valid: false });

    await onConfirm();

    expect(resetUserPassword).not.toHaveBeenCalled();
    expect(modalProbe.api.lock).not.toHaveBeenCalled();
    expect(wrapper.emitted('success')).toBeUndefined();
  });

  it('提交前把明文密码摘要后再调用重置接口', /** 明文密码落库会让登录校验失败，也会泄漏口令。 */ async () => {
    const { onConfirm, wrapper } = await mountResetPasswordForm();
    vi.mocked(resetUserPassword).mockResolvedValue(true);

    await onConfirm();

    expect(resetUserPassword).toHaveBeenCalledWith(
      5,
      md5('DUMMY-new-password'),
    );
    expect(modalProbe.api.close).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('success')).toHaveLength(1);
  });

  it('提交期间锁定并在成功后释放', /** 未锁定会让用户重复点击提交而产生重复请求。 */ async () => {
    const { onConfirm } = await mountResetPasswordForm();
    vi.mocked(resetUserPassword).mockResolvedValue(true);

    await onConfirm();

    expect(modalProbe.api.lock).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.lock.mock.invocationCallOrder[0]).toBeLessThan(
      modalProbe.api.unlock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('提交失败时释放锁且不提示成功', /** 未释放锁会让弹窗卡住，误报成功会让用户以为密码已改。 */ async () => {
    const { onConfirm, wrapper } = await mountResetPasswordForm();
    vi.mocked(resetUserPassword).mockRejectedValue(new Error('重置失败'));

    await expect(onConfirm()).rejects.toThrow('重置失败');

    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.close).not.toHaveBeenCalled();
    expect(wrapper.emitted('success')).toBeUndefined();
  });

  it('成功后提示操作成功文案', /** 缺少成功提示会让用户无法确认密码是否已重置。 */ async () => {
    const { onConfirm } = await mountResetPasswordForm();
    vi.mocked(resetUserPassword).mockResolvedValue(true);
    const { ElMessage } = await import('element-plus');

    await onConfirm();

    expect(vi.mocked(ElMessage.success)).toHaveBeenCalledWith(
      '译文:ui.actionMessage.operationSuccess',
    );
  });
});
