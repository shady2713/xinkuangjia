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

/** 锁屏弹窗属性：avatar 为头像地址，text 为头像下方的提示文案。 */
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

const [Form, formApi] = useVbenForm<BaseFormComponentType, LockScreenForm>(
  reactive({
    commonConfig: {
      hideLabel: true,
      hideRequiredMark: true,
    },
    schema: computed(
      /**
       * 声明锁屏密码输入项：必填，且只提交明文密码字段。
       * @returns 表单 schema 数组。
       */
      () => [
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
      ],
    ),
    showDefaultActions: false,
  }),
);

const { getFieldComponentRef, getValues, resetForm, validate } = formApi;

const [Modal] = useVbenModal({
  /** 确认动作复用同一条提交链路，避免页脚按钮与回车走两套逻辑。 */
  onConfirm() {
    handleSubmit();
  },
  /**
   * 弹窗打开时清空上一次的密码输入。
   * @param isOpen 弹窗当前是否打开。
   */
  onOpenChange(isOpen) {
    if (isOpen) {
      void resetFormForOpen();
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
 * 打开弹窗时清空上一次的密码输入。
 *
 * 弹窗默认 `destroyOnClose`：关闭会连表单一起销毁，重新打开时打开回调早于内容重建，
 * 此刻表单处于“已卸载”状态，直接重置会被表单实例以「表单已卸载」拒绝；
 * 这条拒绝没有接收方，会变成未处理拒绝上抛到运行环境（也清不掉上一次的校验错误）。
 * 因此先等重建后的表单真正挂载，再执行重置。
 * 等待与重置失败都只记录日志：清空输入失败不应中断弹窗打开流程，也不应留下未处理拒绝。
 */
async function resetFormForOpen() {
  try {
    // 表单已挂载（未开启关闭即销毁、或重建已完成）时无需等待，直接重置。
    if (!formApi.isMounted) {
      await formApi.stateHandler.waitForCondition();
    }
    await resetForm();
  } catch (error) {
    console.error('Failed to reset lock screen form', error);
  }
}

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
