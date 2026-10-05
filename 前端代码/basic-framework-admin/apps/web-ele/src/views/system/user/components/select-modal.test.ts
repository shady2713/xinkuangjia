/**
 * 用户选择弹窗（views/system/user/components/select-modal）真实行为回归。
 *
 * 该弹窗把扁平部门列表重组为树、把用户列表交给穿梭框做多选：打开时未回填调用方传入的
 * 已选用户会让用户丢失原有选择；关闭或取消时未清空状态会让下次打开残留上一次的勾选；
 * 确认时未按勾选集合过滤会把未勾选的用户交回调用方，未勾选就确认又没有提示会让用户
 * 以为操作已生效；部门树按关键字过滤写错会让父节点在子节点命中时被剔除；过深的部门树
 * 没有深度保护会让递归爆栈；主键缺失的用户被当作可勾选对象会让选择永远无法命中。
 *
 * 用例真实渲染弹窗内容并使用真实的 Element Plus 部门树、穿梭框与分页组件，只替换弹窗
 * 容器（外部边界，弹窗自身的开合契约按组件声明的事件驱动）与网络边界。
 */

import type { SystemDeptApi } from '#/api/system/dept';

import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { ElPagination, ElTransfer, ElTree } from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSimpleDeptList } from '#/api/system/dept';
import { getUserPage } from '#/api/system/user';

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
      open: vi.fn(),
      unlock: vi.fn(),
    },
    handlers: {} as {
      /** 取消回调，由组件在弹窗取消时声明。 */
      onCancel?: () => void;
      /** 关闭完成回调，由组件在弹窗关闭后声明。 */
      onClosed?: () => void;
      /** 开关回调，由组件在弹窗打开或关闭时声明。 */
      onOpenChange?: ModalOpenChange;
    },
    options: undefined as Record<string, unknown> | undefined,
  }),
);

