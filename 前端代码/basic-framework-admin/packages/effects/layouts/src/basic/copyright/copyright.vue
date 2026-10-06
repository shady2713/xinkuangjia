<script lang="ts" setup>
/**
 * 版权信息条：拼装 ICP 备案号、年份与公司名（可带站点链接），认证页与后台页脚共用。
 * 内容全部由偏好经 Props 传入，某项为空时对应片段不渲染，不自行读取偏好。
 */
interface Props {
  companyName?: string;
  companySiteLink?: string;
  date?: string;
  icp?: string;
  icpLink?: string;
}

defineOptions({
  name: 'Copyright',
});

withDefaults(defineProps<Props>(), {
  companyName: '管理后台',
  companySiteLink: '',
  date: '2024',
  icp: '',
  icpLink: '',
});
</script>

<template>
  <div class="text-md flex-center">
    <!-- ICP Link -->
    <a
      v-if="icp"
      :href="icpLink || 'javascript:void(0)'"
      class="hover:text-primary-hover mx-1"
      target="_blank"
    >
      {{ icp }}
    </a>

    <!-- Copyright Text -->
    Copyright © {{ date }}

    <!-- Company Link -->
    <a
      v-if="companyName && companySiteLink"
      :href="companySiteLink"
      class="hover:text-primary-hover mx-1"
      target="_blank"
    >
      {{ companyName }}
    </a>
    <span v-else-if="companyName" class="mx-1">
      {{ companyName }}
    </span>
  </div>
</template>
