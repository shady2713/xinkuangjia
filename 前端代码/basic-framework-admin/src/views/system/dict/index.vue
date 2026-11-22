<script setup lang="ts">
/**
 * 字典管理：左右双栏联动（左侧字典类型 + 右侧字典数据）。
 */
import { Plus, Search } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox, type FormInstance } from 'element-plus';
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
import ProTable from '@/components/ProTable.vue';
import { CommonStatusEnum, DICT_TYPE } from '@/constants/enums';
import { useDictStore } from '@/stores/dict';

defineOptions({ name: 'SystemDictType' });

const dictStore = useDictStore();

// 左侧：字典类型
const typeLoading = ref(false);
const typeList = ref<DictTypeItem[]>([]);
const typeTotal = ref(0);
const typeQuery = reactive({ pageNo: 1, pageSize: 10, name: '', type: '' });
const selectedType = ref<DictTypeItem | null>(null);

const typeDialogVisible = ref(false);
const typeFormRef = ref<FormInstance>();
const typeForm = reactive({
  id: undefined as number | string | undefined,
  name: '',
  type: '',
  status: CommonStatusEnum.ENABLE as number,
  remark: '',
});

// 右侧：字典数据
const dataLoading = ref(false);
const dataList = ref<DictDataItem[]>([]);
const dataTotal = ref(0);
const dataQuery = reactive({ pageNo: 1, pageSize: 10, label: '' });

const dataDialogVisible = ref(false);
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

async function loadTypes() {
  typeLoading.value = true;
  try {
    const res = await getDictTypePageApi({
      pageNo: typeQuery.pageNo,
      pageSize: typeQuery.pageSize,
      name: typeQuery.name || undefined,
      type: typeQuery.type || undefined,
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
      label: dataQuery.label || undefined,
    });
    dataList.value = res.list ?? [];
    dataTotal.value = res.total ?? 0;
  } finally {
    dataLoading.value = false;
  }
}

async function openTypeForm(row?: DictTypeItem) {
  Object.assign(typeForm, {
    id: undefined,
    name: '',
    type: '',
    status: CommonStatusEnum.ENABLE,
    remark: '',
  });
  typeDialogVisible.value = true;
  if (row?.id) {
    const detail = await getDictTypeApi(row.id);
    Object.assign(typeForm, {
      id: detail.id,
      name: detail.name,
      type: detail.type,
      status: detail.status ?? CommonStatusEnum.ENABLE,
      remark: detail.remark || '',
    });
  }
}

async function submitTypeForm() {
  if (!typeForm.name.trim() || !typeForm.type.trim()) {
    ElMessage.warning('请填写字典名称和字典类型');
    return;
  }
  if (typeForm.id) {
    await updateDictTypeApi({ ...typeForm });
  } else {
    await createDictTypeApi({ ...typeForm });
  }
  ElMessage.success(typeForm.id ? '修改成功' : '新增成功');
  typeDialogVisible.value = false;
  await loadTypes();
}

