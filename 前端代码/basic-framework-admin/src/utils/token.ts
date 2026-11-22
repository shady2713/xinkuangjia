/**
 * 访问令牌与刷新令牌持久化管理。
 */
import { computed, ref } from 'vue';

const ACCESS_TOKEN_KEY = 'bf_access_token';
const REFRESH_TOKEN_KEY = 'bf_refresh_token';
const PASSWORD_CHANGE_KEY = 'bf_password_change_required';

const passwordChangeRequiredState = ref(
  localStorage.getItem(PASSWORD_CHANGE_KEY) === 'true',
);

/** Single in-memory source of the flag, exposed read-only. */
export const passwordChangeRequiredFlag = computed(
  () => passwordChangeRequiredState.value,
);

/** Updates the in-memory flag and its persisted copy together. */
export function setPasswordChangeRequired(value: boolean): void {
  passwordChangeRequiredState.value = value;
  localStorage.setItem(PASSWORD_CHANGE_KEY, value ? 'true' : 'false');
}

export function getAccessToken(): string {
  return localStorage.getItem(ACCESS_TOKEN_KEY) || '';
}

export function getRefreshToken(): string {
  return localStorage.getItem(REFRESH_TOKEN_KEY) || '';
}

/** An omitted (non-boolean) flag keeps the current value; false is authoritative. */
export function setTokens(
  accessToken: string,
  refreshToken: string,
  passwordChangeRequired?: boolean | null,
): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  if (typeof passwordChangeRequired === 'boolean') {
    setPasswordChangeRequired(passwordChangeRequired);
  }
}

export function isPasswordChangeRequired(): boolean {
  return passwordChangeRequiredState.value;
}

export function clearPasswordChangeRequired(): void {
  setPasswordChangeRequired(false);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(PASSWORD_CHANGE_KEY);
  passwordChangeRequiredState.value = false;
}
