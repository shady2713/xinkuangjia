/**
 * 前端关键路径 e2e 的共享环境配置、接口转发与登录操作。
 *
 * 用例运行在生产构建的 vite preview 上；浏览器请求 `/admin-api` 时由本文件安装的
 * 路由拦截转发到真实后端。构建产物中的运行时配置保持原样，只有验证码开关在测试
 * 上下文内改为关闭，避免自动化依赖人工滑块；关闭后端验证码属于测试环境准备步骤。
 */
import type { BrowserContext, Page, Response } from '@playwright/test';

import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** 后端服务地址；本地 e2e 可用 E2E_BACKEND_URL 指向其他实例。 */
export const backendUrl =
  process.env.E2E_BACKEND_URL ?? 'http://127.0.0.1:48080';

/** 登录用例使用的测试账号。 */
export type TestAccount = {
  password: string;
  username: string;
};

/**
 * 读取隔离测试库口令。源码不写口令字面量，避免密钥扫描把测试数据当成固定凭据。
 *
 * @param name 环境变量名，例如 E2E_ADMIN_PASSWORD。
 * @returns 环境变量中的口令。
 * @throws 未设置该变量时抛出，提示按 README 导出后再跑。
 */
function requiredTestSecret(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `缺少 ${name}，请按 e2e/README.md 导出隔离测试账号口令后再跑 e2e。`,
    );
  }
  return value;
}

/** 管理员测试账号；口令来自 E2E_ADMIN_PASSWORD，对应 seed-e2e.sql。 */
export const adminAccount: TestAccount = {
  password: requiredTestSecret('E2E_ADMIN_PASSWORD'),
  username: process.env.E2E_ADMIN_USERNAME ?? 'admin',
};

/** 无业务菜单权限的受限账号，用于验证无权限入口不可用和后端接口拒绝。 */
export const limitedAccount: TestAccount = {
  password: requiredTestSecret('E2E_LIMITED_PASSWORD'),
  username: process.env.E2E_LIMITED_USERNAME ?? 'e2elimited',
};

/** 不存在的账号与错误口令占位，只用于登录失败路径，不会写入数据库。 */
export const unknownAccount: TestAccount = {
  password: 'CHANGE_ME_WRONG_PASSWORD',
  username: 'e2enotexist',
};

/**
 * 读取 e2e 夹具文件的绝对路径。
 *
 * @param name 夹具文件名，位于 e2e/fixtures 目录。
 * @returns 与执行目录无关的绝对路径。
 */
export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

/**
 * 为浏览器上下文安装运行时配置替换与后端接口转发。
 *
 * 必须在页面首次导航前调用。仅替换验证码开关，其他运行时配置维持构建产物原值；
 * `/admin-api` 请求按原方法、请求头和请求体转发到后端，避免生产预览服务器缺少代理。
 *
 * @param context Playwright 浏览器上下文。
 * @returns 两条路由规则安装完成的 Promise。
 */
export async function prepareBrowserContext(
  context: BrowserContext,
): Promise<void> {
  await context.route(
    '**/_app.config.js*',
    // 关闭构建产物中的验证码开关，保证登录可以自动化。
    async (route) => {
      const response = await route.fetch();
      const text = await response.text();
      const body = text.replace(
        "VITE_APP_CAPTCHA_ENABLE: 'true'",
        "VITE_APP_CAPTCHA_ENABLE: 'false'",
      );
      await route.fulfill({ response, body });
    },
  );
  await context.route(
    '**/admin-api/**',
    // 保持原请求内容，仅把目标地址替换成真实后端。
    async (route) => {
      const target = new URL(route.request().url());
      const backend = new URL(backendUrl);
      target.protocol = backend.protocol;
      target.host = backend.host;
      await route.continue({ url: target.toString() });
    },
  );
}

/**
 * 打开登录页并提交账号密码，返回登录接口响应。
 *
 * 不等待页面跳转，错误凭据场景也能直接检查接口响应和页面提示；调用方负责断言结果。
 *
 * @param page 当前页面。
 * @param account 用户名和明文密码。
 * @returns 登录接口响应；页面未发出登录请求时抛出超时异常。
 */
export async function submitLogin(
  page: Page,
  account: TestAccount,
): Promise<Response> {
  await page.goto('./#/auth/login', { waitUntil: 'networkidle' });
  await page.locator('input[name="username"]').fill(account.username);
  await page.locator('input[name="password"]').fill(account.password);
  const responsePromise = page.waitForResponse(
    // 只匹配账号密码登录接口的 POST 响应。
    (response) =>
      response.url().includes('/system/auth/super-admin-login') &&
      response.request().method() === 'POST',
  );
  await page.locator('button:has-text("登录")').last().click();
  return await responsePromise;
}

/**
 * 使用测试账号登录，等待概览页并返回访问令牌。
 *
 * @param page 当前页面。
 * @param account 用户名和明文密码。
 * @returns 登录成功后的访问令牌，用于直接验证后端权限边界。
 * @throws 登录接口未返回访问令牌或页面未进入概览页时抛出异常。
 */
export async function loginAs(
  page: Page,
  account: TestAccount,
): Promise<string> {
  const response = await submitLogin(page, account);
  const payload = (await response.json()) as {
    data?: { accessToken?: string };
  };
  const loginData = payload.data;
  if (loginData === undefined) {
    throw new Error(`登录失败：${JSON.stringify(payload)}`);
  }
  const loginGrant = loginData.accessToken;
  if (!loginGrant) {
    throw new Error(`登录失败：${JSON.stringify(payload)}`);
  }
  await page.waitForURL(/#\/dashboard/);
  return loginGrant;
}