vi.mock(
  '@vben/common-ui',
  /** 只替换弹窗容器，选择弹窗自身的加载、过滤、勾选与确认逻辑保持真实实现。 */ async () => {
    const ModalStub = defineComponent({
      name: 'ModalStub',
      props: {
        /** 弹窗标题，用于核对组件声明的默认标题。 */
        title: { default: '', type: String },
      },
      /**
       * 渲染弹窗默认插槽与底部插槽，使部门树与穿梭框进入真实组件树。
       * @param props 弹窗组件声明的属性。
       * @param context 组件上下文，用于取用插槽。
       * @param context.slots 调用方传入的插槽表。
       * @returns 渲染两个插槽的渲染函数。
       */
      setup(props, { slots }) {
        return /** 渲染默认插槽与底部插槽并暴露标题，便于断言弹窗契约。 */ () =>
          h('div', { class: 'modal-stub', 'data-title': props.title }, [
            h('div', { class: 'modal-body' }, slots.default?.()),
            h('div', { class: 'modal-footer' }, slots.footer?.()),
          ]);
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
  /** 只替换部门列表网络边界，部门树拼装与过滤保持真实实现。 */ () => ({
    getSimpleDeptList: vi.fn(),
  }),
);

vi.mock(
  '#/api/system/user',
  /** 只替换用户分页网络边界，勾选、去重与分页保持真实实现。 */ () => ({
    getUserPage: vi.fn(),
  }),
);

/** 部门夹具：两级父子关系用于验证真实树拼装与按关键字过滤。 */
const DEPT_FIXTURE = [
  { id: 1, name: 'DUMMY-研发部', parentId: 0 },
  { id: 2, name: 'DUMMY-前端组', parentId: 1 },
  { id: 3, name: 'DUMMY-后端组', parentId: 1 },
];

/**
 * 构造一页用户夹具。
 * @param start 起始主键。
 * @param count 用户数量。
 * @returns 用户列表，昵称与账号按主键拼出便于定位。
 */
function userPage(start: number, count: number) {
  return Array.from(
    { length: count },
    /** 按序号拼出用户主键、昵称与账号。 */ (_, index) => {
      const id = start + index;
      return {
        id,
        nickname: `DUMMY-用户${id}`,
        username: `user${id}`,
      };
    },
  );
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
 * 取出关闭完成回调。
 * @returns 弹窗关闭完成回调。
 * @throws Error 组件未声明关闭完成回调时抛出，避免用例静默地什么都不验证。
 */
function onClosedHandler() {
  const handler = modalProbe.handlers.onClosed;
  if (!handler) {
    throw new Error('弹窗未声明关闭完成回调');
  }
  return handler;
}

/**
 * 挂载选择弹窗并等待首次渲染完成。
 * @param props 弹窗属性，用于驱动标题与按钮文案。
 * @returns 已挂载的弹窗包装器。
 */
async function mountModal(props: Record<string, unknown> = {}) {
  const wrapper = mount(SelectModal, { props });
  await wrapper.vm.$nextTick();
  return wrapper;
}

/**
 * 打开弹窗并等待数据加载完成。
 * @param props 弹窗属性。
 * @returns 已挂载的弹窗包装器。
 */
async function mountOpened(props: Record<string, unknown> = {}) {
  const wrapper = await mountModal(props);
  await onOpenChangeHandler()(true);
  await wrapper.vm.$nextTick();
  return wrapper;
}

/**
 * 读取部门树当前的数据源。
 * @param wrapper 已挂载的弹窗包装器。
 * @returns 树组件收到的节点数组。
 */
function treeData(wrapper: ReturnType<typeof mount>) {
  return wrapper.findComponent(ElTree).props('data') as Array<{
    children?: unknown[];
    id: string;
    label: string;
  }>;
}

/**
 * 读取穿梭框当前的数据源。
 * @param wrapper 已挂载的弹窗包装器。
 * @returns 穿梭框收到的候选项数组。
 */
function transferData(wrapper: ReturnType<typeof mount>) {
  return wrapper.findComponent(ElTransfer).props('data') as Array<{
    key: number;
    label: string;
  }>;
}

/**
 * 触发部门树的节点点击。
 * @param wrapper 已挂载的弹窗包装器。
 * @param node 被点击的部门节点。
 * @param node.id 部门主键，空串表示未落库。
 * @param node.name 部门名称。
 * @returns 点击处理完成。
 */
async function clickDeptNode(
  wrapper: ReturnType<typeof mount>,
  node: { id: string; name: string },
) {
  wrapper.findComponent(ElTree).vm.$emit('node-click', node);
  await wrapper.vm.$nextTick();
  await vi.waitFor(
    /** 等待部门切换触发的用户请求完成。 */ async () => {
      await Promise.resolve();
      expect(getUserPage).toHaveBeenCalled();
    },
  );
}

/**
 * 触发穿梭框的勾选变化。
 * @param wrapper 已挂载的弹窗包装器。
 * @param value 勾选后的用户主键列表。
 * @returns 勾选处理完成。
 */
async function changeTransfer(
  wrapper: ReturnType<typeof mount>,
  value: (number | string)[],
) {
  const transfer = wrapper.findComponent(ElTransfer);
  // 真实穿梭框先派发 v-model 更新，再派发 change，这里复刻同一事件顺序。
  transfer.vm.$emit('update:modelValue', value);
  transfer.vm.$emit('change', value, 'right', value);
  await wrapper.vm.$nextTick();
}

/**
 * 读取弹窗底部的按钮文案。
 * @param wrapper 已挂载的弹窗包装器。
 * @returns 底部按钮的文案数组。
 */
function footerButtons(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAll('.modal-footer button')
    .map(/** 读取单个底部按钮的文案。 */ (button) => button.text());
}

/**
 * 点击弹窗底部的指定按钮。
 * @param wrapper 已挂载的弹窗包装器。
 * @param label 目标按钮文案。
 * @returns 点击处理完成。
 * @throws Error 找不到目标按钮时抛出，避免用例静默地什么都不验证。
 */
async function clickFooter(wrapper: ReturnType<typeof mount>, label: string) {
  const button = wrapper
    .findAll('.modal-footer button')
    .find(/** 按文案定位目标底部按钮。 */ (item) => item.text() === label);
  if (!button) {
    throw new Error(`弹窗底部没有按钮：${label}`);
  }
  await button.trigger('click');
}

beforeEach(
  /** 清空替身调用与数据，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    modalProbe.handlers = {};
    modalProbe.api.getData.mockReturnValue({});
    modalProbe.api.close.mockResolvedValue(undefined);
    // 夹具只保留组件实际读取的字段，按接口类型断言后交给真实树拼装。
    vi.mocked(getSimpleDeptList).mockResolvedValue(
      DEPT_FIXTURE as unknown as SystemDeptApi.Dept[],
    );
    vi.mocked(getUserPage).mockResolvedValue({
      list: userPage(1, 3),
      total: 3,
    } as unknown as Awaited<ReturnType<typeof getUserPage>>);
  },
);

describe('用户选择弹窗默认契约', /** 默认属性决定弹窗标题与底部按钮文案。 */ () => {
  it('按约定声明标题、按钮文案与选择模式', /** 默认值写错会让弹窗标题或按钮文案不符合交互约定。 */ async () => {
    const wrapper = await mountModal();

    expect(wrapper.props('cancelText')).toBe('取消');
    expect(wrapper.props('confirmText')).toBe('确定');
    expect(wrapper.props('multiple')).toBe(true);
    expect(wrapper.props('title')).toBe('选择用户');
    expect(wrapper.props('value')).toEqual([]);
    expect(wrapper.find('.modal-stub').attributes('data-title')).toBe(
      '选择用户',
    );
    expect(footerButtons(wrapper)).toEqual(['取消', '确定']);
    expect(modalProbe.options?.destroyOnClose).toBe(true);
  });

  it('标题与按钮文案可由调用方覆盖', /** 固定文案会让不同业务场景无法区分选择目标。 */ async () => {
    const wrapper = await mountModal({
      cancelText: 'DUMMY-返回',
      confirmText: 'DUMMY-保存',
      title: 'DUMMY-选择负责人',
    });

    expect(wrapper.find('.modal-stub').attributes('data-title')).toBe(
      'DUMMY-选择负责人',
    );
    expect(footerButtons(wrapper)).toEqual(['DUMMY-返回', 'DUMMY-保存']);
  });

  it('声明的已选值与多选开关不参与行为', /** 声明却未使用的属性会让调用方以为可以预选或限制单选。 */ async () => {
    modalProbe.api.getData.mockReturnValue({});
    const wrapper = await mountOpened({ multiple: false, value: [2] });

    // 现状：value 不回填、multiple 不限制，穿梭框初始勾选仍为空。
    expect(wrapper.findComponent(ElTransfer).props('modelValue')).toEqual([]);
    await clickFooter(wrapper, '确定');
    expect(wrapper.emitted('confirm')).toBeUndefined();
  });
});

describe('用户选择弹窗打开与关闭', /** 开合链路决定树数据与勾选状态是否被正确加载与清理。 */ () => {
  it('打开时加载部门树与首页用户并锁定弹窗', /** 未加载会让用户看到空树，未锁定会让用户在加载期间重复操作。 */ async () => {
    const wrapper = await mountOpened();

    expect(getSimpleDeptList).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.lock).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.open).toHaveBeenCalledTimes(1);
    expect(getUserPage).toHaveBeenCalledWith({
      deptId: undefined,
      pageNo: 1,
      pageSize: 10,
      username: undefined,
    });

    const tree = treeData(wrapper);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      id: '1',
      label: 'DUMMY-研发部 (1)',
      name: 'DUMMY-研发部',
    });
    expect(tree[0]?.children).toHaveLength(2);
    expect(wrapper.findComponent(ElTree).props('defaultExpandedKeys')).toEqual([
      '1',
    ]);
    expect(transferData(wrapper)).toHaveLength(3);
  });

  it('打开时回填调用方传入的已选用户并去重', /** 未回填会让用户丢失原有选择，未去重会让同一用户出现两次。 */ async () => {
    modalProbe.api.getData.mockReturnValue({ userIds: [2] });
    vi.mocked(getUserPage)
      .mockResolvedValueOnce({
        list: userPage(1, 3),
        total: 3,
      } as unknown as Awaited<ReturnType<typeof getUserPage>>)
      .mockResolvedValueOnce({
        list: userPage(2, 2),
        total: 2,
      } as unknown as Awaited<ReturnType<typeof getUserPage>>);

    const wrapper = await mountOpened();

    expect(getUserPage).toHaveBeenCalledTimes(2);
    expect(getUserPage).toHaveBeenLastCalledWith({
      pageNo: 1,
      pageSize: 100,
      userIds: [2],
    });
    expect(wrapper.findComponent(ElTransfer).props('modelValue')).toEqual([2]);
    // 预取返回 2、3，其中 2 已存在，用户列表按主键去重后仍是 1、2、3。
    expect(
      transferData(wrapper).map(
        /** 取出穿梭框候选项的主键用于核对去重结果。 */ (item) => item.key,
      ),
    ).toEqual([1, 2, 3]);
  });

  it('缺少调用方数据时直接返回且不请求部门列表', /** 无目标数据时仍请求会让弹窗在错误场景下发出多余请求。 */ async () => {
    modalProbe.api.getData.mockReturnValue(undefined);
    await mountModal();

    await onOpenChangeHandler()(true);

    expect(getSimpleDeptList).not.toHaveBeenCalled();
    expect(modalProbe.api.lock).not.toHaveBeenCalled();
  });

  it('关闭时清空用户与勾选状态并在下次打开重新加载部门树', /** 未清空会让下次打开残留勾选，未重载会让用户看到过期部门。 */ async () => {
    const wrapper = await mountOpened();
    await changeTransfer(wrapper, [2]);
    expect(transferData(wrapper)).toHaveLength(3);

    await onOpenChangeHandler()(false);
    await wrapper.vm.$nextTick();

    expect(transferData(wrapper)).toEqual([]);
    expect(wrapper.findComponent(ElTransfer).props('modelValue')).toEqual([]);
    // 关闭只清理用户与勾选状态，部门树保留到下次打开时重新加载。
    expect(treeData(wrapper)).toHaveLength(1);

    vi.mocked(getSimpleDeptList).mockClear();
    await onOpenChangeHandler()(true);
    await wrapper.vm.$nextTick();

    expect(getSimpleDeptList).toHaveBeenCalledTimes(1);
  });

  it('加载失败时仍然解锁弹窗', /** 未解锁会让弹窗永久停在加载态，用户无法继续操作。 */ async () => {
    vi.mocked(getSimpleDeptList).mockRejectedValue(new Error('DUMMY-网络失败'));
    await mountModal();

    await expect(onOpenChangeHandler()(true)).rejects.toThrow('DUMMY-网络失败');
    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
  });

  it('关闭完成回调清空本地状态并派发事件', /** 未派发会让调用方收不到关闭通知，未清空会让状态残留。 */ async () => {
    const wrapper = await mountOpened();

    onClosedHandler()();
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('closed')).toHaveLength(1);
    expect(transferData(wrapper)).toEqual([]);
  });
});

