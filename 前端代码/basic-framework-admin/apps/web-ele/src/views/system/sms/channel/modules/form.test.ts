/**
 * 短信渠道弹窗（views/system/sms/channel/modules/form）真实行为回归。
 *
 * 弹窗按是否已存在主键决定走新增还是修改：主键判断写错会把已有短信渠道改成新增、产生重复
 * 短信渠道；打开编辑时未重新拉取详情会让用户看到列表页的旧值并覆盖他人修改；关闭时未清理
 * 上一条记录会让下一次提交误改上一条短信渠道；提交失败未释放弹窗锁会让弹窗永久停在加载态。
 * 用例按真实调用顺序驱动弹窗回调，只替换弹窗容器、表单渲染、消息提示与网络边界。
 */
import type { VueWrapper } from '@vue/test-utils';

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSmsChannel,
  getSmsChannel,
  updateSmsChannel,
} from '#/api/system/sms/channel';

import ChannelForm from './form.vue';

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
  /** 只替换弹窗容器，短信渠道弹窗自身的主键判断与锁状态逻辑保持真实实现。 */ async () => {
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
       * 记录短信渠道弹窗声明的回调并返回替身组件与替身实例。
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
  '#/api/system/sms/channel',
  /** 只替换网络收发边界，弹窗自身的接口选择与参数拼装保持真实实现。 */ () => ({
    createSmsChannel: vi.fn(),
    getSmsChannel: vi.fn(),
    updateSmsChannel: vi.fn(),
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
    useFormSchema: () => [{ component: 'Input', fieldName: 'signature' }],
  }),
);

/** 构造字段完整的短信渠道记录，作为编辑路径的数据基线。 */
function channelRecord() {
  return {
    apiKey: 'DUMMY-api-key',
    apiSecret: 'DUMMY-api-secret',
    callbackUrl: 'https://example.test/sms/callback',
    code: 'DEBUG_DING_TALK',
    id: 2,
    remark: '调试用渠道',
    signature: '示例科技',
    status: 0,
  };
}

/**
 * 挂载短信渠道弹窗并返回驱动弹窗回调所需的能力。
 * @returns 已挂载的组件包装器与组件声明的弹窗回调。
 * @throws Error 组件未声明弹窗回调时抛出，避免用例静默地什么都不验证。
 */
async function mountChannelForm() {
  const wrapper = mount(ChannelForm);
  await nextTick();
  const { onConfirm, onOpenChange } = modalProbe.handlers;
  if (!onConfirm || !onOpenChange) {
    throw new Error('短信渠道弹窗未声明提交或开关回调');
  }
  return { onConfirm, onOpenChange, wrapper };
}

/**
 * 按编辑路径打开弹窗并等待详情加载完成。
 * @param wrapper 已挂载的短信渠道弹窗。
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
    formProbe.api.getValues.mockResolvedValue({ signature: '示例值' });
    formProbe.api.setValues.mockResolvedValue(undefined);
    modalProbe.api.close.mockResolvedValue(undefined);
  },
);

describe('短信渠道弹窗装配', /** 表单配置决定弹窗里展示哪些字段与默认行为。 */ () => {
  it('关闭默认操作并沿用页面表单定义', /** 默认操作栏重复出现或表单定义被替换会让弹窗与页面不一致。 */ async () => {
    const { wrapper } = await mountChannelForm();

    expect(formProbe.options).toMatchObject({
      layout: 'horizontal',
      showDefaultActions: false,
      commonConfig: {
        componentProps: { class: 'w-full' },
        formItemClass: 'col-span-2',
        labelWidth: 100,
      },
    });
    expect(formProbe.options?.schema).toEqual([
      { component: 'Input', fieldName: 'signature' },
    ]);
    expect(wrapper.find('.form-stub').exists()).toBe(true);
  });
});

