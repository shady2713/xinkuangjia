/**
 * 列表页增删改动作 composable（composables/use-crud-actions）真实行为回归。
 *
 * 全站 CRUD 列表页都用它串起勾选、单条删除、批量删除与新增/编辑弹窗：
 * - 删除前校验（beforeDelete）返回 false 时必须放弃删除，否则会绕过业务确认改坏数据；
 * - 批量删除失败必须回显后端错误并保留勾选，静默吞错会让用户以为已经删掉；
 * - 无论成功还是失败都必须关闭加载遮罩，否则页面永久停在加载态；
 * - 勾选同步必须剔除 undefined/null/空串/NaN 行键，否则会向后端发出指向空目标的请求；
 * - 新增入口在没有初始值时必须把弹窗行数据置空，否则会复用上一次编辑的残留数据。
 * 用例只替换提示、加载遮罩、翻译与弹窗边界，composable 自身分支保持真实实现。
 */
import { ElLoading, ElMessage, ElMessageBox } from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { showError, showSuccessMessage } from '#/utils/feedback';

import {
  useCrudActions,
  useCrudDeleteActions,
  useCrudItemActions,
} from './use-crud-actions';

/** 行夹具：删除与编辑都以该行的主键定位后端记录。 */
interface Row {
  /** 后端主键。 */
  id: number;
  /** 删除提示中展示的业务名称。 */
  name: string;
}

/** 删除动作用例可覆盖的字段：未覆盖的字段使用工厂给出的安全替身。 */
interface DeleteActionOverrides {
  /** 批量删除接口替身，接收勾选到的主键列表。 */
  batchDeleteApi?: (ids: number[]) => Promise<unknown>;
  /** 删除前的业务校验，返回 false 时放弃删除。 */
  beforeDelete?: (row: Row) => boolean | Promise<boolean>;
  /** 单条删除接口替身。 */
  deleteApi?: (id: number) => Promise<unknown>;
  /** 删除提示中展示的名称取值。 */
  getDeleteName?: (row: Row) => string;
  /** 取行唯一标识的函数。 */
  getRowKey?: (row: Row) => number;
  /** 删除成功后的刷新回调。 */
  refresh?: () => void;
}

/** 弹窗 API 替身契约：真实 composable 通过 setData 后链式调用 open。 */
interface ModalApiStub {
  /** 打开弹窗，用例只统计打开次数。 */
  open: () => void;
  /**
   * 记录弹窗当前操作的行数据。
   * @param row 当前行数据；新增时为 null。
   * @returns 弹窗 API 自身，支持链式 open。
   */
  setData: (row: null | Row) => ModalApiStub;
}

/** 弹窗替身的可观察状态：打开次数与每次设置的行数据。 */
interface ModalProbe {
  /** 记录弹窗被打开的次数。 */
  opened: number;
  /** 按调用顺序记录 setData 收到的行数据。 */
  rows: Array<null | Row>;
}

/** 加载遮罩替身实例；单条与批量删除结束后都必须关闭它。 */
const loadingProbe = vi.hoisted(
  /** 建立可断言的加载遮罩实例。 */ () => ({ close: vi.fn() }),
);

vi.mock(
  'element-plus',
  /** 只替换提示与加载遮罩的展示边界，composable 自身的调用时机与顺序保持真实实现。 */ () => ({
    ElLoading: {
      /**
       * 记录加载遮罩文案并返回可断言的实例。
       * @param options 加载遮罩配置。
       * @returns 只记录关闭调用的遮罩实例。
       */
      service: vi.fn(
        /** 返回只记录关闭调用的遮罩实例；遮罩文案由用例单独断言。 */ () =>
          loadingProbe,
      ),
    },
    ElMessage: { warning: vi.fn() },
    ElMessageBox: { confirm: vi.fn() },
  }),
);

vi.mock(
  '#/locales',
  /** 只替换翻译边界，便于核对 composable 请求的语言键与占位参数。 */ () => ({
    /**
     * 把语言键与占位参数拼成可预期的译文。
     * @param key 组件请求的语言键。
     * @param args 语言键的可选占位参数。
     * @returns 带参数时拼接参数，否则回显键名。
     */
    $t: (key: string, args?: string[]) =>
      args ? `${key}(${args.join('/')})` : key,
  }),
);

vi.mock(
  '#/utils/feedback',
  /** 只替换消息展示边界，便于断言成功与失败提示收到的真实参数。 */ () => ({
    showError: vi.fn(),
    showSuccessMessage: vi.fn(),
  }),
);

/**
 * 组装删除动作配置：默认使用不会失败的替身，用例只覆盖自己关心的字段。
 * @param overrides 本用例要覆盖的字段。
 * @returns 可直接交给 useCrudDeleteActions 的配置。
 */
