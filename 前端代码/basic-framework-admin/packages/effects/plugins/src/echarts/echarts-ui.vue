<script setup lang="ts">
/** 图表容器：只提供带默认宽高的占位节点并透传属性，实例与数据绑定交给 useEcharts。 */
interface Props {
  height?: string;
  width?: string;
}

withDefaults(defineProps<Props>(), {
  height: '300px',
  width: '100%',
});
</script>

<template>
  <div v-bind="$attrs" :style="{ height, width }"></div>
</template>
