<script setup lang="ts">
/** 密码输入框：在普通输入框上增加明文切换按钮，并可按需展示密码强度提示。 */
import type { ClassValue } from '@vben-core/shared/utils';

import { ref, useSlots } from 'vue';

import { Eye, EyeOff } from '@vben-core/icons';
import { cn } from '@vben-core/shared/utils';

import { Input } from '../../ui';
import PasswordStrength from './password-strength.vue';

interface Props {
  class?: ClassValue;
  /**
   * 是否显示密码强度
   */
  passwordStrength?: boolean;
}

defineOptions({
  inheritAttrs: false,
});

const props = defineProps<Props>();

const modelValue = defineModel<string>();

const slots = useSlots();

const show = ref(false);
</script>

<template>
  <div class="relative w-full">
    <Input
      v-bind="$attrs"
      v-model="modelValue"
      :class="cn(props.class)"
      :type="show ? 'text' : 'password'"
    />
    <template v-if="passwordStrength">
      <PasswordStrength :password="modelValue" />
      <p v-if="slots.strengthText" class="mt-1.5 text-xs text-muted-foreground">
        <slot name="strengthText"> </slot>
      </p>
    </template>
    <div
      :class="{
        'top-3': !!passwordStrength,
        'top-1/2 -translate-y-1/2 items-center': !passwordStrength,
      }"
      class="absolute inset-y-0 right-0 flex cursor-pointer pr-3 text-lg leading-5 text-foreground/60 hover:text-foreground"
      @click="show = !show"
    >
      <Eye v-if="show" class="size-4" />
      <EyeOff v-else class="size-4" />
    </div>
  </div>
</template>