async function deleteType(row: DictTypeItem) {
  await ElMessageBox.confirm(`确认删除字典类型「${row.name}」吗？`, '删除确认', {
    type: 'warning',
  });
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
  Object.assign(dataForm, {
    id: undefined,
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
  }
}

async function submitDataForm() {
  if (!dataForm.label.trim() || !dataForm.value.trim()) {
    ElMessage.warning('请填写字典标签和字典键值');
    return;
  }
  if (dataForm.id) {
    await updateDictDataApi({ ...dataForm });
  } else {
    await createDictDataApi({ ...dataForm });
  }
  ElMessage.success(dataForm.id ? '修改成功' : '新增成功');
  dataDialogVisible.value = false;
  await Promise.all([loadDataList(), dictStore.ensureLoaded(true)]);
}

async function deleteData(row: DictDataItem) {
  await ElMessageBox.confirm(`确认删除字典数据「${row.label}」吗？`, '删除确认', {
    type: 'warning',
  });
  await deleteDictDataApi(row.id);
  ElMessage.success('删除成功');
  await Promise.all([loadDataList(), dictStore.ensureLoaded(true)]);
}

onMounted(() => {
  void loadTypes();
});
</script>

<template>
  <el-row :gutter="14">
    <!-- 左侧：字典类型 -->
    <el-col :xs="24" :lg="11" class="mb-4 lg:mb-0">
      <ProTable
        title="字典类型"
        :loading="typeLoading"
        :total="typeTotal"
        v-model:page-no="typeQuery.pageNo"
        v-model:page-size="typeQuery.pageSize"
        @refresh="loadTypes"
      >
        <template #search>
          <el-form :inline="true" :model="typeQuery" @submit.prevent="loadTypes">
            <el-form-item>
              <el-input v-model="typeQuery.name" placeholder="字典名称" clearable style="width: 140px" />
            </el-form-item>
            <el-form-item>
              <el-input v-model="typeQuery.type" placeholder="字典类型" clearable style="width: 140px" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :icon="Search" @click="() => ((typeQuery.pageNo = 1), loadTypes())">
                搜索
              </el-button>
            </el-form-item>
          </el-form>
        </template>

        <template #toolbar>
          <el-button v-has-permi="'system:dict:create'" type="primary" :icon="Plus" size="small" @click="openTypeForm()">
            新增类型
          </el-button>
        </template>

        <el-table
          :data="typeList"
          border
          highlight-current-row
          @row-click="selectTypeRow"
        >
          <el-table-column prop="name" label="字典名称" min-width="110" show-overflow-tooltip />
          <el-table-column prop="type" label="字典类型" min-width="140" show-overflow-tooltip />
          <el-table-column label="状态" width="75" align="center">
            <template #default="{ row }">
              <DictTag :type="DICT_TYPE.COMMON_STATUS" :value="row.status" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="110" fixed="right">
            <template #default="{ row }">
              <el-button v-has-permi="'system:dict:update'" link type="primary" size="small" @click.stop="openTypeForm(row)">
                编辑
              </el-button>
              <el-button v-has-permi="'system:dict:delete'" link type="danger" size="small" @click.stop="deleteType(row)">
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </ProTable>
    </el-col>

    <!-- 右侧：字典数据 -->
    <el-col :xs="24" :lg="13">
      <ProTable
        :title="selectedType ? `字典数据（${selectedType.name} / ${selectedType.type}）` : '字典数据'"
        :loading="dataLoading"
        :total="dataTotal"
        v-model:page-no="dataQuery.pageNo"
        v-model:page-size="dataQuery.pageSize"
        @refresh="loadDataList"
      >
        <template #search>
          <el-form :inline="true" :model="dataQuery" @submit.prevent="loadDataList">
            <el-form-item>
              <el-input v-model="dataQuery.label" placeholder="字典标签" clearable style="width: 180px" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :icon="Search" @click="() => ((dataQuery.pageNo = 1), loadDataList())">
                搜索
              </el-button>
            </el-form-item>
          </el-form>
        </template>

        <template #toolbar>
          <el-button
            v-has-permi="'system:dict:create'"
            type="primary"
            :icon="Plus"
            size="small"
            :disabled="!selectedType"
            @click="openDataForm()"
          >
            新增数据
          </el-button>
        </template>

        <el-table :data="dataList" border stripe>
          <el-table-column prop="label" label="标签" min-width="110" />
          <el-table-column prop="value" label="键值" width="100" />
          <el-table-column prop="sort" label="排序" width="70" align="center" />
          <el-table-column label="状态" width="75" align="center">
            <template #default="{ row }">
              <DictTag :type="DICT_TYPE.COMMON_STATUS" :value="row.status" />
            </template>
          </el-table-column>
          <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip />
          <el-table-column label="操作" width="110" fixed="right">
            <template #default="{ row }">
              <el-button v-has-permi="'system:dict:update'" link type="primary" size="small" @click="openDataForm(row)">
                编辑
              </el-button>
              <el-button v-has-permi="'system:dict:delete'" link type="danger" size="small" @click="deleteData(row)">
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </ProTable>
    </el-col>

    <!-- 字典类型弹窗 -->
    <el-dialog v-model="typeDialogVisible" :title="typeForm.id ? '编辑字典类型' : '新增字典类型'" width="480px">
      <el-form ref="typeFormRef" :model="typeForm" label-width="85px">
        <el-form-item label="字典名称" required>
          <el-input v-model="typeForm.name" />
        </el-form-item>
        <el-form-item label="字典类型" required>
          <el-input v-model="typeForm.type" :disabled="Boolean(typeForm.id)" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="typeForm.status">
            <el-radio :value="CommonStatusEnum.ENABLE">开启</el-radio>
            <el-radio :value="CommonStatusEnum.DISABLE">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="typeForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="typeDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitTypeForm">确定</el-button>
      </template>
    </el-dialog>

    <!-- 字典数据弹窗 -->
    <el-dialog v-model="dataDialogVisible" :title="dataForm.id ? '编辑字典数据' : '新增字典数据'" width="480px">
      <el-form ref="dataFormRef" :model="dataForm" label-width="85px">
        <el-form-item label="字典类型">
          <el-input :model-value="dataForm.dictType" disabled />
        </el-form-item>
        <el-form-item label="数据标签" required>
          <el-input v-model="dataForm.label" />
        </el-form-item>
        <el-form-item label="数据键值" required>
          <el-input v-model="dataForm.value" />
        </el-form-item>
        <el-form-item label="显示排序">
          <el-input-number v-model="dataForm.sort" :min="0" />
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
        <el-form-item label="备注">
          <el-input v-model="dataForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dataDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitDataForm">确定</el-button>
      </template>
    </el-dialog>
  </el-row>
</template>
