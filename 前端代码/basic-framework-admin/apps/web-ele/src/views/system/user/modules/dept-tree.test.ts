/**
 * 用户页左侧部门树（views/system/user/modules/dept-tree）真实行为回归。
 *
 * 该组件在用户列表左侧展示部门树并支持按名称过滤：加载失败未结束加载态会让左侧永远
 * 显示加载动画，未记录错误会让排查缺少线索；搜索过滤未做大小写归一会让用户按小写搜不到
 * 部门，过滤后未重建树会让层级关系丢失；节点点击未抛出事件会让右侧用户列表无法按部门
 * 筛选。用例真实渲染组件与 Element Plus 的输入框、树控件，只替换网络边界并捕获日志。
 */
import { flushPromises, mount } from '@vue/test-utils';

import { ElInput, ElTree } from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSimpleDeptList } from '#/api/system/dept';

import DeptTree from './dept-tree.vue';

vi.mock(
  '#/api/system/dept',
  /** 只替换网络收发边界，组件自身的树构建、过滤与加载态逻辑保持真实实现。 */ () => ({
    getSimpleDeptList: vi.fn(),
  }),
);

/** 部门列表夹具：两个层级，用于核对树构建与按名称过滤。 */
const DEPT_LIST = [
  {
    createTime: 1_700_000_000_000,
    email: 'root@example.test',
    id: 1,
    leaderUserId: 1,
    name: 'BasicFramework 科技',
    parentId: 0,
    phone: '13800000000',
    sort: 1,
    status: 0,
  },
  {
    createTime: 1_700_000_000_000,
    email: 'dev@example.test',
    id: 2,
    leaderUserId: 2,
    name: '研发部',
    parentId: 1,
    phone: '13800000001',
    sort: 1,
    status: 0,
  },
  {
    createTime: 1_700_000_000_000,
    email: 'market@example.test',
    id: 3,
    leaderUserId: 3,
    name: '市场部',
    parentId: 1,
    phone: '13800000002',
    sort: 2,
    status: 0,
  },
  {
    createTime: 1_700_000_000_000,
    email: 'fe@example.test',
    id: 4,
    leaderUserId: 4,
    name: '前端组',
    parentId: 2,
    phone: '13800000003',
    sort: 1,
    status: 0,
  },
];

/**
 * 读取树控件收到的数据。
 * @param wrapper 已挂载的部门树组件包装器。
 * @returns 树控件当前的数据数组。
 */
function treeData(wrapper: ReturnType<typeof mount>) {
  return wrapper.findComponent(ElTree).props('data') as Array<{
    children?: unknown[];
    id: number;
    name: string;
  }>;
}

/**
 * 驱动搜索输入框触发一次过滤。
 * @param wrapper 已挂载的部门树组件包装器。
 * @param value 输入框本次提交的搜索值。
 */
async function search(wrapper: ReturnType<typeof mount>, value: string) {
  // 真实输入框会同时回写 v-model 并派发 input，这里按同一契约驱动两个事件。
  wrapper.findComponent(ElInput).vm.$emit('update:modelValue', value);
  wrapper.findComponent(ElInput).vm.$emit('input', value);
  await flushPromises();
}

/**
 * 挂载部门树并等待初始化完成。
 * @returns 已挂载的组件包装器。
 */
async function mountDeptTree() {
  const wrapper = mount(DeptTree);
  await flushPromises();
  return wrapper;
}

