<script setup lang="ts">
/**
 * 登录审计日志：条件查询、详情弹窗与 Excel 导出。
 */
import { Download, Search, View } from '@element-plus/icons-vue';
import { onMounted, reactive, ref } from 'vue';

import {
  exportLoginLogApi,
  getLoginLogPageApi,
  type LoginLogItem,
} from '@/api/system/log';
import DetailDialog from '@/components/DetailDialog.vue';
import DictTag from '@/components/DictTag.vue';
import ProTable from '@/components/ProTable.vue';
import TableAction from '@/components/TableAction.vue';
import { DICT_TYPE } from '@/constants/enums';
import { FIELD_LIMITS } from '@/constants/validation';
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
      username: query.username.trim() || undefined,
      userIp: query.userIp.trim() || undefined,
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
    username: query.username.trim() || undefined,
    userIp: query.userIp.trim() || undefined,
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
  <div class="h-full">
    <ProTable
      title="登录日志"
      :loading="loading"
      :total="total"
      :columns="[
        { key: 'id', label: '日志编号' },
        { key: 'logType', label: '操作类型' },
        { key: 'username', label: '用户账号' },
        { key: 'userIp', label: '登录 IP' },
        { key: 'userAgent', label: '客户端 UA' },
        { key: 'result', label: '登录结果' },
        { key: 'createTime', label: '登录时间' },
      ]"
      v-model:page-no="query.pageNo"
      v-model:page-size="query.pageSize"
      @refresh="loadList"
    >
      <template #search>
        <el-form :inline="true" :model="query" @submit.prevent="() => ((query.pageNo = 1), loadList())">
          <el-form-item label="用户账号">
            <el-input
              v-model="query.username"
              placeholder="请输入用户账号"
              :maxlength="FIELD_LIMITS.USERNAME"
              clearable
            />
          </el-form-item>
          <el-form-item label="登录地址">
            <el-input
              v-model="query.userIp"
              placeholder="请输入登录 IP"
              :maxlength="FIELD_LIMITS.EMAIL"
              clearable
            />
          </el-form-item>
          <el-form-item label="登录状态">
            <el-select v-model="query.status" placeholder="全部" clearable>
              <el-option label="成功" :value="true" />
              <el-option label="失败" :value="false" />
            </el-select>
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
          v-has-permi="'system:login-log:export'"
          :icon="Download"
          @click="handleExport"
        >
          导出
        </el-button>
      </template>

      <template #default="{ size, tableHeight, isColVisible }">
        <el-table :data="list" :size="size" :height="tableHeight" border stripe>
          <el-table-column v-if="isColVisible('id')" prop="id" label="日志编号" width="88" align="center" />
          <el-table-column v-if="isColVisible('logType')" label="操作类型" width="116" align="center">
            <template #default="{ row }">
              <DictTag :type="DICT_TYPE.SYSTEM_LOGIN_TYPE" :value="row.logType" />
            </template>
          </el-table-column>
          <el-table-column v-if="isColVisible('username')" prop="username" label="用户账号" min-width="110" show-overflow-tooltip />
          <el-table-column v-if="isColVisible('userIp')" prop="userIp" label="登录 IP" width="136" show-overflow-tooltip />
          <el-table-column v-if="isColVisible('userAgent')" prop="userAgent" label="客户端 UA" min-width="220" show-overflow-tooltip />
          <el-table-column v-if="isColVisible('result')" label="登录结果" width="110" align="center">
            <template #default="{ row }">
              <DictTag :type="DICT_TYPE.SYSTEM_LOGIN_RESULT" :value="row.result" />
            </template>
          </el-table-column>
          <el-table-column v-if="isColVisible('createTime')" label="登录时间" width="164" show-overflow-tooltip>
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

    <DetailDialog v-model="detailVisible" title="登录日志详情" width="600px">
      <el-descriptions v-if="detailRow" :column="1" border size="small">
        <el-descriptions-item label="日志编号" width="110">{{ detailRow.id }}</el-descriptions-item>
        <el-descriptions-item label="用户账号">{{ detailRow.username || '-' }}</el-descriptions-item>
        <el-descriptions-item label="登录 IP">{{ detailRow.userIp || '-' }}</el-descriptions-item>
        <el-descriptions-item label="链路追踪">{{ detailRow.traceId || '-' }}</el-descriptions-item>
        <el-descriptions-item label="浏览器 UA">
          <span class="bf-pre-wrap">{{ detailRow.userAgent || '-' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="登录时间">
          {{ formatDateTime(detailRow.createTime) }}
        </el-descriptions-item>
      </el-descriptions>
    </DetailDialog>
  </div>
</template>
