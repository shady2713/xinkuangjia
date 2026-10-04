/**
 * 定时任务日志详情弹窗（views/infra/job/logger/modules/detail）真实行为回归。
 *
 * 该模块在弹窗打开时按编号拉取日志详情：编号校验写错会发出无效请求，接口失败时
 * 未释放锁会让弹窗永久卡在加载态并吞掉错误，关闭时未清空会让下次打开先闪出上一条
 * 日志。用例只替换弹窗容器、描述列表与任务日志接口边界，驱动真实回调并断言请求
 * 参数、锁状态顺序与失败传播。
 */
import type { VueWrapper } from '@vue/test-utils';

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getJobLog } from '#/api/infra/job-log';

import JobLogDetail from './detail.vue';

/** 弹窗开关回调签名：弹窗容器在打开与关闭时驱动详情组件。 */
type ModalOpenChange = (isOpen: boolean) => Promise<void> | void;

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
  '#/api/infra/job-log',
  /** 只替换任务日志查询边界，详情组件自身的编号校验与状态装配保持真实实现。 */ () => ({
    getJobLog: vi.fn(),
  }),
);

vi.mock(
  '@vben/common-ui',
  /** 只替换弹窗容器，详情组件的取数与锁状态逻辑保持真实实现。 */ async () => {
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

/** 构造字段完整的任务日志记录，作为详情数据基线。 */
function jobLogRecord() {
  return {
    beginTime: new Date('2026-01-02T03:00:00.000Z'),
    cronExpression: '0 0 * * * ?',
    duration: '120',
    endTime: new Date('2026-01-02T03:00:02.000Z'),
    executeIndex: '1',
    handlerName: 'demoJob',
    handlerParam: '{}',
    id: 42,
    jobId: 7,
    result: '执行成功',
    status: 1,
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
  const wrapper = mount(JobLogDetail);
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
    vi.mocked(getJobLog).mockResolvedValue(jobLogRecord());
  },
);

describe('任务日志详情取数', /** 打开时必须校验编号并按需锁定，失败也必须释放锁。 */ () => {
  it('带编号打开时按编号拉取并展示详情', /** 请求参数必须使用弹窗传入的编号，否则会展示其它任务的日志。 */ async () => {
    const record = jobLogRecord();
    modalProbe.api.getData.mockReturnValue({ id: 42 });
    vi.mocked(getJobLog).mockResolvedValue(record);
    const { onOpenChange, wrapper } = await mountDetail();

    await toggleModal(wrapper, true, onOpenChange);

    expect(getJobLog).toHaveBeenCalledWith(42);
    expect(currentDescriptionData()).toEqual(record);
    expect(modalProbe.api.lock).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
  });

  it('加载期间先锁定再释放锁', /** 锁状态顺序颠倒会让弹窗在详情展示后仍显示加载中。 */ async () => {
    modalProbe.api.getData.mockReturnValue({ id: 42 });
    const { onOpenChange, wrapper } = await mountDetail();

    await toggleModal(wrapper, true, onOpenChange);

    expect(modalProbe.api.lock.mock.invocationCallOrder[0]).toBeLessThan(
      modalProbe.api.unlock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('没有弹窗数据时不请求也不锁定', /** 空数据必须提前返回，避免发出无编号的无效请求。 */ async () => {
    modalProbe.api.getData.mockReturnValue(undefined);
    const { onOpenChange, wrapper } = await mountDetail();

    await toggleModal(wrapper, true, onOpenChange);

    expect(getJobLog).not.toHaveBeenCalled();
    expect(currentDescriptionData()).toBeUndefined();
    expect(modalProbe.api.lock).not.toHaveBeenCalled();
  });

  it('编号为零时不请求也不锁定', /** 零不是合法主键，请求它只会得到后端参数错误。 */ async () => {
    modalProbe.api.getData.mockReturnValue({ id: 0 });
    const { onOpenChange, wrapper } = await mountDetail();

    await toggleModal(wrapper, true, onOpenChange);

    expect(getJobLog).not.toHaveBeenCalled();
    expect(currentDescriptionData()).toBeUndefined();
    expect(modalProbe.api.lock).not.toHaveBeenCalled();
  });

  it('接口失败时释放锁并向调用方抛出原错误', /** 未释放锁会让弹窗永久卡在加载态，吞掉错误则无法提示失败原因。 */ async () => {
    const failure = new Error('任务日志查询失败');
    modalProbe.api.getData.mockReturnValue({ id: 42 });
    vi.mocked(getJobLog).mockRejectedValue(failure);
    const { onOpenChange, wrapper } = await mountDetail();

    await expect(onOpenChange(true)).rejects.toBe(failure);
    await nextTick();

    expect(modalProbe.api.lock).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
    expect(currentDescriptionData()).toBeUndefined();
    expect(wrapper.find('.description-stub').exists()).toBe(true);
  });

  it('关闭弹窗时清空已展示的日志', /** 残留数据会在下次打开时先闪出上一条日志。 */ async () => {
    modalProbe.api.getData.mockReturnValue({ id: 42 });
    const { onOpenChange, wrapper } = await mountDetail();
    await toggleModal(wrapper, true, onOpenChange);
    expect(currentDescriptionData()).toBeDefined();

    await toggleModal(wrapper, false, onOpenChange);

    expect(currentDescriptionData()).toBeUndefined();
  });

  it('再次打开时重新拉取并展示新记录', /** 复用同一弹窗实例时必须按新编号重新取数。 */ async () => {
    modalProbe.api.getData.mockReturnValue({ id: 42 });
    const { onOpenChange, wrapper } = await mountDetail();
    await toggleModal(wrapper, true, onOpenChange);

    const second = { ...jobLogRecord(), id: 99 };
    modalProbe.api.getData.mockReturnValue({ id: 99 });
    vi.mocked(getJobLog).mockResolvedValue(second);
    await toggleModal(wrapper, false, onOpenChange);
    await toggleModal(wrapper, true, onOpenChange);

    expect(getJobLog).toHaveBeenLastCalledWith(99);
    expect(currentDescriptionData()).toEqual(second);
  });
});

describe('任务日志详情描述契约', /** 描述列表的列数与字段集合是详情页面的展示契约。 */ () => {
  it('单列带边框并声明全部详情字段', /** 字段缺失会让详情页漏展示处理器参数与执行结果等排查信息。 */ async () => {
    const { wrapper } = await mountDetail();

    expect(descriptionProbe.options).toMatchObject({ border: true, column: 1 });
    const schema = descriptionProbe.options?.schema as
      | undefined
      | { field: string }[];
    expect(
      schema?.map(/** 取出字段名用于核对详情字段集合。 */ (item) => item.field),
    ).toEqual([
      'id',
      'jobId',
      'handlerName',
      'handlerParam',
      'executeIndex',
      'beginTime',
      'duration',
      'status',
      'result',
    ]);
    expect(wrapper.find('.description-stub').exists()).toBe(true);
  });
});
