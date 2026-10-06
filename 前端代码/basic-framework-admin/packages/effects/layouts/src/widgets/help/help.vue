<script lang="ts" setup>
/**
 * 帮助弹窗：展示快捷键说明、项目支持与版本说明三类静态文案。
 * 经 @vben/layouts 导出供上层布局挂载，由全局 Alt+H 快捷键打开；
 * 不请求接口，也不再提供外部文档或演示站入口，内容需按项目自行补充。
 */
import { $t } from '@vben/locales';

import { useVbenModal } from '@vben-core/popup-ui';
import { Badge } from '@vben-core/shadcn-ui';

import { useMagicKeys, whenever } from '@vueuse/core';

defineOptions({
  name: 'Help',
});

const keys = useMagicKeys();
// useMagicKeys 以 Proxy 惰性创建组合键，索引结果在类型上仍是可选的；
// 缺失时跳过注册即可，运行时该组合键始终由 useMagicKeys 提供
const helpKey = keys['Alt+KeyH'];
if (helpKey) {
  whenever(
    helpKey,
    /**
     * 快捷键命中后打开帮助弹窗。
     */
    () => {
      modalApi.open();
    },
  );
}

const [Modal, modalApi] = useVbenModal({
  draggable: true,
  overlayBlur: 5,
  footer: false,
  /** 关闭回调：直接收起帮助弹窗；弹窗内容为静态文案，无需额外清理。 */
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
