/**
 * 运行时应用配置（use-app-config）的真实行为回归。
 *
 * 覆盖配置读取的三条契约：
 * ① 生产构建忽略 Vite 环境变量，只用 app.config.js 的地址；开发环境允许 .env 覆盖；
 * ② 钉钉企业凭证只在企业标识与客户端标识同时存在时才写入认证配置；
 * ③ 无浏览器环境（服务端渲染）读取运行时字段返回 undefined，验证码与文档提醒开关据此为假。
 * 断言读取真实返回值，不检查内部实现步骤。
 */
import type { ApplicationConfig } from '@vben/types/global';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isCaptchaEnable,
  isDocAlertEnable,
  isTenantEnable,
  useAppConfig,
} from '../use-app-config';

/**
 * 写入运行时配置对象。
 * @param config 本次要注入的运行时配置字段。
 */
function stubRuntimeConfig(config: Record<string, unknown>): void {
  (
    window as unknown as { _VBEN_ADMIN_PRO_APP_CONF_?: Record<string, unknown> }
  )._VBEN_ADMIN_PRO_APP_CONF_ = config;
}

describe('useAppConfig 接口地址来源', /** 生产与开发环境的地址优先级。 */ () => {
  afterEach(
    /** 清理注入的运行时配置，避免影响其他用例。 */ () => {
      delete (window as { _VBEN_ADMIN_PRO_APP_CONF_?: unknown })
        ._VBEN_ADMIN_PRO_APP_CONF_;
      vi.unstubAllGlobals();
    },
  );

  it('开发环境允许环境变量覆盖运行时地址', /** 本地联调需要把请求指向本机服务，开发期必须以 .env 为准。 */ () => {
    stubRuntimeConfig({ VITE_GLOB_API_URL: 'https://runtime.example.test' });

    const config: ApplicationConfig = useAppConfig(
      { VITE_GLOB_API_URL: 'http://127.0.0.1:48080/admin-api' },
      false,
    );

    expect(config.apiURL).toBe('http://127.0.0.1:48080/admin-api');
  });

  it('开发环境缺少环境变量时仍使用运行时地址', /** 未声明覆盖时不能把地址读成 undefined。 */ () => {
    stubRuntimeConfig({ VITE_GLOB_API_URL: 'https://runtime.example.test' });

    expect(useAppConfig({}, false).apiURL).toBe('https://runtime.example.test');
  });

  it('生产构建忽略环境变量并固定使用运行时地址', /** 生产产物必须使用部署时可替换的 app.config.js，构建期变量不得生效。 */ () => {
    stubRuntimeConfig({ VITE_GLOB_API_URL: 'https://runtime.example.test' });

    const config = useAppConfig(
      { VITE_GLOB_API_URL: 'http://127.0.0.1:48080/admin-api' },
      true,
    );

    expect(config.apiURL).toBe('https://runtime.example.test');
  });

  it('钉钉凭证齐全时写入认证配置', /** 企业标识与客户端标识缺一不可，齐全时才允许启用钉钉登录。 */ () => {
    stubRuntimeConfig({
      VITE_GLOB_API_URL: 'https://runtime.example.test',
      VITE_GLOB_AUTH_DINGDING_CLIENT_ID: 'DUMMY-dingding-client',
      VITE_GLOB_AUTH_DINGDING_CORP_ID: 'DUMMY-dingding-corp',
    });

    expect(useAppConfig({}, true).auth?.dingding).toEqual({
      clientId: 'DUMMY-dingding-client',
      corpId: 'DUMMY-dingding-corp',
    });
  });

  it('钉钉凭证不完整时不写入认证配置', /** 只配置一半会让登录按钮指向不可用的授权地址，必须整组忽略。 */ () => {
    stubRuntimeConfig({
      VITE_GLOB_API_URL: 'https://runtime.example.test',
      VITE_GLOB_AUTH_DINGDING_CORP_ID: 'DUMMY-dingding-corp',
    });

    expect(useAppConfig({}, true).auth).toEqual({});
  });
});

describe('运行时开关读取', /** 租户、验证码与文档提醒三个开关的真实取值。 */ () => {
  afterEach(
    /** 清理注入的运行时配置与全局替身。 */ () => {
      delete (window as { _VBEN_ADMIN_PRO_APP_CONF_?: unknown })
        ._VBEN_ADMIN_PRO_APP_CONF_;
      vi.unstubAllGlobals();
    },
  );

  it('租户能力在当前版本固定关闭', /** 单租户部署下打开租户能力会让用户查询带上不存在的租户条件。 */ () => {
    expect(isTenantEnable()).toBe(false);
  });

  it('按运行时字段判定验证码与文档提醒开关', /** 开关字段是字符串配置，只有显式 true 才启用。 */ () => {
    stubRuntimeConfig({
      VITE_APP_CAPTCHA_ENABLE: 'true',
      VITE_APP_DOCALERT_ENABLE: 'false',
    });

    expect(isCaptchaEnable()).toBe(true);
    expect(isDocAlertEnable()).toBe(false);

    stubRuntimeConfig({
      VITE_APP_CAPTCHA_ENABLE: 'false',
      VITE_APP_DOCALERT_ENABLE: 'true',
    });

    expect(isCaptchaEnable()).toBe(false);
    expect(isDocAlertEnable()).toBe(true);
  });

  it('缺少运行时配置对象时两个开关都为假', /** 配置脚本未加载时不能抛错，也不能误判为已启用。 */ () => {
    expect(isCaptchaEnable()).toBe(false);
    expect(isDocAlertEnable()).toBe(false);
  });

  it('无浏览器环境读取运行时字段返回 undefined', /** 服务端渲染没有 window，读取必须安全退化为未配置。 */ () => {
    stubRuntimeConfig({ VITE_APP_CAPTCHA_ENABLE: 'true' });

    vi.stubGlobal('window', undefined);
    try {
      expect(isCaptchaEnable()).toBe(false);
      expect(isDocAlertEnable()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
