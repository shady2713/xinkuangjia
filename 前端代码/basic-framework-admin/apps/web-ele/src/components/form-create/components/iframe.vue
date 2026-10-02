<!-- 网页 iframe 组件 (Element Plus 版本) -->
<script lang="ts" setup>
import { computed } from 'vue';

defineOptions({ name: 'IframeComponent' });

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  url: '',
  height: '500px',
  width: '100%',
  frameborder: '0',
  allowfullscreen: true,
  loading: 'lazy',
  sandbox: '',
});

// 接受父组件参数
interface Props {
  /** 待预览的网页地址，支持 v-model；url 非空时优先于 modelValue */
  modelValue?: string;
  /** 待预览的网页地址，优先级高于 modelValue */
  url?: string;
  /** iframe 高度，默认 500px */
  height?: string;
  /** iframe 宽度，默认 100% */
  width?: string;
  /** iframe 边框，透传给原生 frameborder 属性 */
  frameborder?: string;
  /** 是否允许全屏 */
  allowfullscreen?: boolean;
  /** 加载策略，默认 lazy 延迟加载 */
  loading?: 'eager' | 'lazy';
  /** iframe sandbox 白名单，为空表示不加沙箱限制；嵌入不可信地址时应按最小权限配置 */
  sandbox?: string;
  /** form-create 表单的注入上下文，由 form-create 渲染器传入，业务方无需手工赋值 */
  formCreateInject?: Record<string, unknown>;
}

// 显示的 URL（优先使用 url prop，其次使用 modelValue）
const displayUrl = computed(() => props.url || props.modelValue || '');

// 是否显示预览
const showPreview = computed(() => {
  return displayUrl.value && isValidUrl(displayUrl.value);
});

// URL 验证
function isValidUrl(url: string): boolean {
  if (!url || url.trim() === '') return false;
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}
</script>

<template>
  <div class="iframe-component">
    <!-- iframe 预览 -->
    <div v-if="showPreview" class="iframe-preview">
      <iframe
        :src="displayUrl"
        :width="width"
        :height="height"
        :frameborder="frameborder"
        :allowfullscreen="allowfullscreen"
        :loading="loading"
        :sandbox="sandbox || undefined"
        class="iframe-content"
      ></iframe>
    </div>

    <!-- 无 URL 或无效 URL 提示 -->
    <div v-else class="iframe-placeholder">
      <el-empty description="请在右侧属性面板配置 URL 地址" />
    </div>
  </div>
</template>

<style scoped>
.iframe-component {
  width: 100%;
}

.iframe-preview {
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  overflow: hidden;
}

.iframe-content {
  display: block;
  border: none;
}

.iframe-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  border: 1px dashed #dcdfe6;
  border-radius: 4px;
  background-color: #fafafa;
}
</style>
