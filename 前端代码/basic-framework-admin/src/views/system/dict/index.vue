<script setup lang="ts">
/**
 * 字典管理：左右双栏联动（左侧字典类型 + 右侧字典数据）。
 */
import { Delete, Edit, Plus, Search } from '@element-plus/icons-vue';
import {
  ElMessage,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import { onMounted, reactive, ref } from 'vue';

import {
  createDictDataApi,
  createDictTypeApi,
  deleteDictDataApi,
  deleteDictTypeApi,
  type DictDataItem,
  type DictTypeItem,
  getDictDataApi,
  getDictDataPageApi,
  getDictTypeApi,
  getDictTypePageApi,
  updateDictDataApi,
  updateDictTypeApi,
} from '@/api/system/dict';
import DictTag from '@/components/DictTag.vue';
import FormDialog from '@/components/FormDialog.vue';
import ProTable from '@/components/ProTable.vue';
import TableAction from '@/components/TableAction.vue';
import { CommonStatusEnum, DICT_TYPE } from '@/constants/enums';
import {
  deleteConfirmMessage,
  FIELD_LIMITS,
  maxLenRule,
  requiredRule,
} from '@/constants/validation';
import { useDictStore } from '@/stores/dict';
import { getSessionId } from '@/utils/token';

defineOptions({ name: 'SystemDictType' });

const dictStore = useDictStore();

// 左侧：字典类型
const typeLoading = ref(false);
const typeList = ref<DictTypeItem[]>([]);
const typeTotal = ref(0);
const typeQuery = reactive({ pageNo: 1, pageSize: 10, name: '', type: '' });
const selectedType = ref<DictTypeItem | null>(null);

const typeDialogVisible = ref(false);
const typeSubmitting = ref(false);
const typeFormReady = ref(false);
let typeFormLoad = 0;
let typeFormOwner: string | null = null;
const typeFormRef = ref<FormInstance>();
const typeForm = reactive({
  id: undefined as number | string | undefined,
  name: '',
  type: '',
  status: CommonStatusEnum.ENABLE as number,
  remark: '',
});
const typeFormRules: FormRules = {
  name: [requiredRule('字典名称'), maxLenRule('字典名称', FIELD_LIMITS.DICT_NAME)],
  type: [requiredRule('字典类型'), maxLenRule('字典类型', FIELD_LIMITS.DICT_TYPE)],
  remark: [maxLenRule('备注', FIELD_LIMITS.REMARK)],
};

// 右侧：字典数据
const dataLoading = ref(false);
const dataList = ref<DictDataItem[]>([]);
const dataTotal = ref(0);
const dataQuery = reactive({ pageNo: 1, pageSize: 10, label: '' });

const dataDialogVisible = ref(false);
const dataSubmitting = ref(false);
const dataFormReady = ref(false);
let dataFormLoad = 0;
let dataFormOwner: string | null = null;
const dataFormRef = ref<FormInstance>();
const dataForm = reactive({
  id: undefined as number | string | undefined,
  dictType: '',
  label: '',
  value: '',
  sort: 0,
  status: CommonStatusEnum.ENABLE as number,
  colorType: 'primary',
  cssClass: '',
  remark: '',
});
const dataFormRules: FormRules = {
  label: [requiredRule('数据标签'), maxLenRule('数据标签', FIELD_LIMITS.DICT_LABEL)],
  value: [requiredRule('数据键值'), maxLenRule('数据键值', FIELD_LIMITS.DICT_VALUE)],
  remark: [maxLenRule('备注', FIELD_LIMITS.REMARK)],
};

async function loadTypes() {
  typeLoading.value = true;
  try {
    const res = await getDictTypePageApi({
      pageNo: typeQuery.pageNo,
      pageSize: typeQuery.pageSize,
      name: typeQuery.name.trim() || undefined,
      type: typeQuery.type.trim() || undefined,
    });
    typeList.value = res.list ?? [];
    typeTotal.value = res.total ?? 0;
    if (!selectedType.value && typeList.value.length > 0) {
      selectTypeRow(typeList.value[0]);
    }
  } finally {
    typeLoading.value = false;
  }
}

function resetTypeSearch() {
  typeQuery.name = '';
  typeQuery.type = '';
  typeQuery.pageNo = 1;
  void loadTypes();
}

function selectTypeRow(row: DictTypeItem) {
  selectedType.value = row;
  dataQuery.pageNo = 1;
  void loadDataList();
}

async function loadDataList() {
  if (!selectedType.value?.type) {
    dataList.value = [];
    dataTotal.value = 0;
    return;
  }
  dataLoading.value = true;
  try {
    const res = await getDictDataPageApi({
      pageNo: dataQuery.pageNo,
      pageSize: dataQuery.pageSize,
      dictType: selectedType.value.type,
      label: dataQuery.label.trim() || undefined,
    });
    dataList.value = res.list ?? [];
    dataTotal.value = res.total ?? 0;
  } finally {
    dataLoading.value = false;
  }
}

function resetDataSearch() {
  dataQuery.label = '';
  dataQuery.pageNo = 1;
  void loadDataList();
}

async function openTypeForm(row?: DictTypeItem) {
  if (typeSubmitting.value) return;
  const load = ++typeFormLoad;
  const owner = getSessionId();
  typeFormOwner = owner;
  typeFormReady.value = !row?.id;
  Object.assign(typeForm, {
    id: row?.id,
    name: '',
    type: '',
    status: CommonStatusEnum.ENABLE,
    remark: '',
  });
  typeDialogVisible.value = true;
  if (row?.id) {
    const detail = await getDictTypeApi(row.id);
    if (load !== typeFormLoad || !typeDialogVisible.value || !owner || getSessionId() !== owner) return;
    Object.assign(typeForm, {
      id: detail.id,
      name: detail.name,
      type: detail.type,
      status: detail.status ?? CommonStatusEnum.ENABLE,
      remark: detail.remark || '',
    });
    typeFormReady.value = true;
  }
}

async function submitTypeForm() {
  if (!typeFormReady.value || typeSubmitting.value || getSessionId() !== typeFormOwner) return;
  const valid = await typeFormRef.value?.validate().catch(() => false);
  if (!valid) return;
  typeSubmitting.value = true;
  try {
    const payload = {
      ...typeForm,
      name: typeForm.name.trim(),
      type: typeForm.type.trim(),
      remark: typeForm.remark.trim() || undefined,
    };
    if (typeForm.id) {
      await updateDictTypeApi(payload);
    } else {
      await createDictTypeApi(payload);
    }
    ElMessage.success(typeForm.id ? '修改成功' : '新增成功');
    typeDialogVisible.value = false;
    await loadTypes();
  } finally {
    typeSubmitting.value = false;
  }
}

async function deleteType(row: DictTypeItem) {
  await deleteDictTypeApi(row.id);
  ElMessage.success('删除成功');
  if (selectedType.value?.id === row.id) {
    selectedType.value = null;
  }
  await loadTypes();
}

async function openDataForm(row?: DictDataItem) {
  if (!selectedType.value?.type) {
    ElMessage.warning('请先在左侧选择字典类型');
    return;
  }
  if (dataSubmitting.value) return;
  const load = ++dataFormLoad;
  const owner = getSessionId();
  dataFormOwner = owner;
  dataFormReady.value = !row?.id;
  Object.assign(dataForm, {
    id: row?.id,
    dictType: selectedType.value.type,
    label: '',
    value: '',
    sort: 0,
    status: CommonStatusEnum.ENABLE,
    colorType: 'primary',
    cssClass: '',
    remark: '',
  });
  dataDialogVisible.value = true;
  if (row?.id) {
    const detail = await getDictDataApi(row.id);
    if (load !== dataFormLoad || !dataDialogVisible.value || !owner || getSessionId() !== owner) return;
    Object.assign(dataForm, {
      id: detail.id,
      dictType: detail.dictType,
      label: detail.label,
      value: detail.value,
      sort: detail.sort ?? 0,
      status: detail.status ?? CommonStatusEnum.ENABLE,
      colorType: detail.colorType || 'primary',
      cssClass: detail.cssClass || '',
      remark: detail.remark || '',
    });
    dataFormReady.value = true;
  }
}

async function submitDataForm() {
  if (!dataFormReady.value || dataSubmitting.value || getSessionId() !== dataFormOwner) return;
  const valid = await dataFormRef.value?.validate().catch(() => false);
  if (!valid) return;
  dataSubmitting.value = true;
  try {
    const payload = {
      ...dataForm,
      label: dataForm.label.trim(),
      value: dataForm.value.trim(),
      remark: dataForm.remark.trim() || undefined,
    };
    if (dataForm.id) {
      await updateDictDataApi(payload);
    } else {
      await createDictDataApi(payload);
    }
    ElMessage.success(dataForm.id ? '修改成功' : '新增成功');
    dataDialogVisible.value = false;
    await Promise.all([loadDataList(), dictStore.ensureLoaded(true)]);
  } finally {
    dataSubmitting.value = false;
  }
}

async function deleteData(row: DictDataItem) {
  await deleteDictDataApi(row.id);
  ElMessage.success('删除成功');
  await Promise.all([loadDataList(), dictStore.ensureLoaded(true)]);
}

onMounted(() => {
  void loadTypes();
});
</script>

<template>
  <el-row :gutter="14" class="min-h-0 lg:h-full">
    <!-- 左侧：字典类型 -->
    <el-col :xs="24" :lg="11" class="mb-4 min-h-0 lg:mb-0 lg:h-full">
      <ProTable
        title="字典类型"
        :loading="typeLoading"
        :total="typeTotal"
        :columns="[
          { key: 'name', label: '字典名称' },
          { key: 'type', label: '字典类型' },
          { key: 'status', label: '状态' },
        ]"
        v-model:page-no="typeQuery.pageNo"
        v-model:page-size="typeQuery.pageSize"
        @refresh="loadTypes"
      >
        <template #search>
          <el-form :inline="true" :model="typeQuery" @submit.prevent="() => ((typeQuery.pageNo = 1), loadTypes())">
            <el-form-item>
              <el-input
                v-model="typeQuery.name"
                placeholder="字典名称"
                :maxlength="FIELD_LIMITS.DICT_NAME"
                clearable
              />
            </el-form-item>
            <el-form-item>
              <el-input
                v-model="typeQuery.type"
                placeholder="字典类型"
                :maxlength="FIELD_LIMITS.DICT_TYPE"
                clearable
              />
            </el-form-item>
            <el-form-item>
              <el-button @click="resetTypeSearch">重置</el-button>
              <el-button type="primary" :icon="Search" @click="() => ((typeQuery.pageNo = 1), loadTypes())">
                查询
              </el-button>
            </el-form-item>
          </el-form>
        </template>

        <template #toolbar>
          <el-button
            v-has-permi="'system:dict:create'"
            type="primary"
            :icon="Plus"
            @click="openTypeForm()"
          >
            新增类型
          </el-button>
        </template>

        <template #default="{ size, tableHeight, isColVisible }">
          <el-table
            :data="typeList"
            :size="size"
            :height="tableHeight"
            border
            highlight-current-row
            @row-click="selectTypeRow"
          >
            <el-table-column v-if="isColVisible('name')" prop="name" label="字典名称" min-width="110" show-overflow-tooltip />
            <el-table-column v-if="isColVisible('type')" prop="type" label="字典类型" min-width="135" show-overflow-tooltip />
            <el-table-column v-if="isColVisible('status')" label="状态" width="74" align="center">
              <template #default="{ row }">
                <DictTag :type="DICT_TYPE.COMMON_STATUS" :value="row.status" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="144" align="center" fixed="right">
              <template #default="{ row }">
                <div @click.stop>
                  <TableAction
                    :actions="[
                      {
                        label: '编辑',
                        icon: Edit,
                        auth: 'system:dict:update',
                        onClick: () => openTypeForm(row),
                      },
                      {
                        label: '删除',
                        type: 'danger',
                        icon: Delete,
                        auth: 'system:dict:delete',
                        popConfirm: {
                          title: deleteConfirmMessage(row.name),
                          confirm: () => deleteType(row),
                        },
                      },
                    ]"
                  />
                </div>
              </template>
            </el-table-column>
          </el-table>
        </template>
      </ProTable>
    </el-col>

    <!-- 右侧：字典数据 -->
    <el-col :xs="24" :lg="13" class="min-h-0 lg:h-full">
      <ProTable
        :title="selectedType ? `字典数据（${selectedType.name}）` : '字典数据'"
        :loading="dataLoading"
        :total="dataTotal"
        :columns="[
          { key: 'label', label: '标签' },
          { key: 'value', label: '键值' },
          { key: 'sort', label: '排序' },
          { key: 'status', label: '状态' },
          { key: 'remark', label: '备注' },
        ]"
        v-model:page-no="dataQuery.pageNo"
        v-model:page-size="dataQuery.pageSize"
        @refresh="loadDataList"
      >
        <template #search>
          <el-form :inline="true" :model="dataQuery" @submit.prevent="() => ((dataQuery.pageNo = 1), loadDataList())">
            <el-form-item>
              <el-input
                v-model="dataQuery.label"
                placeholder="请输入字典标签"
                :maxlength="FIELD_LIMITS.DICT_LABEL"
                clearable
              />
            </el-form-item>
            <el-form-item>
              <el-button @click="resetDataSearch">重置</el-button>
              <el-button type="primary" :icon="Search" @click="() => ((dataQuery.pageNo = 1), loadDataList())">
                查询
              </el-button>
            </el-form-item>
          </el-form>
        </template>

        <template #toolbar>
          <el-button
            v-has-permi="'system:dict:create'"
            type="primary"
            :icon="Plus"
            :disabled="!selectedType"
            @click="openDataForm()"
          >
            新增数据
          </el-button>
        </template>

        <template #default="{ size, tableHeight, isColVisible }">
          <el-table :data="dataList" :size="size" :height="tableHeight" border stripe>
            <el-table-column v-if="isColVisible('label')" prop="label" label="标签" min-width="110" show-overflow-tooltip />
            <el-table-column v-if="isColVisible('value')" prop="value" label="键值" min-width="96" show-overflow-tooltip />
            <el-table-column v-if="isColVisible('sort')" prop="sort" label="排序" width="68" align="center" />
            <el-table-column v-if="isColVisible('status')" label="状态" width="74" align="center">
              <template #default="{ row }">
                <DictTag :type="DICT_TYPE.COMMON_STATUS" :value="row.status" />
              </template>
            </el-table-column>
            <el-table-column v-if="isColVisible('remark')" prop="remark" label="备注" min-width="120" show-overflow-tooltip />
            <el-table-column label="操作" width="144" align="center" fixed="right">
              <template #default="{ row }">
                <TableAction
                  :actions="[
                    {
                      label: '编辑',
                      icon: Edit,
                      auth: 'system:dict:update',
                      onClick: () => openDataForm(row),
                    },
                    {
                      label: '删除',
                      type: 'danger',
                      icon: Delete,
                      auth: 'system:dict:delete',
                      popConfirm: {
                        title: deleteConfirmMessage(row.label),
                        confirm: () => deleteData(row),
                      },
                    },
                  ]"
                />
              </template>
            </el-table-column>
          </el-table>
        </template>
      </ProTable>
    </el-col>

    <!-- 字典类型弹窗 -->
    <FormDialog
      v-model="typeDialogVisible"
      :title="typeForm.id ? '编辑字典类型' : '新增字典类型'"
      width="500px"
      :confirm-loading="typeSubmitting"
      :confirm-disabled="!typeFormReady"
      @confirm="submitTypeForm"
    >
      <el-form ref="typeFormRef" v-loading="!typeFormReady" :model="typeForm" :rules="typeFormRules" label-width="88px">
        <el-form-item label="字典名称" prop="name">
          <el-input
            v-model="typeForm.name"
            :maxlength="FIELD_LIMITS.DICT_NAME"
            placeholder="请输入字典名称"
          />
        </el-form-item>
        <el-form-item label="字典类型" prop="type">
          <el-input
            v-model="typeForm.type"
            :disabled="Boolean(typeForm.id)"
            :maxlength="FIELD_LIMITS.DICT_TYPE"
            placeholder="请输入字典类型编码，如 system_user_sex"
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="typeForm.status">
            <el-radio :value="CommonStatusEnum.ENABLE">开启</el-radio>
            <el-radio :value="CommonStatusEnum.DISABLE">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input
            v-model="typeForm.remark"
            type="textarea"
            :rows="3"
            :maxlength="FIELD_LIMITS.REMARK"
            show-word-limit
            placeholder="请输入备注说明（选填）"
          />
        </el-form-item>
      </el-form>
    </FormDialog>

    <!-- 字典数据弹窗 -->
    <FormDialog
      v-model="dataDialogVisible"
      :title="dataForm.id ? '编辑字典数据' : '新增字典数据'"
      width="500px"
      :confirm-loading="dataSubmitting"
      :confirm-disabled="!dataFormReady"
      @confirm="submitDataForm"
    >
      <el-form ref="dataFormRef" v-loading="!dataFormReady" :model="dataForm" :rules="dataFormRules" label-width="88px">
        <el-form-item label="字典类型">
          <el-input :model-value="dataForm.dictType" disabled />
        </el-form-item>
        <el-form-item label="数据标签" prop="label">
          <el-input
            v-model="dataForm.label"
            :maxlength="FIELD_LIMITS.DICT_LABEL"
            placeholder="请输入展示标签"
          />
        </el-form-item>
        <el-form-item label="数据键值" prop="value">
          <el-input
            v-model="dataForm.value"
            :maxlength="FIELD_LIMITS.DICT_VALUE"
            placeholder="请输入存储键值"
          />
        </el-form-item>
        <el-form-item label="显示排序">
          <el-input-number v-model="dataForm.sort" :min="0" :max="99999" />
        </el-form-item>
        <el-form-item label="标签颜色">
          <el-select v-model="dataForm.colorType" class="w-full">
            <el-option label="主色 (primary)" value="primary" />
            <el-option label="成功 (success)" value="success" />
            <el-option label="信息 (info)" value="info" />
            <el-option label="警告 (warning)" value="warning" />
            <el-option label="危险 (danger)" value="danger" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="dataForm.status">
            <el-radio :value="CommonStatusEnum.ENABLE">开启</el-radio>
            <el-radio :value="CommonStatusEnum.DISABLE">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input
            v-model="dataForm.remark"
            type="textarea"
            :rows="3"
            :maxlength="FIELD_LIMITS.REMARK"
            show-word-limit
            placeholder="请输入备注说明（选填）"
          />
        </el-form-item>
      </el-form>
    </FormDialog>
  </el-row>
</template>
