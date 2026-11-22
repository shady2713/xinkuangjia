<script setup lang="ts">
/**
 * 角色管理：CRUD + 分配菜单权限树 + 分配部门数据权限范围。
 */
import {
  DataAnalysis,
  Delete,
  Edit,
  Menu as MenuIconEl,
  Plus,
  Search,
} from '@element-plus/icons-vue';
import {
  ElMessage,
  type ElTree,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import { nextTick, onMounted, reactive, ref } from 'vue';

import { type DeptSimple, getSimpleDeptListApi } from '@/api/system/dept';
import { getSimpleMenuListApi, type MenuSimple } from '@/api/system/menu';
import {
  assignRoleDataScopeApi,
  assignRoleMenuApi,
  getRoleMenuListApi,
} from '@/api/system/permission';
import {
  createRoleApi,
  deleteRoleApi,
  deleteRoleListApi,
  getRoleApi,
  getRolePageApi,
  type RoleItem,
  type RoleSaveReq,
  updateRoleApi,
} from '@/api/system/role';
import DictTag from '@/components/DictTag.vue';
import FormDialog from '@/components/FormDialog.vue';
import ProTable from '@/components/ProTable.vue';
import TableAction from '@/components/TableAction.vue';
import {
  CommonStatusEnum,
  DICT_TYPE,
  SystemDataScopeEnum,
} from '@/constants/enums';
import {
  deleteConfirmMessage,
  FIELD_LIMITS,
  maxLenRule,
  requiredRule,
} from '@/constants/validation';
import { confirmAction } from '@/utils/confirm';
import { formatDateTime } from '@/utils/format';
import { handleTree } from '@/utils/tree';

defineOptions({ name: 'SystemRole' });

const loading = ref(false);
const list = ref<RoleItem[]>([]);
const total = ref(0);
const selectedIds = ref<(number | string)[]>([]);

const query = reactive({
  pageNo: 1,
  pageSize: 10,
  name: '',
  code: '',
  status: undefined as number | undefined,
});

const formVisible = ref(false);
const formSubmitting = ref(false);
const formRef = ref<FormInstance>();
const form = reactive({
  id: undefined as number | string | undefined,
  name: '',
  code: '',
  sort: 0,
  status: CommonStatusEnum.ENABLE as number,
  remark: '',
});

const formRules: FormRules = {
  name: [requiredRule('角色名称'), maxLenRule('角色名称', FIELD_LIMITS.ROLE_NAME)],
  code: [requiredRule('角色标识'), maxLenRule('角色标识', FIELD_LIMITS.ROLE_CODE)],
  remark: [maxLenRule('备注', FIELD_LIMITS.REMARK)],
};

// 菜单权限弹窗
const menuDialogVisible = ref(false);
const menuSubmitting = ref(false);
const menuTreeRef = ref<InstanceType<typeof ElTree>>();
const menuTreeData = ref<Record<string, unknown>[]>([]);
const currentRole = ref<RoleItem | null>(null);

// 数据权限弹窗
const scopeDialogVisible = ref(false);
const scopeSubmitting = ref(false);
const deptTreeRef = ref<InstanceType<typeof ElTree>>();
const deptTreeData = ref<Record<string, unknown>[]>([]);
const scopeForm = reactive({
  roleId: undefined as number | string | undefined,
  name: '',
  dataScope: SystemDataScopeEnum.ALL as number,
  dataScopeDeptIds: [] as (number | string)[],
});

async function loadList() {
  loading.value = true;
  try {
    const res = await getRolePageApi({
      pageNo: query.pageNo,
      pageSize: query.pageSize,
      name: query.name.trim() || undefined,
      code: query.code.trim() || undefined,
      status: query.status,
    });
    list.value = res.list ?? [];
    total.value = res.total ?? 0;
  } finally {
    loading.value = false;
  }
}

function handleSearch() {
  query.pageNo = 1;
  void loadList();
}

function handleReset() {
  query.name = '';
  query.code = '';
  query.status = undefined;
  query.pageNo = 1;
  void loadList();
}

async function openForm(row?: RoleItem) {
  Object.assign(form, {
    id: undefined,
    name: '',
    code: '',
    sort: 0,
    status: CommonStatusEnum.ENABLE,
    remark: '',
  });
  formVisible.value = true;
  if (row?.id) {
    const detail = await getRoleApi(row.id);
    Object.assign(form, {
      id: detail.id,
      name: detail.name,
      code: detail.code,
      sort: detail.sort ?? 0,
      status: detail.status ?? CommonStatusEnum.ENABLE,
      remark: detail.remark || '',
    });
  }
}

async function submitForm() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  formSubmitting.value = true;
  try {
    const payload: RoleSaveReq = {
      id: form.id,
      name: form.name.trim(),
      code: form.code.trim(),
      sort: form.sort,
      status: form.status,
      remark: form.remark.trim() || undefined,
    };
    if (form.id) {
      await updateRoleApi(payload);
    } else {
      await createRoleApi(payload);
    }
    ElMessage.success(form.id ? '修改成功' : '新增成功');
    formVisible.value = false;
    await loadList();
  } finally {
    formSubmitting.value = false;
  }
}

