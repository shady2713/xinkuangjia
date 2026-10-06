/**
 * 列表页增删改动作组合式函数：把二次确认、Loading、成功提示与刷新
 * 收敛成批量删除、单条增删改与两者合并三档，供表格操作列直接绑定。
 * 只编排动作与勾选状态，接口调用、弹窗与列表查询由调用页提供。
 */
import type { Ref } from 'vue';

import { ref } from 'vue';

import { ElLoading, ElMessage, ElMessageBox } from 'element-plus';

import { $t } from '#/locales';
import { showError, showSuccessMessage } from '#/utils/feedback';

/** 行唯一标识允许的类型：后端主键可能是数字 id，也可能是字符串编码。 */
type RowKey = number | string;

/** 至少带一个主键字段的行数据；主键缺失的行无法定位后端记录，不参与勾选与删除。 */
type RowWithId<Id extends RowKey = number> = {
  id?: Id;
};

/** 新增与编辑弹窗对外暴露的最小接口，只保留动作层需要的两个入口。 */
type ModalApi<Row> = {
  /** 打开弹窗；本次是新增还是编辑由先前 setData 传入的数据决定。 */
  open: () => unknown;
  /**
   * 设置弹窗当前操作的行；传 null 表示新增，此时不携带既有数据。
   * @param data 当前行数据，新增时为 null。
   * @returns 弹窗 API 本身，便于链式调用。
   */
  setData: (data: null | Row) => ModalApi<Row>;
};

/** 删除动作的接口与行键配置，单条删除和批量删除共用这一份契约。 */
type DeleteOptions<Row, Id extends RowKey> = {
  /** 删除前的额外校验；返回 false（或兑现为 false）时放弃本次删除，不调用删除接口。 */
  beforeDelete?: (row: Row) => boolean | Promise<boolean>;
  /** 单条删除接口，按行键删除后端记录；失败时由调用方决定提示方式。 */
  deleteApi: (id: Id) => Promise<unknown>;
  /** 取该行用于提示文案的名称；不提供时退化为不带名称的通用文案。 */
  getDeleteName?: (row: Row) => string;
  /** 取行唯一标识，删除接口与批量删除接口都用它定位后端记录。 */
  getRowKey: (row: Row) => Id;
  /** 删除成功后的刷新回调，由调用方接列表查询。 */
  refresh: () => void;
};

/** 单条记录的增删改动作配置：在删除配置之外，额外声明新增时用的初始值。 */
type UseCrudItemActionsOptions<Row, Id extends RowKey> = {
  /**
   * 新增时的初始行数据；不提供时弹窗以空表单打开。
   * @returns 交给新增表单的初始值。
   */
  createData?: () => null | Row;
  modalApi: ModalApi<Row>;
} & DeleteOptions<Row, Id>;

/** 批量删除动作的配置：在删除契约之上补一个批量删除接口。 */
type UseCrudDeleteActionsOptions<Row, Id extends RowKey> = DeleteOptions<
  Row,
  Id
> & {
  /** 批量删除接口，一次接收勾选到的主键列表。 */
  batchDeleteApi: (ids: Id[]) => Promise<unknown>;
};

/** 完整增删改动作的配置：批量删除配置加上可选的行键兜底。 */
type UseCrudActionsOptions<
  Row extends RowWithId<Id>,
  Id extends RowKey = number,
> = {
  /**
   * 新增时的初始行数据；不提供时弹窗以空表单打开。
   * @returns 交给新增表单的初始值。
   */
  createData?: () => null | Row;
  /** 取行唯一标识；不提供时直接取行上的 id，因此只适用于主键必定存在的行类型。 */
  getRowKey?: (row: Row) => Id;
  modalApi: ModalApi<Row>;
} & Omit<UseCrudDeleteActionsOptions<Row, Id>, 'getRowKey'>;

/**
 * 执行单条删除：先交给 beforeDelete 决定是否继续，通过后打开 Loading 调用删除接口，
 * 成功则提示并刷新列表，无论成败最后都关闭 Loading。
 * 删除接口抛出时不吞异常，错误原样传给调用方，由页面决定如何提示。
 * @param context 删除配置与目标行：deleteApi、getRowKey 决定删哪条，getDeleteName 只影响提示文案，
 * `beforeDelete` 返回假值即放弃删除，`row` 为本次操作的行数据。
 * @returns 删除流程结束时兑现的 Promise；被 beforeDelete 拦下时不调用删除接口。
 */
