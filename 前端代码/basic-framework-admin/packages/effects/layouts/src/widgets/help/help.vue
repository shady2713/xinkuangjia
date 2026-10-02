<script lang="ts" setup>
import { $t } from '@vben/locales';

import { useVbenModal } from '@vben-core/popup-ui';
import { Badge } from '@vben-core/shadcn-ui';

import { useMagicKeys, whenever } from '@vueuse/core';

defineOptions({
  name: 'Help',
});

const keys = useMagicKeys();
whenever(keys['Alt+KeyH']!, () => {
  modalApi.open();
});

const [Modal, modalApi] = useVbenModal({
  draggable: true,
  overlayBlur: 5,
  footer: false,
  onCancel() {
    modalApi.close();
  },
});
</script>

<template>
  <Modal class="w-1/3" :title="$t('ui.widgets.qa')">
    <div class="space-y-4 p-1 text-sm leading-6">
      <div>
        <p class="font-medium">快捷说明</p>
        <p class="text-muted-foreground">
          按
          <Badge class="mx-1" variant="secondary">Alt + H</Badge>
          可随时打开此帮助窗口。
        </p>
      </div>
      <div>
        <p class="font-medium">项目支持</p>
        <p class="text-muted-foreground">
          如需部署文档、接口说明或运维支持，请联系当前项目维护人或系统管理员。
        </p>
      </div>
      <div>
        <p class="font-medium">版本说明</p>
        <p class="text-muted-foreground">
          当前工程已移除默认外部仓库和演示站入口，可按实际项目继续补充内部文档与支持链接。
        </p>
      </div>
    </div>
  </Modal>
</template>
