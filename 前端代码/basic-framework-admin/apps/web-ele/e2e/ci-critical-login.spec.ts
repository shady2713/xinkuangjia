/**
 * CI 可重复关键业务浏览器路径：基于真实生产构建与临时 SM2 密钥对验证登录成功/失败及权限菜单渲染。
 */
import type { BrowserContext, Page, Route } from '@playwright/test';

import { expect, test } from '@playwright/test';
import { sm2 } from 'sm-crypto';

/** 运行期用于验证 SM2 加密解密回环的占位口令与令牌，非真实凭据。 */
const CI_VALID_LOGIN_INPUT = 'CHANGE_ME_CI_LOGIN_PASS';
const CI_WRONG_LOGIN_INPUT = 'CHANGE_ME_CI_WRONG_PASS';
const CI_ACCESS_GRANT = 'CHANGE_ME_CI_ACCESS_TOKEN';
const CI_REFRESH_GRANT = 'CHANGE_ME_CI_REFRESH_TOKEN';

/** CI 权限菜单与用户信息响应夹具。 */
const ADMIN_PERMISSION_INFO = {
  menus: [
    {
      alwaysShow: true,
      children: [],
      component: 'system/user/index',
      componentName: 'System',
      icon: 'ep:setting',
      id: 1,
      keepAlive: true,
      name: '系统管理',
      parentId: 0,
      path: '/system',
      visible: true,
    },
  ],
  permissions: ['*:*:*', 'system:user:query'],
  roles: ['super_admin'],
  user: {
    avatar: '',
    deptId: 100,
    id: 1,
    nickname: '管理员',
    passwordChangeRequired: false,
    username: 'admin',
  },
};

/**
 * 以统一后端 CommonResult JSON 结构响应拦截到的请求。
 *
 * @param route Playwright 网络路由对象
 * @param data 业务返回数据
 * @param code 业务状态码，默认 0 表示成功
 * @param msg 业务提示信息
 */
async function fulfillApi(route: Route, data: unknown, code = 0, msg = '') {
  await route.fulfill({
    contentType: 'application/json',
    json: { code, data, msg },
    status: 200,
  });
}

/**
 * 为 CI 关键路径安装无外部依赖的确定性接口契约拦截，并真实校验浏览器提交的 SM2 密文。
 *
 * @param context Playwright 浏览器上下文
 */
async function installDeterministicAuthRoutes(context: BrowserContext) {
  const keyPair = sm2.generateKeyPairHex();

  await context.route(
    '**/_app.config.js*',
    /**
     * 在生产预览产物中仅关闭验证码开关以便自动化执行登录提交。
     *
     * @param route Playwright 拦截到的配置脚本路由
     */
    async (route) => {
      const response = await route.fetch();
      const text = await response.text();
      const body = text.replace(
        "VITE_APP_CAPTCHA_ENABLE: 'true'",
        "VITE_APP_CAPTCHA_ENABLE: 'false'",
      );
      await route.fulfill({ body, response });
    },
  );

  await context.route(
    '**/admin-api/**',
    /**
     * 按后端 OpenAPI 契约响应认证、权限菜单及基础字典请求。
     *
     * @param route Playwright 拦截到的接口路由
     */
    async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname.endsWith('/system/auth/sm2-public-key')) {
        await fulfillApi(route, {
          cipherMode: 1,
          publicKey: keyPair.publicKey,
        });
        return;
      }
      if (pathname.endsWith('/system/auth/super-admin-login')) {
        const body = route.request().postDataJSON() as {
          password?: string;
          username?: string;
        };
        const cipher = body?.password ?? '';
        let matched = false;
        if (cipher.startsWith('04')) {
          const payload = JSON.parse(
            sm2.doDecrypt(cipher.slice(2), keyPair.privateKey, 1),
          ) as {
            n?: string;
            p?: string;
            t?: number;
          };
          matched =
            body.username === 'admin' &&
            payload.p === CI_VALID_LOGIN_INPUT &&
            typeof payload.t === 'number' &&
            Boolean(payload.n);
        }
        await (matched
          ? fulfillApi(route, {
              accessToken: CI_ACCESS_GRANT,
              expiresTime: Date.now() + 3_600_000,
              passwordChangeRequired: false,
              refreshToken: CI_REFRESH_GRANT,
              userId: 1,
            })
          : fulfillApi(route, null, 1_002_000_000, '登录失败，账号密码不正确'));
        return;
      }
      if (pathname.endsWith('/system/auth/get-permission-info')) {
        await fulfillApi(route, ADMIN_PERMISSION_INFO);
        return;
      }
      await fulfillApi(route, []);
    },
  );
}

/**
 * 打开登录页并提交账号与密码，返回登录接口响应。
 *
 * @param page Playwright 页面实例
 * @param username 登录用户名
 * @param passwordInput 登录口令输入值
 * @returns 登录 POST 请求对应的响应对象
 */
async function submitCiLogin(
  page: Page,
  username: string,
  passwordInput: string,
) {
  await page.goto('./#/auth/login', { waitUntil: 'networkidle' });
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(passwordInput);
  const responsePromise = page.waitForResponse(
    /** 匹配超级管理员登录接口的 POST 响应。 */
    (response) =>
      response.url().includes('/system/auth/super-admin-login') &&
      response.request().method() === 'POST',
  );
  await page.locator('button:has-text("登录")').last().click();
  return await responsePromise;
}

test.beforeEach(
  /** 每个用例前安装独立的临时 SM2 密钥对与契约拦截路由。 */
  async ({ context }) => {
    await installDeterministicAuthRoutes(context);
  },
);

test('CI 关键路径：管理员经 SM2 加密登录后进入概览并渲染动态权限菜单' /** 验证生产前端 SM2 公钥加密、登录跳转、菜单渲染与用户身份展示完整闭合。 */, async ({
  page,
}) => {
  const response = await submitCiLogin(page, 'admin', CI_VALID_LOGIN_INPUT);
  expect(((await response.json()) as { code: number }).code).toBe(0);
  await page.waitForURL(/#\/dashboard/);
  await expect(page.getByText('系统管理', { exact: true })).toBeVisible();
  await expect(page.locator('body')).toContainText('管理员');
});

test('CI 关键路径：错误密码停留在登录页并显示统一失败提示' /** 验证错误凭据不会误跳入系统主页且提示后端统一错误消息。 */, async ({
  page,
}) => {
  const response = await submitCiLogin(page, 'admin', CI_WRONG_LOGIN_INPUT);
  expect(((await response.json()) as { code: number }).code).not.toBe(0);
  await expect(page).toHaveURL(/#\/auth\/login/);
  await expect(page.locator('.el-message')).toContainText(
    '登录失败，账号密码不正确',
  );
});
