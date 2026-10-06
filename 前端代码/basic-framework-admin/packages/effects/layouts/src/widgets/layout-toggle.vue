<script setup lang="ts">
/**
 * 认证页布局切换挂件：下拉在左对齐、居中、右对齐三种面板布局间切换。
 * 由认证页工具栏挂载，选中值写入 preferences 的 authPageLayout；
 * 只切换布局偏好，不负责认证页本身的渲染与登录流程。
 */
import type { AuthPageLayoutType } from '@vben/types';

import type { VbenDropdownMenuItem } from '@vben-core/shadcn-ui';

import { computed } from 'vue';

import { InspectionPanel, PanelLeft, PanelRight } from '@vben/icons';
import { $t } from '@vben/locales';
import {
  preferences,
  updatePreferences,
  usePreferences,
} from '@vben/preferences';

import { VbenDropdownRadioMenu, VbenIconButton } from '@vben-core/shadcn-ui';

defineOptions({
  name: 'AuthenticationLayoutToggle',
});

/** 布局切换下拉项：左对齐、居中、右对齐三种认证页面板布局，文案随当前语言变化。 */
const menus = computed((): VbenDropdownMenuItem[] => [
  {
    icon: PanelLeft,
    label: $t('authentication.layout.alignLeft'),
    value: 'panel-left',
  },
  {
    icon: InspectionPanel,
    label: $t('authentication.layout.center'),
    value: 'panel-center',
  },
  {
    icon: PanelRight,
    label: $t('authentication.layout.alignRight'),
    value: 'panel-right',
  },
]);

const { authPanelCenter, authPanelLeft, authPanelRight } = usePreferences();

/** 选中布局后写入 authPageLayout 偏好；值为空时不做任何处理。 */
function handleUpdate(value: string | undefined) {
  if (!value) return;
  updatePreferences({
    app: {
      authPageLayout: value as AuthPageLayoutType,
    },
  });
}
</script>

<template>
  <VbenDropdownRadioMenu
    :menus="menus"
    :model-value="preferences.app.authPageLayout"
    @update:model-value="handleUpdate"
  >
    <VbenIconButton>
      <PanelRight v-if="authPanelRight" class="size-4" />
      <PanelLeft v-if="authPanelLeft" class="size-4" />
      <InspectionPanel v-if="authPanelCenter" class="size-4" />
    </VbenIconButton>
  </VbenDropdownRadioMenu>
</template>
