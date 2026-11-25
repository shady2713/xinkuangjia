<script setup lang="ts">
/**
 * 部门管理：树形表格 CRUD。
 */
import { Delete, Edit, Plus, Search } from '@element-plus/icons-vue';
import {
  ElMessage,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';

import { notifyUnhandledError } from '@/api/request';
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
import FormDialog from '@/components/FormDialog.vue';
import ProTable from '@/components/ProTable.vue';
import TableAction from '@/components/TableAction.vue';
import { CommonStatusEnum, DICT_TYPE } from '@/constants/enums';
import {
  deleteConfirmMessage,
  emailRule,
  FIELD_LIMITS,
  maxLenRule,
  mobileRule,
  requiredNumberRule,
  requiredRule,
} from '@/constants/validation';
import { formatDateTime } from '@/utils/format';
import { getSessionId } from '@/utils/token';
import { handleTree } from '@/utils/tree';

defineOptions({ name: 'SystemDept' });

const loading = ref(false);
const rawList = ref<DeptItem[]>([]);
const users = ref<UserSimple[]>([]);
const userMap = computed(() =>
  new Map(users.value.map((u) => [String(u.id), u.nickname])),
);
const treeList = computed(() =>
  handleTree(rawList.value as { id: number | string; parentId?: number | string }[]),
);
const parentOptions = computed(() => [
  { id: 0, name: '顶级部门', children: treeList.value },
]);

const query = reactive({
  name: '',
  status: undefined as number | undefined,
});

const formVisible = ref(false);
const formSubmitting = ref(false);
const formReady = ref(false);
let formLoad = 0;
let formOwner: string | null = null;
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
});

const formRules: FormRules = {
  name: [requiredRule('部门名称'), maxLenRule('部门名称', FIELD_LIMITS.DEPT_NAME)],
  sort: [requiredNumberRule('显示排序')],
  phone: [mobileRule()],
  email: [emailRule(), maxLenRule('邮箱', FIELD_LIMITS.EMAIL)],
};

