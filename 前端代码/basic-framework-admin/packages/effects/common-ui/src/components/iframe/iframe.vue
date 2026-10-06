<script setup lang="ts">
/**
 * 内嵌页面容器：用原生 iframe 渲染 src，供打开外部系统或独立页面。
 * 挂载后延迟计算视口剩余高度作为容器高度，以避开顶栏与标签栏，
 * 期间展示 v-loading 遮罩；不做跨域通信、路由同步与失败提示。
 */
import { onMounted, ref } from 'vue';

/** 内嵌页面容器属性：要加载的 iframe 源地址。 */
interface IFrameProps {
  /** iframe 的源地址 */
  src: string;
}

defineProps<IFrameProps>();

const loading = ref(true);
const height = ref('');

/** 按视口高度减去固定头尾高度得到容器高度，并关闭加载遮罩；不感知实际内容高度。 */
function init() {
  height.value = `${document.documentElement.clientHeight - 94.5}px`;
  loading.value = false;
}

onMounted(() => {
  setTimeout(() => {
    init();
  }, 300);
});
</script>

<template>
  <div v-loading="loading" :style="`height:${height}`">
    <iframe
      :src="src"
      class="h-full w-full"
      frameborder="no"
      scrolling="auto"
    ></iframe>
  </div>
</template>
