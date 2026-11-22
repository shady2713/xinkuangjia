<script setup lang="ts">
/**
 * 角色管理：CRUD + 分配菜单权限树 + 分配部门数据权限范围。
 */
import { Delete, Plus, Search } from '@element-plus/icons-vue';
import {
  ElMessage,
  ElMessageBox,
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
  updateRoleApi,
} from '@/api/system/role';
import DictTag from '@/components/DictTag.vue';
import ProTable from '@/components/ProTable.vue';
import {
  CommonStatusEnum,
  DICT_TYPE,
  SystemDataScopeEnum,
} from '@/constants/enums';
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
  roleType: 'business_admin',
  sort: 0,
  status: CommonStatusEnum.ENABLE as number,
  remark: '',
});

const formRules: FormRules = {
  name: [{ required: true, message: '请输入角色名称', trigger: 'blur' }],
  code: [{ required: true, message: '请输入角色标识', trigger: 'blur' }],
  roleType: [{ required: true, message: '请选择所属平台', trigger: 'change' }],
};

// 菜单权限弹窗
const menuDialogVisible = ref(false);
const menuTreeRef = ref<InstanceType<typeof ElTree>>();
const menuTreeData = ref<any[]>([]);
const currentRole = ref<RoleItem | null>(null);

// 数据权限弹窗
const scopeDialogVisible = ref(false);
const deptTreeRef = ref<InstanceType<typeof ElTree>>();
const deptTreeData = ref<any[]>([]);
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
      name: query.name || undefined,
      code: query.code || undefined,
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
    roleType: 'business_admin',
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
      roleType: detail.roleType || 'business_admin',
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
    const payload = {
      id: form.id,
      name: form.name.trim(),
      code: form.code.trim(),
      roleType: form.roleType,
      sort: form.sort,
      status: form.status,
      remark: form.remark || undefined,
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
  await ElMessageBox.confirm(`确认删除角色「${row.name}」吗？`, '删除确认', {
    type: 'warning',
  });
  await deleteRoleApi(row.id);
  ElMessage.success('删除成功');
  await loadList();
}

