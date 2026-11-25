<script setup lang="ts">
/**
 * 操作审计日志：条件查询、详情弹窗与 Excel 导出。
 */
import { Download, Search, View } from '@element-plus/icons-vue';
import { onMounted, reactive, ref } from 'vue';

import { notifyUnhandledError } from '@/api/request';
import {
  exportOperateLogApi,
  getOperateLogPageApi,
  type OperateLogItem,
} from '@/api/system/log';
import DetailDialog from '@/components/DetailDialog.vue';
import ProTable from '@/components/ProTable.vue';
import TableAction from '@/components/TableAction.vue';
import { FIELD_LIMITS } from '@/constants/validation';
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
      type: query.type.trim() || undefined,
      subType: query.subType.trim() || undefined,
      action: query.action.trim() || undefined,
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
  query.type = '';
  query.subType = '';
  query.action = '';
  query.pageNo = 1;
  void loadList();
}

async function handleExport() {
  try {
    const blob = await exportOperateLogApi({
      type: query.type.trim() || undefined,
      subType: query.subType.trim() || undefined,
      action: query.action.trim() || undefined,
    });
    downloadBlob(blob, '操作审计日志.xlsx');
  } catch (error) {
    notifyUnhandledError(error);
  }
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
  <div class="h-full">
    <ProTable
      title="操作日志"
      :loading="loading"
      :total="total"
      :columns="[
        { key: 'id', label: '日志编号' },
        { key: 'userName', label: '操作人' },
        { key: 'type', label: '操作模块' },
        { key: 'subType', label: '操作名' },
        { key: 'action', label: '操作内容' },
        { key: 'userIp', label: '操作 IP' },
        { key: 'createTime', label: '操作时间' },
      ]"
      v-model:page-no="query.pageNo"
      v-model:page-size="query.pageSize"
      @refresh="loadList"
    >
      <template #search>
        <el-form :inline="true" :model="query" @submit.prevent="() => ((query.pageNo = 1), loadList())">
          <el-form-item label="操作模块">
            <el-input
              v-model="query.type"
              placeholder="请输入操作模块"
              :maxlength="FIELD_LIMITS.LOG_MODULE"
              clearable
            />
          </el-form-item>
          <el-form-item label="操作名">
            <el-input
              v-model="query.subType"
              placeholder="请输入操作名"
              :maxlength="FIELD_LIMITS.LOG_MODULE"
              clearable
            />
          </el-form-item>
          <el-form-item label="操作内容">
            <el-input
              v-model="query.action"
              placeholder="请输入操作内容关键字"
              :maxlength="FIELD_LIMITS.SEARCH_KEYWORD"
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

      <template #toolbar>
        <el-button
          v-has-permi="'system:operate-log:export'"
          :icon="Download"
          @click="handleExport"
        >
          导出
        </el-button>
      </template>

      <template #default="{ size, tableHeight, isColVisible }">
        <el-table :data="list" :size="size" :height="tableHeight" border stripe>
          <el-table-column v-if="isColVisible('id')" prop="id" label="日志编号" width="88" align="center" />
          <el-table-column v-if="isColVisible('userName')" prop="userName" label="操作人" width="110" show-overflow-tooltip />
          <el-table-column v-if="isColVisible('type')" prop="type" label="操作模块" width="126" show-overflow-tooltip />
          <el-table-column v-if="isColVisible('subType')" prop="subType" label="操作名" width="126" show-overflow-tooltip />
          <el-table-column v-if="isColVisible('action')" prop="action" label="操作内容" min-width="220" show-overflow-tooltip />
          <el-table-column v-if="isColVisible('userIp')" prop="userIp" label="操作 IP" width="130" show-overflow-tooltip />
          <el-table-column v-if="isColVisible('createTime')" label="操作时间" width="164" show-overflow-tooltip>
            <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="88" align="center" fixed="right">
            <template #default="{ row }">
              <TableAction
                :actions="[
                  {
                    label: '详情',
                    icon: View,
                    onClick: () => openDetail(row),
                  },
                ]"
              />
            </template>
          </el-table-column>
        </el-table>
      </template>
    </ProTable>

    <DetailDialog v-model="detailVisible" title="操作日志详情" width="640px">
      <el-descriptions v-if="detailRow" :column="1" border size="small">
        <el-descriptions-item label="日志编号" width="110">{{ detailRow.id }}</el-descriptions-item>
        <el-descriptions-item label="链路追踪">{{ detailRow.traceId || '-' }}</el-descriptions-item>
        <el-descriptions-item label="操作人">
          {{ detailRow.userName || detailRow.userId || '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="操作模块">
          {{ detailRow.type }} / {{ detailRow.subType }}
        </el-descriptions-item>
        <el-descriptions-item label="操作内容">
          <span class="bf-pre-wrap">{{ detailRow.action || '-' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="请求地址">
          {{ detailRow.requestMethod }} {{ detailRow.requestUrl }}
        </el-descriptions-item>
        <el-descriptions-item label="操作 IP">{{ detailRow.userIp || '-' }}</el-descriptions-item>
        <el-descriptions-item label="操作时间">
          {{ formatDateTime(detailRow.createTime) }}
        </el-descriptions-item>
      </el-descriptions>
    </DetailDialog>
  </div>
</template>
