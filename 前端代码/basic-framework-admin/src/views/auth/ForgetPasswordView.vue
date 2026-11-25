<script setup lang="ts">
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { onBeforeUnmount, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import { resetPasswordBySmsApi, sendSmsCodeApi } from '@/api/auth';
import CaptchaVerify from '@/components/CaptchaVerify.vue';
import { getAppConfig } from '@/config/app';
import { SmsSceneEnum } from '@/constants/enums';
import {
  FIELD_LIMITS,
  mobileRule,
  passwordComplexityRule,
  REGEX_PATTERNS,
  requiredRule,
} from '@/constants/validation';
import { encryptPassword } from '@/utils/sm2';

const router = useRouter();
const { appTitle, captchaEnabled } = getAppConfig();
const logoUrl = `${import.meta.env.BASE_URL}brand-logo.svg`;
const sloganUrl = `${import.meta.env.BASE_URL}login-slogan.svg`;

const formRef = ref<FormInstance>();
const captchaRef = ref<InstanceType<typeof CaptchaVerify> | null>(null);
const loading = ref(false);
const countdown = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

const form = reactive({
  mobile: '',
  code: '',
  password: '',
  confirmPassword: '',
});

const rules: FormRules = {
  mobile: [requiredRule('手机号'), mobileRule()],
  code: [requiredRule('短信验证码')],
  password: [requiredRule('新密码'), passwordComplexityRule()],
  confirmPassword: [
    requiredRule('确认新密码'),
    {
      validator: (_rule, val, cb) => {
        if (val !== form.password) cb(new Error('两次输入的密码不一致'));
        else cb();
      },
      trigger: 'blur',
    },
  ],
};

const sendingSms = ref(false);

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

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

async function doSendCode(captchaVerification?: string) {
  if (sendingSms.value || countdown.value > 0) return;
  sendingSms.value = true;
  try {
    await sendSmsCodeApi({
      mobile: form.mobile.trim(),
      scene: SmsSceneEnum.ADMIN_MEMBER_RESET_PASSWORD,
      captchaVerification,
    });
    ElMessage.success('验证码已发送');
    startCountdown();
  } finally {
    sendingSms.value = false;
  }
}

async function handleSendCode() {
  if (sendingSms.value || countdown.value > 0) return;
  if (!REGEX_PATTERNS.MOBILE.test(form.mobile.trim())) {
    ElMessage.warning('请先输入正确的 11 位手机号');
    return;
  }
  if (captchaEnabled) {
    captchaRef.value?.show();
    return;
  }
  await doSendCode();
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  loading.value = true;
  try {
    const encryptedPassword = await encryptPassword(form.password);
    await resetPasswordBySmsApi({
      mobile: form.mobile.trim(),
      code: form.code.trim(),
      password: encryptedPassword,
    });
    ElMessage.success('密码重置成功，请重新登录');
    await router.replace({ path: '/login', query: { platform: 'business' } });
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="relative flex min-h-screen w-full overflow-x-hidden bg-white select-none">
    <div class="absolute top-5 left-6 z-10 flex items-center gap-2.5">
      <img :src="logoUrl" :alt="appTitle" class="h-10 w-10 rounded-lg" />
      <span class="text-xl font-medium text-[#1f2937]">{{ appTitle }}</span>
    </div>

    <div class="relative hidden flex-1 bg-[#f1f3f6] lg:block">
      <div class="bf-login-bg absolute inset-0 h-full w-full" />
      <div class="relative flex h-full flex-col items-center justify-center px-12">
        <img
          :src="sloganUrl"
          :alt="appTitle"
          class="-enter-x bf-animate-float h-72 w-auto max-w-[440px]"
        />
        <h2 class="-enter-x mt-6 text-2xl font-medium text-[#1f2937]">重置账号密码</h2>
        <p class="-enter-x mt-2 text-sm text-[#64748b]">验证绑定手机号后立即重置安全密码</p>
      </div>
    </div>

    <div class="bf-side-enter-right relative flex w-full flex-col items-center justify-center bg-white px-6 py-12 lg:w-2/5 lg:px-8">
      <div class="w-full max-w-[400px]">
        <div class="enter-x mb-7">
          <h1 class="text-3xl font-bold leading-9 tracking-tight text-[#18181b]">忘记密码？</h1>
          <p class="mt-2.5 text-sm text-[#71717a]">验证绑定手机号后立即设置新密码</p>
        </div>

        <el-form ref="formRef" :model="form" :rules="rules" size="large" class="enter-x">
          <el-form-item prop="mobile">
            <el-input
              v-model="form.mobile"
              placeholder="请输入 11 位手机号"
              :maxlength="FIELD_LIMITS.MOBILE"
              clearable
            />
          </el-form-item>
          <el-form-item prop="code">
            <div class="flex w-full gap-2">
              <el-input
                v-model="form.code"
                placeholder="请输入 6 位验证码"
                :maxlength="FIELD_LIMITS.SMS_CODE"
                class="flex-1"
              />
              <el-button :disabled="countdown > 0 || sendingSms" @click="handleSendCode">
                {{ countdown > 0 ? `${countdown}s` : '获取验证码' }}
              </el-button>
            </div>
          </el-form-item>
          <el-form-item prop="password">
            <el-input
              v-model="form.password"
              type="password"
              show-password
              :maxlength="FIELD_LIMITS.PASSWORD_MAX"
              placeholder="请输入 8~32 位含大小写字母及数字的新密码"
            />
          </el-form-item>
          <el-form-item prop="confirmPassword">
            <el-input
              v-model="form.confirmPassword"
              type="password"
              show-password
              :maxlength="FIELD_LIMITS.PASSWORD_MAX"
              placeholder="请再次确认新密码"
            />
          </el-form-item>
          <el-button type="primary" class="w-full !font-medium" size="large" :loading="loading" @click="handleSubmit">
            确认重置
          </el-button>
          <div class="mt-4">
            <el-button class="w-full" size="large" @click="router.push('/login')">
              返回登录
            </el-button>
          </div>
        </el-form>
      </div>

      <div class="absolute bottom-4 text-center text-xs text-[#a1a1aa]">
        Copyright © {{ new Date().getFullYear() }} {{ appTitle }}
      </div>
    </div>

    <CaptchaVerify ref="captchaRef" @success="({ captchaVerification }) => doSendCode(captchaVerification)" />
  </div>
</template>