describe('用户选择弹窗部门树', /** 部门过滤与选择决定左侧列表展示哪个部门的用户。 */ () => {
  it('按关键字过滤部门树并在命中子节点时保留父节点', /** 过滤写错会让用户搜不到部门或把父节点整棵剔除。 */ async () => {
    const wrapper = await mountOpened();
    const input = wrapper.find('input');

    await input.setValue('前端');
    await wrapper.vm.$nextTick();

    const filtered = treeData(wrapper);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('1');
    expect(filtered[0]?.children).toHaveLength(1);
    expect(wrapper.findComponent(ElTree).props('defaultExpandedKeys')).toEqual([
      '1',
      '2',
      '3',
    ]);

    await input.setValue('');
    await wrapper.vm.$nextTick();

    expect(treeData(wrapper)[0]?.children).toHaveLength(2);
    expect(wrapper.findComponent(ElTree).props('defaultExpandedKeys')).toEqual([
      '1',
    ]);
  });

  it('部门树过深时按深度保护返回空结果', /** 缺少深度保护会让深层部门搜索直接爆栈。 */ async () => {
    const deep = Array.from(
      { length: 103 },
      /** 按序号拼出父子相接的部门链。 */ (_, index) => ({
        id: index + 1,
        name: `DUMMY-部门${index + 1}`,
        parentId: index,
      }),
    );
    vi.mocked(getSimpleDeptList).mockResolvedValue(
      deep as unknown as SystemDeptApi.Dept[],
    );
    const wrapper = await mountOpened();
    expect(treeData(wrapper)).toHaveLength(1);

    await wrapper.find('input').setValue('DUMMY-不存在的部门');
    await wrapper.vm.$nextTick();

    expect(treeData(wrapper)).toEqual([]);
  });

  it('点击部门按主键加载用户并支持取消选择', /** 未按主键查询会让列表不随部门变化，无法取消会让用户被困在某个部门。 */ async () => {
    const wrapper = await mountOpened();
    vi.mocked(getUserPage).mockClear();

    await clickDeptNode(wrapper, { id: '2', name: 'DUMMY-前端组' });

    expect(getUserPage).toHaveBeenCalledWith({
      deptId: 2,
      pageNo: 1,
      pageSize: 10,
      username: undefined,
    });
    expect(wrapper.findComponent(ElTree).props('currentNodeKey')).toBe('2');

    await clickDeptNode(wrapper, { id: '2', name: 'DUMMY-前端组' });

    expect(getUserPage).toHaveBeenLastCalledWith({
      deptId: undefined,
      pageNo: 1,
      pageSize: 10,
      username: undefined,
    });
    expect(wrapper.findComponent(ElTree).props('currentNodeKey')).toBe(
      undefined,
    );
  });

  it('主键缺失的部门节点按未选择处理', /** 未落库的部门被当成编号会让查询落到错误部门。 */ async () => {
    const wrapper = await mountOpened();
    vi.mocked(getUserPage).mockClear();

    await clickDeptNode(wrapper, { id: '', name: 'DUMMY-未落库部门' });

    expect(getUserPage).toHaveBeenCalledWith({
      deptId: undefined,
      pageNo: 1,
      pageSize: 10,
      username: undefined,
    });
  });
});

