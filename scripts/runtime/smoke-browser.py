#!/usr/bin/env python3
"""Browser smoke for an isolated loopback stack; secrets are read only from env."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from contextlib import contextmanager
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

LOOPBACK = {"127.0.0.1", "localhost", "::1"}
STEPS = []
ORIGIN = ""
CHANGE = "**/profile/change-password"
SM2_MODULE = "/src/utils/sm2.ts"
PLATFORM_DENIED = 1_002_000_015
FILE_DENIED = 1_001_003_008
SIGNING_UNSUPPORTED = 1_001_003_010
EXPECTED_STEPS = 19
SM2_JS = "async ([m, ...ps]) => { const s = await import(m); return Promise.all(ps.map((x) => s.encryptPassword(x))); }"
REFRESH_JS = "async () => { const m = await import('/src/api/request.ts'); await m.request.get('/system/auth/get-permission-info'); }"
SESSION_JS = """f => { const v = localStorage.getItem('bf_session'); if (v === null) return null;
  const x = JSON.parse(v)?.[f]; return x === undefined || x === null || x === '' ? null : String(x); }"""
TOKENS_JS = """async () => { const t = await import('/src/utils/token.ts');
  return [t.getAccessToken() || null, t.getRefreshToken() || null, t.isPasswordChangeRequired()]; }"""
SUBMIT = ".el-form button.el-button--primary"
CHANGE_FIELDS = ("请输入当前密码", "请输入 8~32 位含大小写字母及数字的新密码",
                 "请再次输入新密码")


class SmokeError(Exception):
    pass


def check(cond, msg):
    if not cond:
        raise SmokeError(msg)


@contextmanager
def step(name):
    STEPS.append({"name": name, "status": "failed"})
    yield
    STEPS[-1]["status"] = "passed"


def store(page, key):
    return page.evaluate(SESSION_JS, key)


def peer_synced(page, peer):
    """Asserts the sibling tab's in-memory token state matches this tab, with no reload."""
    want = page.evaluate(TOKENS_JS)
    persisted = [store(page, "accessToken"), store(page, "refreshToken"),
                 store(page, "passwordChangeRequired") == "true"]
    check(want == persisted, "memory session differs from storage")
    for _ in range(50):
        if peer.evaluate(TOKENS_JS) == want:
            break
        peer.wait_for_timeout(100)
    check(peer.evaluate(TOKENS_JS) == want, "peer tab session not synced")
    check(peer.evaluate("() => window.__smokePeer === 1"), "peer tab reloaded")
    return want


def call(req, method, path, token=None, **kw):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return req.fetch(ORIGIN + path, method=method, headers=headers, max_redirects=0, **kw)


def ok(resp):
    check(resp.status == 200, f"unexpected HTTP {resp.status}")
    body = resp.json()
    check(body.get("code") == 0, f"unexpected code {body.get('code')}")
    return body.get("data")


def denied(resp, codes):
    if resp.status in codes:
        return
    check(resp.status == 200, f"unexpected HTTP {resp.status}")
    code = resp.json().get("code")
    check(code in codes, f"expected denial {sorted(codes)}, got code {code}")


def ui_login(page, username, password, *, path="/login"):
    if path is not None:
        page.goto(path)
    page.fill("input[autocomplete=username]", username)
    page.fill("input[autocomplete=current-password]", password)
    page.locator(SUBMIT).first.click()


def role_crud(req, token, prefix, *, remove=True):
    code = f"{prefix}_{int(time.time() * 1000)}"
    body = {"name": code, "code": code, "sort": 99, "status": 0}
    def get(rid):
        return ok(call(req, "GET", "/admin-api/system/role/get", token, params={"id": rid}))
    rid = ok(call(req, "POST", "/admin-api/system/role/create", token, data=body))
    check(get(rid)["code"] == code, "role read mismatch")
    ok(call(req, "PUT", "/admin-api/system/role/update", token, data={**body, "id": rid, "name": code + "_u"}))
    check(get(rid)["name"] == code + "_u", "role update mismatch")
    if remove:
        ok(call(req, "DELETE", "/admin-api/system/role/delete", token, params={"id": rid}))
    return rid, body


