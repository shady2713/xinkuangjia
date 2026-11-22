<script setup lang="ts">
/**
 * OAuth2.0 在线令牌会话管理：查询与强制下线。
 */
import { Search } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';

import {
  deleteOAuth2TokenApi,
  getOAuth2TokenPageApi,
  type OAuth2TokenItem,
} from '@/api/system/oauth2';
import DictTag from '@/components/DictTag.vue';
import ProTable from '@/components/ProTable.vue';
import { DICT_TYPE } from '@/constants/enums';
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
      userId: query.userId || undefined,
      clientId: query.clientId || undefined,
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
  await ElMessageBox.confirm('确定要强制注销该访问令牌吗？', '强退确认', {
    type: 'warning',
  });
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
      <el-form :inline="true" :model="query" @submit.prevent="loadList">
        <el-form-item label="用户编号">
          <el-input v-model="query.userId" placeholder="请输入用户编号" clearable />
        </el-form-item>
        <el-form-item label="客户端编号">
          <el-input v-model="query.clientId" placeholder="请输入客户端编号" clearable />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="() => ((query.pageNo = 1), loadList())">
            搜索
          </el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </template>

    <el-table :data="list" border stripe>
      <el-table-column prop="id" label="令牌编号" width="100" />
      <el-table-column prop="userId" label="用户编号" width="100" />
      <el-table-column label="用户类型" width="100" align="center">
        <template #default="{ row }">
          <DictTag :type="DICT_TYPE.USER_TYPE" :value="row.userType" />
        </template>
      </el-table-column>
      <el-table-column prop="clientId" label="客户端编号" width="130" />
      <el-table-column label="过期时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.expiresTime) }}</template>
      </el-table-column>
      <el-table-column label="创建时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button
            v-has-permi="'system:oauth2-token:delete'"
            link
            type="danger"
            size="small"
            @click="handleForceLogout(row)"
          >
            强退
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </ProTable>
</template>
