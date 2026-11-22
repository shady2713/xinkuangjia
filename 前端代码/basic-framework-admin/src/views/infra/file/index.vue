<script setup lang="ts">
/**
 * 文件管理：列表查询、统一上传（含图片裁剪开关演示）、私有短时签名预览与删除。
 */
import { Delete, Plus, Search } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';

import {
  deleteFileApi,
  deleteFileListApi,
  type FileRecord,
  getFilePageApi,
  getPrivateFileSignedUrlApi,
} from '@/api/file';
import ProTable from '@/components/ProTable.vue';
import UploadField from '@/components/UploadField.vue';
import { formatDateTime, formatFileSize } from '@/utils/format';

defineOptions({ name: 'InfraFile' });

const loading = ref(false);
const list = ref<FileRecord[]>([]);
const total = ref(0);
const selectedIds = ref<(number | string)[]>([]);

const query = reactive({
  pageNo: 1,
  pageSize: 10,
  path: '',
  type: '',
});

const uploadDialogVisible = ref(false);
const uploadMode = ref<'file' | 'image'>('file');
const enableCropper = ref(false);
const uploadedUrl = ref('');

async function loadList() {
  loading.value = true;
  try {
    const res = await getFilePageApi({
      pageNo: query.pageNo,
      pageSize: query.pageSize,
      path: query.path || undefined,
      type: query.type || undefined,
    });
    list.value = res.list ?? [];
    total.value = res.total ?? 0;
  } finally {
    loading.value = false;
  }
}

function handleReset() {
  query.path = '';
  query.type = '';
  query.pageNo = 1;
  void loadList();
}

async function handlePreview(row: FileRecord) {
  let targetUrl = row.url;
  if (row.path?.startsWith('private/') && row.id) {
    targetUrl = await getPrivateFileSignedUrlApi(row.id, 300);
  }
  if (targetUrl) {
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  }
}

async function handleCopyUrl(url?: string) {
  if (!url) return;
  await navigator.clipboard?.writeText(url);
  ElMessage.success('地址已复制到剪贴板');
}

async function handleDelete(row: FileRecord) {
  await ElMessageBox.confirm(`确认删除文件「${row.name || row.path}」吗？`, '删除确认', {
    type: 'warning',
  });
  await deleteFileApi(row.id);
  ElMessage.success('删除成功');
  await loadList();
}

async function handleBatchDelete() {
  if (selectedIds.value.length === 0) return;
  await ElMessageBox.confirm(
    `确认删除已勾选的 ${selectedIds.value.length} 个文件吗？`,
    '批量删除',
    { type: 'warning' },
  );
  await deleteFileListApi(selectedIds.value);
  ElMessage.success('批量删除成功');
  selectedIds.value = [];
  await loadList();
}

function onUploaded() {
  uploadDialogVisible.value = false;
  uploadedUrl.value = '';
  void loadList();
}

onMounted(() => {
  void loadList();
});
</script>

<template>
  <div>
    <ProTable
      title="文件列表"
      :loading="loading"
      :total="total"
      v-model:page-no="query.pageNo"
      v-model:page-size="query.pageSize"
      @refresh="loadList"
    >
      <template #search>
        <el-form :inline="true" :model="query" @submit.prevent="loadList">
          <el-form-item label="文件路径">
            <el-input v-model="query.path" placeholder="请输入文件路径" clearable />
          </el-form-item>
          <el-form-item label="文件类型">
            <el-input v-model="query.type" placeholder="例如 image/png" clearable />
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
        <el-button type="primary" :icon="Plus" size="small" @click="uploadDialogVisible = true">
          上传文件
        </el-button>
        <el-button
          v-has-permi="'infra:file:delete'"
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
        @selection-change="(rows: FileRecord[]) => (selectedIds = rows.map((r) => r.id))"
      >
        <el-table-column type="selection" width="44" />
        <el-table-column prop="name" label="文件名" min-width="160" show-overflow-tooltip />
        <el-table-column prop="path" label="存储路径" min-width="180" show-overflow-tooltip />
        <el-table-column prop="type" label="MIME 类型" width="150" show-overflow-tooltip />
        <el-table-column label="大小" width="100">
          <template #default="{ row }">{{ formatFileSize(row.size) }}</template>
        </el-table-column>
        <el-table-column label="上传时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handlePreview(row)">查看</el-button>
            <el-button link type="primary" size="small" @click="handleCopyUrl(row.url)">复制链接</el-button>
            <el-button v-has-permi="'infra:file:delete'" link type="danger" size="small" @click="handleDelete(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </ProTable>

    <el-dialog v-model="uploadDialogVisible" title="上传文件" width="480px" destroy-on-close>
      <el-form label-width="95px">
        <el-form-item label="上传模式">
          <el-radio-group v-model="uploadMode">
            <el-radio value="file">通用文件</el-radio>
            <el-radio value="image">图片模式</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="uploadMode === 'image'" label="图片裁剪">
          <el-switch v-model="enableCropper" active-text="开启裁剪" inactive-text="直接上传" />
        </el-form-item>
        <el-form-item label="选择文件">
          <UploadField
            v-model="uploadedUrl"
            :mode="uploadMode"
            :cropper="uploadMode === 'image' && enableCropper"
            tip="单文件不超过 50MB"
            @uploaded="onUploaded"
          />
        </el-form-item>
      </el-form>
    </el-dialog>
  </div>
</template>
