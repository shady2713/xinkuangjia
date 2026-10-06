<script lang="ts" setup>
/** 标签栏刷新按钮：点击发出 refresh 事件，由父级决定刷新目标。 */
import { RotateCw } from '@vben-core/icons';

const emit = defineEmits(['refresh']);

/** 刷新按钮的点击处理：只向上抛出 refresh 事件，刷新哪个视图由父级决定。 */
const handleRefresh = () => {
  emit('refresh');
};
</script>

<template>
  <div
    class="flex-center h-full cursor-pointer border-l border-border px-2 text-lg font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
    @click="handleRefresh"
  >
    <RotateCw class="size-4" />
  </div>
</template>
