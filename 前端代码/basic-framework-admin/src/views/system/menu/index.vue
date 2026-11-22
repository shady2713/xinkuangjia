<script setup lang="ts">
/**
 * 菜单管理：树形表格 CRUD（目录 / 菜单 / 按钮）。
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
  createMenuApi,
  deleteMenuApi,
  getMenuApi,
  getMenuListApi,
  type MenuItem,
  updateMenuApi,
} from '@/api/system/menu';
import DictTag from '@/components/DictTag.vue';
import MenuIcon from '@/components/MenuIcon.vue';
import ProTable from '@/components/ProTable.vue';
import {
  CommonStatusEnum,
  DICT_TYPE,
  SystemMenuTypeEnum,
} from '@/constants/enums';
import { handleTree } from '@/utils/tree';

defineOptions({ name: 'SystemMenu' });

const loading = ref(false);
const rawList = ref<MenuItem[]>([]);
const treeList = computed(() => handleTree(rawList.value as any[]));
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
  menuType: 'super_admin',
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
  name: [{ required: true, message: '请输入菜单名称', trigger: 'blur' }],
  sort: [{ required: true, message: '请输入排序', trigger: 'blur' }],
};

async function loadList() {
  loading.value = true;
  try {
    rawList.value = await getMenuListApi({
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

async function openForm(row?: MenuItem, parentId: number | string = 0) {
  Object.assign(form, {
    id: undefined,
    parentId,
    name: '',
    type: parentId === 0 ? SystemMenuTypeEnum.DIR : SystemMenuTypeEnum.MENU,
    menuType: row?.menuType || 'super_admin',
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
      menuType: detail.menuType || 'super_admin',
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
    const payload: any = { ...form };
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
  await ElMessageBox.confirm(`确认删除菜单「${row.name}」吗？`, '删除确认', {
    type: 'warning',
  });
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
            <el-input v-model="query.name" placeholder="请输入菜单名称" clearable />
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
          v-has-permi="'system:menu:create'"
          type="primary"
          :icon="Plus"
          size="small"
          @click="openForm()"
        >
          新增
        </el-button>
      </template>

      <el-table :data="treeList" row-key="id" border default-expand-all>
        <el-table-column prop="name" label="菜单名称" min-width="200">
          <template #default="{ row }">
            <span class="inline-flex items-center gap-1.5">
              <MenuIcon v-if="row.icon && row.icon !== '#'" :name="row.icon" />
              <span>{{ row.name }}</span>
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="type" label="类型" width="90" align="center">
          <template #default="{ row }">
            <DictTag :type="DICT_TYPE.SYSTEM_MENU_TYPE" :value="row.type" />
          </template>
        </el-table-column>
        <el-table-column prop="sort" label="排序" width="75" align="center" />
        <el-table-column prop="permission" label="权限标识" min-width="180" show-overflow-tooltip />
        <el-table-column prop="component" label="组件路径" min-width="180" show-overflow-tooltip />
        <el-table-column label="状态" width="85" align="center">
          <template #default="{ row }">
            <DictTag :type="DICT_TYPE.COMMON_STATUS" :value="row.status" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button
              v-has-permi="'system:menu:create'"
              link
              type="primary"
              size="small"
              @click="openForm(undefined, row.id)"
            >
              新增下级
            </el-button>
            <el-button
              v-has-permi="'system:menu:update'"
              link
              type="primary"
              size="small"
              @click="openForm(row)"
            >
              编辑
            </el-button>
            <el-button
              v-has-permi="'system:menu:delete'"
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

    <el-dialog v-model="formVisible" :title="form.id ? '编辑菜单' : '新增菜单'" width="580px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="95px">
        <el-form-item label="上级菜单">
          <el-tree-select
            v-model="form.parentId"
            :data="parentOptions"
            :props="{ label: 'name', value: 'id', children: 'children' }"
            check-strictly
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
        <el-form-item label="所属平台">
          <el-select v-model="form.menuType" class="w-full">
            <el-option label="超管平台 (super_admin)" value="super_admin" />
            <el-option label="业务平台 (business_admin)" value="business_admin" />
          </el-select>
        </el-form-item>
        <el-form-item label="菜单名称" prop="name">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item v-if="form.type !== SystemMenuTypeEnum.BUTTON" label="图标标识">
          <el-input v-model="form.icon" placeholder="例如 ep:tools" />
        </el-form-item>
        <el-form-item v-if="form.type !== SystemMenuTypeEnum.BUTTON" label="路由地址">
          <el-input v-model="form.path" placeholder="例如 user 或 /system" />
        </el-form-item>
        <el-form-item v-if="form.type === SystemMenuTypeEnum.MENU" label="组件路径">
          <el-input v-model="form.component" placeholder="例如 system/user/index" />
        </el-form-item>
        <el-form-item v-if="form.type === SystemMenuTypeEnum.MENU" label="组件名称">
          <el-input v-model="form.componentName" placeholder="例如 SystemUser" />
        </el-form-item>
        <el-form-item v-if="form.type !== SystemMenuTypeEnum.DIR" label="权限标识">
          <el-input v-model="form.permission" placeholder="例如 system:user:query" />
        </el-form-item>
        <el-form-item label="显示排序" prop="sort">
          <el-input-number v-model="form.sort" :min="0" />
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
