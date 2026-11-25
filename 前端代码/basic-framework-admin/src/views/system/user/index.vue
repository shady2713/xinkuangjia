<script setup lang="ts">
/**
 * 用户管理：左侧部门树筛选 + 右侧用户列表（新增/编辑/删除/状态切换/重置密码/分配角色/Excel导入导出）。
 */
import {
  Delete,
  Download,
  Edit,
  Key,
  Plus,
  Search,
  Upload,
  UserFilled,
} from '@element-plus/icons-vue';
import {
  ElMessage,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';

import { type DeptSimple, getSimpleDeptListApi } from '@/api/system/dept';
import {
  assignUserRoleApi,
  getUserRoleListApi,
} from '@/api/system/permission';
import { getSimpleRoleListApi, type RoleSimpleItem } from '@/api/system/role';
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
import FormDialog from '@/components/FormDialog.vue';
import ProTable from '@/components/ProTable.vue';
import TableAction from '@/components/TableAction.vue';
import { CommonStatusEnum } from '@/constants/enums';
import {
  deleteConfirmMessage,
  emailRule,
  FIELD_LIMITS,
  maxLenRule,
  mobileRule,
  passwordComplexityRule,
  rangeLenRule,
  REGEX_PATTERNS,
  requiredRule,
} from '@/constants/validation';
import { confirmCurrentSession } from '@/utils/confirm';
import { downloadBlob, formatDateTime } from '@/utils/format';
import { encryptPassword } from '@/utils/sm2';
import { getSessionId } from '@/utils/token';
import { handleTree } from '@/utils/tree';
import { hasPermission } from '@/directives/permission';

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
const fullDeptTree = computed(() =>
  handleTree(deptList.value as { id: number | string; parentId?: number | string }[]),
);
const deptTree = computed(() => {
  const filtered = deptKeyword.value.trim()
    ? deptList.value.filter((d) =>
        d.name.toLowerCase().includes(deptKeyword.value.trim().toLowerCase()),
      )
    : deptList.value;
  return handleTree(filtered as { id: number | string; parentId?: number | string }[]);
});

// 新增/编辑弹窗
const formVisible = ref(false);
const formSubmitting = ref(false);
const formReady = ref(false);
let formLoad = 0;
let formOwner: string | null = null;
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
  username: [
    requiredRule('用户账号'),
    rangeLenRule('用户账号', FIELD_LIMITS.USERNAME_MIN, FIELD_LIMITS.USERNAME),
    {
      pattern: REGEX_PATTERNS.USERNAME,
      message: '用户账号仅支持字母、数字和下划线',
      trigger: 'blur',
    },
  ],
  nickname: [
    requiredRule('用户昵称'),
    maxLenRule('用户昵称', FIELD_LIMITS.NICKNAME),
  ],
  password: [requiredRule('初始密码'), passwordComplexityRule()],
  mobile: [mobileRule()],
  email: [emailRule(), maxLenRule('邮箱', FIELD_LIMITS.EMAIL)],
  remark: [maxLenRule('备注', FIELD_LIMITS.REMARK)],
};

// 分配角色弹窗
const roleDialogVisible = ref(false);
const roleSubmitting = ref(false);
const roleReady = ref(false);
let roleLoad = 0;
let roleOwner: string | null = null;
const statusUpdating = reactive(new Set<string>());
const roleOptions = ref<RoleSimpleItem[]>([]);
const assignRoleForm = reactive({
  userId: undefined as number | string | undefined,
  username: '',
  roleIds: [] as (number | string)[],
});

// 重置密码弹窗
const pwdDialogVisible = ref(false);
const pwdSubmitting = ref(false);
const pwdFormRef = ref<FormInstance>();
const pwdForm = reactive({
  userId: undefined as number | string | undefined,
  username: '',
  password: '',
});
const pwdRules: FormRules = {
  password: [requiredRule('新密码'), passwordComplexityRule()],
};

// 导入弹窗
const importDialogVisible = ref(false);
const importUpdateSupport = ref(false);
const importFile = ref<File | null>(null);
const importFileInputRef = ref<HTMLInputElement | null>(null);
const importing = ref(false);

