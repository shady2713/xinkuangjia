<script setup lang="ts">
import { computed } from 'vue';

import { useDictStore } from '@/stores/dict';

const props = defineProps<{
  type: string;
  value?: string | number | boolean | null;
}>();

const dictStore = useDictStore();

const dictItem = computed(() => dictStore.getDictItem(props.type, props.value));

type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger';

const tagType = computed<TagType>(() => {
  const raw = dictItem.value?.colorType;
  if (
    raw === 'primary' ||
    raw === 'success' ||
    raw === 'info' ||
    raw === 'warning' ||
    raw === 'danger'
  ) {
    return raw;
  }
  return 'info';
});
</script>

<template>
  <el-tag
    v-if="dictItem"
    :type="tagType"
    size="small"
    effect="light"
    disable-transitions
  >
    {{ dictItem.label }}
  </el-tag>
  <span v-else>{{ value ?? '-' }}</span>
</template>
