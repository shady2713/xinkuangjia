<script setup lang="ts">
/**
 * OAuth2.0 在线令牌会话管理：查询与强制下线。
 */
import { Search, SwitchButton } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';

import { notifyUnhandledError } from '@/api/request';
import {
  deleteOAuth2TokenApi,
  getOAuth2TokenPageApi,
  type OAuth2TokenItem,
} from '@/api/system/oauth2';
import DictTag from '@/components/DictTag.vue';
import ProTable from '@/components/ProTable.vue';
import TableAction from '@/components/TableAction.vue';
import { DICT_TYPE } from '@/constants/enums';
import { FIELD_LIMITS, REGEX_PATTERNS } from '@/constants/validation';
import { formatDateTime } from '@/utils/format';

defineOptions({ name: 'SystemOAuth2Token' });

const loading = ref(false);
const list = ref<OAuth2TokenItem[]>([]);
const total = ref(0);

const query = reactive({
  pageNo: 1,
  pageSize: 10,
  userId: '',
  clientId: '',
});

async function loadList() {
  const userIdText = query.userId.trim();
  if (userIdText && !REGEX_PATTERNS.NUMERIC_ID.test(userIdText)) {
    ElMessage.warning('用户编号必须为数字');
    return;
  }
  loading.value = true;
  try {
    const res = await getOAuth2TokenPageApi({
      pageNo: query.pageNo,
      pageSize: query.pageSize,
      userId: userIdText || undefined,
      clientId: query.clientId.trim() || undefined,
    });
    list.value = res.list ?? [];
    total.value = res.total ?? 0;
  } catch (error) {
    notifyUnhandledError(error);
  } finally {
    loading.value = false;
  }
}

function handleReset() {
  query.userId = '';
  query.clientId = '';
  query.pageNo = 1;
  void loadList();
}

async function handleForceLogout(row: OAuth2TokenItem) {
  try {
    await deleteOAuth2TokenApi(row.id);
    ElMessage.success('已强制下线');
    await loadList();
  } catch (error) {
    notifyUnhandledError(error);
  }
}

onMounted(() => {
  void loadList();
});
</script>

<template>
  <div class="h-full">
    <ProTable
      title="在线令牌列表"
      :loading="loading"
      :total="total"
      :columns="[
        { key: 'id', label: '令牌编号' },
        { key: 'userId', label: '用户编号' },
        { key: 'userType', label: '用户类型' },
        { key: 'clientId', label: '客户端编号' },
        { key: 'expiresTime', label: '过期时间' },
        { key: 'createTime', label: '创建时间' },
      ]"
      v-model:page-no="query.pageNo"
      v-model:page-size="query.pageSize"
      @refresh="loadList"
    >
      <template #search>
        <el-form :inline="true" :model="query" @submit.prevent="() => ((query.pageNo = 1), loadList())">
          <el-form-item label="用户编号">
            <el-input
              v-model="query.userId"
              placeholder="请输入数字用户编号"
              :maxlength="FIELD_LIMITS.NUMERIC_ID"
              clearable
            />
          </el-form-item>
          <el-form-item label="客户端编号">
            <el-input
              v-model="query.clientId"
              placeholder="请输入客户端编号"
              :maxlength="FIELD_LIMITS.OAUTH_CLIENT_ID"
              clearable
            />
          </el-form-item>
          <el-form-item>
            <el-button @click="handleReset">重置</el-button>
            <el-button type="primary" :icon="Search" @click="() => ((query.pageNo = 1), loadList())">
              查询
            </el-button>
          </el-form-item>
        </el-form>
      </template>

      <template #default="{ size, tableHeight, isColVisible }">
        <el-table :data="list" :size="size" :height="tableHeight" border stripe>
          <el-table-column v-if="isColVisible('id')" prop="id" label="令牌编号" min-width="96" align="center" />
          <el-table-column v-if="isColVisible('userId')" prop="userId" label="用户编号" min-width="96" align="center" />
          <el-table-column v-if="isColVisible('userType')" label="用户类型" min-width="110" align="center">
            <template #default="{ row }">
              <DictTag :type="DICT_TYPE.USER_TYPE" :value="row.userType" />
            </template>
          </el-table-column>
          <el-table-column v-if="isColVisible('clientId')" prop="clientId" label="客户端编号" min-width="160" show-overflow-tooltip />
          <el-table-column v-if="isColVisible('expiresTime')" label="过期时间" min-width="175" show-overflow-tooltip>
            <template #default="{ row }">{{ formatDateTime(row.expiresTime) }}</template>
          </el-table-column>
          <el-table-column v-if="isColVisible('createTime')" label="创建时间" min-width="175" show-overflow-tooltip>
            <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="110" align="center" fixed="right">
            <template #default="{ row }">
              <TableAction
                :actions="[
                  {
                    label: '强退',
                    type: 'danger',
                    icon: SwitchButton,
                    auth: 'system:oauth2-token:delete',
                    popConfirm: {
                      title: '确定要强制注销该访问令牌吗？',
                      confirm: () => handleForceLogout(row),
                    },
                  },
                ]"
              />
            </template>
          </el-table-column>
        </el-table>
      </template>
    </ProTable>
  </div>
</template>