async function handleBatchDelete() {
  if (selectedIds.value.length === 0) return;
  await ElMessageBox.confirm(
    `确认删除已勾选的 ${selectedIds.value.length} 个角色吗？`,
    '批量删除',
    { type: 'warning' },
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
  menuTreeData.value = handleTree(menus as any[]);
  await nextTick();
  // 仅勾选叶子节点，避免 Element Plus Tree 级联自动全选子节点
  const leafIds = checkedIds.filter((id) => !parentIds.has(String(id)));
  menuTreeRef.value?.setCheckedKeys(leafIds as any[]);
}

async function submitAssignMenu() {
  if (!currentRole.value || !menuTreeRef.value) return;
  const checked = menuTreeRef.value.getCheckedKeys() as (number | string)[];
  const halfChecked = menuTreeRef.value.getHalfCheckedKeys() as (number | string)[];
  await assignRoleMenuApi({
    roleId: currentRole.value.id,
    menuIds: [...checked, ...halfChecked],
  });
  ElMessage.success('菜单权限已更新');
  menuDialogVisible.value = false;
}

async function openScopeDialog(row: RoleItem) {
  scopeForm.roleId = row.id;
  scopeForm.name = row.name;
  scopeForm.dataScope = row.dataScope ?? SystemDataScopeEnum.ALL;
  scopeForm.dataScopeDeptIds = row.dataScopeDeptIds ?? [];
  scopeDialogVisible.value = true;
  const depts: DeptSimple[] = await getSimpleDeptListApi();
  deptTreeData.value = handleTree(depts as any[]);
  await nextTick();
  deptTreeRef.value?.setCheckedKeys(scopeForm.dataScopeDeptIds as any[]);
}

async function submitDataScope() {
  if (!scopeForm.roleId) return;
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
            <el-input v-model="query.name" placeholder="请输入角色名称" clearable />
          </el-form-item>
          <el-form-item label="角色标识">
            <el-input v-model="query.code" placeholder="请输入角色标识" clearable />
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

      <el-table
        :data="list"
        border
        stripe
        @selection-change="(rows: RoleItem[]) => (selectedIds = rows.map((r) => r.id))"
      >
        <el-table-column type="selection" width="44" />
        <el-table-column prop="id" label="编号" width="80" />
        <el-table-column prop="name" label="角色名称" min-width="140" />
        <el-table-column prop="code" label="角色标识" min-width="140" />
        <el-table-column prop="roleType" label="所属平台" width="130">
          <template #default="{ row }">
            <el-tag size="small" :type="row.roleType === 'super_admin' ? 'danger' : 'primary'">
              {{ row.roleType === 'super_admin' ? '超管平台' : '业务平台' }}
            </el-tag>
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
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button v-has-permi="'system:role:update'" link type="primary" size="small" @click="openForm(row)">
              编辑
            </el-button>
            <el-button
              v-has-permi="'system:permission:assign-role-menu'"
              link
              type="primary"
              size="small"
              @click="openMenuDialog(row)"
            >
              菜单权限
            </el-button>
            <el-button
              v-has-permi="'system:permission:assign-role-data-scope'"
              link
              type="primary"
              size="small"
              @click="openScopeDialog(row)"
            >
              数据权限
            </el-button>
            <el-button v-has-permi="'system:role:delete'" link type="danger" size="small" @click="handleDelete(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </ProTable>

    <!-- 新增/编辑角色弹窗 -->
    <el-dialog v-model="formVisible" :title="form.id ? '编辑角色' : '新增角色'" width="520px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="90px">
        <el-form-item label="角色名称" prop="name">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="角色标识" prop="code">
          <el-input v-model="form.code" />
        </el-form-item>
        <el-form-item label="所属平台" prop="roleType">
          <el-select v-model="form.roleType" class="w-full" :disabled="Boolean(form.id)">
            <el-option label="业务平台 (business_admin)" value="business_admin" />
            <el-option label="超管平台 (super_admin)" value="super_admin" />
          </el-select>
        </el-form-item>
        <el-form-item label="显示排序">
          <el-input-number v-model="form.sort" :min="0" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio :value="CommonStatusEnum.ENABLE">开启</el-radio>
            <el-radio :value="CommonStatusEnum.DISABLE">禁用</el-radio>
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

    <!-- 分配菜单权限弹窗 -->
    <el-dialog v-model="menuDialogVisible" :title="`分配菜单权限 - ${currentRole?.name || ''}`" width="500px">
      <div class="max-h-[420px] overflow-auto rounded border border-[#e4e4e7] p-2">
        <el-tree
          ref="menuTreeRef"
          :data="menuTreeData"
          :props="{ label: 'name', children: 'children' }"
          node-key="id"
          show-checkbox
          default-expand-all
        />
      </div>
      <template #footer>
        <el-button @click="menuDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitAssignMenu">保存</el-button>
      </template>
    </el-dialog>

    <!-- 分配数据权限弹窗 -->
    <el-dialog v-model="scopeDialogVisible" title="分配数据权限" width="500px">
      <el-form label-width="90px">
        <el-form-item label="角色名称">
          <el-input :model-value="scopeForm.name" disabled />
        </el-form-item>
        <el-form-item label="权限范围">
          <el-select v-model="scopeForm.dataScope" class="w-full">
            <el-option label="全部数据权限" :value="SystemDataScopeEnum.ALL" />
            <el-option label="指定部门数据权限" :value="SystemDataScopeEnum.DEPT_CUSTOM" />
            <el-option label="本部门数据权限" :value="SystemDataScopeEnum.DEPT_ONLY" />
            <el-option label="本部门及以下数据权限" :value="SystemDataScopeEnum.DEPT_AND_CHILD" />
            <el-option label="仅本人数据权限" :value="SystemDataScopeEnum.DEPT_SELF" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="scopeForm.dataScope === SystemDataScopeEnum.DEPT_CUSTOM" label="指定部门">
          <div class="max-h-[280px] w-full overflow-auto rounded border border-[#e4e4e7] p-2">
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
      <template #footer>
        <el-button @click="scopeDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitDataScope">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
