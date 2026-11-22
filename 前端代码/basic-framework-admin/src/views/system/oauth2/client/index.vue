<script setup lang="ts">
/**
 * OAuth2.0 第三方开放应用管理（仅保留 clientId / secret / 有效期 / grantTypes / scopes 核心字段）。
 */
import { Delete, Plus, Search } from '@element-plus/icons-vue';
import {
  ElMessage,
  ElMessageBox,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import { onMounted, reactive, ref } from 'vue';

import {
  createOAuth2ClientApi,
  deleteOAuth2ClientApi,
  deleteOAuth2ClientListApi,
  getOAuth2ClientApi,
  getOAuth2ClientPageApi,
  type OAuth2ClientItem,
  updateOAuth2ClientApi,
} from '@/api/system/oauth2';
import DictTag from '@/components/DictTag.vue';
import ProTable from '@/components/ProTable.vue';
import { CommonStatusEnum, DICT_TYPE } from '@/constants/enums';
import { formatDateTime } from '@/utils/format';

defineOptions({ name: 'SystemOAuth2Client' });

const loading = ref(false);
const list = ref<OAuth2ClientItem[]>([]);
const total = ref(0);
const selectedIds = ref<(number | string)[]>([]);

const query = reactive({
  pageNo: 1,
  pageSize: 10,
  name: '',
  status: undefined as number | undefined,
});

const formVisible = ref(false);
const formSubmitting = ref(false);
const formRef = ref<FormInstance>();
const form = reactive({
  id: undefined as number | string | undefined,
  clientId: '',
  secret: '',
  name: '',
  description: '',
  status: CommonStatusEnum.ENABLE as number,
  accessTokenValiditySeconds: 1800,
  refreshTokenValiditySeconds: 2592000,
  authorizedGrantTypes: ['client_credentials'] as string[],
  scopesText: '',
});

const formRules: FormRules = {
  clientId: [{ required: true, message: '请输入客户端编号', trigger: 'blur' }],
  secret: [
    {
      validator: (_rule, val, cb) => {
        if (!form.id && !String(val || '').trim()) {
          cb(new Error('新增客户端时必须设置密钥'));
        } else {
          cb();
        }
      },
      trigger: 'blur',
    },
  ],
  name: [{ required: true, message: '请输入应用名称', trigger: 'blur' }],
};

async function loadList() {
  loading.value = true;
  try {
    const res = await getOAuth2ClientPageApi({
      pageNo: query.pageNo,
      pageSize: query.pageSize,
      name: query.name || undefined,
      status: query.status,
    });
    list.value = res.list ?? [];
    total.value = res.total ?? 0;
  } finally {
    loading.value = false;
  }
}

function handleReset() {
  query.name = '';
  query.status = undefined;
  query.pageNo = 1;
  void loadList();
}

async function openForm(row?: OAuth2ClientItem) {
  Object.assign(form, {
    id: undefined,
    clientId: '',
    secret: '',
    name: '',
    description: '',
    status: CommonStatusEnum.ENABLE,
    accessTokenValiditySeconds: 1800,
    refreshTokenValiditySeconds: 2592000,
    authorizedGrantTypes: ['client_credentials'],
    scopesText: '',
  });
  formVisible.value = true;
  if (row?.id) {
    const detail = await getOAuth2ClientApi(row.id);
    Object.assign(form, {
      id: detail.id,
      clientId: detail.clientId,
      secret: '',
      name: detail.name,
      description: detail.description || '',
      status: detail.status ?? CommonStatusEnum.ENABLE,
      accessTokenValiditySeconds: detail.accessTokenValiditySeconds ?? 1800,
      refreshTokenValiditySeconds: detail.refreshTokenValiditySeconds ?? 2592000,
      authorizedGrantTypes: detail.authorizedGrantTypes ?? ['client_credentials'],
      scopesText: (detail.scopes ?? []).join(','),
    });
  }
}

async function submitForm() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  formSubmitting.value = true;
  try {
    const scopes = form.scopesText
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const payload = {
      id: form.id,
      clientId: form.clientId.trim(),
      secret: form.secret.trim() || undefined,
      name: form.name.trim(),
      description: form.description || undefined,
      status: form.status,
      accessTokenValiditySeconds: form.accessTokenValiditySeconds,
      refreshTokenValiditySeconds: form.refreshTokenValiditySeconds,
      authorizedGrantTypes: form.authorizedGrantTypes,
      scopes,
    };
    if (form.id) {
      await updateOAuth2ClientApi(payload);
    } else {
      await createOAuth2ClientApi(payload);
    }
    ElMessage.success(form.id ? '修改成功' : '新增成功');
    formVisible.value = false;
    await loadList();
  } finally {
    formSubmitting.value = false;
  }
}

