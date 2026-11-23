<script setup lang="ts">
/**
 * 菜单管理：树形表格 CRUD（目录 / 菜单 / 按钮）。
 */
import { Delete, Edit, Plus, Search } from '@element-plus/icons-vue';
import {
  ElMessage,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';

import {
  createMenuApi,
  deleteMenuApi,
  getMenuApi,
  getMenuListApi,
  type MenuItem,
  updateMenuApi,
} from '@/api/system/menu';
import DictTag from '@/components/DictTag.vue';
import FormDialog from '@/components/FormDialog.vue';
import MenuIcon from '@/components/MenuIcon.vue';
import ProTable from '@/components/ProTable.vue';
import TableAction from '@/components/TableAction.vue';
import {
  CommonStatusEnum,
  DICT_TYPE,
  SystemMenuTypeEnum,
} from '@/constants/enums';
import {
  deleteConfirmMessage,
  FIELD_LIMITS,
  maxLenRule,
  requiredRule,
} from '@/constants/validation';
import { handleTree } from '@/utils/tree';

defineOptions({ name: 'SystemMenu' });

const loading = ref(false);
const rawList = ref<MenuItem[]>([]);
const treeList = computed(() =>
  handleTree(rawList.value as { id: number | string; parentId?: number | string }[]),
);
const parentOptions = computed(() => [
  { id: 0, name: '主类目', children: treeList.value },
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
  type: SystemMenuTypeEnum.DIR as number,
  icon: '',
  path: '',
  component: '',
  componentName: '',
  permission: '',
  sort: 0,
  status: CommonStatusEnum.ENABLE as number,
  visible: true,
  keepAlive: true,
  alwaysShow: true,
});

const formRules: FormRules = {
  name: [requiredRule('菜单名称'), maxLenRule('菜单名称', FIELD_LIMITS.MENU_NAME)],
  sort: [requiredRule('显示排序', 'change')],
  icon: [maxLenRule('图标标识', FIELD_LIMITS.MENU_ICON)],
  path: [maxLenRule('路由地址', FIELD_LIMITS.MENU_PATH)],
  component: [maxLenRule('组件路径', FIELD_LIMITS.MENU_COMPONENT)],
  componentName: [maxLenRule('组件名称', FIELD_LIMITS.MENU_COMPONENT_NAME)],
  permission: [maxLenRule('权限标识', FIELD_LIMITS.MENU_PERMISSION)],
};

async function loadList() {
  loading.value = true;
  try {
    rawList.value = await getMenuListApi({
      name: query.name.trim() || undefined,
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

async function openForm(row?: MenuItem, parentId: number | string = 0) {
  Object.assign(form, {
    id: undefined,
    parentId,
    name: '',
    type: parentId === 0 ? SystemMenuTypeEnum.DIR : SystemMenuTypeEnum.MENU,
    icon: '',
    path: '',
    component: '',
    componentName: '',
    permission: '',
    sort: 0,
    status: CommonStatusEnum.ENABLE,
    visible: true,
    keepAlive: true,
    alwaysShow: true,
  });
  formVisible.value = true;
  if (row?.id) {
    const detail = await getMenuApi(row.id);
    Object.assign(form, {
      id: detail.id,
      parentId: detail.parentId ?? 0,
      name: detail.name,
      type: detail.type,
      icon: detail.icon || '',
      path: detail.path || '',
      component: detail.component || '',
      componentName: detail.componentName || '',
      permission: detail.permission || '',
      sort: detail.sort ?? 0,
      status: detail.status ?? CommonStatusEnum.ENABLE,
      visible: detail.visible !== false,
      keepAlive: detail.keepAlive !== false,
      alwaysShow: detail.alwaysShow !== false,
    });
  }
}

async function submitForm() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  formSubmitting.value = true;
  try {
    const payload = {
      ...form,
      name: form.name.trim(),
      icon: form.icon.trim(),
      path: form.path.trim(),
      component: form.component.trim(),
      componentName: form.componentName.trim(),
      permission: form.permission.trim(),
    };
    if (form.id) {
      await updateMenuApi(payload);
    } else {
      await createMenuApi(payload);
    }
    ElMessage.success(form.id ? '修改成功' : '新增成功');
    formVisible.value = false;
    await loadList();
  } finally {
    formSubmitting.value = false;
  }
}

async function handleDelete(row: MenuItem) {
  await deleteMenuApi(row.id);
  ElMessage.success('删除成功');
  await loadList();
}

onMounted(() => {
  void loadList();
});
</script>

<template>
  <div>
    <ProTable
      title="菜单列表"
      :loading="loading"
      :show-pagination="false"
      @refresh="loadList"
    >
      <template #search>
        <el-form :inline="true" :model="query" @submit.prevent="loadList">
          <el-form-item label="菜单名称">
            <el-input
              v-model="query.name"
              placeholder="请输入菜单名称"
              :maxlength="FIELD_LIMITS.MENU_NAME"
              clearable
              style="width: 180px"
            />
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="query.status" placeholder="全部" clearable style="width: 110px">
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
          v-has-permi="'system:menu:create'"
          type="primary"
          :icon="Plus"
          size="small"
          @click="openForm()"
        >
          新增
        </el-button>
      </template>

      <template #default="{ size }">
        <el-table :data="treeList" :size="size" row-key="id" border default-expand-all>
          <el-table-column prop="name" label="菜单名称" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="inline-flex items-center gap-1.5">
                <MenuIcon v-if="row.icon && row.icon !== '#'" :name="row.icon" />
                <span>{{ row.name }}</span>
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="type" label="类型" width="84" align="center">
            <template #default="{ row }">
              <DictTag :type="DICT_TYPE.SYSTEM_MENU_TYPE" :value="row.type" />
            </template>
          </el-table-column>
          <el-table-column prop="sort" label="排序" width="70" align="center" />
          <el-table-column prop="permission" label="权限标识" min-width="240" show-overflow-tooltip />
          <el-table-column prop="component" label="组件路径" min-width="190" show-overflow-tooltip />
          <el-table-column label="状态" width="82" align="center">
            <template #default="{ row }">
              <DictTag :type="DICT_TYPE.COMMON_STATUS" :value="row.status" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="232" align="center" fixed="right">
            <template #default="{ row }">
              <TableAction
                :actions="[
                  {
                    label: '新增下级',
                    icon: Plus,
                    auth: 'system:menu:create',
                    onClick: () => openForm(undefined, row.id),
                  },
                  {
                    label: '编辑',
                    icon: Edit,
                    auth: 'system:menu:update',
                    onClick: () => openForm(row),
                  },
                  {
                    label: '删除',
                    type: 'danger',
                    icon: Delete,
                    auth: 'system:menu:delete',
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
      :title="form.id ? '编辑菜单' : '新增菜单'"
      width="580px"
      :confirm-loading="formSubmitting"
      @confirm="submitForm"
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="95px">
        <el-form-item label="上级菜单">
          <el-tree-select
            v-model="form.parentId"
            :data="parentOptions"
            :props="{ label: 'name', value: 'id', children: 'children' }"
            check-strictly
            placeholder="请选择上级菜单"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="菜单类型">
          <el-radio-group v-model="form.type">
            <el-radio-button :value="SystemMenuTypeEnum.DIR">目录</el-radio-button>
            <el-radio-button :value="SystemMenuTypeEnum.MENU">菜单</el-radio-button>
            <el-radio-button :value="SystemMenuTypeEnum.BUTTON">按钮</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="菜单名称" prop="name">
          <el-input
            v-model="form.name"
            :maxlength="FIELD_LIMITS.MENU_NAME"
            placeholder="请输入菜单名称（最多 50 字符）"
          />
        </el-form-item>
        <el-form-item v-if="form.type !== SystemMenuTypeEnum.BUTTON" label="图标标识" prop="icon">
          <el-input
            v-model="form.icon"
            :maxlength="FIELD_LIMITS.MENU_ICON"
            placeholder="例如 ep:tools"
          />
        </el-form-item>
        <el-form-item v-if="form.type !== SystemMenuTypeEnum.BUTTON" label="路由地址" prop="path">
          <el-input
            v-model="form.path"
            :maxlength="FIELD_LIMITS.MENU_PATH"
            placeholder="例如 user 或 /system"
          />
        </el-form-item>
        <el-form-item v-if="form.type === SystemMenuTypeEnum.MENU" label="组件路径" prop="component">
          <el-input
            v-model="form.component"
            :maxlength="FIELD_LIMITS.MENU_COMPONENT"
            placeholder="例如 system/user/index"
          />
        </el-form-item>
        <el-form-item v-if="form.type === SystemMenuTypeEnum.MENU" label="组件名称" prop="componentName">
          <el-input
            v-model="form.componentName"
            :maxlength="FIELD_LIMITS.MENU_COMPONENT_NAME"
            placeholder="例如 SystemUser"
          />
        </el-form-item>
        <el-form-item v-if="form.type !== SystemMenuTypeEnum.DIR" label="权限标识" prop="permission">
          <el-input
            v-model="form.permission"
            :maxlength="FIELD_LIMITS.MENU_PERMISSION"
            placeholder="例如 system:user:query"
          />
        </el-form-item>
        <el-form-item label="显示排序" prop="sort">
          <el-input-number v-model="form.sort" :min="0" :max="99999" />
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