function deleteActionOptions(overrides: DeleteActionOverrides = {}) {
  return {
    /** 默认批量删除接口：只验证勾选与提示的用例不会走到这里。 */
    batchDeleteApi: async () => true,
    /** 默认单条删除接口。 */
    deleteApi: async () => true,
    /** 默认取行主键函数，与全站列表页一致地使用 id。 */
    getRowKey: (row: Row) => row.id,
    /** 默认刷新回调：只有断言刷新的用例才覆盖它。 */
    refresh: () => {},
    ...overrides,
  };
}

/**
 * 建立链式弹窗替身，记录打开次数与每次设置的行数据。
 * @returns 弹窗 API 替身与它的可观察状态。
 */
function createModalApi() {
  /** 记录打开次数与 setData 入参，供用例断言新增与编辑的差异。 */
  const probe: ModalProbe = { opened: 0, rows: [] };
  /** 链式弹窗替身；setData 返回自身以支持 .open()。 */
  const api: ModalApiStub = {
    /** 记录一次弹窗打开。 */
    open: () => {
      probe.opened += 1;
    },
    /**
     * 记录设置的行数据并返回自身。
     * @param row 当前行数据；新增时由调用方传 null。
     * @returns 弹窗 API 自身，支持链式调用。
     */
    setData: (row) => {
      probe.rows.push(row);
      return api;
    },
  };
  return { api, probe };
}

/**
 * 让二次确认按“用户确认”返回。
 *
 * element-plus 的 MessageBoxData 是对象与字符串字面量的交叉类型，无法构造合法值；
 * composable 只区分确认与取消两个分支，因此这里给出等价载荷的类型断言。
 */
function resolveConfirm() {
  vi.mocked(ElMessageBox.confirm).mockResolvedValue({
    action: 'confirm',
    value: '',
  } as never);
}

beforeEach(
  /** 清空替身调用与遮罩状态，避免上一例的调用次数影响断言。 */ () => {
    vi.clearAllMocks();
  },
);