describe('用户选择弹窗勾选与分页', /** 勾选与分页决定交回调用方的用户集合。 */ () => {
  it('勾选变化按数字归一化并交回调用方', /** 未归一化会让字符串主键与数字主键无法匹配。 */ async () => {
    const wrapper = await mountOpened();

    await changeTransfer(wrapper, ['2', 3]);

    expect(wrapper.emitted('update:value')?.at(-1)?.[0]).toEqual([2, 3]);
    expect(wrapper.findComponent(ElTransfer).props('modelValue')).toEqual([
      2, 3,
    ]);
  });

  it('右侧分页按页大小切分已选用户', /** 未按分页切分会让右侧列表一次显示全部已选用户。 */ async () => {
    const preselected = userPage(10, 12);
    modalProbe.api.getData.mockReturnValue({
      userIds: preselected.map(
        /** 取出预选用户主键交给弹窗回填。 */ (user) => user.id,
      ),
    });
    vi.mocked(getUserPage)
      .mockResolvedValueOnce({
        list: userPage(1, 3),
        total: 3,
      } as unknown as Awaited<ReturnType<typeof getUserPage>>)
      .mockResolvedValueOnce({
        list: preselected,
        total: preselected.length,
      } as unknown as Awaited<ReturnType<typeof getUserPage>>);
    const wrapper = await mountOpened();

    const paginations = wrapper.findAllComponents(ElPagination);
    expect(paginations).toHaveLength(2);
    expect(paginations[1]?.props('total')).toBe(12);
    // 左侧 3 条与右侧第一页 10 条合并为穿梭框候选。
    expect(transferData(wrapper)).toHaveLength(13);

    // 缩小页大小后切到第二页：分页组件会把越界页码收敛回合法值。
    paginations[1]?.vm.$emit('update:pageSize', 6);
    await wrapper.vm.$nextTick();
    paginations[1]?.vm.$emit('update:currentPage', 2);
    paginations[1]?.vm.$emit('current-change', 2);
    await wrapper.vm.$nextTick();

    // 右侧分页只影响已选用户的候选集合，第二页应剩 6 条。
    expect(paginations[1]?.props('currentPage')).toBe(2);
    expect(transferData(wrapper)).toHaveLength(9);
  });

  it('左侧分页按页码与页大小重新请求用户', /** 未按页码请求会让翻页后列表不变，未带上页大小会让每页条数失效。 */ async () => {
    const wrapper = await mountOpened();
    vi.mocked(getUserPage).mockClear();
    const leftPagination = wrapper.findAllComponents(ElPagination)[0];

    leftPagination?.vm.$emit('update:pageSize', 20);
    leftPagination?.vm.$emit('update:currentPage', 2);
    leftPagination?.vm.$emit('current-change', 2);
    await wrapper.vm.$nextTick();

    expect(getUserPage).toHaveBeenCalledWith({
      deptId: undefined,
      pageNo: 2,
      pageSize: 20,
      username: undefined,
    });
  });

  it('缺少主键的用户不进入穿梭框候选', /** 主键缺失的用户无法被勾选命中，混入候选会让用户白选一次。 */ async () => {
    vi.mocked(getUserPage).mockResolvedValue({
      list: [{ nickname: 'DUMMY-未落库用户', username: 'ghost' }],
      total: 1,
    } as unknown as Awaited<ReturnType<typeof getUserPage>>);

    const wrapper = await mountOpened();

    expect(transferData(wrapper)).toEqual([]);
  });
});

