/**
 * 操作日志详情弹窗（views/system/operatelog/modules/detail）真实行为回归。
 *
 * 该模块把弹窗传入的操作日志装配到描述列表上：打开时未校验主键会把空记录渲染成
 * 空白详情，关闭时未清空会让下一次打开先闪出上一条日志，锁状态未成对释放会让弹窗
 * 永久卡在加载态。用例驱动真实的弹窗回调并断言描述列表实际收到的数据与锁状态
 * 调用顺序，只替换弹窗容器与描述列表渲染边界。
 */
import type { VueWrapper } from '@vue/test-utils';

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import OperateLogDetail from './detail.vue';

/** 弹窗开关回调签名：弹窗容器在打开与关闭时驱动详情组件。 */
type ModalOpenChange = (isOpen: boolean) => Promise<void> | void;

// 该详情页经列表数据模块间接依赖请求边界，而应用配置在模块导入期即被读取；
// 必须在导入前提供与 app.config.js 同形状的测试值。vi.hoisted 会被提升到导入之前执行。
vi.hoisted(
  /** 写入最小运行时配置，使请求与偏好模块能在无浏览器环境完成导入。 */ () => {
    (
      globalThis as unknown as { _VBEN_ADMIN_PRO_APP_CONF_: unknown }
    )._VBEN_ADMIN_PRO_APP_CONF_ = {
      VITE_APP_CAPTCHA_ENABLE: 'false',
      VITE_APP_STORE_SECURE_KEY: 'DUMMY-store-key',
      VITE_GLOB_API_URL: 'https://example.test/admin-api',
      VITE_GLOB_AUTH_DINGDING_CLIENT_ID: '',
      VITE_GLOB_AUTH_DINGDING_CORP_ID: '',
    };
  },
);

/** 弹窗替身记录的回调与调用实例；模块替身与用例读取同一实例。 */
const modalProbe = vi.hoisted(
  /** 建立用例可设置数据、可断言的弹窗替身容器。 */ () => ({
    api: {
      getData: vi.fn(),
      lock: vi.fn(),
      unlock: vi.fn(),
    },
    onOpenChange: undefined as ModalOpenChange | undefined,
  }),
);

/** 描述列表替身收到的每次详情数据与声明属性；末项即当前展示值。 */
const descriptionProbe = vi.hoisted(
  /** 建立用例可清空、可断言的描述数据记录容器。 */ () => ({
    options: undefined as Record<string, unknown> | undefined,
    received: [] as unknown[],
  }),
);

