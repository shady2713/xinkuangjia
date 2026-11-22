/**
 * 访问令牌与刷新令牌持久化管理。
 */
const ACCESS_TOKEN_KEY = 'bf_access_token';
const REFRESH_TOKEN_KEY = 'bf_refresh_token';
const PASSWORD_CHANGE_KEY = 'bf_password_change_required';

export function getAccessToken(): string {
  return localStorage.getItem(ACCESS_TOKEN_KEY) || '';
}

export function getRefreshToken(): string {
  return localStorage.getItem(REFRESH_TOKEN_KEY) || '';
}

export function setTokens(
  accessToken: string,
  refreshToken: string,
  passwordChangeRequired = false,
): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  localStorage.setItem(
    PASSWORD_CHANGE_KEY,
    passwordChangeRequired ? 'true' : 'false',
  );
}

export function isPasswordChangeRequired(): boolean {
  return localStorage.getItem(PASSWORD_CHANGE_KEY) === 'true';
}

export function clearPasswordChangeRequired(): void {
  localStorage.setItem(PASSWORD_CHANGE_KEY, 'false');
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(PASSWORD_CHANGE_KEY);
}