describe('短信渠道弹窗打开', /** 打开路径决定标题与回填数据，主键判断错会展示空表单或旧数据。 */ () => {
  it('新增时设置新增标题且不回填数据', /** 未区分新增会让空表单带上上一条短信渠道的残留值。 */ async () => {
    const { onOpenChange, wrapper } = await mountChannelForm();

    modalProbe.api.getData.mockReturnValue(undefined);
    await onOpenChange(true);
    await nextTick();

    expect(modalProbe.api.setState).toHaveBeenCalledWith({
      title: 'ui.actionTitle.create(短信渠道)',
    });
    expect(getSmsChannel).not.toHaveBeenCalled();
    expect(formProbe.api.setValues).not.toHaveBeenCalled();
    expect(wrapper.find('.form-stub').exists()).toBe(true);
  });

  it('编辑时按主键重新拉取详情并回填', /** 直接用列表行会让用户看到过期数据并覆盖他人修改。 */ async () => {
    const { onOpenChange, wrapper } = await mountChannelForm();
    const detail = { ...channelRecord(), signature: '最新签名' };
    vi.mocked(getSmsChannel).mockResolvedValue(detail);

    await openForEdit(wrapper, onOpenChange, channelRecord());

    expect(modalProbe.api.setState).toHaveBeenCalledWith({
      title: 'ui.actionTitle.edit(短信渠道)',
    });
    expect(getSmsChannel).toHaveBeenCalledWith(2);
    expect(formProbe.api.setValues).toHaveBeenCalledWith(detail);
  });

  it('加载详情期间先锁定再释放锁', /** 锁状态顺序颠倒会让弹窗在数据回填后仍显示加载中。 */ async () => {
    const { onOpenChange, wrapper } = await mountChannelForm();
    vi.mocked(getSmsChannel).mockResolvedValue(channelRecord());

    await openForEdit(wrapper, onOpenChange, channelRecord());

    expect(modalProbe.api.lock.mock.invocationCallOrder[0]).toBeLessThan(
      modalProbe.api.unlock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('详情加载失败仍释放弹窗锁', /** 未释放锁会让弹窗永久卡在加载态，只能刷新页面。 */ async () => {
    const { onOpenChange, wrapper } = await mountChannelForm();
    vi.mocked(getSmsChannel).mockRejectedValue(new Error('详情加载失败'));

    modalProbe.api.getData.mockReturnValue(channelRecord());
    await expect(onOpenChange(true)).rejects.toThrow('详情加载失败');
    await nextTick();

    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.form-stub').exists()).toBe(true);
  });

  it('关闭弹窗时清理已加载的短信渠道', /** 残留数据会让下一次提交误改上一条短信渠道。 */ async () => {
    const { onConfirm, onOpenChange, wrapper } = await mountChannelForm();
    vi.mocked(getSmsChannel).mockResolvedValue(channelRecord());
    vi.mocked(createSmsChannel).mockResolvedValue(3);
    await openForEdit(wrapper, onOpenChange, channelRecord());

    await onOpenChange(false);
    await onConfirm();

    // 关闭后已加载记录被清空，再次提交必须走新增而不是修改。
    expect(createSmsChannel).toHaveBeenCalledTimes(1);
    expect(updateSmsChannel).not.toHaveBeenCalled();
  });
});

describe('短信渠道弹窗提交', /** 提交路径决定落库目标与用户可见结果，必须与主键状态一致。 */ () => {
  it('校验不通过时不提交也不锁定弹窗', /** 无效数据提交会把后端拒绝的错误暴露给用户并留下锁定态。 */ async () => {
    const { onConfirm, wrapper } = await mountChannelForm();
    formProbe.api.validate.mockResolvedValue({ valid: false });

    await onConfirm();

    expect(createSmsChannel).not.toHaveBeenCalled();
    expect(updateSmsChannel).not.toHaveBeenCalled();
    expect(modalProbe.api.lock).not.toHaveBeenCalled();
    expect(wrapper.emitted('success')).toBeUndefined();
  });

  it('新增时提交表单值并关闭弹窗', /** 主键缺失却走修改会更新到错误的短信渠道。 */ async () => {
    const { onConfirm, wrapper } = await mountChannelForm();
    const values = { signature: '示例值', name: '新短信渠道' };
    formProbe.api.getValues.mockResolvedValue(values);
    vi.mocked(createSmsChannel).mockResolvedValue(3);

    await onConfirm();

    expect(createSmsChannel).toHaveBeenCalledWith(values);
    expect(updateSmsChannel).not.toHaveBeenCalled();
    expect(modalProbe.api.close).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('success')).toHaveLength(1);
  });

  it('编辑时按主键走修改接口', /** 主键存在却走新增会产生重复短信渠道。 */ async () => {
    const { onConfirm, onOpenChange, wrapper } = await mountChannelForm();
    vi.mocked(getSmsChannel).mockResolvedValue(channelRecord());
    await openForEdit(wrapper, onOpenChange, channelRecord());
    const values = { id: 2, name: '改名后的短信渠道' };
    formProbe.api.getValues.mockResolvedValue(values);
    vi.mocked(updateSmsChannel).mockResolvedValue(true);

    await onConfirm();

    expect(updateSmsChannel).toHaveBeenCalledWith(values);
    expect(createSmsChannel).not.toHaveBeenCalled();
  });

  it('提交失败时释放锁且不提示成功', /** 未释放锁会让弹窗卡住，误报成功会让用户以为已保存。 */ async () => {
    const { onConfirm, wrapper } = await mountChannelForm();
    vi.mocked(createSmsChannel).mockRejectedValue(new Error('保存失败'));

    await expect(onConfirm()).rejects.toThrow('保存失败');

    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.close).not.toHaveBeenCalled();
    expect(wrapper.emitted('success')).toBeUndefined();
  });

  it('成功后提示操作成功文案', /** 缺少成功提示会让用户无法确认保存结果。 */ async () => {
    const { onConfirm } = await mountChannelForm();
    vi.mocked(createSmsChannel).mockResolvedValue(3);
    const { ElMessage } = await import('element-plus');

    await onConfirm();

    expect(vi.mocked(ElMessage.success)).toHaveBeenCalledWith(
      '译文:ui.actionMessage.operationSuccess',
    );
  });
});
