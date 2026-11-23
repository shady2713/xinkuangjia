/**
 * 访问令牌与刷新令牌持久化管理。
 */
import { computed, shallowRef } from 'vue';

const SESSION_KEY = 'bf_session';
const LEGACY_ACCESS_KEY = 'bf_access_token';
const LEGACY_REFRESH_KEY = 'bf_refresh_token';
const LEGACY_PASSWORD_CHANGE_KEY = 'bf_password_change_required';
const LEGACY_KEYS = [LEGACY_ACCESS_KEY, LEGACY_REFRESH_KEY, LEGACY_PASSWORD_CHANGE_KEY];

export type LoginPlatform = 'super' | 'business';

interface SessionSnapshot {
  accessToken: string;
  refreshToken: string;
  passwordChangeRequired: boolean;
  /** Opaque login ID; null when signed out. */
  sessionId: string | null;
  loginPlatform?: LoginPlatform;
}

const EMPTY_SESSION: Readonly<SessionSnapshot> = {
  accessToken: '',
  refreshToken: '',
  passwordChangeRequired: false,
  sessionId: null,
};

function newSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Tab-local ID for ID-less records, reused while the token pair is unchanged. */
let legacyId: { accessToken: string; refreshToken: string; id: string } | null = null;

function legacySessionId(accessToken: string, refreshToken: string): string | null {
  if (!accessToken && !refreshToken) {
    legacyId = null;
    return null;
  }
  const cached = legacyId;
  if (cached && cached.accessToken === accessToken && cached.refreshToken === refreshToken) {
    return cached.id;
  }
  const id = newSessionId();
  legacyId = { accessToken, refreshToken, id };
  return id;
}

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
        const storedId = record.sessionId;
        if (typeof storedId === 'string' && storedId) {
          legacyId = null;
        }
        return {
          accessToken: record.accessToken,
          refreshToken: record.refreshToken,
          passwordChangeRequired: record.passwordChangeRequired,
          loginPlatform: record.loginPlatform === 'business' || record.loginPlatform === 'super'
            ? record.loginPlatform : undefined,
          sessionId:
            typeof storedId === 'string' && storedId
              ? storedId
              : legacySessionId(record.accessToken, record.refreshToken),
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
  const accessToken = localStorage.getItem(LEGACY_ACCESS_KEY) || '';
  const refreshToken = localStorage.getItem(LEGACY_REFRESH_KEY) || '';
  return {
    accessToken,
    refreshToken,
    passwordChangeRequired: localStorage.getItem(LEGACY_PASSWORD_CHANGE_KEY) === 'true',
    sessionId: legacySessionId(accessToken, refreshToken),
  };
}

function removeLegacyKeys(): void {
  LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
}

/** Single in-memory session state; every getter reads from here. */
const session = shallowRef<SessionSnapshot>(readStoredSession());

/** Whether the last installed snapshot came from a storage read rather than a same-tab write. */
let sessionFromStorage = false;

/** Replaces the reactive snapshot only when a field differs, avoiding redundant notifications. */
function applySession(next: SessionSnapshot, fromStorage = false): void {
  const current = session.value;
  if (
    current.accessToken !== next.accessToken ||
    current.refreshToken !== next.refreshToken ||
    current.passwordChangeRequired !== next.passwordChangeRequired ||
    current.sessionId !== next.sessionId ||
    current.loginPlatform !== next.loginPlatform
  ) {
    sessionFromStorage = fromStorage;
    session.value = next;
  }
}

/** Synchronously re-reads storage into memory; read-only, never writes. */
function syncSession(): void {
  const next = readStoredSession();
  if (!next.sessionId) {
    legacyId = null;
  }
  applySession(next, true);
}

/** Writes the whole snapshot at once, then drops legacy keys it supersedes. */
function persistSession(next: SessionSnapshot): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  removeLegacyKeys();
  legacyId = null;
  applySession(next);
}

/** Read-only sync from other tabs; never writes storage. key=null means storage was cleared. */
window.addEventListener('storage', (event: StorageEvent) => {
  if (event.storageArea !== null && event.storageArea !== localStorage) {
    return;
  }
  if (event.key !== null && event.key !== SESSION_KEY && !LEGACY_KEYS.includes(event.key)) {
    return;
  }
  syncSession();
});

/** Single in-memory source of the flag, exposed read-only. */
export const passwordChangeRequiredFlag = computed(() => session.value.passwordChangeRequired);

/** Route consumers receive the login identifier and its platform from the same snapshot. */
export const loginSession = computed(() => ({
  id: session.value.sessionId,
  platform: session.value.loginPlatform,
}));

export const sessionId = computed(() => loginSession.value.id);

/** 仅业务登录需要在地址中明确标识平台。 */
export function loginPlatformQuery(platform: LoginPlatform | undefined): { platform?: 'business' } {
  return platform === 'business' ? { platform } : {};
}

/** Current login ID, synchronized with storage first so a queued StorageEvent cannot race. */
export function getSessionId(): string | null {
  syncSession();
  return session.value.sessionId;
}

/** True when the last session change was read from localStorage (another tab or an early sync). */
export function isSessionFromStorage(): boolean {
  return sessionFromStorage;
}

export function getAccessToken(): string {
  return session.value.accessToken;
}

export function getRefreshToken(): string {
  return session.value.refreshToken;
}

/** Rotation keeps the login ID; an omitted (non-boolean) flag keeps the current value. */
export function setTokens(
  accessToken: string,
  refreshToken: string,
  passwordChangeRequired?: boolean | null,
  expectedSessionId?: string,
): boolean {
  const currentId = getSessionId();
  if (expectedSessionId !== undefined && currentId !== expectedSessionId) return false;
  const current = session.value;
  persistSession({
    accessToken,
    refreshToken,
    passwordChangeRequired:
      typeof passwordChangeRequired === 'boolean'
        ? passwordChangeRequired
        : current.passwordChangeRequired,
    sessionId: current.sessionId ?? newSessionId(),
    loginPlatform: current.loginPlatform,
  });
  return true;
}

/** Explicit sign-in: always starts a new login ID; an omitted flag means false. */
export function setLoginTokens(
  accessToken: string,
  refreshToken: string,
  passwordChangeRequired?: boolean | null,
  expectedSessionId?: string | null,
  platform?: LoginPlatform,
): boolean {
  if (expectedSessionId !== undefined && getSessionId() !== expectedSessionId) return false;
  persistSession({
    accessToken,
    refreshToken,
    passwordChangeRequired: passwordChangeRequired === true,
    sessionId: newSessionId(),
    loginPlatform: platform,
  });
  return true;
}

export function isPasswordChangeRequired(): boolean {
  return session.value.passwordChangeRequired;
}

/** Logout: legacy keys go first so other tabs never re-read stale values. */
export function clearTokens(expectedSessionId?: string | null): boolean {
  if (expectedSessionId !== undefined && getSessionId() !== expectedSessionId) return false;
  removeLegacyKeys();
  localStorage.removeItem(SESSION_KEY);
  legacyId = null;
  applySession(EMPTY_SESSION);
  return true;
}
