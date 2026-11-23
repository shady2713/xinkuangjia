<script setup lang="ts">
/**
 * OAuth2.0 第三方开放应用管理（仅保留 clientId / secret / 有效期 / grantTypes / scopes 核心字段）。
 */
import { Delete, Edit, Plus, Search } from '@element-plus/icons-vue';
import {
  ElMessage,
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
import FormDialog from '@/components/FormDialog.vue';
import ProTable from '@/components/ProTable.vue';
import TableAction from '@/components/TableAction.vue';
import { CommonStatusEnum, DICT_TYPE } from '@/constants/enums';
import {
  deleteConfirmMessage,
  FIELD_LIMITS,
  maxLenRule,
  requiredRule,
} from '@/constants/validation';
import { confirmAction } from '@/utils/confirm';
import { formatDateTime } from '@/utils/format';

defineOptions({ name: 'SystemOAuth2Client' });

const OPEN_GRANT_TYPE = 'client_credentials';
const historicalGrantTypes = ref<string[]>([]);

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
  authorizedGrantTypes: [OPEN_GRANT_TYPE] as string[],
  scopesText: '',
});

const formRules: FormRules = {
  clientId: [
    requiredRule('客户端编号'),
    maxLenRule('客户端编号', FIELD_LIMITS.OAUTH_CLIENT_ID),
  ],
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
    maxLenRule('客户端密钥', FIELD_LIMITS.OAUTH_SECRET),
  ],
  name: [
    requiredRule('应用名称'),
    maxLenRule('应用名称', FIELD_LIMITS.OAUTH_NAME),
  ],
  description: [maxLenRule('应用描述', FIELD_LIMITS.OAUTH_DESCRIPTION)],
};

async function loadList() {
  loading.value = true;
  try {
    const res = await getOAuth2ClientPageApi({
      pageNo: query.pageNo,
      pageSize: query.pageSize,
      name: query.name.trim() || undefined,
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
    authorizedGrantTypes: [OPEN_GRANT_TYPE],
    scopesText: '',
  });
  historicalGrantTypes.value = [];
  formVisible.value = true;
  if (row?.id) {
    const detail = await getOAuth2ClientApi(row.id);
    historicalGrantTypes.value = (detail.authorizedGrantTypes ?? []).filter((type) => type !== OPEN_GRANT_TYPE);
    Object.assign(form, {
      id: detail.id,
      clientId: detail.clientId,
      secret: '',
      name: detail.name,
      description: detail.description || '',
      status: detail.status ?? CommonStatusEnum.ENABLE,
      accessTokenValiditySeconds: detail.accessTokenValiditySeconds ?? 1800,
      refreshTokenValiditySeconds: detail.refreshTokenValiditySeconds ?? 2592000,
      authorizedGrantTypes: detail.authorizedGrantTypes ?? [OPEN_GRANT_TYPE],
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
      description: form.description.trim() || undefined,
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
  await deleteOAuth2ClientApi(row.id);
  ElMessage.success('删除成功');
  await loadList();
}

async function handleBatchDelete() {
  if (selectedIds.value.length === 0) return;
  await confirmAction(
    `是否确认批量删除已勾选的 ${selectedIds.value.length} 个应用？删除后无法恢复。`,
    { title: '批量删除确认', confirmText: '确认删除' },
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
        <el-form :inline="true" :model="query" @submit.prevent="() => ((query.pageNo = 1), loadList())">
          <el-form-item label="应用名称">
            <el-input
              v-model="query.name"
              placeholder="请输入应用名称"
              :maxlength="FIELD_LIMITS.OAUTH_NAME"
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
            <el-button type="primary" :icon="Search" @click="() => ((query.pageNo = 1), loadList())">
              搜索
            </el-button>
            <el-button @click="handleReset">重置</el-button>
          </el-form-item>
        </el-form>
      </template>

      <template #toolbar>
        <el-button
          v-has-permi="'system:oauth2-client:create'"
          type="primary"
          :icon="Plus"
          size="small"
          @click="openForm()"
        >
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

      <template #default="{ size }">
        <el-table
          :data="list"
          :size="size"
          border
          stripe
          @selection-change="(rows: OAuth2ClientItem[]) => (selectedIds = rows.map((r) => r.id))"
        >
          <el-table-column type="selection" width="44" align="center" />
          <el-table-column prop="clientId" label="客户端编号" min-width="130" show-overflow-tooltip />
          <el-table-column prop="name" label="应用名称" min-width="140" show-overflow-tooltip />
          <el-table-column label="状态" width="82" align="center">
            <template #default="{ row }">
              <DictTag :type="DICT_TYPE.COMMON_STATUS" :value="row.status" />
            </template>
          </el-table-column>
          <el-table-column prop="accessTokenValiditySeconds" label="访问令牌有效期(秒)" width="150" align="center" />
          <el-table-column prop="refreshTokenValiditySeconds" label="刷新令牌有效期(秒)" width="150" align="center" />
          <el-table-column label="授权类型" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">
              <el-tag v-for="gt in row.authorizedGrantTypes || []" :key="gt" size="small" class="mr-1">
                {{ gt }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="创建时间" width="164" show-overflow-tooltip>
            <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="148" align="center" fixed="right">
            <template #default="{ row }">
              <TableAction
                :actions="[
                  {
                    label: '编辑',
                    icon: Edit,
                    auth: 'system:oauth2-client:update',
                    onClick: () => openForm(row),
                  },
                  {
                    label: '删除',
                    type: 'danger',
                    icon: Delete,
                    auth: 'system:oauth2-client:delete',
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
      :title="form.id ? '编辑应用' : '新增应用'"
      width="580px"
      :confirm-loading="formSubmitting"
      @confirm="submitForm"
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="135px">
        <el-form-item label="客户端编号" prop="clientId">
          <el-input
            v-model="form.clientId"
            :maxlength="FIELD_LIMITS.OAUTH_CLIENT_ID"
            placeholder="请输入客户端唯一编号"
          />
        </el-form-item>
        <el-form-item label="客户端密钥" prop="secret">
          <el-input
            v-model="form.secret"
            :maxlength="FIELD_LIMITS.OAUTH_SECRET"
            :placeholder="form.id ? '留空表示保持原密钥不变' : '请输入客户端密钥'"
          />
        </el-form-item>
        <el-form-item label="应用名称" prop="name">
          <el-input
            v-model="form.name"
            :maxlength="FIELD_LIMITS.OAUTH_NAME"
            placeholder="请输入应用名称"
          />
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
          <el-select v-model="form.authorizedGrantTypes" multiple class="w-full" placeholder="请选择授权类型">
            <el-option label="客户端模式 (client_credentials)" :value="OPEN_GRANT_TYPE" />
            <el-option
              v-for="type in historicalGrantTypes"
              :key="type"
              :label="`历史配置（${type}）`"
              :value="type"
              disabled
            />
          </el-select>
        </el-form-item>
        <el-form-item label="授权范围">
          <el-input
            v-model="form.scopesText"
            :maxlength="FIELD_LIMITS.OAUTH_DESCRIPTION"
            placeholder="多个范围以逗号分隔，例如 user_info,read"
          />
        </el-form-item>
        <el-form-item label="应用描述" prop="description">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            :maxlength="FIELD_LIMITS.OAUTH_DESCRIPTION"
            show-word-limit
            placeholder="请输入应用用途说明（选填）"
          />
        </el-form-item>
      </el-form>
    </FormDialog>
  </div>
</template>
