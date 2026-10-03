import type { Ref } from 'vue';

import { ref } from 'vue';

import { ElLoading, ElMessage, ElMessageBox } from 'element-plus';

import { $t } from '#/locales';
import { showError, showSuccessMessage } from '#/utils/feedback';

type RowKey = number | string;

type RowWithId<Id extends RowKey = number> = {
  id?: Id;
};

type ModalApi<Row> = {
  open: () => unknown;
  /**
   * 设置弹窗当前操作的行；传 null 表示新增，此时不携带既有数据。
   * @param data 当前行数据，新增时为 null。
   * @returns 弹窗 API 本身，便于链式调用。
   */
  setData: (data: null | Row) => ModalApi<Row>;
};

type DeleteOptions<Row, Id extends RowKey> = {
  beforeDelete?: (row: Row) => boolean | Promise<boolean>;
  deleteApi: (id: Id) => Promise<unknown>;
  getDeleteName?: (row: Row) => string;
  getRowKey: (row: Row) => Id;
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

type UseCrudDeleteActionsOptions<Row, Id extends RowKey> = DeleteOptions<
  Row,
  Id
> & {
  batchDeleteApi: (ids: Id[]) => Promise<unknown>;
};

type UseCrudActionsOptions<
  Row extends RowWithId<Id>,
  Id extends RowKey = number,
> = {
  /**
   * 新增时的初始行数据；不提供时弹窗以空表单打开。
   * @returns 交给新增表单的初始值。
   */
  createData?: () => null | Row;
  getRowKey?: (row: Row) => Id;
  modalApi: ModalApi<Row>;
} & Omit<UseCrudDeleteActionsOptions<Row, Id>, 'getRowKey'>;

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

  async function handleDelete(row: Row) {
    await deleteRow({ ...options, row });
  }

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

export function useCrudItemActions<Row, Id extends RowKey = number>(
  options: UseCrudItemActionsOptions<Row, Id>,
) {
  const { createData, modalApi } = options;

  async function handleDelete(row: Row) {
    await deleteRow({ ...options, row });
  }

  function handleCreate() {
    modalApi.setData(createData?.() || null).open();
  }

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

  function handleCreate() {
    modalApi.setData(createData?.() || null).open();
  }

  function handleEdit(row: Row) {
    modalApi.setData(row).open();
  }

  return {
    ...deleteActions,
    handleCreate,
    handleEdit,
  };
}