beforeEach(
  /** 清空替身调用并恢复默认的部门列表返回，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    vi.mocked(getSimpleDeptList).mockResolvedValue(DEPT_LIST);
  },
);

describe('部门树初始化', /** 初始化决定左侧树的内容与加载态，失败处理错会让用户看不到任何提示。 */ () => {
  it('按接口返回构建带层级的部门树', /** 未构建层级会让所有部门平铺，用户无法按组织层级浏览。 */ async () => {
    const wrapper = await mountDeptTree();

    const data = treeData(wrapper);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ id: 1, name: 'BasicFramework 科技' });
    expect(
      (data[0]?.children as Array<{ id: number }> | undefined)?.map(
        /** 取出二级部门编号，核对层级归属。 */ (node) => node.id,
      ),
    ).toEqual([2, 3]);
    expect(getSimpleDeptList).toHaveBeenCalledTimes(1);
  });

  it('树控件按部门名称字段展示并默认展开全部节点', /** 字段名或展开策略写错会让树显示空白或需要逐层点开。 */ async () => {
    const wrapper = await mountDeptTree();
    const tree = wrapper.findComponent(ElTree);

    expect(tree.props('props')).toEqual({
      children: 'children',
      label: 'name',
    });
    expect(tree.props('nodeKey')).toBe('id');
    expect(tree.props('defaultExpandAll')).toBe(true);
  });

  it('加载失败时记录可定位的错误并结束加载态', /** 未记录错误会让排查缺少线索，未结束加载态会让左侧永远转圈。 */ async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(
        /** 屏蔽预期内的错误输出，只保留调用记录。 */ () => {},
      );
    vi.mocked(getSimpleDeptList).mockRejectedValue(new Error('部门加载失败'));

    const wrapper = await mountDeptTree();

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0]?.[0])).toContain(
      '[system:user:dept-tree:load]',
    );
    expect(String(consoleError.mock.calls[0]?.[0])).toContain('部门加载失败');
    expect(wrapper.text()).toContain('暂无数据');
  });
});

describe('部门树搜索', /** 搜索决定左侧树的可见范围，过滤口径错会让用户找不到目标部门。 */ () => {
  it('按名称子串过滤并保留层级关系', /** 过滤后未重建树会让命中节点的层级关系丢失。 */ async () => {
    const wrapper = await mountDeptTree();

    await search(wrapper, '研发');

    const data = treeData(wrapper);
    expect(
      data.map(/** 取出根节点编号，核对过滤结果。 */ (node) => node.id),
    ).toEqual([2]);
    expect(
      (data[0]?.children as Array<{ id: number }> | undefined)?.map(
        /** 取出子节点编号，核对命中节点的子级仍保留。 */ (node) => node.id,
      ),
    ).toEqual([4]);
  });

  it('搜索忽略大小写差异', /** 大小写敏感会让用户按小写搜不到英文部门名。 */ async () => {
    const wrapper = await mountDeptTree();

    await search(wrapper, 'basicframework');

    expect(
      treeData(wrapper).map(
        /** 取出根节点名称，核对大小写归一后的命中结果。 */ (node) => node.name,
      ),
    ).toEqual(['BasicFramework 科技']);
  });

  it('清空搜索值时恢复完整部门树', /** 未恢复完整列表会让用户清空输入后仍看不到全部部门。 */ async () => {
    const wrapper = await mountDeptTree();
    await search(wrapper, '研发');
    expect(treeData(wrapper)).toHaveLength(1);

    await search(wrapper, '');

    expect(
      treeData(wrapper).map(
        /** 取出根节点编号，核对已恢复完整列表。 */ (node) => node.id,
      ),
    ).toEqual([1]);
  });

  it('没有命中部门时展示空数据提示', /** 未展示提示会让用户以为组件坏了。 */ async () => {
    const wrapper = await mountDeptTree();

    await search(wrapper, '不存在的部门');

    // 无命中时树控件整体不渲染，改为展示空数据提示。
    expect(wrapper.findComponent(ElTree).exists()).toBe(false);
    expect(wrapper.text()).toContain('暂无数据');
  });
});

describe('部门树节点选中', /** 选中事件是右侧用户列表按部门筛选的唯一入口。 */ () => {
  it('点击节点时向父组件抛出选中部门', /** 事件未抛出会让右侧列表无法按部门筛选。 */ async () => {
    const wrapper = await mountDeptTree();
    const node = { id: 2, label: '研发部' };

    wrapper.findComponent(ElTree).vm.$emit('node-click', node);
    await flushPromises();

    expect(wrapper.emitted('select')).toEqual([[node]]);
  });

  it('连续点击不同节点时逐次抛出各自的部门', /** 事件载荷写错会让右侧列表始终按第一次点击的部门筛选。 */ async () => {
    const wrapper = await mountDeptTree();

    wrapper
      .findComponent(ElTree)
      .vm.$emit('node-click', { id: 2, label: '研发部' });
    wrapper
      .findComponent(ElTree)
      .vm.$emit('node-click', { id: 3, label: '市场部' });
    await flushPromises();

    expect(wrapper.emitted('select')).toEqual([
      [{ id: 2, label: '研发部' }],
      [{ id: 3, label: '市场部' }],
    ]);
  });
});