async function deleteRow<Row, Id extends RowKey>({
  beforeDelete,
  deleteApi,
  getDeleteName,
  getRowKey,
  refresh,
  row,
}: DeleteOptions<Row, Id> & { row: Row }) {
  if (beforeDelete && !(await beforeDelete(row))) {
    return;
  }

  const name = getDeleteName?.(row) || '';
  const loadingInstance = ElLoading.service({
    text: $t('ui.actionMessage.deleting', [name]),
  });
  try {
    await deleteApi(getRowKey(row));
    const message = name
      ? $t('ui.actionMessage.deleteSuccess', [name])
      : $t('ui.actionMessage.deleteSuccess');
    showSuccessMessage(message);
    refresh();
  } finally {
    loadingInstance.close();
  }
}

/**
 * 提供列表页的批量删除动作：单条删除、批量删除与勾选状态维护。
 * 删除前统一走二次确认，删除成功后按 refresh 回调刷新列表。
 * @param options 删除相关的接口与行键配置。
 * @returns 勾选状态、删除处理函数与表格事件绑定。
 */
export function useCrudDeleteActions<Row, Id extends RowKey = number>(
  options: UseCrudDeleteActionsOptions<Row, Id>,
) {
  const { batchDeleteApi, getRowKey, refresh } = options;
  const checkedIds = ref<Id[]>([]) as Ref<Id[]>;

  /** 删除指定行：把该行并入删除配置后交给 deleteRow 执行，二次确认由 beforeDelete 负责。 */
  async function handleDelete(row: Row) {
    await deleteRow({ ...options, row });
  }

  /**
   * 批量删除勾选中的行：先剔除无效主键，未勾选时提示并结束；二次确认通过后调用批量删除接口，
   * 成功则清空勾选并刷新列表，失败则提示错误且保留勾选，便于用户重试。
   * 用户在确认框取消时按正常流程结束，不视为失败。
   */
  async function handleDeleteBatch() {
    checkedIds.value = checkedIds.value.filter(
      (id) => id !== undefined && id !== null && String(id) !== '',
    );
    if (checkedIds.value.length === 0) {
      ElMessage.warning('请选择要删除的数据');
      return;
    }

    try {
      await ElMessageBox.confirm($t('ui.actionMessage.deleteBatchConfirm'), {
        confirmButtonText: $t('common.confirm'),
        cancelButtonText: $t('common.cancel'),
        type: 'warning',
      });
    } catch {
      // 用户取消（点击取消 / 关闭对话框 / ESC），按预期直接结束
      return;
    }
    const loadingInstance = ElLoading.service({
      text: $t('ui.actionMessage.deletingBatch'),
    });
    try {
      await batchDeleteApi(checkedIds.value);
      checkedIds.value = [];
      showSuccessMessage($t('ui.actionMessage.deleteSuccess', ['']).trim());
      refresh();
    } catch (error) {
      showError(error, $t('ui.actionMessage.deleteFailed', ['']));
    } finally {
      loadingInstance.close();
    }
  }

  /**
   * 同步表格勾选状态到批量操作的主键列表。
   * @param payload 表格勾选变化事件负载。
   * @param payload.records 本次勾选的全部行，用于推算批量删除所需的主键列表。
   */
  function handleRowCheckboxChange({ records }: { records: Row[] }) {
    checkedIds.value = records
      .map((item) => getRowKey(item))
      // getRowKey 允许用空串或 NaN 表示「该行没有可用主键」（DTO 中 id 为可选字段），
      // 这类行无法定位后端记录，必须在批量删除前剔除，否则会发出指向空目标的请求
      .filter(
        /**
         * 判断主键是否可用于后端请求。
         * @param id getRowKey 的返回值，可能是 undefined、null、空串或 NaN。
         * @returns 主键可用时返回 true。
         */
        (id) =>
          id !== undefined &&
          id !== null &&
          String(id) !== '' &&
          !(typeof id === 'number' && !Number.isFinite(id)),
      );
  }

  /** 清空勾选的主键列表；列表重新查询时由表格事件触发，避免残留上一次的勾选。 */
  function clearCheckedIds() {
    checkedIds.value = [];
  }

  /**
   * 汇总表格要绑定的事件，额外事件排在默认事件之后，可覆盖同名处理器。
   * @param extraEvents 调用方额外补充的表格事件。
   * @returns 交给表格的事件映射。
   */
  function getGridEvents(extraEvents: Record<string, unknown> = {}) {
    return {
      checkboxAll: handleRowCheckboxChange,
      checkboxChange: handleRowCheckboxChange,
      proxyQuery: clearCheckedIds,
      ...extraEvents,
    };
  }

  return {
    checkedIds,
    clearCheckedIds,
    getGridEvents,
    handleDelete,
    handleDeleteBatch,
    handleRowCheckboxChange,
  };
}