async function loadList() {
  loading.value = true;
  try {
    rawList.value = await getDeptListApi({
      name: query.name.trim() || undefined,
      status: query.status,
    });
  } catch (error) {
    notifyUnhandledError(error);
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
  if (formSubmitting.value) return;
  const load = ++formLoad;
  const owner = getSessionId();
  formOwner = owner;
  formReady.value = !row?.id;
  Object.assign(form, {
    id: row?.id,
    parentId,
    name: '',
    sort: 0,
    leaderUserId: undefined,
    phone: '',
    email: '',
    status: CommonStatusEnum.ENABLE,
  });
  formVisible.value = true;
  if (row?.id) {
    try {
      const detail = await getDeptApi(row.id);
      if (load !== formLoad || !formVisible.value || !owner || getSessionId() !== owner) return;
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
      formReady.value = true;
    } catch (error) {
      notifyUnhandledError(error);
      if (load === formLoad) {
        formVisible.value = false;
      }
    }
  }
}

async function submitForm() {
  if (!formReady.value || formSubmitting.value || getSessionId() !== formOwner) return;
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  formSubmitting.value = true;
  try {
    const payload = {
      ...form,
      name: form.name.trim(),
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
    };
    if (form.id) {
      await updateDeptApi(payload);
    } else {
      await createDeptApi(payload);
    }
    ElMessage.success(form.id ? '修改成功' : '新增成功');
    formVisible.value = false;
    await loadList();
  } catch (error) {
    notifyUnhandledError(error);
  } finally {
    formSubmitting.value = false;
  }
}

async function handleDelete(row: DeptItem) {
  if (row.id === undefined) return;
  try {
    await deleteDeptApi(row.id);
    ElMessage.success('删除成功');
    await loadList();
  } catch (error) {
    notifyUnhandledError(error);
  }
}

onMounted(async () => {
  await Promise.all([
    loadList(),
    getSimpleUserListApi()
      .then((res) => (users.value = res))
      .catch((error) => notifyUnhandledError(error)),
  ]);
});
</script>

<template>
  <div class="h-full">
    <ProTable
      title="部门列表"
      :loading="loading"
      :show-pagination="false"
      :columns="[
        { key: 'name', label: '部门名称' },
        { key: 'leader', label: '负责人' },
        { key: 'phone', label: '联系电话' },
        { key: 'sort', label: '排序' },
        { key: 'status', label: '状态' },
        { key: 'createTime', label: '创建时间' },
      ]"
      @refresh="loadList"
    >
      <template #search>
        <el-form :inline="true" :model="query" @submit.prevent="loadList">
          <el-form-item label="部门名称">
            <el-input
              v-model="query.name"
              placeholder="请输入部门名称"
              :maxlength="FIELD_LIMITS.DEPT_NAME"
              clearable
            />
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="query.status" placeholder="全部" clearable>
              <el-option label="开启" :value="CommonStatusEnum.ENABLE" />
              <el-option label="禁用" :value="CommonStatusEnum.DISABLE" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button @click="handleReset">重置</el-button>
            <el-button type="primary" :icon="Search" @click="loadList">查询</el-button>
          </el-form-item>
        </el-form>
      </template>

      <template #toolbar>
        <el-button
          v-has-permi="'system:dept:create'"
          type="primary"
          :icon="Plus"
          @click="openForm()"
        >
          新增
        </el-button>
      </template>

      <template #default="{ size, tableHeight, isColVisible }">
        <el-table :data="treeList" :size="size" :height="tableHeight" row-key="id" border default-expand-all>
          <el-table-column v-if="isColVisible('name')" prop="name" label="部门名称" min-width="200" show-overflow-tooltip />
          <el-table-column v-if="isColVisible('leader')" label="负责人" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.leaderUserId ? userMap.get(String(row.leaderUserId)) || '-' : '-' }}
            </template>
          </el-table-column>
          <el-table-column v-if="isColVisible('phone')" prop="phone" label="联系电话" width="130" show-overflow-tooltip />
          <el-table-column v-if="isColVisible('sort')" prop="sort" label="排序" width="76" align="center" />
          <el-table-column v-if="isColVisible('status')" label="状态" width="84" align="center">
            <template #default="{ row }">
              <DictTag :type="DICT_TYPE.COMMON_STATUS" :value="row.status" />
            </template>
          </el-table-column>
          <el-table-column v-if="isColVisible('createTime')" label="创建时间" width="164" show-overflow-tooltip>
            <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="232" align="center" fixed="right">
            <template #default="{ row }">
              <TableAction
                :actions="[
                  {
                    label: '新增下级',
                    icon: Plus,
                    auth: 'system:dept:create',
                    onClick: () => openForm(undefined, row.id),
                  },
                  {
                    label: '编辑',
                    icon: Edit,
                    auth: 'system:dept:update',
                    onClick: () => openForm(row),
                  },
                  {
                    label: '删除',
                    type: 'danger',
                    icon: Delete,
                    auth: 'system:dept:delete',
                    popConfirm: {
                      title: deleteConfirmMessage(row.name),
                      confirm: () => handleDelete(row),
                    },
                  },
                ]"
              />
            </template>
          </el-table-column>
        </el-table>
      </template>
    </ProTable>

    <FormDialog
      v-model="formVisible"
      :title="form.id ? '编辑部门' : '新增部门'"
      width="540px"
      :confirm-loading="formSubmitting"
      :confirm-disabled="!formReady"
      @confirm="submitForm"
    >
      <el-form ref="formRef" v-loading="!formReady" :model="form" :rules="formRules" label-width="90px">
        <el-form-item label="上级部门">
          <el-tree-select
            v-model="form.parentId"
            :data="parentOptions"
            :props="{ label: 'name', value: 'id', children: 'children' }"
            check-strictly
            placeholder="请选择上级部门"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="部门名称" prop="name">
          <el-input
            v-model="form.name"
            :maxlength="FIELD_LIMITS.DEPT_NAME"
            placeholder="请输入部门名称"
          />
        </el-form-item>
        <el-form-item label="显示排序" prop="sort">
          <el-input-number v-model="form.sort" :min="FIELD_LIMITS.SORT_MIN" :max="FIELD_LIMITS.SORT_MAX" />
        </el-form-item>
        <el-form-item label="负责人">
          <el-select
            v-model="form.leaderUserId"
            clearable
            filterable
            class="w-full"
            placeholder="请选择负责人"
          >
            <el-option v-for="u in users" :key="u.id" :label="u.nickname" :value="u.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="联系电话" prop="phone">
          <el-input
            v-model="form.phone"
            :maxlength="FIELD_LIMITS.MOBILE"
            placeholder="请输入 11 位手机号"
          />
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input
            v-model="form.email"
            :maxlength="FIELD_LIMITS.EMAIL"
            placeholder="请输入部门联系邮箱"
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio :value="CommonStatusEnum.ENABLE">开启</el-radio>
            <el-radio :value="CommonStatusEnum.DISABLE">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
    </FormDialog>
  </div>
</template>
