<script setup lang="ts">
/**
 * 文件管理：列表查询、统一上传（含图片裁剪开关）、私有文件鉴权下载与删除。
 */
import { CopyDocument, Delete, Download, Plus, Search, View } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';

import {
  deleteFileApi,
  deleteFileListApi,
  type FileRecord,
  getFilePageApi,
  getPrivateFileContentApi,
} from '@/api/file';
import FormDialog from '@/components/FormDialog.vue';
import ProTable from '@/components/ProTable.vue';
import TableAction from '@/components/TableAction.vue';
import { deleteConfirmMessage, FIELD_LIMITS } from '@/constants/validation';
import { confirmCurrentSession } from '@/utils/confirm';
import { downloadBlob, formatDateTime, formatFileSize } from '@/utils/format';
import UploadField from '@/components/UploadField.vue';

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
      path: query.path.trim() || undefined,
      type: query.type.trim() || undefined,
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
  if (!row.privateFile && row.url) {
    window.open(row.url, '_blank', 'noopener,noreferrer');
    return;
  }
  if (!row.id) return;
  const blob = await getPrivateFileContentApi(row.id);
  downloadBlob(blob, row.name || row.path?.split('/').pop() || `file-${row.id}`);
}

async function handleCopyUrl(row: FileRecord) {
  if (row.privateFile || !row.url) return;
  await navigator.clipboard?.writeText(row.url);
  ElMessage.success('地址已复制到剪贴板');
}

async function handleDelete(row: FileRecord) {
  await deleteFileApi(row.id);
  ElMessage.success('删除成功');
  await loadList();
}

async function handleBatchDelete() {
  const ids = [...selectedIds.value];
  if (!ids.length) return;
  const confirmed = await confirmCurrentSession(
    `是否确认批量删除已勾选的 ${ids.length} 个文件？删除后无法恢复。`,
    { title: '批量删除确认', confirmText: '确认删除' },
  );
  if (!confirmed) return;
  await deleteFileListApi(ids);
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
        <el-form :inline="true" :model="query" @submit.prevent="() => ((query.pageNo = 1), loadList())">
          <el-form-item label="文件路径">
            <el-input
              v-model="query.path"
              placeholder="请输入文件路径"
              :maxlength="FIELD_LIMITS.FILE_PATH"
              clearable
              style="width: 190px"
            />
          </el-form-item>
          <el-form-item label="文件类型">
            <el-input
              v-model="query.type"
              placeholder="例如 image/png"
              :maxlength="FIELD_LIMITS.SEARCH_KEYWORD"
              clearable
              style="width: 160px"
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

      <template #toolbar>
        <el-button
          type="primary"
          :icon="Plus"
          size="small"
          @click="uploadDialogVisible = true"
        >
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

      <template #default="{ size }">
        <el-table
          :data="list"
          :size="size"
          border
          stripe
          @selection-change="(rows: FileRecord[]) => (selectedIds = rows.map((r) => r.id))"
        >
          <el-table-column type="selection" width="44" align="center" />
          <el-table-column prop="name" label="文件名" min-width="160" show-overflow-tooltip />
          <el-table-column prop="path" label="存储路径" min-width="200" show-overflow-tooltip />
          <el-table-column prop="type" label="MIME 类型" width="145" show-overflow-tooltip />
          <el-table-column label="大小" width="96" align="right">
            <template #default="{ row }">{{ formatFileSize(row.size) }}</template>
          </el-table-column>
          <el-table-column label="上传时间" width="164" show-overflow-tooltip>
            <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="236" align="center" fixed="right">
            <template #default="{ row }">
              <TableAction
                :actions="[
                  {
                    label: row.privateFile ? '下载' : '查看',
                    icon: row.privateFile ? Download : View,
                    onClick: () => handlePreview(row),
                  },
                  {
                    label: '复制链接',
                    icon: CopyDocument,
                    disabled: row.privateFile || !row.url,
                    onClick: () => handleCopyUrl(row),
                  },
                  {
                    label: '删除',
                    type: 'danger',
                    icon: Delete,
                    auth: 'infra:file:delete',
                    popConfirm: {
                      title: deleteConfirmMessage(row.name || row.path),
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
      v-model="uploadDialogVisible"
      title="上传文件"
      width="500px"
      :show-footer="false"
      :show-fullscreen="false"
    >
      <el-form label-width="90px">
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
    </FormDialog>
  </div>
</template>
