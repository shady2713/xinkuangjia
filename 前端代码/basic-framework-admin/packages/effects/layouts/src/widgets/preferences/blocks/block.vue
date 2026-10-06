<script setup lang="ts">
/**
 * 偏好设置分组容器：渲染分组标题，并把内部控件按纵向间距堆叠起来。
 * 供右侧偏好抽屉分节使用，只做排版与默认插槽透传，不读写任何偏好值。
 */
interface Props {
  title?: string;
}

defineOptions({
  name: 'PreferenceBlock',
});

withDefaults(defineProps<Props>(), {
  title: '',
});
</script>

<template>
  <div class="flex flex-col py-4">
    <h3 class="mb-3 font-semibold leading-none tracking-tight">
      {{ title }}
    </h3>
    <slot></slot>
  </div>
</template>
