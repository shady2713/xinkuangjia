<script setup lang="ts">
/**
 * 1:1 复刻原 Vben Admin 5 认证页右侧面板（panel-right）：
 * - 左侧柔和主色光晕 + 品牌 Logo + 浮动插画 + -enter-x 交错入场
 * - 右侧极简大标题 + 轻量平台分段切换 + 纯净大输入框 + 记住账号/忘记密码 + 主按钮与手机号登录切换
 */
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { sendSmsCodeApi } from '@/api/auth';
import CaptchaVerify from '@/components/CaptchaVerify.vue';
import { getAppConfig } from '@/config/app';
import { SmsSceneEnum } from '@/constants/enums';
import {
  FIELD_LIMITS,
  mobileRule,
  requiredRule,
} from '@/constants/validation';
import { useUserStore } from '@/stores/user';
import { encryptPassword } from '@/utils/sm2';
import type { LoginPlatform } from '@/utils/token';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const { appTitle, captchaEnabled } = getAppConfig();
const logoUrl = `${import.meta.env.BASE_URL}brand-logo.svg`;
const sloganUrl = `${import.meta.env.BASE_URL}login-slogan.svg`;
const REMEMBER_ME_KEY = `REMEMBER_ME_USERNAME_${typeof window !== 'undefined' ? window.location.hostname : 'local'}`;

const activeTab = ref<'password' | 'sms'>('password');
const platform = ref<LoginPlatform>(route.query.platform === 'business' ? 'business' : 'super');
const rememberMe = ref(false);
watch(
  () => route.query.platform,
  (next) => {
    if (next === 'business' || next === 'super') {
      platform.value = next;
    }
  },
);
const loading = ref(false);
const sendingSms = ref(false);
const captchaRef = ref<InstanceType<typeof CaptchaVerify> | null>(null);
const captchaPurpose = ref<'login' | 'sms'>('login');

const pwdFormRef = ref<FormInstance>();
const pwdForm = reactive({
  username: '',
  password: '',
});
const pwdRules: FormRules = {
  username: [requiredRule('用户名')],
  password: [requiredRule('密码')],
};

const smsFormRef = ref<FormInstance>();
const smsForm = reactive({
  mobile: '',
  code: '',
});
const smsRules: FormRules = {
  mobile: [requiredRule('手机号'), mobileRule()],
  code: [requiredRule('短信验证码')],
};

const countdown = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

function startCountdown() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  countdown.value = 60;
  timer = setInterval(() => {
    countdown.value -= 1;
    if (countdown.value <= 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  }, 1000);
}