async function handleDelete(row: OAuth2ClientItem) {
  await ElMessageBox.confirm(`确认删除应用「${row.name}」吗？`, '删除确认', {
    type: 'warning',
  });
  await deleteOAuth2ClientApi(row.id);
  ElMessage.success('删除成功');
  await loadList();
}

async function handleBatchDelete() {
  if (selectedIds.value.length === 0) return;
  await ElMessageBox.confirm(
    `确认删除已勾选的 ${selectedIds.value.length} 个应用吗？`,
    '批量删除',
    { type: 'warning' },
  );
  await deleteOAuth2ClientListApi(selectedIds.value);
  ElMessage.success('批量删除成功');
  selectedIds.value = [];
  await loadList();
}

onMounted(() => {
  void loadList();
});
</script>

<template>
  <div>
    <ProTable
      title="OAuth2.0 应用列表"
      :loading="loading"
      :total="total"
      v-model:page-no="query.pageNo"
      v-model:page-size="query.pageSize"
      @refresh="loadList"
    >
      <template #search>
        <el-form :inline="true" :model="query" @submit.prevent="loadList">
          <el-form-item label="应用名称">
            <el-input v-model="query.name" placeholder="请输入应用名" clearable />
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="query.status" placeholder="全部" clearable style="width: 120px">
              <el-option label="开启" :value="CommonStatusEnum.ENABLE" />
              <el-option label="禁用" :value="CommonStatusEnum.DISABLE" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :icon="Search" @click="() => ((query.pageNo = 1), loadList())">
              搜索
            </el-button>
            <el-button @click="handleReset">重置</el-button>
          </el-form-item>
        </el-form>
      </template>

      <template #toolbar>
        <el-button v-has-permi="'system:oauth2-client:create'" type="primary" :icon="Plus" size="small" @click="openForm()">
          新增
        </el-button>
        <el-button
          v-has-permi="'system:oauth2-client:delete'"
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
        @selection-change="(rows: OAuth2ClientItem[]) => (selectedIds = rows.map((r) => r.id))"
      >
        <el-table-column type="selection" width="44" />
        <el-table-column prop="clientId" label="客户端编号" min-width="130" />
        <el-table-column prop="name" label="应用名称" min-width="140" />
        <el-table-column label="状态" width="85" align="center">
          <template #default="{ row }">
            <DictTag :type="DICT_TYPE.COMMON_STATUS" :value="row.status" />
          </template>
        </el-table-column>
        <el-table-column prop="accessTokenValiditySeconds" label="访问令牌有效期(秒)" width="150" align="center" />
        <el-table-column prop="refreshTokenValiditySeconds" label="刷新令牌有效期(秒)" width="150" align="center" />
        <el-table-column label="授权类型" min-width="160">
          <template #default="{ row }">
            <el-tag v-for="gt in row.authorizedGrantTypes || []" :key="gt" size="small" class="mr-1">
              {{ gt }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button v-has-permi="'system:oauth2-client:update'" link type="primary" size="small" @click="openForm(row)">
              编辑
            </el-button>
            <el-button v-has-permi="'system:oauth2-client:delete'" link type="danger" size="small" @click="handleDelete(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </ProTable>

    <el-dialog v-model="formVisible" :title="form.id ? '编辑应用' : '新增应用'" width="560px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="135px">
        <el-form-item label="客户端编号" prop="clientId">
          <el-input v-model="form.clientId" />
        </el-form-item>
        <el-form-item label="客户端密钥" prop="secret">
          <el-input v-model="form.secret" />
        </el-form-item>
        <el-form-item label="应用名称" prop="name">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio :value="CommonStatusEnum.ENABLE">开启</el-radio>
            <el-radio :value="CommonStatusEnum.DISABLE">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="访问令牌有效期(秒)">
          <el-input-number v-model="form.accessTokenValiditySeconds" :min="60" class="w-full" />
        </el-form-item>
        <el-form-item label="刷新令牌有效期(秒)">
          <el-input-number v-model="form.refreshTokenValiditySeconds" :min="60" class="w-full" />
        </el-form-item>
        <el-form-item label="授权类型">
          <el-select v-model="form.authorizedGrantTypes" multiple class="w-full">
            <el-option label="client_credentials" value="client_credentials" />
            <el-option label="refresh_token" value="refresh_token" />
          </el-select>
        </el-form-item>
        <el-form-item label="授权范围 (Scope)">
          <el-input v-model="form.scopesText" placeholder="多个范围以逗号分隔，如 read,write" />
        </el-form-item>
        <el-form-item label="应用描述">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="formSubmitting" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>
