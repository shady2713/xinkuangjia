<script setup lang="ts">
/**
 * OAuth2.0 在线令牌会话管理：查询与强制下线。
 */
import { Search, SwitchButton } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';

import {
  deleteOAuth2TokenApi,
  getOAuth2TokenPageApi,
  type OAuth2TokenItem,
} from '@/api/system/oauth2';
import DictTag from '@/components/DictTag.vue';
import ProTable from '@/components/ProTable.vue';
import TableAction from '@/components/TableAction.vue';
import { DICT_TYPE } from '@/constants/enums';
import { FIELD_LIMITS } from '@/constants/validation';
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
  loading.value = true;
  try {
    const res = await getOAuth2TokenPageApi({
      pageNo: query.pageNo,
      pageSize: query.pageSize,
      userId: query.userId.trim() || undefined,
      clientId: query.clientId.trim() || undefined,
    });
    list.value = res.list ?? [];
    total.value = res.total ?? 0;
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
  await deleteOAuth2TokenApi(row.id);
  ElMessage.success('已强制下线');
  await loadList();
}

onMounted(() => {
  void loadList();
});
</script>

<template>
  <ProTable
    title="在线令牌列表"
    :loading="loading"
    :total="total"
    v-model:page-no="query.pageNo"
    v-model:page-size="query.pageSize"
    @refresh="loadList"
  >
    <template #search>
      <el-form :inline="true" :model="query" @submit.prevent="() => ((query.pageNo = 1), loadList())">
        <el-form-item label="用户编号">
          <el-input
            v-model="query.userId"
            placeholder="请输入用户编号"
            :maxlength="FIELD_LIMITS.USERNAME"
            clearable
            style="width: 160px"
          />
        </el-form-item>
        <el-form-item label="客户端编号">
          <el-input
            v-model="query.clientId"
            placeholder="请输入客户端编号"
            :maxlength="FIELD_LIMITS.OAUTH_CLIENT_ID"
            clearable
            style="width: 180px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="() => ((query.pageNo = 1), loadList())">
            搜索
          </el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </template>

    <template #default="{ size }">
      <el-table :data="list" :size="size" border stripe>
        <el-table-column prop="id" label="令牌编号" min-width="96" align="center" />
        <el-table-column prop="userId" label="用户编号" min-width="96" align="center" />
        <el-table-column label="用户类型" min-width="110" align="center">
          <template #default="{ row }">
            <DictTag :type="DICT_TYPE.USER_TYPE" :value="row.userType" />
          </template>
        </el-table-column>
        <el-table-column prop="clientId" label="客户端编号" min-width="160" show-overflow-tooltip />
        <el-table-column label="过期时间" min-width="175" show-overflow-tooltip>
          <template #default="{ row }">{{ formatDateTime(row.expiresTime) }}</template>
        </el-table-column>
        <el-table-column label="创建时间" min-width="175" show-overflow-tooltip>
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
</template>
