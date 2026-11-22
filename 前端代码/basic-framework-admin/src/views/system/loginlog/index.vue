<script setup lang="ts">
/**
 * 登录审计日志：条件查询、详情弹窗与 Excel 导出。
 */
import { Download, Search } from '@element-plus/icons-vue';
import { onMounted, reactive, ref } from 'vue';

import {
  exportLoginLogApi,
  getLoginLogPageApi,
  type LoginLogItem,
} from '@/api/system/log';
import DictTag from '@/components/DictTag.vue';
import ProTable from '@/components/ProTable.vue';
import { DICT_TYPE } from '@/constants/enums';
import { downloadBlob, formatDateTime } from '@/utils/format';

defineOptions({ name: 'SystemLoginLog' });

const loading = ref(false);
const list = ref<LoginLogItem[]>([]);
const total = ref(0);
const detailRow = ref<LoginLogItem | null>(null);
const detailVisible = ref(false);

const query = reactive({
  pageNo: 1,
  pageSize: 10,
  username: '',
  userIp: '',
  status: undefined as boolean | undefined,
});

async function loadList() {
  loading.value = true;
  try {
    const res = await getLoginLogPageApi({
      pageNo: query.pageNo,
      pageSize: query.pageSize,
      username: query.username || undefined,
      userIp: query.userIp || undefined,
      status: query.status,
    });
    list.value = res.list ?? [];
    total.value = res.total ?? 0;
  } finally {
    loading.value = false;
  }
}

function handleReset() {
  query.username = '';
  query.userIp = '';
  query.status = undefined;
  query.pageNo = 1;
  void loadList();
}

async function handleExport() {
  const blob = await exportLoginLogApi({
    username: query.username || undefined,
    userIp: query.userIp || undefined,
    status: query.status,
  });
  downloadBlob(blob, '登录审计日志.xlsx');
}

function openDetail(row: LoginLogItem) {
  detailRow.value = row;
  detailVisible.value = true;
}

onMounted(() => {
  void loadList();
});
</script>

<template>
  <div>
    <ProTable
      title="登录日志"
      :loading="loading"
      :total="total"
      v-model:page-no="query.pageNo"
      v-model:page-size="query.pageSize"
      @refresh="loadList"
    >
      <template #search>
        <el-form :inline="true" :model="query" @submit.prevent="loadList">
          <el-form-item label="用户名称">
            <el-input v-model="query.username" placeholder="请输入用户名称" clearable />
          </el-form-item>
          <el-form-item label="登录地址">
            <el-input v-model="query.userIp" placeholder="请输入登录 IP" clearable />
          </el-form-item>
          <el-form-item label="登录状态">
            <el-select v-model="query.status" placeholder="全部" clearable style="width: 120px">
              <el-option label="成功" :value="true" />
              <el-option label="失败" :value="false" />
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
        <el-button v-has-permi="'system:login-log:export'" :icon="Download" size="small" @click="handleExport">
          导出
        </el-button>
      </template>

      <el-table :data="list" border stripe>
        <el-table-column prop="id" label="日志编号" width="90" />
        <el-table-column label="操作类型" width="120">
          <template #default="{ row }">
            <DictTag :type="DICT_TYPE.SYSTEM_LOGIN_TYPE" :value="row.logType" />
          </template>
        </el-table-column>
        <el-table-column prop="username" label="用户名称" min-width="120" />
        <el-table-column prop="userIp" label="登录 IP" width="140" />
        <el-table-column prop="userAgent" label="客户端 UA" min-width="200" show-overflow-tooltip />
        <el-table-column label="登录结果" width="120">
          <template #default="{ row }">
            <DictTag :type="DICT_TYPE.SYSTEM_LOGIN_RESULT" :value="row.result" />
          </template>
        </el-table-column>
        <el-table-column label="登录时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
    </ProTable>

    <el-dialog v-model="detailVisible" title="登录日志详情" width="580px">
      <el-descriptions v-if="detailRow" :column="1" border size="small">
        <el-descriptions-item label="日志编号">{{ detailRow.id }}</el-descriptions-item>
        <el-descriptions-item label="用户名称">{{ detailRow.username }}</el-descriptions-item>
        <el-descriptions-item label="登录 IP">{{ detailRow.userIp }}</el-descriptions-item>
        <el-descriptions-item label="链路追踪">{{ detailRow.traceId || '-' }}</el-descriptions-item>
        <el-descriptions-item label="浏览器 UA">{{ detailRow.userAgent || '-' }}</el-descriptions-item>
        <el-descriptions-item label="登录时间">{{ formatDateTime(detailRow.createTime) }}</el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>