async function handleDelete(row: RoleItem) {
  await deleteRoleApi(row.id);
  ElMessage.success('删除成功');
  await loadList();
}

async function handleBatchDelete() {
  if (selectedIds.value.length === 0) return;
  await confirmAction(
    `是否确认批量删除已勾选的 ${selectedIds.value.length} 个角色？删除后无法恢复。`,
    { title: '批量删除确认', confirmText: '确认删除' },
  );
  await deleteRoleListApi(selectedIds.value);
  ElMessage.success('批量删除成功');
  selectedIds.value = [];
  await loadList();
}

async function openMenuDialog(row: RoleItem) {
  currentRole.value = row;
  menuDialogVisible.value = true;
  const [menus, checkedIds] = await Promise.all([
    getSimpleMenuListApi(),
    getRoleMenuListApi(row.id),
  ]);
  const parentIds = new Set(menus.map((m: MenuSimple) => String(m.parentId)));
  menuTreeData.value = handleTree(
    menus as { id: number | string; parentId?: number | string }[],
  );
  await nextTick();
  const leafIds = checkedIds.filter((id) => !parentIds.has(String(id)));
  menuTreeRef.value?.setCheckedKeys(leafIds as (number | string)[]);
}

async function submitAssignMenu() {
  if (!currentRole.value || !menuTreeRef.value) return;
  menuSubmitting.value = true;
  try {
    const checked = menuTreeRef.value.getCheckedKeys() as (number | string)[];
    const halfChecked = menuTreeRef.value.getHalfCheckedKeys() as (number | string)[];
    await assignRoleMenuApi({
      roleId: currentRole.value.id,
      menuIds: [...checked, ...halfChecked],
    });
    ElMessage.success('菜单权限已更新');
    menuDialogVisible.value = false;
  } finally {
    menuSubmitting.value = false;
  }
}

async function openScopeDialog(row: RoleItem) {
  scopeForm.roleId = row.id;
  scopeForm.name = row.name;
  scopeForm.dataScope = row.dataScope ?? SystemDataScopeEnum.ALL;
  scopeForm.dataScopeDeptIds = row.dataScopeDeptIds ?? [];
  scopeDialogVisible.value = true;
  const depts: DeptSimple[] = await getSimpleDeptListApi();
  deptTreeData.value = handleTree(
    depts as { id: number | string; parentId?: number | string }[],
  );
  await nextTick();
  deptTreeRef.value?.setCheckedKeys(scopeForm.dataScopeDeptIds as (number | string)[]);
}

async function submitDataScope() {
  if (!scopeForm.roleId) return;
  scopeSubmitting.value = true;
  try {
    const deptIds =
      scopeForm.dataScope === SystemDataScopeEnum.DEPT_CUSTOM
        ? ((deptTreeRef.value?.getCheckedKeys() as (number | string)[]) ?? [])
        : [];
    await assignRoleDataScopeApi({
      roleId: scopeForm.roleId,
      dataScope: scopeForm.dataScope,
      dataScopeDeptIds: deptIds,
    });
    ElMessage.success('数据权限已更新');
    scopeDialogVisible.value = false;
    await loadList();
  } finally {
    scopeSubmitting.value = false;
  }
}

onMounted(() => {
  void loadList();
});
</script>

