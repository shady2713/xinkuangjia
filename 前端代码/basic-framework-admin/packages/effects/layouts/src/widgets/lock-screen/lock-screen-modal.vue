<script setup lang="ts">
/**
 * 锁屏解锁弹窗：只负责收集锁屏密码并上抛，由外层容器完成真正的解锁校验。
 */
import type { BaseFormComponentType } from '@vben-core/form-ui';

import { computed, reactive } from 'vue';

import { $t } from '@vben/locales';

import { useVbenForm, z } from '@vben-core/form-ui';
import { useVbenModal } from '@vben-core/popup-ui';
import { VbenAvatar, VbenButton } from '@vben-core/shadcn-ui';

interface Props {
  avatar?: string;
  text?: string;
}

/** 密码输入框的组件实例形状：只用于定位内部原生 input 元素。 */
type PasswordFieldRef = {
  $el?: HTMLElement;
};

/** 锁屏弹窗表单值：用户输入的锁屏密码。 */
type LockScreenForm = {
  lockScreenPassword: string;
};

defineOptions({
  name: 'LockScreenModal',
});

withDefaults(defineProps<Props>(), {
  avatar: '',
  text: '',
});

const emit = defineEmits<{
  submit: [value: string];
}>();

const [Form, { resetForm, validate, getValues, getFieldComponentRef }] =
  useVbenForm<BaseFormComponentType, LockScreenForm>(
    reactive({
      commonConfig: {
        hideLabel: true,
        hideRequiredMark: true,
      },
      schema: computed(() => [
        {
          component: 'VbenInputPassword' as const,
          componentProps: {
            placeholder: $t('ui.widgets.lockScreen.placeholder'),
          },
          fieldName: 'lockScreenPassword',
          formFieldProps: { validateOnBlur: false },
          label: $t('authentication.password'),
          rules: z
            .string()
            .min(1, { message: $t('ui.widgets.lockScreen.placeholder') }),
        },
      ]),
      showDefaultActions: false,
    }),
  );

const [Modal] = useVbenModal({
  onConfirm() {
    handleSubmit();
  },
  onOpenChange(isOpen) {
    if (isOpen) {
      resetForm();
    }
  },
  /**
   * 弹窗动画结束后再聚焦输入框。
   * 必须等动画结束，否则焦点会被弹窗的位移动画重置。
   */
  onOpened() {
    requestAnimationFrame(
      /** 在下一帧聚焦原生 input，弹窗容器自身不接收输入。 */
      () => {
        getFieldComponentRef<PasswordFieldRef>('lockScreenPassword')
          ?.$el?.querySelector<HTMLInputElement>('[name="lockScreenPassword"]')
          ?.focus();
      },
    );
  },
});

/**
 * 提交解锁密码。
 * 校验不通过时不通知上层：解锁是敏感操作，不能把空密码送到鉴权接口。
 */
async function handleSubmit() {
  const { valid } = await validate();
  const values = await getValues();
  if (valid) {
    emit('submit', values.lockScreenPassword);
  }
}
</script>

<template>
  <Modal
    :footer="false"
    :fullscreen-button="false"
    :title="$t('ui.widgets.lockScreen.title')"
  >
    <div
      class="mb-10 flex w-full flex-col items-center px-10"
      @keydown.enter.prevent="handleSubmit"
    >
      <div class="w-full">
        <div class="ml-2 flex w-full flex-col items-center">
          <VbenAvatar
            :src="avatar"
            class="size-20"
            dot-class="bottom-0 right-1 border-2 size-4 bg-green-500"
          />
          <div class="text-foreground my-6 flex items-center font-medium">
            {{ text }}
          </div>
        </div>
        <Form />
        <VbenButton class="mt-1 w-full" @click="handleSubmit">
          {{ $t('ui.widgets.lockScreen.screenButton') }}
        </VbenButton>
      </div>
    </div>
  </Modal>
</template>