async function loadList() {
  loading.value = true;
  try {
    const res = await getUserPageApi({
      pageNo: query.pageNo,
      pageSize: query.pageSize,
      username: query.username.trim() || undefined,
      mobile: query.mobile.trim() || undefined,
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
  if (formSubmitting.value) return;
  const load = ++formLoad;
  const owner = getSessionId();
  formOwner = owner;
  formReady.value = !row?.id;
  Object.assign(form, {
    id: row?.id,
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
    if (load !== formLoad || !formVisible.value || !owner || getSessionId() !== owner) return;
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
    formReady.value = true;
  }
}

async function submitForm() {
  if (!formReady.value || formSubmitting.value || getSessionId() !== formOwner) return;
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  formSubmitting.value = true;
  try {
    const payload = {
      id: form.id,
      username: form.username.trim(),
      nickname: form.nickname.trim(),
      deptId: form.deptId,
      mobile: form.mobile.trim() || undefined,
      email: form.email.trim() || undefined,
      sex: form.sex,
      remark: form.remark.trim() || undefined,
      password: '',
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
  const key = String(row.id);
  if (statusUpdating.has(key) || !hasPermission('system:user:update')) return;
  statusUpdating.add(key);
  const nextStatus = Number(val);
  try {
    await updateUserStatusApi(row.id, nextStatus);
    row.status = nextStatus;
    ElMessage.success('状态已更新');
  } catch {
    await loadList();
  } finally {
    statusUpdating.delete(key);
  }
}

async function handleDelete(row: UserItem) {
  await deleteUserApi(row.id);
  ElMessage.success('删除成功');
  await loadList();
}

async function handleBatchDelete() {
  const ids = [...selectedIds.value];
  if (!ids.length) return;
  const confirmed = await confirmCurrentSession(
    `是否确认批量删除已勾选的 ${ids.length} 个用户？删除后无法恢复。`,
    { title: '批量删除确认', confirmText: '确认删除' },
  );
  if (!confirmed) return;
  await deleteUserListApi(ids);
  ElMessage.success('批量删除成功');
  selectedIds.value = [];
  await loadList();
}

async function openAssignRole(row: UserItem) {
  if (roleSubmitting.value) return;
  const load = ++roleLoad;
  const owner = getSessionId();
  roleReady.value = false;
  assignRoleForm.userId = row.id;
  assignRoleForm.username = row.username;
  assignRoleForm.roleIds = [];
  roleOptions.value = [];
  roleDialogVisible.value = true;
  const [roles, checked] = await Promise.all([
    getSimpleRoleListApi(),
    getUserRoleListApi(row.id),
  ]);
  if (load !== roleLoad || !roleDialogVisible.value || !owner || getSessionId() !== owner) return;
  roleOptions.value = roles;
  assignRoleForm.roleIds = checked;
  roleOwner = owner;
  roleReady.value = true;
}

async function submitAssignRole() {
  if (!roleReady.value || roleSubmitting.value || !assignRoleForm.userId || getSessionId() !== roleOwner) return;
  roleSubmitting.value = true;
  try {
    await assignUserRoleApi({
      userId: assignRoleForm.userId,
      roleIds: assignRoleForm.roleIds,
    });
    ElMessage.success('角色分配成功');
    roleDialogVisible.value = false;
  } finally {
    roleSubmitting.value = false;
  }
}

function openResetPwd(row: UserItem) {
  pwdForm.userId = row.id;
  pwdForm.username = row.username;
  pwdForm.password = '';
  pwdDialogVisible.value = true;
}

async function submitResetPwd() {
  const valid = await pwdFormRef.value?.validate().catch(() => false);
  if (!valid || !pwdForm.userId) return;
  pwdSubmitting.value = true;
  try {
    const encrypted = await encryptPassword(pwdForm.password);
    await resetUserPasswordApi(pwdForm.userId, encrypted);
    ElMessage.success('密码重置成功');
    pwdDialogVisible.value = false;
  } finally {
    pwdSubmitting.value = false;
  }
}

async function handleExport() {
  const blob = await exportUserApi({
    username: query.username.trim() || undefined,
    mobile: query.mobile.trim() || undefined,
    status: query.status,
    deptId: query.deptId,
  });
  downloadBlob(blob, '用户列表.xlsx');
}

async function handleDownloadTemplate() {
  const blob = await getImportUserTemplateApi();
  downloadBlob(blob, '用户导入模板.xlsx');
}

function openImportDialog() {
  importFile.value = null;
  importUpdateSupport.value = false;
  importDialogVisible.value = true;
}

function handleImportFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  importFile.value = input.files?.[0] ?? null;
  input.value = '';
}

async function submitImport() {
  if (!importFile.value) {
    ElMessage.warning('请先选择待导入的 Excel 文件');
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

onMounted(() => {
  void Promise.all([loadDeptTree(), loadList()]);
});
</script>

<template>
  <div class="flex min-h-0 flex-col gap-3 lg:h-full lg:flex-row">
    <!-- 左侧部门树（1:1 对齐原版 Vben 5 等高 1/6 侧栏） -->
    <el-card
      shadow="never"
      class="flex max-h-[260px] w-full shrink-0 flex-col lg:h-full lg:max-h-none lg:w-1/6 lg:min-w-[220px] lg:max-w-[260px]"
      :body-style="{
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        flex: '1 1 0%',
        minHeight: '0',
      }"
    >
      <el-input
        v-model="deptKeyword"
        placeholder="搜索部门名称"
        :prefix-icon="Search"
        :maxlength="FIELD_LIMITS.DEPT_NAME"
        clearable
        class="mb-3 shrink-0"
      />
      <el-scrollbar class="min-h-0 flex-1">
        <el-tree
          :data="deptTree"
          :props="{ label: 'name', children: 'children' }"
          node-key="id"
          default-expand-all
          highlight-current
          :expand-on-click-node="false"
          @node-click="handleDeptClick"
        />
      </el-scrollbar>
    </el-card>

    <!-- 右侧用户列表 -->
    <div class="h-full min-h-0 min-w-0 flex-1">
      <ProTable
        title="用户列表"
        :loading="loading"
        :total="total"
        :columns="[
          { key: 'id', label: '编号' },
          { key: 'username', label: '用户账号' },
          { key: 'nickname', label: '用户昵称' },
          { key: 'deptName', label: '归属部门' },
          { key: 'mobile', label: '手机号码' },
          { key: 'status', label: '状态' },
          { key: 'createTime', label: '创建时间' },
        ]"
        v-model:page-no="query.pageNo"
        v-model:page-size="query.pageSize"
        @refresh="loadList"
      >
        <template #search>
          <el-form :inline="true" :model="query" @submit.prevent="handleSearch">
            <el-form-item label="用户账号">
              <el-input
                v-model="query.username"
                placeholder="请输入用户账号"
                :maxlength="FIELD_LIMITS.USERNAME"
                clearable
              />
            </el-form-item>
            <el-form-item label="手机号码">
              <el-input
                v-model="query.mobile"
                placeholder="请输入手机号"
                :maxlength="FIELD_LIMITS.MOBILE"
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
              <el-button type="primary" :icon="Search" @click="handleSearch">查询</el-button>
            </el-form-item>
          </el-form>
        </template>

        <template #toolbar>
          <el-button
            v-has-permi="'system:user:create'"
            type="primary"
            :icon="Plus"
            @click="openForm()"
          >
            新增
          </el-button>
          <el-button
            v-has-permi="'system:user:import'"
            :icon="Upload"
            @click="openImportDialog"
          >
            导入
          </el-button>
          <el-button
            v-has-permi="'system:user:export'"
            :icon="Download"
            @click="handleExport"
          >
            导出
          </el-button>
          <el-button
            v-has-permi="'system:user:delete'"
            type="danger"
            plain
            :icon="Delete"
            :disabled="selectedIds.length === 0"
            @click="handleBatchDelete"
          >
            批量删除
          </el-button>
        </template>

        <template #default="{ size, tableHeight, isColVisible }">
          <el-table
            :data="list"
            :size="size"
            :height="tableHeight"
            border
            stripe
            @selection-change="(rows: UserItem[]) => (selectedIds = rows.map((r) => r.id))"
          >
            <el-table-column type="selection" width="44" align="center" />
            <el-table-column v-if="isColVisible('id')" prop="id" label="编号" width="72" align="center" />
            <el-table-column v-if="isColVisible('username')" prop="username" label="用户账号" min-width="110" show-overflow-tooltip />
            <el-table-column v-if="isColVisible('nickname')" prop="nickname" label="用户昵称" min-width="110" show-overflow-tooltip />
            <el-table-column v-if="isColVisible('deptName')" prop="deptName" label="归属部门" min-width="110" show-overflow-tooltip />
            <el-table-column v-if="isColVisible('mobile')" prop="mobile" label="手机号码" width="124" show-overflow-tooltip />
            <el-table-column v-if="isColVisible('status')" label="状态" width="78" align="center">
              <template #default="{ row }">
                <el-switch
                  :model-value="row.status"
                  :disabled="!hasPermission('system:user:update') || statusUpdating.has(String(row.id))"
                  :active-value="CommonStatusEnum.ENABLE"
                  :inactive-value="CommonStatusEnum.DISABLE"
                  @change="(v: string | number | boolean) => handleStatusChange(row, v)"
                />
              </template>
            </el-table-column>
            <el-table-column v-if="isColVisible('createTime')" label="创建时间" width="164" show-overflow-tooltip>
              <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="192" align="center" fixed="right">
              <template #default="{ row }">
                <TableAction
                  :actions="[
                    {
                      label: '编辑',
                      icon: Edit,
                      auth: 'system:user:update',
                      onClick: () => openForm(row),
                    },
                    {
                      label: '删除',
                      type: 'danger',
                      icon: Delete,
                      auth: 'system:user:delete',
                      popConfirm: {
                        title: deleteConfirmMessage(row.username),
                        confirm: () => handleDelete(row),
                      },
                    },
                  ]"
                  :drop-down-actions="[
                    {
                      label: '分配角色',
                      icon: UserFilled,
                      auth: 'system:permission:assign-user-role',
                      onClick: () => openAssignRole(row),
                    },
                    {
                      label: '重置密码',
                      icon: Key,
                      auth: 'system:user:update-password',
                      onClick: () => openResetPwd(row),
                    },
                  ]"
                />
              </template>
            </el-table-column>
          </el-table>
        </template>
      </ProTable>
    </div>

    <!-- 新增/编辑用户弹窗 -->
    <FormDialog
      v-model="formVisible"
      :title="form.id ? '编辑用户' : '新增用户'"
      width="560px"
      :confirm-loading="formSubmitting"
      :confirm-disabled="!formReady"
      @confirm="submitForm"
    >
      <el-form ref="formRef" v-loading="!formReady" :model="form" :rules="formRules" label-width="90px">
        <el-form-item label="用户账号" prop="username">
          <el-input
            v-model="form.username"
            :disabled="Boolean(form.id)"
            :maxlength="FIELD_LIMITS.USERNAME"
            placeholder="请输入 4~30 位字母、数字或下划线"
          />
        </el-form-item>
        <el-form-item label="用户昵称" prop="nickname">
          <el-input
            v-model="form.nickname"
            :maxlength="FIELD_LIMITS.NICKNAME"
            placeholder="请输入用户昵称"
          />
        </el-form-item>
        <el-form-item v-if="!form.id" label="初始密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            :maxlength="FIELD_LIMITS.PASSWORD_MAX"
            placeholder="请输入 8~32 位含大小写字母及数字的密码"
          />
        </el-form-item>
        <el-form-item label="归属部门">
          <el-tree-select
            v-model="form.deptId"
            :data="fullDeptTree"
            :props="{ label: 'name', value: 'id', children: 'children' }"
            check-strictly
            clearable
            placeholder="请选择归属部门"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="手机号码" prop="mobile">
          <el-input
            v-model="form.mobile"
            :maxlength="FIELD_LIMITS.MOBILE"
            placeholder="请输入 11 位手机号码"
          />
        </el-form-item>
        <el-form-item label="用户邮箱" prop="email">
          <el-input
            v-model="form.email"
            :maxlength="FIELD_LIMITS.EMAIL"
            placeholder="请输入常用邮箱地址"
          />
        </el-form-item>
        <el-form-item label="性别">
          <el-radio-group v-model="form.sex">
            <el-radio :value="1">男</el-radio>
            <el-radio :value="2">女</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input
            v-model="form.remark"
            type="textarea"
            :rows="3"
            :maxlength="FIELD_LIMITS.REMARK"
            show-word-limit
            placeholder="请输入备注说明（选填）"
          />
        </el-form-item>
      </el-form>
    </FormDialog>

    <!-- 分配角色弹窗 -->
    <FormDialog
      v-model="roleDialogVisible"
      title="分配角色"
      width="480px"
      confirm-text="保存"
      :confirm-loading="roleSubmitting"
      :confirm-disabled="!roleReady"
      :show-fullscreen="false"
      @confirm="submitAssignRole"
    >
      <el-form label-width="85px">
        <el-form-item label="用户账号">
          <el-input :model-value="assignRoleForm.username" disabled />
        </el-form-item>
        <el-form-item label="角色列表">
          <el-select
            v-model="assignRoleForm.roleIds"
            :disabled="!roleReady || roleSubmitting"
            multiple
            class="w-full"
            placeholder="请选择要分配的角色"
          >
            <el-option
              v-for="role in roleOptions"
              :key="role.id"
              :label="role.name"
              :value="role.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
    </FormDialog>

    <!-- 重置密码弹窗 -->
    <FormDialog
      v-model="pwdDialogVisible"
      title="重置密码"
      width="460px"
      confirm-text="确认重置"
      :confirm-loading="pwdSubmitting"
      :show-fullscreen="false"
      @confirm="submitResetPwd"
    >
      <el-form ref="pwdFormRef" :model="pwdForm" :rules="pwdRules" label-width="85px">
        <el-form-item label="用户账号">
          <el-input :model-value="pwdForm.username" disabled />
        </el-form-item>
        <el-form-item label="新密码" prop="password">
          <el-input
            v-model="pwdForm.password"
            type="password"
            show-password
            :maxlength="FIELD_LIMITS.PASSWORD_MAX"
            placeholder="请输入 8~32 位含大小写字母及数字的新密码"
          />
        </el-form-item>
      </el-form>
    </FormDialog>

    <!-- Excel 导入弹窗 -->
    <FormDialog
      v-model="importDialogVisible"
      title="导入用户"
      width="480px"
      confirm-text="开始导入"
      :confirm-loading="importing"
      :show-fullscreen="false"
      @confirm="submitImport"
    >
      <div class="flex flex-col gap-4">
        <div
          class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-4 py-6 text-center"
        >
          <input
            ref="importFileInputRef"
            type="file"
            accept=".xlsx,.xls"
            class="hidden"
            @change="handleImportFileChange"
          />
          <el-button
            type="primary"
            plain
            :icon="Upload"
            @click="importFileInputRef?.click()"
          >
            选择 Excel 文件
          </el-button>
          <div class="text-xs text-[#64748b]">
            <span v-if="importFile" class="font-medium text-[#1f2937]">
              已选择：{{ importFile.name }}
            </span>
            <span v-else>仅支持 .xlsx / .xls 格式文件</span>
          </div>
        </div>

        <div class="flex items-center justify-between">
          <el-checkbox v-model="importUpdateSupport">
            是否更新已存在的用户数据
          </el-checkbox>
          <el-button link type="primary" :icon="Download" @click="handleDownloadTemplate">
            下载标准模板
          </el-button>
        </div>
      </div>
    </FormDialog>
  </div>
</template>