describe('单条删除', /** beforeDelete 是业务确认关口，删除失败还必须关闭加载遮罩。 */ () => {
  it('删除前校验返回 false 时放弃删除', /** 忽略校验结果会删掉业务上不允许删除的记录。 */ async () => {
    const beforeDelete = vi.fn(
      /** 模拟业务校验拒绝本次删除。 */ async () => false,
    );
    const deleteApi = vi.fn();
    const refresh = vi.fn();
    const { handleDelete } = useCrudDeleteActions<Row, number>(
      deleteActionOptions({ beforeDelete, deleteApi, refresh }),
    );

    await handleDelete({ id: 7, name: '授权角色' });

    expect(beforeDelete).toHaveBeenCalledWith({ id: 7, name: '授权角色' });
    expect(deleteApi).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(vi.mocked(ElLoading.service)).not.toHaveBeenCalled();
  });

  it('删除前校验通过时按行键删除、提示并刷新', /** 校验通过后仍不删除会让按钮形同失效，不刷新会停留在已删除数据上。 */ async () => {
    const deleteApi = vi.fn(/** 模拟后端删除成功。 */ async () => true);
    const refresh = vi.fn();
    const { handleDelete } = useCrudDeleteActions<Row, number>(
      deleteActionOptions({
        /** 模拟业务校验放行。 */
        beforeDelete: async () => true,
        deleteApi,
        /** 提示中展示行的业务名称。 */
        getDeleteName: (row) => row.name,
        refresh,
      }),
    );

    await handleDelete({ id: 9, name: '授权角色' });

    expect(vi.mocked(ElLoading.service)).toHaveBeenCalledWith({
      text: 'ui.actionMessage.deleting(授权角色)',
    });
    expect(deleteApi).toHaveBeenCalledWith(9);
    expect(showSuccessMessage).toHaveBeenCalledWith(
      'ui.actionMessage.deleteSuccess(授权角色)',
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(loadingProbe.close).toHaveBeenCalledTimes(1);
  });

  it('未声明名称取值时使用无名称的删除成功文案', /** 拼接空名称会得到带空括号的文案，用户看到残句。 */ async () => {
    const { handleDelete } = useCrudDeleteActions<Row, number>(
      deleteActionOptions(),
    );

    await handleDelete({ id: 11, name: '未命名' });

    expect(vi.mocked(ElLoading.service)).toHaveBeenCalledWith({
      text: 'ui.actionMessage.deleting()',
    });
    expect(showSuccessMessage).toHaveBeenCalledWith(
      'ui.actionMessage.deleteSuccess',
    );
  });
});

describe('勾选同步', /** 勾选状态决定批量删除的目标，脏行键会发出指向空目标的请求。 */ () => {
  it('剔除没有可用主键的行', /** undefined/null/空串/NaN 行键会拼出无效删除请求。 */ () => {
    const { checkedIds, handleRowCheckboxChange } = useCrudDeleteActions<
      { id: number | string | undefined },
      number
    >({
      /** 本用例不触发批量删除。 */
      batchDeleteApi: async () => true,
      /** 本用例不触发单条删除。 */
      deleteApi: async () => true,
      /** 允许空串或 NaN 表示该行没有可用主键。 */
      getRowKey: (row) =>
        row.id === undefined || row.id === '' ? Number.NaN : Number(row.id),
      /** 本用例不触发刷新。 */
      refresh: () => {},
    });

    handleRowCheckboxChange({
      records: [{ id: 1 }, { id: undefined }, { id: '' }, { id: 2 }],
    });

    expect(checkedIds.value).toEqual([1, 2]);
  });

  it('清空勾选与默认表格事件绑定', /** 查询后不清空勾选会把上一页的选择带到下一次批量删除。 */ () => {
    const { checkedIds, clearCheckedIds, getGridEvents } = useCrudDeleteActions<
      Row,
      number
    >(deleteActionOptions());
    /** 调用方覆盖的查询后处理。 */
    const customQuery = () => {};

    checkedIds.value = [1, 2];
    clearCheckedIds();
    expect(checkedIds.value).toEqual([]);

    const events = getGridEvents({ proxyQuery: customQuery });
    expect(events.proxyQuery).toBe(customQuery);
    expect(events.checkboxAll).toBe(events.checkboxChange);
    expect(typeof events.checkboxAll).toBe('function');
  });
});

describe('批量删除', /** 二次确认、失败回显与勾选保留直接决定用户数据是否被误删。 */ () => {
  it('未勾选时只给出提示且不打开确认框', /** 没有勾选仍弹确认框会让用户以为是可删除的空批次。 */ async () => {
    const { handleDeleteBatch } = useCrudDeleteActions<Row, number>(
      deleteActionOptions(),
    );

    await handleDeleteBatch();

    expect(vi.mocked(ElMessage.warning)).toHaveBeenCalledWith(
      '请选择要删除的数据',
    );
    expect(vi.mocked(ElMessageBox.confirm)).not.toHaveBeenCalled();
  });

  it('用户取消二次确认时不发起批量删除', /** 取消后仍删除会直接丢失数据。 */ async () => {
    const batchDeleteApi = vi.fn();
    const { checkedIds, handleDeleteBatch } = useCrudDeleteActions<Row, number>(
      deleteActionOptions({ batchDeleteApi }),
    );
    vi.mocked(ElMessageBox.confirm).mockRejectedValue(new Error('用户取消'));
    checkedIds.value = [3];

    await handleDeleteBatch();

    expect(vi.mocked(ElMessageBox.confirm)).toHaveBeenCalledWith(
      'ui.actionMessage.deleteBatchConfirm',
      {
        cancelButtonText: 'common.cancel',
        confirmButtonText: 'common.confirm',
        type: 'warning',
      },
    );
    expect(batchDeleteApi).not.toHaveBeenCalled();
    expect(checkedIds.value).toEqual([3]);
  });

  it('批量删除成功后清空勾选并刷新', /** 未清空会让用户重复提交同一批主键。 */ async () => {
    const batchDeleteApi = vi.fn(
      /** 模拟后端批量删除成功。 */ async () => true,
    );
    const refresh = vi.fn();
    const { checkedIds, handleDeleteBatch } = useCrudDeleteActions<Row, number>(
      deleteActionOptions({ batchDeleteApi, refresh }),
    );
    resolveConfirm();
    checkedIds.value = [4, 5];

    await handleDeleteBatch();

    expect(vi.mocked(ElLoading.service)).toHaveBeenCalledWith({
      text: 'ui.actionMessage.deletingBatch',
    });
    expect(batchDeleteApi).toHaveBeenCalledWith([4, 5]);
    expect(showSuccessMessage).toHaveBeenCalledWith(
      'ui.actionMessage.deleteSuccess()',
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(checkedIds.value).toEqual([]);
    expect(loadingProbe.close).toHaveBeenCalledTimes(1);
  });

  it('批量删除失败时回显后端错误并保留勾选', /** 吞掉错误会让用户以为已删除，清空勾选会让用户无法直接重试。 */ async () => {
    const failure = new Error('后端拒绝批量删除');
    const batchDeleteApi = vi.fn(
      /** 模拟后端拒绝本次批量删除。 */ async () => {
        throw failure;
      },
    );
    const refresh = vi.fn();
    const { checkedIds, handleDeleteBatch } = useCrudDeleteActions<Row, number>(
      deleteActionOptions({ batchDeleteApi, refresh }),
    );
    resolveConfirm();
    checkedIds.value = [6];

    await handleDeleteBatch();

    expect(showError).toHaveBeenCalledWith(
      failure,
      'ui.actionMessage.deleteFailed()',
    );
    expect(showSuccessMessage).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(checkedIds.value).toEqual([6]);
    expect(loadingProbe.close).toHaveBeenCalledTimes(1);
  });
});

describe('单条增删改动作', /** 新增与编辑必须把正确的行数据交给弹窗，否则会改错记录。 */ () => {
  it('新增时把初始值交给弹窗并打开', /** 初始值丢失会让新增表单缺少业务默认值。 */ () => {
    const { api, probe } = createModalApi();
    const { handleCreate } = useCrudItemActions<Row, number>({
      /** 提供新增行初始值。 */
      createData: () => ({ id: 0, name: '默认角色' }),
      ...deleteActionOptions(),
      modalApi: api,
    });

    handleCreate();

    expect(probe.rows).toEqual([{ id: 0, name: '默认角色' }]);
    expect(probe.opened).toBe(1);
  });

  it('新增初始值返回空时把弹窗行数据置空', /** 假值原样传给弹窗会让表单读到非对象值。 */ () => {
    const { api, probe } = createModalApi();
    const { handleCreate } = useCrudItemActions<Row, number>({
      /** 模拟调用方没有可用的初始值。 */
      createData: () => null,
      ...deleteActionOptions(),
      modalApi: api,
    });

    handleCreate();

    expect(probe.rows).toEqual([null]);
  });

  it('未提供新增初始值时把弹窗行数据置空', /** 不置空会复用上一次编辑的残留行数据。 */ () => {
    const { api, probe } = createModalApi();
    const { handleCreate } = useCrudItemActions<Row, number>({
      ...deleteActionOptions(),
      modalApi: api,
    });

    handleCreate();

    expect(probe.rows).toEqual([null]);
    expect(probe.opened).toBe(1);
  });

  it('编辑时把当前行交给弹窗并打开', /** 编辑传入错误行会改坏其它记录。 */ () => {
    const { api, probe } = createModalApi();
    const { handleEdit } = useCrudItemActions<Row, number>({
      ...deleteActionOptions(),
      modalApi: api,
    });

    handleEdit({ id: 12, name: '运营角色' });

    expect(probe.rows).toEqual([{ id: 12, name: '运营角色' }]);
    expect(probe.opened).toBe(1);
  });

  it('单条动作的删除沿用删除前校验', /** 弹窗列表页同样不能绕过业务校验删除记录。 */ async () => {
    const deleteApi = vi.fn();
    const { api } = createModalApi();
    const { handleDelete } = useCrudItemActions<Row, number>({
      ...deleteActionOptions({
        /** 模拟业务校验拒绝本次删除。 */
        beforeDelete: async () => false,
        deleteApi,
      }),
      modalApi: api,
    });

    await handleDelete({ id: 13, name: '只读角色' });

    expect(deleteApi).not.toHaveBeenCalled();
  });
});

describe('完整增删改动作', /** 该入口额外提供未指定行键时的兜底与新增入口。 */ () => {
  it('未指定行键时以行的 id 作为批量删除主键', /** 兜底取错字段会把无效主键发给后端。 */ () => {
    const { checkedIds, handleRowCheckboxChange } = useCrudActions<Row, number>(
      {
        ...deleteActionOptions(),
        modalApi: createModalApi().api,
      },
    );

    handleRowCheckboxChange({ records: [{ id: 21, name: '角色 A' }] });

    expect(checkedIds.value).toEqual([21]);
  });

  it('新增入口未提供初始值时把弹窗行数据置空', /** 复用残留行数据会让新增表单带出上一条记录。 */ () => {
    const { api, probe } = createModalApi();
    const { handleCreate } = useCrudActions<Row, number>({
      ...deleteActionOptions(),
      modalApi: api,
    });

    handleCreate();

    expect(probe.rows).toEqual([null]);
    expect(probe.opened).toBe(1);
  });

  it('编辑入口把当前行交给弹窗并打开', /** 编辑入口若丢失行数据会让弹窗以空表单打开。 */ () => {
    const { api, probe } = createModalApi();
    const { handleEdit } = useCrudActions<Row, number>({
      ...deleteActionOptions(),
      modalApi: api,
    });

    handleEdit({ id: 31, name: '审计角色' });

    expect(probe.rows).toEqual([{ id: 31, name: '审计角色' }]);
  });
});
