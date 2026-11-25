<script setup lang="ts">
/**
 * 1:1 复刻原 Vben Admin 5 锁屏遮罩（时钟翻页视图 + 点击解锁 + 返回登录）。
 */
import { LockKeyhole, LogOut } from '@lucide/vue';
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

defineProps<{
  avatar?: string;
  username: string;
}>();

const emit = defineEmits<{
  (e: 'unlock', password: string, done: (ok: boolean) => void): void;
  (e: 'logout'): void;
}>();

const now = ref(new Date());
const showUnlockForm = ref(false);
const unlockPassword = ref('');
let clockTimer: ReturnType<typeof setInterval> | null = null;

const hourText = computed(() => String(now.value.getHours()).padStart(2, '0'));
const minuteText = computed(() => String(now.value.getMinutes()).padStart(2, '0'));
const dateText = computed(() => {
  const d = now.value;
  const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${weekDays[d.getDay()]}`;
});

function handleSubmitUnlock() {
  if (!unlockPassword.value.trim()) {
    ElMessage.warning('请输入锁屏密码');
    return;
  }
  emit('unlock', unlockPassword.value, (ok) => {
    if (!ok) {
      ElMessage.error('锁屏密码错误');
    } else {
      unlockPassword.value = '';
      showUnlockForm.value = false;
    }
  });
}

onMounted(() => {
  clockTimer = setInterval(() => {
    now.value = new Date();
  }, 1000);
});

onBeforeUnmount(() => {
  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
});
</script>

<template>
  <div
    class="fixed inset-0 z-[2500] flex flex-col items-center justify-between bg-white/92 px-6 py-10 backdrop-blur-md select-none"
  >
    <!-- 顶部解锁触发按钮 -->
    <div class="flex flex-col items-center">
      <button
        type="button"
        class="group flex cursor-pointer flex-col items-center gap-1.5 text-[#334155] transition hover:text-[#006be6]"
        @click="showUnlockForm = !showUnlockForm"
      >
        <div
          class="flex h-10 w-10 items-center justify-center rounded-full bg-[#f4f4f5] transition group-hover:scale-105 group-hover:bg-[#e6f0fc]"
        >
          <LockKeyhole class="h-5 w-5" :stroke-width="1.75" />
        </div>
        <span class="text-xs font-medium">
          {{ showUnlockForm ? '返回时钟' : '点击解锁' }}
        </span>
      </button>
    </div>

    <!-- 中央区域：时钟或解锁表单 -->
    <transition name="bf-fade-slide" mode="out-in">
      <div
        v-if="!showUnlockForm"
        key="clock"
        class="flex cursor-pointer flex-col items-center"
        @click="showUnlockForm = true"
      >
        <div class="flex items-center gap-5 sm:gap-8">
          <div
            class="flex h-40 w-40 items-center justify-center rounded-3xl border border-[#e4e4e7] bg-[#f4f4f5] text-7xl font-bold tracking-tight text-[#18181b] shadow-sm sm:h-52 sm:w-52 sm:text-8xl"
          >
            {{ hourText }}
          </div>
          <span class="text-5xl font-bold text-[#a1a1aa]">:</span>
          <div
            class="flex h-40 w-40 items-center justify-center rounded-3xl border border-[#e4e4e7] bg-[#f4f4f5] text-7xl font-bold tracking-tight text-[#18181b] shadow-sm sm:h-52 sm:w-52 sm:text-8xl"
          >
            {{ minuteText }}
          </div>
        </div>
        <div class="mt-8 text-lg font-medium text-[#64748b]">
          {{ dateText }}
        </div>
      </div>

      <div
        v-else
        key="unlock"
        class="flex w-full max-w-[320px] flex-col items-center"
      >
        <el-avatar
          :size="76"
          :src="avatar || undefined"
          class="enter-x mb-4 !bg-[#006be6] text-2xl font-semibold text-white shadow-md"
        >
          {{ (username || 'A').slice(0, 1).toUpperCase() }}
        </el-avatar>
        <div class="enter-x mb-5 text-lg font-semibold text-[#18181b]">
          {{ username }}
        </div>
        <el-input
          v-model="unlockPassword"
          type="password"
          show-password
          size="large"
          placeholder="请输入锁屏密码"
          class="enter-x mb-3 w-full"
          @keyup.enter="handleSubmitUnlock"
        />
        <el-button
          type="primary"
          size="large"
          class="enter-x w-full"
          @click="handleSubmitUnlock"
        >
          进入系统
        </el-button>
        <div class="enter-x mt-4 flex w-full items-center justify-between text-xs text-[#64748b]">
          <button
            type="button"
            class="cursor-pointer transition hover:text-[#18181b]"
            @click="showUnlockForm = false"
          >
            返回时钟
          </button>
          <button
            type="button"
            class="inline-flex cursor-pointer items-center gap-1 transition hover:text-[#ef4444]"
            @click="emit('logout')"
          >
            <LogOut class="h-3.5 w-3.5" :stroke-width="1.75" />
            返回登录
          </button>
        </div>
      </div>
    </transition>

    <div class="text-xs text-[#94a3b8]">
      {{ dateText }}
    </div>
  </div>
</template>
