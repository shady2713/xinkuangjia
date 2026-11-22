/**
 * 访问令牌与刷新令牌持久化管理。
 */
import { computed, shallowRef } from 'vue';

const SESSION_KEY = 'bf_session';
const LEGACY_ACCESS_KEY = 'bf_access_token';
const LEGACY_REFRESH_KEY = 'bf_refresh_token';
const LEGACY_PASSWORD_CHANGE_KEY = 'bf_password_change_required';
const LEGACY_KEYS = [LEGACY_ACCESS_KEY, LEGACY_REFRESH_KEY, LEGACY_PASSWORD_CHANGE_KEY];

interface SessionSnapshot {
  accessToken: string;
  refreshToken: string;
  passwordChangeRequired: boolean;
}

const EMPTY_SESSION: Readonly<SessionSnapshot> = {
  accessToken: '',
  refreshToken: '',
  passwordChangeRequired: false,
};

/** Parses the stored record; a malformed record is treated as signed out. */
function parseSnapshot(raw: string): SessionSnapshot {
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (
        typeof record.accessToken === 'string' &&
        typeof record.refreshToken === 'string' &&
        typeof record.passwordChangeRequired === 'boolean'
      ) {
        return {
          accessToken: record.accessToken,
          refreshToken: record.refreshToken,
          passwordChangeRequired: record.passwordChangeRequired,
        };
      }
    }
  } catch {
    // fall through to a signed-out snapshot
  }
  return { ...EMPTY_SESSION };
}

/** Reads the atomic record, falling back to legacy per-field keys when it is absent. */
function readStoredSession(): SessionSnapshot {
  const raw = localStorage.getItem(SESSION_KEY);
  if (raw !== null) {
    return parseSnapshot(raw);
  }
  return {
    accessToken: localStorage.getItem(LEGACY_ACCESS_KEY) || '',
    refreshToken: localStorage.getItem(LEGACY_REFRESH_KEY) || '',
    passwordChangeRequired: localStorage.getItem(LEGACY_PASSWORD_CHANGE_KEY) === 'true',
  };
}

function removeLegacyKeys(): void {
  LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
}

/** Single in-memory session state; every getter reads from here. */
const session = shallowRef<SessionSnapshot>(readStoredSession());

/** Writes the whole snapshot at once, then drops legacy keys it supersedes. */
function persistSession(next: SessionSnapshot): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  removeLegacyKeys();
  session.value = next;
}

/** Read-only sync from other tabs; never writes storage. key=null means storage was cleared. */
window.addEventListener('storage', (event: StorageEvent) => {
  if (event.storageArea !== null && event.storageArea !== localStorage) {
    return;
  }
  if (event.key !== null && event.key !== SESSION_KEY && !LEGACY_KEYS.includes(event.key)) {
    return;
  }
  session.value = readStoredSession();
});

/** Single in-memory source of the flag, exposed read-only. */
export const passwordChangeRequiredFlag = computed(() => session.value.passwordChangeRequired);

/** Updates the in-memory flag and its persisted copy together. */
export function setPasswordChangeRequired(value: boolean): void {
  persistSession({ ...session.value, passwordChangeRequired: value });
}

export function getAccessToken(): string {
  return session.value.accessToken;
}

export function getRefreshToken(): string {
  return session.value.refreshToken;
}

/** An omitted (non-boolean) flag keeps the current value; false is authoritative. */
export function setTokens(
  accessToken: string,
  refreshToken: string,
  passwordChangeRequired?: boolean | null,
): void {
  persistSession({
    accessToken,
    refreshToken,
    passwordChangeRequired:
      typeof passwordChangeRequired === 'boolean'
        ? passwordChangeRequired
        : session.value.passwordChangeRequired,
  });
}

export function isPasswordChangeRequired(): boolean {
  return session.value.passwordChangeRequired;
}

export function clearPasswordChangeRequired(): void {
  setPasswordChangeRequired(false);
}

/** Logout: legacy keys go first so other tabs never re-read stale values. */
export function clearTokens(): void {
  removeLegacyKeys();
  localStorage.removeItem(SESSION_KEY);
  session.value = EMPTY_SESSION;
}
