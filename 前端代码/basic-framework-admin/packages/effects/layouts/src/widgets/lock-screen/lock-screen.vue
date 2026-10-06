<script setup lang="ts">
/**
 * 全屏锁屏遮罩：以时钟为主视觉，点击解锁入口后展开密码表单。
 * 密码与访问令牌中保存的锁屏密码比对，通过后调用状态层解锁；
 * 不做路由跳转与登出，返回登录页只上抛 toLogin 事件交给外层布局处理。
 */
import { computed, reactive, ref } from 'vue';

import { LockKeyhole } from '@vben/icons';
import { $t, useI18n } from '@vben/locales';
import { storeToRefs, useAccessStore } from '@vben/stores';

import { useScrollLock } from '@vben-core/composables';
import { useVbenForm, z } from '@vben-core/form-ui';
import { VbenAvatar, VbenButton } from '@vben-core/shadcn-ui';

import { useDateFormat, useNow } from '@vueuse/core';

/** 锁屏属性：avatar 为遮罩上展示的用户头像地址。 */
interface Props {
  avatar?: string;
}

/** 密码输入框的组件实例形状：只用于定位内部原生 input 元素。 */
type PasswordFieldRef = {
  $el?: HTMLElement;
};

defineOptions({
  name: 'LockScreen',
});

withDefaults(defineProps<Props>(), {
  avatar: '',
});

defineEmits<{ toLogin: [] }>();

const { locale } = useI18n();
const accessStore = useAccessStore();

const now = useNow();
const meridiem = useDateFormat(now, 'A');
const hour = useDateFormat(now, 'HH');
const minute = useDateFormat(now, 'mm');
const date = useDateFormat(now, 'YYYY-MM-DD dddd', { locales: locale.value });

const showUnlockForm = ref(false);
const { lockScreenPassword } = storeToRefs(accessStore);

const [Form, { form, validate, getFieldComponentRef }] = useVbenForm(
  reactive({
    commonConfig: {
      hideLabel: true,
      hideRequiredMark: true,
    },
    /** 解锁表单结构：只含一个密码输入框，占位与校验提示均按当前语言生成。 */
    schema: computed(() => [
      {
        component: 'VbenInputPassword' as const,
        componentProps: {
          placeholder: $t('ui.widgets.lockScreen.placeholder'),
        },
        fieldName: 'password',
        label: $t('authentication.password'),
        rules: z.string().min(1, { message: $t('authentication.passwordTip') }),
      },
    ]),
    showDefaultActions: false,
  }),
);

/** 输入的密码是否与访问令牌中保存的锁屏密码一致，用于判断能否解锁。 */
const validPass = computed(
  () => lockScreenPassword?.value === form?.values?.password,
);

/**
 * 提交解锁密码。
 * 密码正确才真正解锁；密码错误时把错误写到字段上，让用户看到失败原因。
 * `form` 是引用恒定的上下文容器，前面校验通过即代表已挂载，
 * 因此这里刻意不加可选链：契约被破坏时要直接抛错暴露，不能把失败原因静默吞掉。
 */
async function handleSubmit() {
  const { valid } = await validate();
  if (valid) {
    if (validPass.value) {
      accessStore.unlockScreen();
    } else {
      form.setFieldError('password', $t('authentication.passwordErrorTip'));
    }
  }
}

/** 展开或收起解锁表单，展开后立刻聚焦密码输入框。 */
function toggleUnlockForm() {
  showUnlockForm.value = !showUnlockForm.value;
  if (showUnlockForm.value) {
    requestAnimationFrame(
      /** 等表单渲染完成再聚焦，否则此时还找不到原生 input。 */
      () => {
        getFieldComponentRef<PasswordFieldRef>('password')
          ?.$el?.querySelector<HTMLInputElement>('[name="password"]')
          ?.focus();
      },
    );
  }
}

useScrollLock();
</script>

<template>
  <div class="bg-background fixed z-[2000] size-full">
    <transition name="slide-left">
      <div v-show="!showUnlockForm" class="size-full">
        <div
          class="flex-col-center text-foreground/80 hover:text-foreground group fixed left-1/2 top-6 z-[2001] -translate-x-1/2 cursor-pointer text-xl font-semibold"
          @click="toggleUnlockForm"
        >
          <LockKeyhole
            class="size-5 transition-all duration-300 group-hover:scale-125"
          />
          <span>{{ $t('ui.widgets.lockScreen.unlock') }}</span>
        </div>
        <div class="flex h-full w-full items-center justify-center">
          <div class="flex w-full justify-center gap-4 px-4 sm:gap-6 md:gap-8">
            <div
              class="bg-accent relative flex h-[140px] w-[140px] items-center justify-center rounded-xl text-[36px] sm:h-[160px] sm:w-[160px] sm:text-[42px] md:h-[200px] md:w-[200px] md:text-[72px]"
            >
              <span
                class="absolute left-3 top-3 text-xs font-semibold sm:text-sm md:text-xl"
              >
                {{ meridiem }}
              </span>
              {{ hour }}
            </div>
            <div
              class="bg-accent flex h-[140px] w-[140px] items-center justify-center rounded-xl text-[36px] sm:h-[160px] sm:w-[160px] sm:text-[42px] md:h-[200px] md:w-[200px] md:text-[72px]"
            >
              {{ minute }}
            </div>
          </div>
        </div>
      </div>
    </transition>

    <transition name="slide-right">
      <div
        v-if="showUnlockForm"
        class="flex-center size-full"
        @keydown.enter.prevent="handleSubmit"
      >
        <div class="flex-col-center mb-10 w-[90%] max-w-[300px] px-4">
          <VbenAvatar :src="avatar" class="enter-x mb-6 size-20" />
          <div class="enter-x mb-2 w-full items-center">
            <Form />
          </div>
          <VbenButton class="enter-x w-full" @click="handleSubmit">
            {{ $t('ui.widgets.lockScreen.entry') }}
          </VbenButton>
          <VbenButton
            class="enter-x my-2 w-full"
            variant="ghost"
            @click="$emit('toLogin')"
          >
            {{ $t('ui.widgets.lockScreen.backToLogin') }}
          </VbenButton>
          <VbenButton
            class="enter-x mr-2 w-full"
            variant="ghost"
            @click="toggleUnlockForm"
          >
            {{ $t('common.back') }}
          </VbenButton>
        </div>
      </div>
    </transition>

    <div
      class="enter-y absolute bottom-5 w-full text-center text-xl md:text-2xl xl:text-xl 2xl:text-3xl"
    >
      <div v-if="showUnlockForm" class="enter-x mb-2 text-2xl md:text-3xl">
        {{ hour }}:{{ minute }}
        <span class="text-base md:text-lg">{{ meridiem }}</span>
      </div>
      <div class="text-xl md:text-3xl">{{ date }}</div>
    </div>
  </div>
</template>