/**
 * 提供单条记录的新增、编辑与删除动作，按 modalApi 打开弹窗。
 * 只做动作编排与弹窗调用，接口实现与弹窗内容由调用方通过 options 提供。
 * @param options 单条动作配置：createData 提供新增初始值，modalApi 提供弹窗入口，
 * 其余删除相关字段与批量删除共用同一份契约。
 * @returns 新增、编辑、删除三个处理函数；本身不持有勾选状态。
 */
export function useCrudItemActions<Row, Id extends RowKey = number>(
  options: UseCrudItemActionsOptions<Row, Id>,
) {
  const { createData, modalApi } = options;

  /** 删除指定行：把该行并入删除配置后交给 deleteRow 执行，二次确认由 beforeDelete 负责。 */
  async function handleDelete(row: Row) {
    await deleteRow({ ...options, row });
  }

  /** 新增：以 createData 的结果作为初始值打开弹窗；未配置 createData 时按空表单打开。 */
  function handleCreate() {
    modalApi.setData(createData?.() || null).open();
  }

  /** 编辑：以当前行数据打开弹窗，弹窗据此回填表单。 */
  function handleEdit(row: Row) {
    modalApi.setData(row).open();
  }

  return {
    handleCreate,
    handleDelete,
    handleEdit,
  };
}

/**
 * 列表页的完整增删改动作集合：在批量删除之外补上新增与编辑，
 * 供表格操作列直接绑定，避免各页面重复拼装同样的处理函数。
 * @param options 列表页增删改动作所需的全部配置。
 * @param options.batchDeleteApi 批量删除接口，接收勾选到的主键列表。
 * @param options.beforeDelete 删除前的额外校验，返回 false 时放弃删除。
 * @param options.createData 新增时的初始行数据。
 * @param options.deleteApi 单条删除接口。
 * @param options.getDeleteName 二次确认框中展示的名称。
 * @param options.getRowKey 取行唯一标识的函数。
 * @param options.modalApi 弹窗 API，用于打开新增与编辑弹窗。
 * @param options.refresh 删除或保存成功后刷新列表的回调。
 * @returns 勾选状态、增删改处理函数与表格事件绑定。
 */
export function useCrudActions<
  Row extends RowWithId<Id>,
  Id extends RowKey = number,
>({
  batchDeleteApi,
  beforeDelete,
  createData,
  deleteApi,
  getDeleteName,
  getRowKey,
  modalApi,
  refresh,
}: UseCrudActionsOptions<Row, Id>) {
  /**
   * 调用方未指定行键时的兜底：直接取主键。
   * 这里断言主键存在，是因为要用主键兜底的行类型本身就带 id；
   * 确实没有主键的行不参与勾选与删除，业务上不会出现。
   * @param row 当前行数据。
   * @returns 该行的唯一标识。
   */
  const fallbackRowKey = (row: Row): Id => row.id as Id;

  const deleteActions = useCrudDeleteActions<Row, Id>({
    batchDeleteApi,
    beforeDelete,
    deleteApi,
    getDeleteName,
    getRowKey: getRowKey || fallbackRowKey,
    refresh,
  });

  /** 新增：以 createData 的结果作为初始值打开弹窗；未配置 createData 时按空表单打开。 */
  function handleCreate() {
    modalApi.setData(createData?.() || null).open();
  }

  /** 编辑：以当前行数据打开弹窗，弹窗据此回填表单。 */
  function handleEdit(row: Row) {
    modalApi.setData(row).open();
  }

  return {
    ...deleteActions,
    handleCreate,
    handleEdit,
  };
}
