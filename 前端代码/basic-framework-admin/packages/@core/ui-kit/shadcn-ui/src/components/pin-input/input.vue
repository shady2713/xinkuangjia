<script setup lang="ts">
/**
 * 验证码输入组件：分格输入固定长度验证码，按钮触发发送并倒计时。
 * 发送逻辑由外部 handleSendCode 注入，本组件不发起请求。
 * 发送失败以 sendError 抛出原始异常，验证码正确性由调用方校验。
 */
import type { PinInputProps } from './types';

import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';

import { PinInput, PinInputGroup, PinInputInput } from '../../ui';
import { VbenButton } from '../button';

defineOptions({
  inheritAttrs: false,
});

/**
 * 解构出组件要用到的可选项并就地给出兜底值。
 * codeLength 决定分格数量；createText 由使用方按剩余秒数生成按钮文案；
 * handleSendCode 是发送动作的注入点，本组件只负责调用与倒计时，不发请求；
 * maxTime 是倒计时秒数，loading 透传按钮的加载态。
 * 逐个解构而非保留 props 对象，是为了让下面的模板可以直接引用这些名字。
 */
const {
  codeLength = 6,
  createText = async () => {},
  disabled = false,
  handleSendCode = async () => {},
  loading = false,
  maxTime = 60,
} = defineProps<PinInputProps>();

const emit = defineEmits<{
  complete: [];
  /** 发送验证码失败；载荷是捕获到的原始异常，类型未知，由使用方自行收窄 */
  sendError: [error: unknown];
}>();

const timer = ref<ReturnType<typeof setTimeout>>();

const modelValue = defineModel<string>();

const inputValue = ref<string[]>([]);
const countdown = ref(0);

/**
 * 发送按钮的文案，交给 createText 按当前剩余秒数生成，
 * 这样"重新发送（60s）"这类带倒计时的文案完全由使用方决定。
 */
const btnText = computed(() => {
  const countdownValue = countdown.value;
  return createText?.(countdownValue);
});

/**
 * 发送按钮是否处于加载态：外部传入的 loading 生效，或本地倒计时尚未走完时都算。
 * 倒计时期间禁用按钮，避免用户在等待中重复触发发送。
 */
const btnLoading = computed(() => {
  return loading || countdown.value > 0;
});

watch(
  () => modelValue.value,
  () => {
    inputValue.value = modelValue.value?.split('') ?? [];
  },
);

watch(inputValue, (val) => {
  modelValue.value = val.join('');
});

/**
 * 分格全部填满时由底层组件回调：把各格拼成完整字符串写回 v-model，
 * 再抛出无参数的 complete 事件通知使用方去校验或提交。
 * 组件自身不判断验证码对错，事件载荷为空，正确性校验由使用方负责。
 * @param e 各分格当前的内容，顺序与 codeLength 中的格位一致。
 */
function handleComplete(e: string[]) {
  modelValue.value = e.join('');
  emit('complete');
}

/**
 * 点击发送按钮的入口：先阻止默认提交，再立即起算 maxTime 秒倒计时并置按钮为加载态，
 * 最后 await 使用方注入的发送逻辑。倒计时先于请求启动，因此请求慢也不会让按钮恢复可点。
 * 发送失败不静默吞掉，异常连同原始载荷一起经 sendError 事件抛给使用方。
 * @param e 点击事件，仅用于阻止表单默认提交。
 */
async function handleSend(e: Event) {
  try {
    e?.preventDefault();
    countdown.value = maxTime;
    startCountdown();
    await handleSendCode();
  } catch (error) {
    // Consider emitting an error event or showing a notification
    emit('sendError', error);
  }
}

/**
 * 逐秒递减 countdown 并递归排下一次定时器，直到减到 0 为止。
 * 递归而非单次 setInterval，是为了让倒计时与组件生命周期解耦；
 * countdown 归零后不再排程，组件卸载时由 onBeforeUnmount 清理未触发的定时器。
 */
function startCountdown() {
  if (countdown.value > 0) {
    timer.value = setTimeout(() => {
      countdown.value--;
      startCountdown();
    }, 1000);
  }
}

onBeforeUnmount(() => {
  countdown.value = 0;
  clearTimeout(timer.value);
});

const id = useId();

const pinType = 'text' as const;
</script>

<template>
  <PinInput
    :id="id"
    v-model="inputValue"
    :disabled="disabled"
    class="flex w-full justify-between"
    otp
    placeholder="○"
    :type="pinType"
    @complete="handleComplete"
  >
    <div class="relative flex w-full">
      <PinInputGroup class="mr-2">
        <PinInputInput
          v-for="(item, index) in codeLength"
          :key="item"
          :index="index"
        />
      </PinInputGroup>
      <VbenButton
        :disabled="disabled"
        :loading="btnLoading"
        class="flex-grow"
        size="lg"
        variant="outline"
        @click="handleSend"
      >
        {{ btnText }}
      </VbenButton>
    </div>
  </PinInput>
</template>
