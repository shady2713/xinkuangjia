<script setup lang="ts">
/**
 * 树形展示组件：把属性原样交给 shadcn-ui 的 VbenTree，并把全部插槽透传下去。
 * treeData 为空时改渲染空状态，即图标加 common.noData 文案。
 * 不负责节点增删改与懒加载请求，这些仍由使用方通过属性与插槽接管。
 */
import type { TreeProps } from '@vben-core/shadcn-ui';

import { Inbox } from '@vben/icons';
import { $t } from '@vben/locales';

import { treePropsDefaults, VbenTree } from '@vben-core/shadcn-ui';

const props = withDefaults(defineProps<TreeProps>(), treePropsDefaults());
</script>

<template>
  <VbenTree v-if="props.treeData?.length > 0" v-bind="props">
    <template v-for="(_, key) in $slots" :key="key" #[key]="slotProps">
      <slot :name="key" v-bind="slotProps"> </slot>
    </template>
  </VbenTree>
  <div
    v-else
    class="flex-col-center text-muted-foreground cursor-pointer rounded-lg border p-10 text-sm font-medium"
  >
    <Inbox class="size-10" />
    <div class="mt-1">{{ $t('common.noData') }}</div>
  </div>
</template>