describe('用户选择弹窗确认与取消', /** 确认与取消决定交回调用方的结果与状态清理。 */ () => {
  it('未勾选任何用户时确认按钮不可用', /** 按钮可点却没有提示会让用户以为选择已生效。 */ async () => {
    const wrapper = await mountOpened();
    const confirmButton = wrapper.findAll('.modal-footer button').at(1);

    expect(confirmButton?.attributes('disabled')).toBeDefined();
    await clickFooter(wrapper, '确定');

    expect(wrapper.emitted('confirm')).toBeUndefined();
    expect(modalProbe.api.close).not.toHaveBeenCalled();

    await changeTransfer(wrapper, [1]);

    expect(confirmButton?.attributes('disabled')).toBeUndefined();
  });

  it('确认时只交回被勾选的用户并关闭弹窗', /** 交回未勾选的用户会让调用方拿到错误的人员范围。 */ async () => {
    const wrapper = await mountOpened();
    await changeTransfer(wrapper, [2]);

    await clickFooter(wrapper, '确定');

    const emitted = wrapper.emitted('confirm');
    expect(emitted).toHaveLength(1);
    expect(emitted?.[0]?.[0]).toEqual([
      { id: 2, nickname: 'DUMMY-用户2', username: 'user2' },
    ]);
    expect(modalProbe.api.close).toHaveBeenCalledTimes(1);
  });

  it('勾选在按钮状态刷新前被清空时确认不交回空结果', /** 空勾选守卫是按钮禁用之外的兜底：竞态下点击不能让调用方拿到空的人员范围。 */ async () => {
    const wrapper = await mountOpened();
    await changeTransfer(wrapper, [2]);
    const confirmButton = wrapper.findAll('.modal-footer button').at(1);
    expect(confirmButton?.attributes('disabled')).toBeUndefined();

    // 先清空勾选再立刻点击：此时 DOM 上的按钮尚未随 Vue 的异步刷新变成禁用态，
    // 处理器会带着空勾选被执行，正是组件内空值守卫要拦住的场景。
    wrapper.findComponent(ElTransfer).vm.$emit('update:modelValue', []);
    await confirmButton?.trigger('click');
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('confirm')).toBeUndefined();
    expect(modalProbe.api.close).not.toHaveBeenCalled();
  });

  it('取消时派发取消事件并关闭弹窗', /** 未派发会让调用方无法区分取消与确认。 */ async () => {
    const wrapper = await mountOpened();
    await changeTransfer(wrapper, [2]);

    await clickFooter(wrapper, '取消');

    expect(wrapper.emitted('cancel')).toHaveLength(1);
    expect(wrapper.emitted('confirm')).toBeUndefined();
    expect(modalProbe.api.close).toHaveBeenCalledTimes(1);
  });

  it('取消后在动画结束的延迟里清空勾选状态', /** 未延迟清理会让关闭动画期间列表闪回上一次的勾选。 */ async () => {
    const wrapper = await mountOpened();
    await changeTransfer(wrapper, [2]);
    await clickFooter(wrapper, '取消');

    // 组件在 300 毫秒后复位数据，这里等待同一时长后断言真实清理结果。
    await new Promise(
      /** 等待组件声明的清理延迟结束。 */ (resolve) => setTimeout(resolve, 350),
    );
    await wrapper.vm.$nextTick();

    expect(transferData(wrapper)).toEqual([]);
    expect(wrapper.findComponent(ElTransfer).props('modelValue')).toEqual([]);
  });
});
