<script setup lang="ts">
/**
 * 部门管理：树形表格 CRUD。
 */
import { Plus, Search } from '@element-plus/icons-vue';
import {
  ElMessage,
  ElMessageBox,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';

import {
  createDeptApi,
  deleteDeptApi,
  type DeptItem,
  getDeptApi,
  getDeptListApi,
  updateDeptApi,
} from '@/api/system/dept';
import { getSimpleUserListApi, type UserSimple } from '@/api/system/user';
import DictTag from '@/components/DictTag.vue';
import ProTable from '@/components/ProTable.vue';
import { CommonStatusEnum, DICT_TYPE } from '@/constants/enums';
import { formatDateTime } from '@/utils/format';
import { handleTree } from '@/utils/tree';

defineOptions({ name: 'SystemDept' });

const loading = ref(false);
const rawList = ref<DeptItem[]>([]);
const users = ref<UserSimple[]>([]);
const userMap = computed(() =>
  new Map(users.value.map((u) => [String(u.id), u.nickname])),
);
const treeList = computed(() => handleTree(rawList.value as any[]));
const parentOptions = computed(() => [
  { id: 0, name: '顶级部门', children: treeList.value },
]);

const query = reactive({
  name: '',
  status: undefined as number | undefined,
});

const formVisible = ref(false);
const formSubmitting = ref(false);
const formRef = ref<FormInstance>();
const form = reactive({
  id: undefined as number | string | undefined,
  parentId: 0 as number | string,
  name: '',
  sort: 0,
  leaderUserId: undefined as number | string | undefined,
  phone: '',
  email: '',
  status: CommonStatusEnum.ENABLE as number,
  roleType: 'super_admin',
});

const formRules: FormRules = {
  name: [{ required: true, message: '请输入部门名称', trigger: 'blur' }],
  sort: [{ required: true, message: '请输入排序', trigger: 'blur' }],
};

async function loadList() {
  loading.value = true;
  try {
    rawList.value = await getDeptListApi({
      name: query.name || undefined,
      status: query.status,
    });
  } finally {
    loading.value = false;
  }
}

function handleReset() {
  query.name = '';
  query.status = undefined;
  void loadList();
}

async function openForm(row?: DeptItem, parentId: number | string = 0) {
  Object.assign(form, {
    id: undefined,
    parentId,
    name: '',
    sort: 0,
    leaderUserId: undefined,
    phone: '',
    email: '',
    status: CommonStatusEnum.ENABLE,
    roleType: 'super_admin',
  });
  formVisible.value = true;
  if (row?.id) {
    const detail = await getDeptApi(row.id);
    Object.assign(form, {
      id: detail.id,
      parentId: detail.parentId ?? 0,
      name: detail.name,
      sort: detail.sort ?? 0,
      leaderUserId: detail.leaderUserId,
      phone: detail.phone || '',
      email: detail.email || '',
      status: detail.status ?? CommonStatusEnum.ENABLE,
    });
  }
}

async function submitForm() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  formSubmitting.value = true;
  try {
    const payload: any = {
      ...form,
      phone: form.phone || undefined,
      email: form.email || undefined,
    };
    if (form.id) {
      await updateDeptApi(payload);
    } else {
      await createDeptApi(payload);
    }
    ElMessage.success(form.id ? '修改成功' : '新增成功');
    formVisible.value = false;
    await loadList();
  } finally {
    formSubmitting.value = false;
  }
}

async function handleDelete(row: DeptItem) {
  if (row.id === undefined) return;
  await ElMessageBox.confirm(`确认删除部门「${row.name}」吗？`, '删除确认', {
    type: 'warning',
  });
  await deleteDeptApi(row.id);
  ElMessage.success('删除成功');
  await loadList();
}

onMounted(async () => {
  await Promise.all([
    loadList(),
    getSimpleUserListApi().then((res) => (users.value = res)),
  ]);
});
</script>

<template>
  <div>
    <ProTable title="部门列表" :loading="loading" :show-pagination="false" @refresh="loadList">
      <template #search>
        <el-form :inline="true" :model="query" @submit.prevent="loadList">
          <el-form-item label="部门名称">
            <el-input v-model="query.name" placeholder="请输入部门名称" clearable />
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="query.status" placeholder="全部" clearable style="width: 120px">
              <el-option label="开启" :value="CommonStatusEnum.ENABLE" />
              <el-option label="禁用" :value="CommonStatusEnum.DISABLE" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :icon="Search" @click="loadList">搜索</el-button>
            <el-button @click="handleReset">重置</el-button>
          </el-form-item>
        </el-form>
      </template>

      <template #toolbar>
        <el-button
          v-has-permi="'system:dept:create'"
          type="primary"
          :icon="Plus"
          size="small"
          @click="openForm()"
        >
          新增
        </el-button>
      </template>

      <el-table :data="treeList" row-key="id" border default-expand-all>
        <el-table-column prop="name" label="部门名称" min-width="200" />
        <el-table-column label="负责人" width="130">
          <template #default="{ row }">
            {{ row.leaderUserId ? userMap.get(String(row.leaderUserId)) || '-' : '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="sort" label="排序" width="80" align="center" />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <DictTag :type="DICT_TYPE.COMMON_STATUS" :value="row.status" />
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button
              v-has-permi="'system:dept:create'"
              link
              type="primary"
              size="small"
              @click="openForm(undefined, row.id)"
            >
              新增下级
            </el-button>
            <el-button
              v-has-permi="'system:dept:update'"
              link
              type="primary"
              size="small"
              @click="openForm(row)"
            >
              编辑
            </el-button>
            <el-button
              v-has-permi="'system:dept:delete'"
              link
              type="danger"
              size="small"
              @click="handleDelete(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </ProTable>

    <el-dialog v-model="formVisible" :title="form.id ? '编辑部门' : '新增部门'" width="520px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="90px">
        <el-form-item label="上级部门">
          <el-tree-select
            v-model="form.parentId"
            :data="parentOptions"
            :props="{ label: 'name', value: 'id', children: 'children' }"
            check-strictly
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="部门名称" prop="name">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="显示排序" prop="sort">
          <el-input-number v-model="form.sort" :min="0" />
        </el-form-item>
        <el-form-item label="负责人">
          <el-select v-model="form.leaderUserId" clearable filterable class="w-full" placeholder="请选择负责人">
            <el-option v-for="u in users" :key="u.id" :label="u.nickname" :value="u.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input v-model="form.phone" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="form.email" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio :value="CommonStatusEnum.ENABLE">开启</el-radio>
            <el-radio :value="CommonStatusEnum.DISABLE">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="formSubmitting" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>
