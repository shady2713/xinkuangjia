/**
 * 部门选择器（form-create 的 dept-select 组件）真实行为回归。
 *
 * 组件把扁平部门列表拼成树供表单选择，并按 `returnType` 决定交回部门主键还是名称：拼树
 * 写错会让层级部门平铺；`returnType='name'` 的双向转换漏掉缺失部门会让回显变成 undefined；
 * 清空选择时未按多选口径交回空数组会让表单残留上一次的部门；`defaultCurrentDept` 的预设值
 * 优先级判断写反会覆盖调用方已经设置好的部门；接口失败未降级会让整个表单项卡住。用例挂载
 * 真实组件与真实 ElTreeSelect，只替换部门接口与告警通道，Pinia 用户 Store 使用真实实现。
 */
import { flushPromises, mount } from '@vue/test-utils';

import { useUserStore } from '@vben/stores';

import { ElTreeSelect } from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import DeptSelect from './dept-select.vue';

/** 树节点过滤方法契约：按关键字判断节点是否保留。 */
type NodeFilterMethod = (value: string, data: unknown) => boolean;

const spies = vi.hoisted(
  /** 只替换告警通道，其余工具函数保持真实实现。 */ () => ({
    logWarn: vi.fn(),
  }),
);

vi.mock(
  '@vben/utils',
  /** 保留 handleTree 等真实实现，只把告警换成可观察替身。 */ async (
    importOriginal,
  ) => {
    const original = await importOriginal<Record<string, unknown>>();
    return { ...original, logWarn: spies.logWarn };
  },
);

vi.mock(
  '#/api/request',
  /** 部门接口是外部边界，由用例决定返回数据或失败。 */ () => ({
    requestClient: { get: vi.fn() },
  }),
);

/** 部门夹具：两级父子关系用于验证真实树拼装与名称/主键互转。 */
const DEPT_FIXTURE = [
  { id: 1, name: 'DUMMY-研发部', parentId: 0 },
  { id: 2, name: 'DUMMY-前端组', parentId: 1 },
  { id: 3, name: 'DUMMY-后端组', parentId: 1 },
];

beforeEach(
  /** 每例使用独立 Pinia、复位替身并登记默认的部门列表返回。 */ () => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    vi.mocked(requestClient.get).mockResolvedValue(DEPT_FIXTURE as never);
  },
);

/**
 * 挂载部门选择器并等待首次加载完成。
 * @param props 组件属性，用于驱动返回值口径、多选与默认值行为。
 * @returns 已挂载的组件包装器。
 */
async function mountDeptSelect(props: Record<string, unknown> = {}) {
  const wrapper = mount(DeptSelect, { props });
  await vi.waitFor(
    /** 等待挂载期真实请求落地并完成树拼装。 */ () => {
      expect(requestClient.get).toHaveBeenCalled();
    },
  );
  await flushPromises();
  await wrapper.vm.$nextTick();
  return wrapper;
}

/**
 * 读取树选择器收到的树数据。
 * @param wrapper 已挂载的组件包装器。
 * @returns 树节点数组。
 */
function treeData(wrapper: ReturnType<typeof mount>) {
  return wrapper.findComponent(ElTreeSelect).props('data') as Array<{
    children?: unknown[];
    id: number;
    name: string;
  }>;
}

/**
 * 取出组件的树节点过滤方法。
 * @param wrapper 已挂载的组件包装器。
 * @returns 过滤方法。
 * @throws Error 组件未声明过滤方法时抛出，避免用例静默地什么都不验证。
 */
function filterNodeMethod(wrapper: ReturnType<typeof mount>) {
  const method = wrapper.findComponent(ElTreeSelect).props('filterNodeMethod');
  if (typeof method !== 'function') {
    throw new TypeError('树选择器未声明节点过滤方法');
  }
  return method as NodeFilterMethod;
}

