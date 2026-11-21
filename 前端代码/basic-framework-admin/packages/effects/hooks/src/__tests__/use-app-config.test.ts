/** 验证运行时应用配置、API 加密配置与登录默认凭据在开发/生产模式下的安全边界。 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  getApiEncryptEnvConfig,
  getDefaultLoginCredentials,
  isCaptchaEnable,
  useAppConfig,
} from '../use-app-config';

const originalConfig = window._VBEN_ADMIN_PRO_APP_CONF_;

afterEach(() => {
  (window as any)._VBEN_ADMIN_PRO_APP_CONF_ = originalConfig;
});

describe('use-app-config 运行时配置契约', () => {
  it('生产模式严格从 window._VBEN_ADMIN_PRO_APP_CONF_ 读取接口地址并强制清空默认密码', () => {
    (window as any)._VBEN_ADMIN_PRO_APP_CONF_ = {
      VITE_APP_API_ENCRYPT_ENABLE: 'true',
      VITE_APP_CAPTCHA_ENABLE: 'true',
      VITE_APP_DEFAULT_PASSWORD: 'PLACEHOLDER_IGNORED',
      VITE_APP_DEFAULT_USERNAME: '',
      VITE_GLOB_API_URL: '/admin-api',
    };

    expect(
      useAppConfig({ VITE_GLOB_API_URL: 'http://127.0.0.1:48080' }, true),
    ).toEqual({ apiURL: '/admin-api' });
    const prodCreds = getDefaultLoginCredentials(
      {
        VITE_APP_DEFAULT_PASSWORD: 'PLACEHOLDER_DEV_PASS',
        VITE_APP_DEFAULT_USERNAME: 'PLACEHOLDER_DEV_USER',
      },
      true,
    );
    expect(prodCreds.password).toBe('');
    expect(prodCreds.username).toBe('');
    expect(
      getApiEncryptEnvConfig({ VITE_APP_API_ENCRYPT_ENABLE: 'false' }, true),
    ).toMatchObject({ VITE_APP_API_ENCRYPT_ENABLE: 'true' });
    expect(isCaptchaEnable()).toBe(true);
  });

  it('开发模式允许环境变量覆盖接口地址与默认登录提示', () => {
    (window as any)._VBEN_ADMIN_PRO_APP_CONF_ = {
      VITE_APP_CAPTCHA_ENABLE: 'false',
      VITE_GLOB_API_URL: '/admin-api',
    };

    expect(
      useAppConfig({ VITE_GLOB_API_URL: 'http://127.0.0.1:48080' }, false),
    ).toEqual({ apiURL: 'http://127.0.0.1:48080' });
    expect(
      getDefaultLoginCredentials(
        {
          VITE_APP_DEFAULT_PASSWORD: 'PLACEHOLDER_DEV_PASS',
          VITE_APP_DEFAULT_USERNAME: 'PLACEHOLDER_DEV_USER',
        },
        false,
      ),
    ).toEqual({
      password: 'PLACEHOLDER_DEV_PASS',
      username: 'PLACEHOLDER_DEV_USER',
    });
    expect(isCaptchaEnable()).toBe(false);
  });
});
