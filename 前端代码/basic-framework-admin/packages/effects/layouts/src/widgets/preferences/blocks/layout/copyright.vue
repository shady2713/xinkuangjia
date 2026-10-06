<script setup lang="ts">
/**
 * 偏好设置「版权」分组：管理版权开关与公司名、站点、日期、ICP 备案字段。
 * 开关关闭或父级 disabled 时，下面各输入项统一置灰不可编辑；
 * 只回写偏好字段，页脚中的实际展示由布局组件按这些偏好渲染。
 */
import { computed } from 'vue';

import { $t } from '@vben/locales';

import InputItem from '../input-item.vue';
import SwitchItem from '../switch-item.vue';

// 版权设置默认可编辑，只有父级明确禁用时才整体置灰。
const props = withDefaults(defineProps<{ disabled?: boolean }>(), {
  disabled: false,
});

const copyrightEnable = defineModel<boolean>('copyrightEnable');
const copyrightDate = defineModel<string>('copyrightDate');
const copyrightIcp = defineModel<string>('copyrightIcp');
const copyrightIcpLink = defineModel<string>('copyrightIcpLink');
const copyrightCompanyName = defineModel<string>('copyrightCompanyName');
const copyrightCompanySiteLink = defineModel<string>(
  'copyrightCompanySiteLink',
);

/** 版权各输入项是否禁用：父级禁用，或版权总开关已关闭时统一置灰。 */
const itemDisabled = computed(() => props.disabled || !copyrightEnable.value);
</script>

<template>
  <SwitchItem v-model="copyrightEnable" :disabled="disabled">
    {{ $t('preferences.copyright.enable') }}
  </SwitchItem>

  <InputItem v-model="copyrightCompanyName" :disabled="itemDisabled">
    {{ $t('preferences.copyright.companyName') }}
  </InputItem>
  <InputItem v-model="copyrightCompanySiteLink" :disabled="itemDisabled">
    {{ $t('preferences.copyright.companySiteLink') }}
  </InputItem>
  <InputItem v-model="copyrightDate" :disabled="itemDisabled">
    {{ $t('preferences.copyright.date') }}
  </InputItem>

  <InputItem v-model="copyrightIcp" :disabled="itemDisabled">
    {{ $t('preferences.copyright.icp') }}
  </InputItem>
  <InputItem v-model="copyrightIcpLink" :disabled="itemDisabled">
    {{ $t('preferences.copyright.icpLink') }}
  </InputItem>
</template>