describe('部门选择器数据加载', /** 部门数据与拼树决定用户能否按层级找到目标部门。 */ () => {
  it('按接口返回的扁平列表拼出两层部门树', /** 拼树写错会让所有部门平铺，用户无法区分父子关系。 */ async () => {
    const wrapper = await mountDeptSelect();

    const tree = treeData(wrapper);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.name).toBe('DUMMY-研发部');
    expect(tree[0]?.children).toHaveLength(2);
  });

  it('接口失败时降级为空树并留下可诊断记录', /** 接口失败未降级会让表单项永久卡在加载态。 */ async () => {
    vi.mocked(requestClient.get).mockRejectedValue(new Error('部门接口不可用'));

    const wrapper = await mountDeptSelect();

    expect(treeData(wrapper)).toEqual([]);
    expect(spies.logWarn).toHaveBeenCalledWith(
      'form-create:dept-select:load',
      expect.any(Error),
    );
  });

  it('树节点过滤按名称大小写无关匹配，空关键字全部保留', /** 过滤写错会让用户搜不到部门或搜出全部部门。 */ async () => {
    const wrapper = await mountDeptSelect();
    const filter = filterNodeMethod(wrapper);

    expect(filter('', { name: 'DUMMY-研发部' })).toBe(true);
    expect(filter('研发', { name: 'DUMMY-研发部' })).toBe(true);
    expect(filter('duumy', { name: 'DUMMY-研发部' })).toBe(false);
    expect(filter('研发', { name: undefined })).toBe(false);
  });

  it('树选择器回写选中值时同步内部选中状态', /** v-model 回写失效会让界面显示已选但组件内部仍认为未选择。 */ async () => {
    const wrapper = await mountDeptSelect({ modelValue: 1 });
    const treeSelect = wrapper.findComponent(ElTreeSelect);
    expect(treeSelect.props('modelValue')).toBe(1);

    treeSelect.vm.$emit('update:modelValue', 3);
    await wrapper.vm.$nextTick();

    expect(wrapper.findComponent(ElTreeSelect).props('modelValue')).toBe(3);
  });
});

