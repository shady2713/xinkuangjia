/**
 * 定时任务详情弹窗（views/infra/job/modules/detail）真实行为回归。
 *
 * 弹窗打开时按编号取任务详情，再取后续执行时间并合并进详情数据：编号校验写错会
 * 发出无效请求，两次取数的合并写错会让详情缺少后续执行时间，失败时未释放锁会让
 * 弹窗永久停在加载态并吞掉错误，关闭时未清空会让下次打开先闪出上一条任务。
 *
 * 用例只替换弹窗容器、任务接口与描述列表边界，详情组件自身的编号校验、取数顺序、
 * 锁状态与数据装配保持真实实现。描述列表与详情 schema 按仓库既有做法（见
 * views/infra/job/logger/modules/detail.test.ts）作为边界替身：真实 import 会连带
 * 引入 description.vue（仓库唯一的 lang="tsx" SFC，覆盖率条目恒为 0 语句）与
 * CronTab、DictTag，前者会让整份覆盖率证据变成 invalid-evidence，后两者只被 import
 * 就被现有门禁记成已覆盖。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getJob, getJobNextTimes } from '#/api/infra/job';

import JobDetail from './detail.vue';

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

/** 详情 schema 替身：记录调用次数并返回固定字段声明。 */
const schemaProbe = vi.hoisted(
  /** 建立用例可清空、可断言的 schema 替身容器。 */ () => ({
    calls: 0,
    schema: [{ field: 'name', label: '任务名称' }],
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
  '#/api/infra/job',
  /** 只替换任务查询边界，详情组件的编号校验、取数顺序与状态装配保持真实实现。 */ () => ({
    getJob: vi.fn(),
    getJobNextTimes: vi.fn(),
  }),
);

vi.mock(
  '../data',
  /** 只替换详情字段声明来源，记录详情组件确实按当前 schema 构造描述列表。 */ () => ({
    /** 返回用例声明的固定描述字段。 */
    useDetailSchema: () => {
      schemaProbe.calls += 1;
      return schemaProbe.schema;
    },
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
  /** 只替换描述列表渲染边界，详情组件声明的描述属性与数据保持真实取值。 */ async () => {
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

/** 构造字段完整的定时任务记录，作为详情数据基线。 */
function jobRecord() {
  return {
    cronExpression: '0 0 * * * ?',
    handlerName: 'demoJob',
    handlerParam: '{"key":"value"}',
    id: 7,
    monitorTimeout: 0,
    name: '演示任务',
    retryCount: 3,
    retryInterval: 5000,
    status: 1,
  };
}

/**
 * 挂载详情组件并返回驱动弹窗回调所需的能力。
 * @returns 已挂载的组件包装器与可调用的弹窗开关回调。
 * @throws 弹窗替身未收到开关回调时报告契约变化。
 */
async function mountDetail() {
  const wrapper = mount(JobDetail);
  if (!modalProbe.onOpenChange) {
    throw new Error('弹窗替身未收到开关回调');
  }
  return { onOpenChange: modalProbe.onOpenChange, wrapper };
}

/**
 * 读取描述列表替身当前展示的详情数据。
 * @returns 末次渲染收到的数据；从未渲染时为 undefined。
 */
function currentDescriptionData() {
  return descriptionProbe.received.at(-1);
}

/**
 * 驱动一次弹窗开关并等待渲染收敛。
 * @param wrapper 已挂载的详情组件。
 * @param isOpen 目标开关状态。
 * @param onOpenChange 弹窗开关回调。
 */
async function toggleModal(
  wrapper: ReturnType<typeof mount>,
  isOpen: boolean,
  onOpenChange: ModalOpenChange,
) {
  await onOpenChange(isOpen);
  await nextTick();
  expect(wrapper.find('.modal-stub').exists()).toBe(true);
}

beforeEach(
  /** 清空替身调用与记录，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    descriptionProbe.received = [];
    schemaProbe.calls = 0;
    modalProbe.api.getData.mockReturnValue(undefined);
    vi.mocked(getJob).mockResolvedValue(jobRecord());
    vi.mocked(getJobNextTimes).mockResolvedValue([1_900_000_000_000]);
  },
);

describe('任务详情取数', /** 打开时必须校验编号并按需锁定，失败也必须释放锁。 */ () => {
  it('带编号打开时取详情与后续执行时间并合并展示', /** 缺少后续执行时间会让排期核对失去依据，编号传错会展示别的任务。 */ async () => {
    modalProbe.api.getData.mockReturnValue({ id: 7 });
    vi.mocked(getJobNextTimes).mockResolvedValue([
      1_900_000_000_000, 1_900_000_060_000,
    ]);
    const { onOpenChange, wrapper } = await mountDetail();

    await toggleModal(wrapper, true, onOpenChange);

    expect(getJob).toHaveBeenCalledWith(7);
    expect(getJobNextTimes).toHaveBeenCalledWith(7);
    expect(wrapper.find('.description-stub').exists()).toBe(true);
    expect(currentDescriptionData()).toEqual({
      ...jobRecord(),
      nextTimes: [1_900_000_000_000, 1_900_000_060_000],
    });
    expect(modalProbe.api.lock).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
  });

  it('后续执行时间为空数组时按空数组合并', /** 空数组被丢弃会让详情页把“没有排期”误显示成“未取到数据”。 */ async () => {
    modalProbe.api.getData.mockReturnValue({ id: 7 });
    vi.mocked(getJobNextTimes).mockResolvedValue([]);
    const { onOpenChange, wrapper } = await mountDetail();

    await toggleModal(wrapper, true, onOpenChange);

    expect(currentDescriptionData()).toMatchObject({ nextTimes: [] });
  });

  it('加载期间先锁定再释放锁', /** 锁状态顺序颠倒会让弹窗在详情展示后仍显示加载中。 */ async () => {
    modalProbe.api.getData.mockReturnValue({ id: 7 });
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

    expect(getJob).not.toHaveBeenCalled();
    expect(getJobNextTimes).not.toHaveBeenCalled();
    expect(modalProbe.api.lock).not.toHaveBeenCalled();
    expect(currentDescriptionData()).toBeUndefined();
  });

  it('编号为零时不请求也不锁定', /** 零不是合法主键，请求它只会得到后端参数错误。 */ async () => {
    modalProbe.api.getData.mockReturnValue({ id: 0 });
    const { onOpenChange, wrapper } = await mountDetail();

    await toggleModal(wrapper, true, onOpenChange);

    expect(getJob).not.toHaveBeenCalled();
    expect(modalProbe.api.lock).not.toHaveBeenCalled();
    expect(currentDescriptionData()).toBeUndefined();
  });

  it('接口失败时释放锁并向调用方抛出原错误', /** 未释放锁会让弹窗永久卡在加载态，吞掉错误则无法提示失败原因。 */ async () => {
    const failure = new Error('任务查询失败');
    modalProbe.api.getData.mockReturnValue({ id: 7 });
    vi.mocked(getJob).mockRejectedValue(failure);
    const { onOpenChange, wrapper } = await mountDetail();

    await expect(onOpenChange(true)).rejects.toBe(failure);
    await nextTick();

    expect(modalProbe.api.lock).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
    expect(currentDescriptionData()).toBeUndefined();
    expect(wrapper.find('.description-stub').exists()).toBe(true);
  });

  it('关闭弹窗时清空已展示的任务详情', /** 残留数据会在下次打开时先闪出上一条任务，误导运维。 */ async () => {
    modalProbe.api.getData.mockReturnValue({ id: 7 });
    const { onOpenChange, wrapper } = await mountDetail();
    await toggleModal(wrapper, true, onOpenChange);
    expect(currentDescriptionData()).toBeDefined();

    await toggleModal(wrapper, false, onOpenChange);

    expect(currentDescriptionData()).toBeUndefined();
  });

  it('再次打开时按新编号重新取数', /** 复用同一弹窗实例时必须按新编号重新取数，否则会展示上一条任务。 */ async () => {
    modalProbe.api.getData.mockReturnValue({ id: 7 });
    const { onOpenChange, wrapper } = await mountDetail();
    await toggleModal(wrapper, true, onOpenChange);

    const second = { ...jobRecord(), id: 99, name: '第二条任务' };
    modalProbe.api.getData.mockReturnValue({ id: 99 });
    vi.mocked(getJob).mockResolvedValue(second);
    await toggleModal(wrapper, false, onOpenChange);
    await toggleModal(wrapper, true, onOpenChange);

    expect(getJob).toHaveBeenLastCalledWith(99);
    expect(getJobNextTimes).toHaveBeenLastCalledWith(99);
    expect(currentDescriptionData()).toMatchObject({ name: '第二条任务' });
  });
});

describe('任务详情描述契约', /** 描述列表的列数、边框与字段来源是详情页面的展示契约。 */ () => {
  it('单列带边框并声明当前 schema', /** 字段来源写错会让详情页展示别的模块的字段。 */ async () => {
    const { wrapper } = await mountDetail();

    expect(schemaProbe.calls).toBe(1);
    expect(descriptionProbe.options).toMatchObject({
      border: true,
      column: 1,
      schema: schemaProbe.schema,
    });
    expect(wrapper.find('.description-stub').exists()).toBe(true);
  });
});