vi.mock(
  '@vben/common-ui',
  /** 只替换弹窗容器，详情组件自身的数据装配与锁状态逻辑保持真实实现。 */ async () => {
    const { defineComponent, h } = await import('vue');
    const ModalStub = defineComponent({
      name: 'ModalStub',
      /** 渲染弹窗默认插槽内容，使描述列表进入真实组件树。
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
      /** 记录详情组件声明的弹窗回调并返回替身组件与替身实例。 */
      useVbenModal: (options: { onOpenChange?: ModalOpenChange }) => {
        modalProbe.onOpenChange = options.onOpenChange;
        return [ModalStub, modalProbe.api];
      },
    };
  },
);

vi.mock(
  '#/components/description',
  /** 只替换描述列表渲染边界，详情组件声明的描述属性保持真实取值。 */ async () => {
    const { defineComponent, h } = await import('vue');
    const DescriptionStub = defineComponent({
      name: 'DescriptionStub',
      props: {
        data: { default: undefined, type: Object },
      },
      /** 记录每次渲染实际收到的详情数据。
       * @param props 描述列表替身声明的属性。
       * @returns 渲染可定位占位节点的渲染函数。
       */
      setup(props) {
        /** 记录本次渲染收到的详情数据并输出可定位节点。 */
        const renderStub = () => {
          descriptionProbe.received.push(props.data);
          return h('div', { class: 'description-stub' });
        };
        return renderStub;
      },
    });
    return {
      /** 记录详情组件声明的描述列表属性并返回替身组件。 */
      useDescription: (options: Record<string, unknown>) => {
        descriptionProbe.options = options;
        return [
          DescriptionStub,
          {
            /** 替身不提供异步回填能力。 */ setDescProps: () => {},
          },
        ];
      },
    };
  },
);

/** 构造字段完整的操作日志记录，作为详情数据基线。 */
function operateLogRecord() {
  return {
    action: '登录成功',
    createTime: '2026-01-02 03:04:05',
    id: 15,
    requestMethod: 'POST',
    requestUrl: '/admin-api/system/auth/login',
    subType: '登录',
    traceId: 'trace-abc',
    type: '认证',
    userAgent: 'Mozilla/5.0',
    userId: 3,
    userName: 'admin',
    userType: 1,
  };
}

/**
 * 读取描述列表替身当前展示的详情数据。
 * @returns 末次渲染收到的数据；从未渲染时为 undefined。
 */
function currentDescriptionData() {
  return descriptionProbe.received.at(-1);
}

/**
 * 挂载详情组件并返回驱动弹窗回调所需的能力。
 * @returns 已挂载的组件包装器与可调用的弹窗开关回调。
 * @throws 弹窗替身未收到开关回调时报告契约变化。
 */
async function mountDetail() {
  const wrapper = mount(OperateLogDetail);
  if (!modalProbe.onOpenChange) {
    throw new Error('弹窗替身未收到开关回调');
  }
  return { onOpenChange: modalProbe.onOpenChange, wrapper };
}

/**
 * 驱动一次弹窗开关并等待渲染收敛。
 * @param wrapper 已挂载的详情组件。
 * @param isOpen 目标开关状态。
 * @param onOpenChange 弹窗开关回调。
 */
async function toggleModal(
  wrapper: VueWrapper,
  isOpen: boolean,
  onOpenChange: ModalOpenChange,
) {
  await onOpenChange(isOpen);
  await nextTick();
  expect(wrapper.find('.description-stub').exists()).toBe(true);
}

beforeEach(
  /** 清空替身调用与记录，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    descriptionProbe.received = [];
    modalProbe.api.getData.mockReturnValue(undefined);
  },
);

describe('操作日志详情打开', /** 打开时必须校验主键并按需锁定，否则会渲染空详情或卡住弹窗。 */ () => {
  it('带主键打开时把日志记录交给描述列表', /** 详情页展示的必须是弹窗传入的那条日志。 */ async () => {
    const record = operateLogRecord();
    modalProbe.api.getData.mockReturnValue(record);
    const { onOpenChange, wrapper } = await mountDetail();

    await toggleModal(wrapper, true, onOpenChange);

    expect(currentDescriptionData()).toEqual(record);
    expect(modalProbe.api.lock).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
  });

  it('加载期间先锁定再释放锁', /** 锁状态顺序颠倒会让弹窗在数据装配完成后仍显示加载中。 */ async () => {
    modalProbe.api.getData.mockReturnValue(operateLogRecord());
    const { onOpenChange, wrapper } = await mountDetail();

    await toggleModal(wrapper, true, onOpenChange);

    expect(modalProbe.api.lock.mock.invocationCallOrder[0]).toBeLessThan(
      modalProbe.api.unlock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('没有弹窗数据时不锁定也不展示数据', /** 空数据必须提前返回，避免无意义地锁定弹窗。 */ async () => {
    modalProbe.api.getData.mockReturnValue(undefined);
    const { onOpenChange, wrapper } = await mountDetail();

    await toggleModal(wrapper, true, onOpenChange);

    expect(currentDescriptionData()).toBeUndefined();
    expect(modalProbe.api.lock).not.toHaveBeenCalled();
    expect(modalProbe.api.unlock).not.toHaveBeenCalled();
  });

  it('缺少主键时不展示数据', /** 没有编号的记录不是有效详情，渲染它会误导排查。 */ async () => {
    modalProbe.api.getData.mockReturnValue({ ...operateLogRecord(), id: 0 });
    const { onOpenChange, wrapper } = await mountDetail();

    await toggleModal(wrapper, true, onOpenChange);

    expect(currentDescriptionData()).toBeUndefined();
    expect(modalProbe.api.lock).not.toHaveBeenCalled();
  });

  it('关闭弹窗时清空已展示的日志', /** 残留数据会在下次打开时先闪出上一条日志。 */ async () => {
    modalProbe.api.getData.mockReturnValue(operateLogRecord());
    const { onOpenChange, wrapper } = await mountDetail();
    await toggleModal(wrapper, true, onOpenChange);
    expect(currentDescriptionData()).toBeDefined();

    await toggleModal(wrapper, false, onOpenChange);

    expect(currentDescriptionData()).toBeUndefined();
  });

  it('再次打开时展示新的日志记录', /** 复用同一弹窗实例时不能沿用上一次的数据。 */ async () => {
    const first = operateLogRecord();
    const second = { ...operateLogRecord(), id: 31, userName: 'operator' };
    modalProbe.api.getData.mockReturnValue(first);
    const { onOpenChange, wrapper } = await mountDetail();
    await toggleModal(wrapper, true, onOpenChange);

    modalProbe.api.getData.mockReturnValue(second);
    await toggleModal(wrapper, false, onOpenChange);
    await toggleModal(wrapper, true, onOpenChange);

    expect(currentDescriptionData()).toEqual(second);
  });
});

describe('操作日志详情描述契约', /** 描述列表的列数与字段集合是详情页面的展示契约。 */ () => {
  it('单列带边框并声明全部详情字段', /** 字段缺失会让详情页漏展示请求地址、操作内容等排查信息。 */ async () => {
    const { wrapper } = await mountDetail();

    expect(descriptionProbe.options).toMatchObject({ border: true, column: 1 });
    const schema = descriptionProbe.options?.schema as
      | undefined
      | { field: string }[];
    expect(
      schema?.map(/** 取出字段名用于核对详情字段集合。 */ (item) => item.field),
    ).toEqual([
      'id',
      'traceId',
      'userId',
      'userType',
      'userName',
      'userIp',
      'userAgent',
      'type',
      'subType',
      'action',
      'extra',
      'requestUrl',
      'createTime',
      'bizId',
    ]);
    expect(wrapper.find('.description-stub').exists()).toBe(true);
  });
});
