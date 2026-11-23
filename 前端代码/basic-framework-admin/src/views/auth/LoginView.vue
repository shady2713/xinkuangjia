<script setup lang="ts">
/**
 * 1:1 复刻原认证页右侧面板布局（panel-right）：
 * 左侧柔和主色光晕 + 品牌 Logo + 浮动插画；右侧支持「账号密码」与「短信验证码」两种登录方式。
 */
import { Lock, Phone, User } from '@element-plus/icons-vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { onBeforeUnmount, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { type LoginPlatform, sendSmsCodeApi } from '@/api/auth';
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

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const { appTitle, captchaEnabled } = getAppConfig();
const logoUrl = `${import.meta.env.BASE_URL}brand-logo.svg`;
const sloganUrl = `${import.meta.env.BASE_URL}login-slogan.svg`;

const activeTab = ref<'password' | 'sms'>('password');
const platform = ref<LoginPlatform>(route.query.platform === 'business' ? 'business' : 'super');
const loading = ref(false);
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
  countdown.value = 60;
  timer = setInterval(() => {
    countdown.value -= 1;
    if (countdown.value <= 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  }, 1000);
}

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
  loading.value = true;
  try {
    const encryptedPassword = await encryptPassword(pwdForm.password);
    await userStore.loginByPassword({
      username: pwdForm.username.trim(),
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
  await sendSmsCodeApi({
    mobile: smsForm.mobile.trim(),
    scene: SmsSceneEnum.ADMIN_MEMBER_LOGIN,
    captchaVerification,
  });
  ElMessage.success('验证码已发送');
  startCountdown();
}

async function handleSendSms() {
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
      <span class="text-xl font-medium text-[#1f2937]">{{ appTitle }}</span>
    </div>

    <!-- 左侧柔和主色光晕 + 品牌插画 -->
    <div class="relative hidden flex-1 bg-[#f1f3f6] lg:block">
      <div class="bf-login-bg absolute inset-0 h-full w-full" />
      <div class="relative flex h-full flex-col items-center justify-center px-12">
        <img
          :src="sloganUrl"
          :alt="appTitle"
          class="bf-animate-float h-72 w-auto max-w-[440px]"
        />
        <h2 class="mt-6 text-2xl font-medium text-[#1f2937]">
          {{ appTitle }} · 开箱即用的管理基座
        </h2>
        <p class="mt-2 text-sm text-[#64748b]">
          安全合规 · 权限隔离 · 极简高效
        </p>
      </div>
    </div>

    <!-- 右侧登录表单面板 -->
    <div
      class="flex w-full flex-col items-center justify-center bg-white px-8 py-12 lg:w-[46%] lg:max-w-[540px]"
    >
      <div class="w-full max-w-[380px]">
        <div class="mb-7">
          <h1 class="text-3xl font-bold tracking-tight text-[#111827]">欢迎回来</h1>
          <p class="mt-2 text-sm text-[#64748b]">请输入您的账号信息以开始管理工作</p>
        </div>

        <el-tabs v-model="activeTab" class="mb-4">
          <el-tab-pane label="账号密码登录" name="password">
            <el-form
              ref="pwdFormRef"
              :model="pwdForm"
              :rules="pwdRules"
              size="large"
              class="mt-2"
              @keyup.enter="handlePasswordSubmit"
            >
              <el-form-item>
                <el-radio-group v-model="platform" :disabled="loading">
                  <el-radio-button value="super">平台管理员</el-radio-button>
                  <el-radio-button value="business">业务账号</el-radio-button>
                </el-radio-group>
              </el-form-item>
              <el-form-item prop="username">
                <el-input
                  v-model="pwdForm.username"
                  placeholder="请输入用户名"
                  :maxlength="FIELD_LIMITS.USERNAME"
                  :prefix-icon="User"
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
                  :prefix-icon="Lock"
                  autocomplete="current-password"
                />
              </el-form-item>

              <div class="mb-5 flex items-center justify-end">
                <router-link
                  to="/forget-password"
                  class="text-xs text-[#006be6] hover:underline"
                >
                  忘记密码？
                </router-link>
              </div>

              <el-button
                type="primary"
                class="w-full"
                size="large"
                :loading="loading"
                @click="handlePasswordSubmit"
              >
                登 录
              </el-button>
            </el-form>
          </el-tab-pane>

          <el-tab-pane label="短信验证码登录" name="sms">
            <el-form
              ref="smsFormRef"
              :model="smsForm"
              :rules="smsRules"
              size="large"
              class="mt-2"
              @keyup.enter="handleSmsSubmit"
            >
              <el-form-item prop="mobile">
                <el-input
                  v-model="smsForm.mobile"
                  placeholder="请输入 11 位手机号"
                  :maxlength="FIELD_LIMITS.MOBILE"
                  :prefix-icon="Phone"
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
                    :disabled="countdown > 0"
                    @click="handleSendSms"
                  >
                    {{ countdown > 0 ? `${countdown}s 后重发` : '获取验证码' }}
                  </el-button>
                </div>
              </el-form-item>

              <el-button
                type="primary"
                class="mt-2 w-full"
                size="large"
                :loading="loading"
                @click="handleSmsSubmit"
              >
                登 录
              </el-button>
            </el-form>
          </el-tab-pane>
        </el-tabs>

        <div class="mt-10 text-center text-xs text-[#94a3b8]">
          Copyright &copy; {{ new Date().getFullYear() }} {{ appTitle }}
        </div>
      </div>
    </div>

    <CaptchaVerify ref="captchaRef" @success="handleCaptchaSuccess" />
  </div>
</template>