def run(p, browser, pwd, new_pwd):
    cfg = {"n": 0}

    def guard(route):
        url = route.request.url
        if not url.startswith(ORIGIN + "/"):
            return route.abort()
        if urlparse(url).path != "/_app.config.js":
            return route.continue_()
        resp = route.fetch(max_redirects=0)
        body, n = re.subn(r"""(VITE_APP_CAPTCHA_ENABLE["']?\s*[:=]\s*)["']?\w+["']?""", r'\1"false"', resp.text())
        cfg["n"] += n
        return route.fulfill(response=resp, body=body)

    def new_page():
        ctx = browser.new_context(base_url=ORIGIN)
        ctx.route("**/*", guard)
        return ctx, ctx.new_page()

    ctx, page = new_page()
    with step("admin-ui-login-forced-change"):
        peer = ctx.new_page()
        peer.goto("/login")
        peer.evaluate("() => { window.__smokePeer = 1; }")
        check(peer.evaluate(TOKENS_JS) == [None, None, False], "initial peer session is not empty")
        with page.expect_response("**/admin-api/system/auth/super-admin-login") as login:
            ui_login(page, "admin", pwd)
        check(ok(login.value)["passwordChangeRequired"] is True, "server did not require password change")
        page.wait_for_url(CHANGE)
        check(cfg["n"] >= 1, "captcha config not overridden")
        old = store(page, "accessToken")
        check(peer_synced(page, peer)[2] is True, "peer tab missed forced-change flag")
    with step("forced-change-denies-role-page"):
        denied(call(page.request, "GET", "/admin-api/system/role/page", old, params={"pageNo": 1, "pageSize": 10}), {403})
    with step("manual-refresh-revokes-old-access"):
        data = ok(call(page.request, "POST", "/admin-api/system/auth/refresh-token", data={"refreshToken": store(page, "refreshToken")}))
        check(data["accessToken"] != old, "access token not rotated")
        denied(call(page.request, "GET", "/admin-api/system/auth/get-permission-info", old), {401})
    with step("frontend-interceptor-refresh"):
        page.evaluate(REFRESH_JS)
        check(store(page, "accessToken") not in (None, old), "stored access token not rotated")
        check(store(page, "passwordChangeRequired") == "true", "change flag not persisted")
        check(peer_synced(page, peer)[0] != old, "peer tab kept old access token")
    with step("reload-keeps-forced-change"):
        page.reload()
        page.wait_for_url(CHANGE)
        check(store(page, "passwordChangeRequired") == "true", "change flag lost on reload")
    with step("change-password"):
        for placeholder, value in zip(CHANGE_FIELDS, (pwd, new_pwd, new_pwd)):
            page.get_by_placeholder(placeholder, exact=True).fill(value)
        with page.expect_response(lambda r: r.request.method == "PUT"
                                  and urlparse(r.url).path.endswith("/admin-api/system/user/profile/update-password")) as put:
            page.locator(SUBMIT).first.click()
        ok(put.value)
        page.wait_for_url(lambda u: urlparse(u).path.endswith("/login"))
        check(store(page, "accessToken") is None and store(page, "refreshToken") is None, "session not cleared")
        check(peer_synced(page, peer) == [None, None, False], "peer tab kept cleared session")
        peer.close()
    with step("admin-fresh-login-new-password"):
        with page.expect_response("**/admin-api/system/auth/super-admin-login") as login:
            ui_login(page, "admin", new_pwd)
        check(ok(login.value)["passwordChangeRequired"] is False, "server did not clear password-change requirement")
        page.wait_for_url(lambda u: "/login" not in u and "/profile/change-password" not in u)
        admin = store(page, "accessToken")
    with step("admin-role-crud"):
        other_role, other_body = role_crud(page.request, admin, "smoke_admin", remove=False)
    with step("member-api-login"):
        (enc,) = page.evaluate(SM2_JS, [SM2_MODULE, pwd])
        member = ok(call(page.request, "POST", "/admin-api/system/auth/login", data={"username": "smokemember", "password": enc}))["accessToken"]
    with step("member-role-crud"):
        role_crud(page.request, member, "smoke_member")
    with step("member-other-platform-role-denied"):
        role_params = {"id": other_role}
        denied(call(page.request, "GET", "/admin-api/system/role/get", member, params=role_params), {PLATFORM_DENIED})
        denied(call(page.request, "PUT", "/admin-api/system/role/update", member,
                    data={**other_body, **role_params}), {PLATFORM_DENIED})
        denied(call(page.request, "DELETE", "/admin-api/system/role/delete", member, params=role_params),
               {PLATFORM_DENIED})
        ok(call(page.request, "DELETE", "/admin-api/system/role/delete", admin, params=role_params))
    name, content = f"smoke-{int(time.time() * 1000)}.txt", b"synthetic smoke file\n"
    with step("admin-private-upload"):
        ok(call(page.request, "POST", "/admin-api/infra/file/upload", admin,
                multipart={"file": {"name": name, "mimeType": "text/plain", "buffer": content}, "directory": "private/smoke"}))
    with step("owner-exact-private-download"):
        rows = ok(call(page.request, "GET", "/admin-api/infra/file/page", admin, params={"pageNo": 1, "pageSize": 10, "path": name.removesuffix(".txt")}))["list"]
        records = [row for row in rows if row.get("name") == name]
        check(len(records) == 1, "uploaded file not found exactly once")
        check(records[0].get("path", "").startswith("private/smoke/")
              and records[0].get("privateFile") is True and not records[0].get("url"),
              "upload did not produce a private record")
        file_id = records[0]["id"]
        resp = call(page.request, "GET", "/admin-api/infra/file/private/content", admin, params={"id": file_id})
        check(resp.status == 200 and resp.body() == content, "private content mismatch")
    with step("local-private-signing-reports-unsupported"):
        denied(call(page.request, "GET", "/admin-api/infra/file/private/presigned-get-url", admin,
                    params={"id": file_id}), {SIGNING_UNSUPPORTED})
    with step("anonymous-download-denied"):
        anon = p.request.new_context()
        denied(call(anon, "GET", "/admin-api/infra/file/private/content", params={"id": file_id}), {401})
        anon.dispose()
    with step("member-download-denied"):
        denied(call(page.request, "GET", "/admin-api/infra/file/private/content", member, params={"id": file_id}), {FILE_DENIED})

    ctx.close()
    ctx, page = new_page()
    with step("business-ui-password-login"):
        with page.expect_response("**/admin-api/system/auth/login") as login:
            ui_login(page, "smokemember", pwd, path="/login?platform=business")
        ok(login.value)
        page.wait_for_url("**/dashboard")
        check(store(page, "loginPlatform") == "business", "business session platform missing")
    with step("business-personal-password-change-returns-to-business-form"):
        page.goto("/profile")
        page.get_by_role("tab", name="修改密码").click()
        for placeholder, value in zip(CHANGE_FIELDS, (pwd, new_pwd, new_pwd)):
            page.get_by_placeholder(placeholder, exact=True).fill(value)
        with page.expect_response("**/admin-api/system/user/profile/update-password") as put:
            page.get_by_role("button", name="修改密码", exact=True).click()
        ok(put.value)
        page.locator("input[autocomplete=username]").wait_for(state="visible")
        page.locator('input[type=radio][value=business]:checked').wait_for(state="attached")
        check(store(page, "accessToken") is None and store(page, "refreshToken") is None,
              "personal password change kept the old session")
    with step("business-fresh-ui-login-without-reselecting-platform"):
        with page.expect_response("**/admin-api/system/auth/login") as login:
            ui_login(page, "smokemember", new_pwd, path=None)
        ok(login.value)
        page.wait_for_url("**/dashboard")
        check(store(page, "loginPlatform") == "business", "re-login did not restore the business session")
    ctx.close()


