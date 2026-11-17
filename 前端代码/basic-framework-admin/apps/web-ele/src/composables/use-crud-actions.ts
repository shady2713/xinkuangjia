import type { Ref } from 'vue';

import { ref } from 'vue';

import { ElLoading, ElMessage, ElMessageBox } from 'element-plus';

import { $t } from '#/locales';
import { showError, showSuccessMessage } from '#/utils/feedback';

type RowKey = number | string;

type RowWithId<Id extends RowKey = number> = {
  id?: Id;
};

/** 弹窗 API：写入当前行数据并打开表单。 */
type ModalApi<Row> = {
  /** 打开弹窗。 */
  open: () => unknown;
  /** 写入当前行数据；传入 null 表示进入新增。 */
  setData: (data: null | Row) => ModalApi<Row>;
};

type DeleteOptions<Row, Id extends RowKey> = {
  beforeDelete?: (row: Row) => boolean | Promise<boolean>;
  deleteApi: (id: Id) => Promise<unknown>;
  getDeleteName?: (row: Row) => string;
  getRowKey: (row: Row) => Id;
  refresh: () => void;
};

/** 单行新增/编辑/删除操作所需的接口与弹窗配置。 */
type UseCrudItemActionsOptions<Row, Id extends RowKey> = {
  /** 打开新增弹窗时使用的空行数据工厂。 */
  createData?: () => null | Row;
  modalApi: ModalApi<Row>;
} & DeleteOptions<Row, Id>;

type UseCrudDeleteActionsOptions<Row, Id extends RowKey> = DeleteOptions<
  Row,
  Id
> & {
  batchDeleteApi: (ids: Id[]) => Promise<unknown>;
};

/** 含批量删除的完整 CRUD 操作配置；行主键读取函数可省略。 */
type UseCrudActionsOptions<
  Row extends RowWithId<Id>,
  Id extends RowKey = number,
> = {
  /** 打开新增弹窗时使用的空行数据工厂。 */
  createData?: () => null | Row;
  /** 从行数据读取主键；缺省时使用行的 id 字段。 */
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

  function handleRowCheckboxChange({ records }: { records: Row[] }) {
    checkedIds.value = records
      .map((item) => getRowKey(item))
      .filter((id) => id !== undefined && id !== null && String(id) !== '');
  }

  function clearCheckedIds() {
    checkedIds.value = [];
  }

  function getGridEvents(extraEvents: Record<string, any> = {}) {
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
 * 组合新增、编辑与删除操作，供列表页复用。
 * @param options CRUD 接口、弹窗和刷新回调
 * @returns 打开新增/编辑弹窗以及删除相关处理函数
 */
export function useCrudActions<
  Row extends RowWithId<Id>,
  Id extends RowKey = number,
>(options: UseCrudActionsOptions<Row, Id>) {
  const {
    batchDeleteApi,
    beforeDelete,
    createData,
    deleteApi,
    getDeleteName,
    getRowKey,
    modalApi,
    refresh,
  } = options;
  /** 缺省主键读取：使用行上的 id 字段。 */
  function defaultGetRowKey(row: Row): Id {
    return row.id as Id;
  }
  const deleteActions = useCrudDeleteActions<Row, Id>({
    batchDeleteApi,
    beforeDelete,
    deleteApi,
    getDeleteName,
    getRowKey: getRowKey || defaultGetRowKey,
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