describe('部门选择器返回值口径', /** 返回值口径决定表单收到的是部门主键还是名称，写错会让后端字段解析失败。 */ () => {
  it('主键口径原样交回选中值与清空结果', /** 主键口径被改写会让表单拿到无法识别的值。 */ async () => {
    const wrapper = await mountDeptSelect();
    const treeSelect = wrapper.findComponent(ElTreeSelect);

    treeSelect.vm.$emit('change', 2);
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe(2);

    treeSelect.vm.$emit('change', undefined);
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBeUndefined();
  });

  it('多选模式下清空交回空数组而不是 undefined', /** 交回 undefined 会让多选表单残留上一次的部门。 */ async () => {
    const wrapper = await mountDeptSelect({ multiple: true });

    wrapper.findComponent(ElTreeSelect).vm.$emit('change', undefined);

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual([]);
  });

  it('名称口径把单选取值转换成部门名称', /** 名称口径未转换会让后端收到主键，部门字段落库错误。 */ async () => {
    const wrapper = await mountDeptSelect({ returnType: 'name' });

    wrapper.findComponent(ElTreeSelect).vm.$emit('change', 2);

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe(
      'DUMMY-前端组',
    );
  });

  it('名称口径把多选取值批量转换成部门名称并剔除未命中项', /** 未命中部门混入结果会在名称字段里留下 undefined。 */ async () => {
    const wrapper = await mountDeptSelect({
      multiple: true,
      returnType: 'name',
    });

    wrapper.findComponent(ElTreeSelect).vm.$emit('change', [2, 3, 999]);

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual([
      'DUMMY-前端组',
      'DUMMY-后端组',
    ]);
    expect(spies.logWarn).toHaveBeenCalledWith(
      'form-create:dept-select:missing-dept',
      'Missing department id: 999',
    );
  });

  it('名称口径下取值为空字符串时不做转换', /** 空白取值不得被当成部门主键，否则会查出无关部门。 */ async () => {
    const wrapper = await mountDeptSelect({ returnType: 'name' });

    wrapper.findComponent(ElTreeSelect).vm.$emit('change', '');

    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('名称口径的单选分支不处理数组取值', /** 单选口径收到数组说明调用方用错模式，不能把数组当成主键查询。 */ async () => {
    const wrapper = await mountDeptSelect({ returnType: 'name' });

    wrapper.findComponent(ElTreeSelect).vm.$emit('change', [2]);

    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });
});

describe('部门选择器回显', /** 回显决定打开表单时能否看到已经保存的部门。 */ () => {
  it('主键口径直接把绑定值交给树选择器', /** 回显丢失会让已保存的部门在表单里显示为空。 */ async () => {
    const wrapper = await mountDeptSelect({ modelValue: 2 });

    expect(wrapper.findComponent(ElTreeSelect).props('modelValue')).toBe(2);
  });

  it('多选空值回显为空数组，单选空值回显为 undefined', /** 空值口径写反会让选择器显示出多余的空白标签。 */ async () => {
    const multiWrapper = await mountDeptSelect({ modelValue: null });
    const singleWrapper = await mountDeptSelect({
      modelValue: null,
      multiple: true,
    });

    expect(multiWrapper.findComponent(ElTreeSelect).props('modelValue')).toBe(
      undefined,
    );
    expect(
      singleWrapper.findComponent(ElTreeSelect).props('modelValue'),
    ).toEqual([]);
  });

  it('名称口径在部门列表加载完成后把名称回显为主键', /** 加载完成后未重新同步会让名称口径的已保存值一直显示为空。 */ async () => {
    const wrapper = await mountDeptSelect({
      modelValue: 'DUMMY-后端组',
      returnType: 'name',
    });

    expect(wrapper.findComponent(ElTreeSelect).props('modelValue')).toBe(3);
  });

  it('名称口径多选回显剔除未命中的名称', /** 未命中名称若不剔除会在树选择器里留下无法解析的占位项。 */ async () => {
    const wrapper = await mountDeptSelect({
      modelValue: ['DUMMY-前端组', 'DUMMY-不存在'],
      multiple: true,
      returnType: 'name',
    });

    expect(wrapper.findComponent(ElTreeSelect).props('modelValue')).toEqual([
      2,
    ]);
  });

  it('名称口径的单选回显忽略非字符串取值', /** 名称口径收到数字说明调用方用错口径，不能把它当成名称查询。 */ async () => {
    const wrapper = await mountDeptSelect({
      modelValue: 2,
      returnType: 'name',
    });

    expect(wrapper.findComponent(ElTreeSelect).props('modelValue')).toBe(
      undefined,
    );
  });
});

describe('部门选择器默认当前部门', /** 默认值决定新建表单时是否预填当前用户所在部门。 */ () => {
  it('开启默认当前部门且调用方未预设值时交回用户部门主键', /** 默认值缺失会让用户每次都要手动选一遍自己的部门。 */ async () => {
    useUserStore().setUserInfo({
      avatar: '',
      deptId: 3,
      nickname: '测试员',
      userId: 'U1',
      username: 'tester',
    });

    const wrapper = await mountDeptSelect({ defaultCurrentDept: true });

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe(3);
  });

  it('多选模式下默认当前部门交回数组', /** 多选多选口径写成裸主键会破坏表单的数组契约。 */ async () => {
    useUserStore().setUserInfo({
      avatar: '',
      deptId: 3,
      nickname: '测试员',
      userId: 'U1',
      username: 'tester',
    });

    const wrapper = await mountDeptSelect({
      defaultCurrentDept: true,
      multiple: true,
    });

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual([3]);
  });

  it('调用方已预设值时默认值不覆盖', /** 预设值优先级写反会覆盖调用方设置的部门。 */ async () => {
    useUserStore().setUserInfo({
      avatar: '',
      deptId: 3,
      nickname: '测试员',
      userId: 'U1',
      username: 'tester',
    });

    const wrapper = await mountDeptSelect({
      defaultCurrentDept: true,
      modelValue: 1,
    });

    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('预设空数组不算有效预设值，仍按当前部门补默认值', /** 空数组被当成有效预设会让默认部门失效。 */ async () => {
    useUserStore().setUserInfo({
      avatar: '',
      deptId: 2,
      nickname: '测试员',
      userId: 'U1',
      username: 'tester',
    });

    const wrapper = await mountDeptSelect({
      defaultCurrentDept: true,
      modelValue: [],
      multiple: true,
    });

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual([2]);
  });

  it('用户没有部门或部门为 0 时不设置默认值', /** 空部门被当成主键会让表单提交一个不存在的部门。 */ async () => {
    const noDeptWrapper = await mountDeptSelect({ defaultCurrentDept: true });
    expect(noDeptWrapper.emitted('update:modelValue')).toBeUndefined();

    useUserStore().setUserInfo({
      avatar: '',
      deptId: 0,
      nickname: '测试员',
      userId: 'U1',
      username: 'tester',
    });
    const zeroDeptWrapper = await mountDeptSelect({ defaultCurrentDept: true });
    expect(zeroDeptWrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('未开启默认当前部门时即使没有预设值也不补默认值', /** 未开启却补默认值会让调用方拿到意料之外的部门。 */ async () => {
    useUserStore().setUserInfo({
      avatar: '',
      deptId: 3,
      nickname: '测试员',
      userId: 'U1',
      username: 'tester',
    });

    const wrapper = await mountDeptSelect();

    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });
});
