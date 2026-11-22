<script setup lang="ts">
/**
 * 操作审计日志：条件查询、详情弹窗与 Excel 导出。
 */
import { Download, Search } from '@element-plus/icons-vue';
import { onMounted, reactive, ref } from 'vue';

import {
  exportOperateLogApi,
  getOperateLogPageApi,
  type OperateLogItem,
} from '@/api/system/log';
import ProTable from '@/components/ProTable.vue';
import { downloadBlob, formatDateTime } from '@/utils/format';

defineOptions({ name: 'SystemOperateLog' });

const loading = ref(false);
const list = ref<OperateLogItem[]>([]);
const total = ref(0);
const detailRow = ref<OperateLogItem | null>(null);
const detailVisible = ref(false);

const query = reactive({
  pageNo: 1,
  pageSize: 10,
  type: '',
  subType: '',
  action: '',
});

async function loadList() {
  loading.value = true;
  try {
    const res = await getOperateLogPageApi({
      pageNo: query.pageNo,
      pageSize: query.pageSize,
      type: query.type || undefined,
      subType: query.subType || undefined,
      action: query.action || undefined,
    });
    list.value = res.list ?? [];
    total.value = res.total ?? 0;
  } finally {
    loading.value = false;
  }
}

function handleReset() {
  query.type = '';
  query.subType = '';
  query.action = '';
  query.pageNo = 1;
  void loadList();
}

async function handleExport() {
  const blob = await exportOperateLogApi({
    type: query.type || undefined,
    subType: query.subType || undefined,
    action: query.action || undefined,
  });
  downloadBlob(blob, '操作审计日志.xlsx');
}

function openDetail(row: OperateLogItem) {
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
      title="操作日志"
      :loading="loading"
      :total="total"
      v-model:page-no="query.pageNo"
      v-model:page-size="query.pageSize"
      @refresh="loadList"
    >
      <template #search>
        <el-form :inline="true" :model="query" @submit.prevent="loadList">
          <el-form-item label="操作模块">
            <el-input v-model="query.type" placeholder="请输入操作模块" clearable />
          </el-form-item>
          <el-form-item label="操作名">
            <el-input v-model="query.subType" placeholder="请输入操作名" clearable />
          </el-form-item>
          <el-form-item label="操作内容">
            <el-input v-model="query.action" placeholder="请输入操作内容" clearable />
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
        <el-button v-has-permi="'system:operate-log:export'" :icon="Download" size="small" @click="handleExport">
          导出
        </el-button>
      </template>

      <el-table :data="list" border stripe>
        <el-table-column prop="id" label="日志编号" width="90" />
        <el-table-column prop="userName" label="操作人" width="120" />
        <el-table-column prop="type" label="操作模块" width="130" />
        <el-table-column prop="subType" label="操作名" width="130" />
        <el-table-column prop="action" label="操作内容" min-width="220" show-overflow-tooltip />
        <el-table-column prop="userIp" label="操作 IP" width="135" />
        <el-table-column label="操作时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
    </ProTable>

    <el-dialog v-model="detailVisible" title="操作日志详情" width="620px">
      <el-descriptions v-if="detailRow" :column="1" border size="small">
        <el-descriptions-item label="日志编号">{{ detailRow.id }}</el-descriptions-item>
        <el-descriptions-item label="链路追踪">{{ detailRow.traceId || '-' }}</el-descriptions-item>
        <el-descriptions-item label="操作人">{{ detailRow.userName || detailRow.userId }}</el-descriptions-item>
        <el-descriptions-item label="操作模块">{{ detailRow.type }} / {{ detailRow.subType }}</el-descriptions-item>
        <el-descriptions-item label="操作内容">{{ detailRow.action }}</el-descriptions-item>
        <el-descriptions-item label="请求地址">
          {{ detailRow.requestMethod }} {{ detailRow.requestUrl }}
        </el-descriptions-item>
        <el-descriptions-item label="操作 IP">{{ detailRow.userIp || '-' }}</el-descriptions-item>
        <el-descriptions-item label="操作时间">{{ formatDateTime(detailRow.createTime) }}</el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>
