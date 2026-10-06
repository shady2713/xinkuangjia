<script lang="ts" setup>
/** 布局页脚容器：铺满页脚区域并居中排布默认插槽，是否放版权条由调用方决定。 */
defineOptions({
  name: 'LayoutFooter',
});
</script>

<template>
  <div class="flex-center text-muted-foreground relative h-full w-full text-xs">
    <slot></slot>
  </div>
</template>