def main():
    global ORIGIN
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--summary", type=Path, default=os.environ.get("SMOKE_SUMMARY", "smoke-summary.json"),
                    help="output path for summary JSON")
    args = ap.parse_args()
    url = urlparse(os.environ["SMOKE_BASE_URL"])
    if url.scheme not in ("http", "https") or url.hostname not in LOOPBACK or url.username is not None or url.query or url.fragment or url.path not in ("", "/"):
        sys.exit("SMOKE_BASE_URL must be a loopback origin")
    ORIGIN = f"{url.scheme}://{url.netloc}"
    pwd, new_pwd = os.environ["SMOKE_PASSWORD"], os.environ["SMOKE_NEW_PASSWORD"]
    sha = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    error = None
    try:
        with sync_playwright() as p:
            run(p, p.chromium.launch(), pwd, new_pwd)
    except Exception as exc:  # report only step name and sanitized reason
        error = str(exc) if isinstance(exc, SmokeError) else type(exc).__name__
        print(f"smoke failed in step {STEPS[-1]['name'] if STEPS else '<setup>'}: {error}", file=sys.stderr)
    failed = sum(s["status"] == "failed" for s in STEPS)
    not_run = EXPECTED_STEPS - len(STEPS)
    if not error and not_run != 0:
        error = "unexpected step count"
    summary = {
        "sha": sha, "run": len(STEPS), "passed": len(STEPS) - failed,
        "failed": failed if STEPS else int(bool(error)), "skipped": 0, "not_run": not_run,
        "steps": STEPS, "error": error,
    }
    args.summary.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return 1 if error else 0


if __name__ == "__main__":
    sys.exit(main())