<template>
  <div>
    <ProTable
      title="角色列表"
      :loading="loading"
      :total="total"
      v-model:page-no="query.pageNo"
      v-model:page-size="query.pageSize"
      @refresh="loadList"
    >
      <template #search>
        <el-form :inline="true" :model="query" @submit.prevent="handleSearch">
          <el-form-item label="角色名称">
            <el-input
              v-model="query.name"
              placeholder="请输入角色名称"
              :maxlength="FIELD_LIMITS.ROLE_NAME"
              clearable
              style="width: 170px"
            />
          </el-form-item>
          <el-form-item label="角色标识">
            <el-input
              v-model="query.code"
              placeholder="请输入角色标识"
              :maxlength="FIELD_LIMITS.ROLE_CODE"
              clearable
              style="width: 170px"
            />
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="query.status" placeholder="全部" clearable style="width: 110px">
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
          v-has-permi="'system:role:create'"
          type="primary"
          :icon="Plus"
          size="small"
          @click="openForm()"
        >
          新增
        </el-button>
        <el-button
          v-has-permi="'system:role:delete'"
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

      <template #default="{ size }">
        <el-table
          :data="list"
          :size="size"
          border
          stripe
          @selection-change="(rows: RoleItem[]) => (selectedIds = rows.map((r) => r.id))"
        >
          <el-table-column type="selection" width="44" align="center" />
          <el-table-column prop="id" label="编号" width="76" align="center" />
          <el-table-column prop="name" label="角色名称" min-width="140" show-overflow-tooltip />
          <el-table-column prop="code" label="角色标识" min-width="150" show-overflow-tooltip />
          <el-table-column prop="roleType" label="所属平台" width="120" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.roleType === 'super_admin' ? 'danger' : 'primary'">
                {{ row.roleType === 'super_admin' ? '超管平台' : '业务平台' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="sort" label="排序" width="76" align="center" />
          <el-table-column label="状态" width="84" align="center">
            <template #default="{ row }">
              <DictTag :type="DICT_TYPE.COMMON_STATUS" :value="row.status" />
            </template>
          </el-table-column>
          <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip />
          <el-table-column label="创建时间" width="164" show-overflow-tooltip>
            <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="192" align="center" fixed="right">
            <template #default="{ row }">
              <TableAction
                :actions="[
                  {
                    label: '编辑',
                    icon: Edit,
                    auth: 'system:role:update',
                    onClick: () => openForm(row),
                  },
                  {
                    label: '删除',
                    type: 'danger',
                    icon: Delete,
                    auth: 'system:role:delete',
                    popConfirm: {
                      title: deleteConfirmMessage(row.name),
                      confirm: () => handleDelete(row),
                    },
                  },
                ]"
                :drop-down-actions="[
                  {
                    label: '菜单权限',
                    icon: MenuIconEl,
                    auth: 'system:permission:assign-role-menu',
                    onClick: () => openMenuDialog(row),
                  },
                  {
                    label: '数据权限',
                    icon: DataAnalysis,
                    auth: 'system:permission:assign-role-data-scope',
                    onClick: () => openScopeDialog(row),
                  },
                ]"
              />
            </template>
          </el-table-column>
        </el-table>
      </template>
    </ProTable>

    <!-- 新增/编辑角色弹窗 -->
    <FormDialog
      v-model="formVisible"
      :title="form.id ? '编辑角色' : '新增角色'"
      width="540px"
      :confirm-loading="formSubmitting"
      @confirm="submitForm"
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="90px">
        <el-form-item label="角色名称" prop="name">
          <el-input
            v-model="form.name"
            :maxlength="FIELD_LIMITS.ROLE_NAME"
            placeholder="请输入角色名称（最多 30 字符）"
          />
        </el-form-item>
        <el-form-item label="角色标识" prop="code">
          <el-input
            v-model="form.code"
            :maxlength="FIELD_LIMITS.ROLE_CODE"
            placeholder="请输入角色标识，如 business_operator"
          />
        </el-form-item>
        <el-form-item label="显示顺序">
          <el-input-number v-model="form.sort" :min="0" :max="99999" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio :value="CommonStatusEnum.ENABLE">开启</el-radio>
            <el-radio :value="CommonStatusEnum.DISABLE">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input
            v-model="form.remark"
            type="textarea"
            :rows="3"
            :maxlength="FIELD_LIMITS.REMARK"
            show-word-limit
            placeholder="请输入角色职责说明（选填）"
          />
        </el-form-item>
      </el-form>
    </FormDialog>

    <!-- 分配菜单权限弹窗 -->
    <FormDialog
      v-model="menuDialogVisible"
      :title="`菜单权限 - ${currentRole?.name || ''}`"
      width="540px"
      confirm-text="保存"
      :confirm-loading="menuSubmitting"
      @confirm="submitAssignMenu"
    >
      <div class="max-h-[420px] overflow-auto rounded-md border border-[#e4e4e7] p-3">
        <el-tree
          ref="menuTreeRef"
          :data="menuTreeData"
          :props="{ label: 'name', children: 'children' }"
          node-key="id"
          show-checkbox
          default-expand-all
        />
      </div>
    </FormDialog>

    <!-- 分配数据权限弹窗 -->
    <FormDialog
      v-model="scopeDialogVisible"
      :title="`数据权限 - ${scopeForm.name}`"
      width="540px"
      confirm-text="保存"
      :confirm-loading="scopeSubmitting"
      @confirm="submitDataScope"
    >
      <el-form label-width="90px">
        <el-form-item label="权限范围">
          <el-select v-model="scopeForm.dataScope" class="w-full" placeholder="请选择数据权限范围">
            <el-option label="全部数据权限" :value="SystemDataScopeEnum.ALL" />
            <el-option label="指定部门数据权限" :value="SystemDataScopeEnum.DEPT_CUSTOM" />
            <el-option label="本部门数据权限" :value="SystemDataScopeEnum.DEPT_ONLY" />
            <el-option label="本部门及以下数据权限" :value="SystemDataScopeEnum.DEPT_AND_CHILD" />
            <el-option label="仅本人数据权限" :value="SystemDataScopeEnum.DEPT_SELF" />
          </el-select>
        </el-form-item>
        <el-form-item
          v-if="scopeForm.dataScope === SystemDataScopeEnum.DEPT_CUSTOM"
          label="指定部门"
        >
          <div class="max-h-[300px] w-full overflow-auto rounded-md border border-[#e4e4e7] p-3">
            <el-tree
              ref="deptTreeRef"
              :data="deptTreeData"
              :props="{ label: 'name', children: 'children' }"
              node-key="id"
              show-checkbox
              check-strictly
              default-expand-all
            />
          </div>
        </el-form-item>
      </el-form>
    </FormDialog>
  </div>
</template>