onMounted(() => {
  try {
    const saved = localStorage.getItem(REMEMBER_ME_KEY) || '';
    if (saved) {
      pwdForm.username = saved;
      rememberMe.value = true;
    }
  } catch {
    // 忽略受限存储环境
  }
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

async function navigateAfterLogin() {
  if (userStore.passwordChangeRequired) {
    await router.replace('/profile/change-password');
    return;
  }
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '';
  const target = redirect && redirect.startsWith('/') && !redirect.startsWith('//')
    ? redirect
    : '/dashboard';
  await router.replace(target);
}

async function doPasswordLogin(captchaVerification?: string) {
  const selectedPlatform = platform.value;
  const trimmedUsername = pwdForm.username.trim();
  loading.value = true;
  try {
    try {
      if (rememberMe.value) {
        localStorage.setItem(REMEMBER_ME_KEY, trimmedUsername);
      } else {
        localStorage.removeItem(REMEMBER_ME_KEY);
      }
    } catch {
      // 忽略受限存储环境
    }
    const encryptedPassword = await encryptPassword(pwdForm.password);
    await userStore.loginByPassword({
      username: trimmedUsername,
      password: encryptedPassword,
      captchaVerification,
    }, selectedPlatform);
    ElMessage.success('登录成功');
    await navigateAfterLogin();
  } finally {
    loading.value = false;
  }
}

async function handlePasswordSubmit() {
  const valid = await pwdFormRef.value?.validate().catch(() => false);
  if (!valid) return;
  if (captchaEnabled) {
    captchaPurpose.value = 'login';
    captchaRef.value?.show();
    return;
  }
  await doPasswordLogin();
}

async function doSendSmsCode(captchaVerification?: string) {
  if (sendingSms.value || countdown.value > 0) return;
  sendingSms.value = true;
  try {
    await sendSmsCodeApi({
      mobile: smsForm.mobile.trim(),
      scene: SmsSceneEnum.ADMIN_MEMBER_LOGIN,
      captchaVerification,
    });
    ElMessage.success('验证码已发送');
    startCountdown();
  } finally {
    sendingSms.value = false;
  }
}

async function handleSendSms() {
  if (sendingSms.value || countdown.value > 0) return;
  if (!/^1\d{10}$/.test(smsForm.mobile.trim())) {
    ElMessage.warning('请先输入正确的 11 位手机号');
    return;
  }
  if (captchaEnabled) {
    captchaPurpose.value = 'sms';
    captchaRef.value?.show();
    return;
  }
  await doSendSmsCode();
}

async function handleSmsSubmit() {
  const valid = await smsFormRef.value?.validate().catch(() => false);
  if (!valid) return;
  loading.value = true;
  try {
    await userStore.loginBySms({
      mobile: smsForm.mobile.trim(),
      code: smsForm.code.trim(),
    });
    ElMessage.success('登录成功');
    await navigateAfterLogin();
  } finally {
    loading.value = false;
  }
}

async function handleCaptchaSuccess({
  captchaVerification,
}: {
  captchaVerification: string;
}) {
  if (captchaPurpose.value === 'login') {
    await doPasswordLogin(captchaVerification);
  } else {
    await doSendSmsCode(captchaVerification);
  }
}
</script>

<template>
  <div class="relative flex min-h-screen w-full overflow-x-hidden bg-white select-none">
    <!-- 左上角品牌标识 -->
    <div class="absolute top-5 left-6 z-10 flex items-center gap-2.5">
      <img :src="logoUrl" :alt="appTitle" class="h-10 w-10" />
      <span class="text-xl font-medium text-[#18181b]">{{ appTitle }}</span>
    </div>

    <!-- 左侧柔和主色光晕 + 品牌插画 -->
    <div class="relative hidden flex-1 bg-[#f1f3f6] lg:block">
      <div class="bf-login-bg absolute inset-0 h-full w-full" />
      <div class="relative flex h-full flex-col items-center justify-center px-12">
        <img
          :src="sloganUrl"
          :alt="appTitle"
          class="-enter-x bf-animate-float h-72 w-auto max-w-[440px]"
        />
        <h2 class="-enter-x mt-6 text-2xl font-medium text-[#18181b]">
          {{ appTitle }} · 开箱即用的管理基座
        </h2>
        <p class="-enter-x mt-2 text-sm text-[#71717a]">
          安全合规 · 权限隔离 · 极简高效
        </p>
      </div>
    </div>

    <!-- 右侧极简 Vben 5 认证面板 -->
    <div
      class="bf-side-enter-right relative flex w-full flex-col items-center justify-center bg-white px-6 py-12 lg:w-2/5 lg:px-8"
    >
      <div class="w-full max-w-[400px]">
        <div class="enter-x mb-7">
          <h1 class="text-3xl font-bold leading-9 tracking-tight text-[#18181b] lg:text-4xl">
            {{ activeTab === 'password' ? '欢迎回来' : '手机号登录' }}
          </h1>
          <p class="mt-2.5 text-sm text-[#71717a]">
            {{
              activeTab === 'password'
                ? '请输入您的账号信息以开始管理您的项目'
                : '请输入绑定手机号接收短信验证码登录'
            }}
          </p>
        </div>

        <transition name="bf-fade-slide" mode="out-in">
          <!-- 账号密码登录 -->
          <el-form
            v-if="activeTab === 'password'"
            key="password"
            ref="pwdFormRef"
            :model="pwdForm"
            :rules="pwdRules"
            size="large"
            class="enter-x"
            @keyup.enter="handlePasswordSubmit"
          >
            <!-- 轻量 shadcn 分段切换（保留双平台隔离能力） -->
            <div class="mb-5 grid grid-cols-2 rounded-lg bg-[#f4f4f5] p-1">
              <button
                type="button"
                class="h-8 cursor-pointer rounded-md text-[13px] font-medium transition-all"
                :class="
                  platform === 'super'
                    ? 'bg-white text-[#18181b] shadow-xs'
                    : 'text-[#71717a] hover:text-[#18181b]'
                "
                :disabled="loading"
                @click="platform = 'super'"
              >
                平台管理员
              </button>
              <button
                type="button"
                class="h-8 cursor-pointer rounded-md text-[13px] font-medium transition-all"
                :class="
                  platform === 'business'
                    ? 'bg-white text-[#18181b] shadow-xs'
                    : 'text-[#71717a] hover:text-[#18181b]'
                "
                :disabled="loading"
                @click="platform = 'business'"
              >
                业务账号
              </button>
            </div>

            <el-form-item prop="username">
              <el-input
                v-model="pwdForm.username"
                placeholder="请输入用户名"
                :maxlength="FIELD_LIMITS.USERNAME"
                autocomplete="username"
                clearable
              />
            </el-form-item>

            <el-form-item prop="password">
              <el-input
                v-model="pwdForm.password"
                type="password"
                show-password
                placeholder="请输入密码"
                :maxlength="FIELD_LIMITS.PASSWORD_MAX"
                autocomplete="current-password"
              />
            </el-form-item>

            <div class="mb-6 flex items-center justify-between">
              <el-checkbox v-model="rememberMe">记住账号</el-checkbox>
              <router-link
                to="/forget-password"
                class="text-sm text-[#006be6] transition hover:text-[#0056b8]"
              >
                忘记密码？
              </router-link>
            </div>

            <el-button
              type="primary"
              class="w-full !font-medium"
              size="large"
              :loading="loading"
              @click="handlePasswordSubmit"
            >
              登 录
            </el-button>

            <div class="mt-4">
              <el-button
                class="w-full"
                size="large"
                @click="activeTab = 'sms'"
              >
                手机号登录
              </el-button>
            </div>
          </el-form>

          <!-- 短信验证码登录 -->
          <el-form
            v-else
            key="sms"
            ref="smsFormRef"
            :model="smsForm"
            :rules="smsRules"
            size="large"
            class="enter-x"
            @keyup.enter="handleSmsSubmit"
          >
            <el-form-item prop="mobile">
              <el-input
                v-model="smsForm.mobile"
                placeholder="请输入 11 位手机号"
                :maxlength="FIELD_LIMITS.MOBILE"
                clearable
              />
            </el-form-item>
            <el-form-item prop="code">
              <div class="flex w-full gap-2">
                <el-input
                  v-model="smsForm.code"
                  placeholder="请输入 6 位验证码"
                  :maxlength="FIELD_LIMITS.SMS_CODE"
                  class="flex-1"
                />
                <el-button
                  :disabled="countdown > 0 || sendingSms"
                  @click="handleSendSms"
                >
                  {{ countdown > 0 ? `${countdown}s 后重发` : '获取验证码' }}
                </el-button>
              </div>
            </el-form-item>

            <el-button
              type="primary"
              class="mt-2 w-full !font-medium"
              size="large"
              :loading="loading"
              @click="handleSmsSubmit"
            >
              登 录
            </el-button>

            <div class="mt-4">
              <el-button
                class="w-full"
                size="large"
                @click="activeTab = 'password'"
              >
                返回账号密码登录
              </el-button>
            </div>
          </el-form>
        </transition>
      </div>

      <!-- 底部版权信息（对齐原版 Vben 5 Copyright） -->
      <div class="absolute bottom-4 text-center text-xs text-[#a1a1aa]">
        Copyright © {{ new Date().getFullYear() }} {{ appTitle }}
      </div>
    </div>

    <CaptchaVerify ref="captchaRef" @success="handleCaptchaSuccess" />
  </div>
</template>
