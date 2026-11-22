<script setup lang="ts">
/**
 * 用户管理：左侧部门树筛选 + 右侧用户列表（新增/编辑/删除/状态切换/重置密码/分配角色/Excel导入导出）。
 */
import {
  Delete,
  Download,
  Plus,
  Search,
  Upload,
} from '@element-plus/icons-vue';
import {
  ElMessage,
  ElMessageBox,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import { computed, onMounted, reactive, ref, watch } from 'vue';

import { type DeptSimple, getSimpleDeptListApi } from '@/api/system/dept';
import {
  assignUserRoleApi,
  getUserRoleListApi,
} from '@/api/system/permission';
import { getSimpleRoleListApi, type RoleItem } from '@/api/system/role';
import {
  createUserApi,
  deleteUserApi,
  deleteUserListApi,
  exportUserApi,
  getImportUserTemplateApi,
  getUserApi,
  getUserPageApi,
  importUserApi,
  resetUserPasswordApi,
  updateUserApi,
  updateUserStatusApi,
  type UserItem,
} from '@/api/system/user';
import ProTable from '@/components/ProTable.vue';
import { CommonStatusEnum } from '@/constants/enums';
import { downloadBlob, formatDateTime } from '@/utils/format';
import { encryptPassword } from '@/utils/sm2';
import { handleTree } from '@/utils/tree';

defineOptions({ name: 'SystemUser' });

const loading = ref(false);
const list = ref<UserItem[]>([]);
const total = ref(0);
const selectedIds = ref<(number | string)[]>([]);

const query = reactive({
  pageNo: 1,
  pageSize: 10,
  username: '',
  mobile: '',
  status: undefined as number | undefined,
  deptId: undefined as number | string | undefined,
});

// 部门树
const deptKeyword = ref('');
const deptList = ref<DeptSimple[]>([]);
const deptTree = computed(() => {
  const filtered = deptKeyword.value.trim()
    ? deptList.value.filter((d) =>
        d.name.toLowerCase().includes(deptKeyword.value.trim().toLowerCase()),
      )
    : deptList.value;
  return handleTree(filtered as any[]);
});

// 新增/编辑弹窗
const formVisible = ref(false);
const formSubmitting = ref(false);
const formRef = ref<FormInstance>();
const form = reactive({
  id: undefined as number | string | undefined,
  username: '',
  nickname: '',
  password: '',
  deptId: undefined as number | string | undefined,
  mobile: '',
  email: '',
  sex: 1,
  remark: '',
});

const formRules: FormRules = {
  username: [{ required: true, message: '请输入用户名称', trigger: 'blur' }],
  nickname: [{ required: true, message: '请输入用户昵称', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入初始密码', trigger: 'blur' },
    { min: 8, max: 32, message: '密码长度需在 8~32 位之间', trigger: 'blur' },
  ],
};

// 分配角色弹窗
const roleDialogVisible = ref(false);
const roleOptions = ref<RoleItem[]>([]);
const assignRoleForm = reactive({
  userId: undefined as number | string | undefined,
  username: '',
  roleIds: [] as (number | string)[],
});

// 重置密码弹窗
const pwdDialogVisible = ref(false);
const pwdForm = reactive({
  userId: undefined as number | string | undefined,
  username: '',
  password: '',
});

// 导入弹窗
const importDialogVisible = ref(false);
const importUpdateSupport = ref(false);
const importFile = ref<File | null>(null);
const importing = ref(false);

async function loadList() {
  loading.value = true;
  try {
    const res = await getUserPageApi({
      pageNo: query.pageNo,
      pageSize: query.pageSize,
      username: query.username || undefined,
      mobile: query.mobile || undefined,
      status: query.status,
      deptId: query.deptId,
    });
    list.value = res.list ?? [];
    total.value = res.total ?? 0;
  } finally {
    loading.value = false;
  }
}

async function loadDeptTree() {
  deptList.value = await getSimpleDeptListApi();
}

function handleSearch() {
  query.pageNo = 1;
  void loadList();
}

function handleReset() {
  query.username = '';
  query.mobile = '';
  query.status = undefined;
  query.deptId = undefined;
  query.pageNo = 1;
  void loadList();
}

function handleDeptClick(node: DeptSimple) {
  query.deptId = query.deptId === node.id ? undefined : node.id;
  query.pageNo = 1;
  void loadList();
}

async function openForm(row?: UserItem) {
  Object.assign(form, {
    id: undefined,
    username: '',
    nickname: '',
    password: '',
    deptId: query.deptId,
    mobile: '',
    email: '',
    sex: 1,
    remark: '',
  });
  formVisible.value = true;
  if (row?.id) {
    const detail = await getUserApi(row.id);
    Object.assign(form, {
      id: detail.id,
      username: detail.username,
      nickname: detail.nickname,
      password: '',
      deptId: detail.deptId,
      mobile: detail.mobile || '',
      email: detail.email || '',
      sex: detail.sex ?? 1,
      remark: detail.remark || '',
    });
  }
}

async function submitForm() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  formSubmitting.value = true;
  try {
    const payload: any = {
      id: form.id,
      username: form.username.trim(),
      nickname: form.nickname.trim(),
      deptId: form.deptId,
      mobile: form.mobile || undefined,
      email: form.email || undefined,
      sex: form.sex,
      remark: form.remark || undefined,
    };
    if (!form.id) {
      payload.password = await encryptPassword(form.password);
      await createUserApi(payload);
    } else {
      await updateUserApi(payload);
    }
    ElMessage.success(form.id ? '修改成功' : '新增成功');
    formVisible.value = false;
    await loadList();
  } finally {
    formSubmitting.value = false;
  }
}

async function handleStatusChange(row: UserItem, val: string | number | boolean) {
  const nextStatus = Number(val);
  try {
    await updateUserStatusApi(row.id, nextStatus);
    ElMessage.success('状态已更新');
  } catch {
    await loadList();
  }
}

async function handleDelete(row: UserItem) {
  await ElMessageBox.confirm(`确认删除用户「${row.username}」吗？`, '删除确认', {
    type: 'warning',
  });
  await deleteUserApi(row.id);
  ElMessage.success('删除成功');
  await loadList();
}

async function handleBatchDelete() {
  if (selectedIds.value.length === 0) return;
  await ElMessageBox.confirm(
    `确认删除已勾选的 ${selectedIds.value.length} 个用户吗？`,
    '批量删除',
    { type: 'warning' },
  );
  await deleteUserListApi(selectedIds.value);
  ElMessage.success('批量删除成功');
  selectedIds.value = [];
  await loadList();
}

async function openAssignRole(row: UserItem) {
  assignRoleForm.userId = row.id;
  assignRoleForm.username = row.username;
  roleDialogVisible.value = true;
  const [roles, checked] = await Promise.all([
    getSimpleRoleListApi(),
    getUserRoleListApi(row.id),
  ]);
  roleOptions.value = roles;
  assignRoleForm.roleIds = checked;
}

async function submitAssignRole() {
  if (!assignRoleForm.userId) return;
  await assignUserRoleApi({
    userId: assignRoleForm.userId,
    roleIds: assignRoleForm.roleIds,
  });
  ElMessage.success('角色分配成功');
  roleDialogVisible.value = false;
}

function openResetPwd(row: UserItem) {
  pwdForm.userId = row.id;
  pwdForm.username = row.username;
  pwdForm.password = '';
  pwdDialogVisible.value = true;
}

async function submitResetPwd() {
  if (!pwdForm.userId || pwdForm.password.length < 8) {
    ElMessage.warning('新密码长度至少 8 位');
    return;
  }
  const encrypted = await encryptPassword(pwdForm.password);
  await resetUserPasswordApi(pwdForm.userId, encrypted);
  ElMessage.success('密码重置成功');
  pwdDialogVisible.value = false;
}

async function handleExport() {
  const blob = await exportUserApi({
    username: query.username || undefined,
    mobile: query.mobile || undefined,
    status: query.status,
    deptId: query.deptId,
  });
  downloadBlob(blob, '用户列表.xlsx');
}

async function handleDownloadTemplate() {
  const blob = await getImportUserTemplateApi();
  downloadBlob(blob, '用户导入模板.xlsx');
}

async function submitImport() {
  if (!importFile.value) {
    ElMessage.warning('请先选择 Excel 文件');
    return;
  }
  importing.value = true;
  try {
    const res = await importUserApi(importFile.value, importUpdateSupport.value);
    const created = res.createUsernames?.length ?? 0;
    const updated = res.updateUsernames?.length ?? 0;
    const failed = Object.keys(res.failureUsernames ?? {}).length;
    ElMessage.success(`导入完成：新增 ${created} 条，更新 ${updated} 条，失败 ${failed} 条`);
    importDialogVisible.value = false;
    importFile.value = null;
    await loadList();
  } finally {
    importing.value = false;
  }
}

watch(deptKeyword, () => {});

onMounted(() => {
  void Promise.all([loadDeptTree(), loadList()]);
});
</script>

<template>
  <div class="flex flex-col gap-3 lg:flex-row">
    <!-- 左侧部门树 -->
    <el-card shadow="never" class="w-full shrink-0 lg:w-[250px]" :body-style="{ padding: '14px' }">
      <el-input
        v-model="deptKeyword"
        placeholder="搜索部门"
        :prefix-icon="Search"
        clearable
        size="small"
        class="mb-3"
      />
      <el-tree
        :data="deptTree"
        :props="{ label: 'name', children: 'children' }"
        node-key="id"
        default-expand-all
        highlight-current
        :expand-on-click-node="false"
        @node-click="handleDeptClick"
      />
    </el-card>

    <!-- 右侧用户列表 -->
    <div class="min-w-0 flex-1">
      <ProTable
        title="用户列表"
        :loading="loading"
        :total="total"
        v-model:page-no="query.pageNo"
        v-model:page-size="query.pageSize"
        @refresh="loadList"
      >
        <template #search>
          <el-form :inline="true" :model="query" @submit.prevent="handleSearch">
            <el-form-item label="用户名称">
              <el-input v-model="query.username" placeholder="请输入用户名称" clearable />
            </el-form-item>
            <el-form-item label="手机号码">
              <el-input v-model="query.mobile" placeholder="请输入手机号" clearable />
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="query.status" placeholder="全部" clearable style="width: 120px">
                <el-option label="开启" :value="CommonStatusEnum.ENABLE" />
                <el-option label="禁用" :value="CommonStatusEnum.DISABLE" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :icon="Search" @click="handleSearch">搜索</el-button>
              <el-button @click="handleReset">重置</el-button>
            </el-form-item>
          </el-form>
        </template>

        <template #toolbar>
          <el-button
            v-has-permi="'system:user:create'"
            type="primary"
            :icon="Plus"
            size="small"
            @click="openForm()"
          >
            新增
          </el-button>
          <el-button
            v-has-permi="'system:user:import'"
            :icon="Upload"
            size="small"
            @click="importDialogVisible = true"
          >
            导入
          </el-button>
          <el-button
            v-has-permi="'system:user:export'"
            :icon="Download"
            size="small"
            @click="handleExport"
          >
            导出
          </el-button>
          <el-button
            v-has-permi="'system:user:delete'"
            type="danger"
            plain
            :icon="Delete"
            size="small"
            :disabled="selectedIds.length === 0"
            @click="handleBatchDelete"
          >
            批量删除
          </el-button>
        </template>

        <el-table
          :data="list"
          border
          stripe
          @selection-change="(rows: UserItem[]) => (selectedIds = rows.map((r) => r.id))"
        >
          <el-table-column type="selection" width="44" />
          <el-table-column prop="id" label="编号" width="80" />
          <el-table-column prop="username" label="用户名称" min-width="120" />
          <el-table-column prop="nickname" label="用户昵称" min-width="120" />
          <el-table-column prop="deptName" label="部门" min-width="130" />
          <el-table-column prop="mobile" label="手机号码" width="130" />
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-switch
                :model-value="row.status"
                :active-value="CommonStatusEnum.ENABLE"
                :inactive-value="CommonStatusEnum.DISABLE"
                @change="(v: string | number | boolean) => handleStatusChange(row, v)"
              />
            </template>
          </el-table-column>
          <el-table-column label="创建时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="230" fixed="right">
            <template #default="{ row }">
              <el-button
                v-has-permi="'system:user:update'"
                link
                type="primary"
                size="small"
                @click="openForm(row)"
              >
                编辑
              </el-button>
              <el-button
                v-has-permi="'system:permission:assign-user-role'"
                link
                type="primary"
                size="small"
                @click="openAssignRole(row)"
              >
                分配角色
              </el-button>
              <el-button
                v-has-permi="'system:user:update-password'"
                link
                type="warning"
                size="small"
                @click="openResetPwd(row)"
              >
                重置密码
              </el-button>
              <el-button
                v-has-permi="'system:user:delete'"
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
    </div>

    <!-- 新增/编辑用户弹窗 -->
    <el-dialog
      v-model="formVisible"
      :title="form.id ? '编辑用户' : '新增用户'"
      width="560px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="90px">
        <el-form-item label="用户名称" prop="username">
          <el-input v-model="form.username" :disabled="Boolean(form.id)" />
        </el-form-item>
        <el-form-item label="用户昵称" prop="nickname">
          <el-input v-model="form.nickname" />
        </el-form-item>
        <el-form-item v-if="!form.id" label="初始密码" prop="password">
          <el-input v-model="form.password" type="password" show-password />
        </el-form-item>
        <el-form-item label="归属部门">
          <el-tree-select
            v-model="form.deptId"
            :data="deptTree"
            :props="{ label: 'name', value: 'id', children: 'children' }"
            check-strictly
            clearable
            placeholder="请选择部门"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="手机号码">
          <el-input v-model="form.mobile" />
        </el-form-item>
        <el-form-item label="用户邮箱">
          <el-input v-model="form.email" />
        </el-form-item>
        <el-form-item label="性别">
          <el-radio-group v-model="form.sex">
            <el-radio :value="1">男</el-radio>
            <el-radio :value="2">女</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="formSubmitting" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>

    <!-- 分配角色弹窗 -->
    <el-dialog v-model="roleDialogVisible" title="分配角色" width="460px">
      <el-form label-width="85px">
        <el-form-item label="用户名称">
          <el-input :model-value="assignRoleForm.username" disabled />
        </el-form-item>
        <el-form-item label="角色列表">
          <el-select v-model="assignRoleForm.roleIds" multiple class="w-full" placeholder="请选择角色">
            <el-option
              v-for="role in roleOptions"
              :key="role.id"
              :label="role.name"
              :value="role.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="roleDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitAssignRole">保存</el-button>
      </template>
    </el-dialog>

    <!-- 重置密码弹窗 -->
    <el-dialog v-model="pwdDialogVisible" title="重置密码" width="440px">
      <el-form label-width="85px">
        <el-form-item label="用户名称">
          <el-input :model-value="pwdForm.username" disabled />
        </el-form-item>
        <el-form-item label="新密码" required>
          <el-input
            v-model="pwdForm.password"
            type="password"
            show-password
            placeholder="请输入 8~32 位新密码"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pwdDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitResetPwd">确认重置</el-button>
      </template>
    </el-dialog>

    <!-- Excel 导入弹窗 -->
    <el-dialog v-model="importDialogVisible" title="导入用户" width="460px">
      <div class="flex flex-col gap-3">
        <input
          type="file"
          accept=".xlsx,.xls"
          @change="(e: Event) => (importFile = (e.target as HTMLInputElement).files?.[0] ?? null)"
        />
        <el-checkbox v-model="importUpdateSupport">是否更新已存在的用户数据</el-checkbox>
        <div>
          <el-button link type="primary" @click="handleDownloadTemplate">
            下载标准导入模板
          </el-button>
        </div>
      </div>
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="importing" @click="submitImport">开始导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>
