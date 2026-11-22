#!/usr/bin/env python3
"""核验独立复核回执是否覆盖当前 PR、主干基线与实际受验合并提交。

Reusable CLI that decides whether a ``pull_request`` workflow run carries
fresh, independent review evidence for the exact head and base SHAs under
test. CI wiring is staged by a separate task. The gate performs no GitHub
mutations, needs no credentials of its own and never executes or evaluates
comment text; comment bodies are only matched against a fixed pattern.

Inputs
------
``--event``
    ``pull_request`` event payload (``GITHUB_EVENT_PATH``). Only the
    immutable PR number, head SHA, base SHA, PR author and repository owner
    are read. ``pull_request_target`` and other events are refused.
``--checkout-sha``
    Validated SHA of the checked-out merge commit (``GITHUB_SHA``). Its
    actual parents, read with git, must be exactly (event base, event head).
    The merge checkout already tests the base, so the gate does not require
    the PR head to contain the base; instead every receipt is bound to both.
``--comments`` / ``--reviews``
    PR issue comments and (optional, required in team mode) PR reviews in
    ``gh api --paginate --slurp`` shape: a JSON array of pages, each page an
    array of objects. Fetch them with a ``GITHUB_TOKEN`` limited to
    ``pull-requests: read``.
``--repo``
    Git checkout holding the merge commit and both parents (fetch depth of
    at least 2).

Receipts
--------
A receipt is an issue comment whose entire body, ignoring surrounding
whitespace, is exactly one line::

    pr-review-receipt v1 type=<pass|security-rules> pr=<number> head=<sha> base=<sha> review=<link-or-id> access=readonly

``review`` names the independently run read-only review (URL or ID). A
receipt attests that this review was performed offline; it is not a GitHub
review submitted by the PR author. Receipts for any other PR number, head or
base are stale and ignored, so a new commit or a moved base needs new
evidence.

Solo mode
---------
Requires a ``pass`` receipt from the real repository owner: comment
``user.type == "User"``, login and numeric id equal to the event's
repository owner, and ``author_association == "OWNER"``. Repositories owned
by an organization cannot use solo mode.

Team mode
---------
Requires an ``APPROVED`` review whose ``commit_id`` is the event head, from a
``User`` that is not the PR author, is listed via ``--maintainer`` and has
association OWNER, MEMBER or COLLABORATOR. Only each reviewer's latest
decision (APPROVED, CHANGES_REQUESTED or DISMISSED, ordered by
``submitted_at`` then review id) counts; a stale approval followed by
CHANGES_REQUESTED or DISMISSED does not, and any authorized reviewer whose
latest decision is CHANGES_REQUESTED fails the gate.

The ``approval`` requirement is met only when a reviewer whose latest
decision approves the head has also posted a ``pass`` receipt for the same
PR, head and base, which binds the approval to the tested base.

GitHub binds reviews to the head commit only. Team mode is therefore valid
only when the protected branch actually enforces, in hosted settings that
are managed separately and must be verified:

* required pull request approvals with review from Code Owners;
* dismissal of stale approvals when new commits are pushed;
* approval of the most recent reviewable push;
* this check as a required status check with strict (up-to-date) mode, so
  base movement produces a new run and requires new evidence.

CODEOWNERS should cover this gate and all scanner rules sources.

Scanner rules
-------------
When ``git diff --name-only`` between the base and the merge checkout lists
a path in ``SCANNER_RULES_PATHS`` of ``scripts/security/rules_scope.py``
(exact match; the scope file itself is always protected) or under a
``--scanner-path`` prefix, a ``security-rules`` receipt on the same PR, head
and base is additionally required: from the owner in solo mode, and from an
authorized independent reviewer (same criteria as approvals) in team mode.

Output
------
One JSON object on stdout with status, reason code, mode, PR number, head,
base and checkout SHAs, required and missing evidence types, the scanner
flag and evidence identifiers (comment ids and review ids). Comment and review bodies and account logins are never echoed.
Exit status is 0 for pass, 1 for fail and 2 for malformed, truncated or
unsupported input.

@author Claude Code
"""

from __future__ import annotations

import argparse
import functools
import importlib.util
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Optional, Sequence

PASS_TYPE = "pass"
SECURITY_TYPE = "security-rules"
APPROVAL_TYPE = "approval"

SHA_PATTERN = r"[0-9a-f]{40}(?:[0-9a-f]{24})?"
SHA_RE = re.compile(SHA_PATTERN, re.ASCII)
TIMESTAMP_RE = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", re.ASCII
)
REVIEW_REF_PATTERN = r"[A-Za-z0-9][A-Za-z0-9._~:/#?=&+%-]{0,255}"
RECEIPT_RE = re.compile(
    r"pr-review-receipt v1"
    r" type=(?P<kind>pass|security-rules)"
    r" pr=(?P<pr>[1-9][0-9]{0,9})"
    rf" head=(?P<head>{SHA_PATTERN})"
    rf" base=(?P<base>{SHA_PATTERN})"
    rf" review=(?P<review>{REVIEW_REF_PATTERN})"
    r" access=readonly",
    re.ASCII,
)

REVIEW_STATES = frozenset(
    {"APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"}
)
DECISION_STATES = frozenset({"APPROVED", "CHANGES_REQUESTED", "DISMISSED"})
REVIEWER_ASSOCIATIONS = frozenset({"OWNER", "MEMBER", "COLLABORATOR"})
RULES_SCOPE_PATH = "scripts/security/rules_scope.py"
EXIT_CODES = {"pass": 0, "fail": 1, "error": 2}
GIT_TIMEOUT_SECONDS = 60
MAX_JSON_BYTES = 8 * 1024 * 1024


class GateError(Exception):
    """用固定错误码表示门禁失败，避免回显输入内容。"""

    def __init__(self, code: str) -> None:
        """保存固定诊断码供门禁输出。"""
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Actor:
    """保存 GitHub 返回的账号身份，供核验审查人使用。"""

    login: str
    id: int
    type: str


@dataclass(frozen=True)
class PullRequest:
    """保存 GitHub 事件给出的 PR 身份、两个提交及相关账号。"""

    number: int
    head: str
    base: str
    author: Actor
    owner: Actor


@dataclass(frozen=True)
class Comment:
    """保留 issue 评论供匹配回执，输出中只使用评论标识。"""

    id: int
    author: Actor
    association: str
    body: str


@dataclass(frozen=True)
class Review:
    """保存 GitHub 审查决定与提交绑定，供判断最新决定。"""

    id: int
    author: Actor
    association: str
    state: str
    commit_id: Optional[str]
    submitted_at: Optional[str]


@dataclass(frozen=True)
class Receipt:
    """保存独立复核回执声明的版本和发布凭证。"""

    kind: str
    pr: int
    head: str
    base: str
    review_ref: str
    comment_id: int


def _reject_constant(_name: str) -> Any:
    """拒绝 JSON 规范之外的非有限数值。"""
    raise ValueError("non-finite number")


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    """拒绝重复对象字段，避免后出现的值覆盖门禁输入。"""
    obj: dict[str, Any] = {}
    for key, value in pairs:
        if key in obj:
            raise ValueError("duplicate key")
        obj[key] = value
    return obj


def load_json(path: str, code: str) -> Any:
    """严格读取门禁输入并限制文件体积，把读取或解析错误归为固定错误码。"""
    try:
        with open(path, "rb") as handle:
            raw = handle.read(MAX_JSON_BYTES + 1)
        if len(raw) > MAX_JSON_BYTES:
            raise ValueError("json too large")
        return json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_constant,
        )
    except (OSError, UnicodeDecodeError, ValueError, RecursionError):
        raise GateError(code) from None


def _field(obj: Any, key: str, code: str) -> Any:
    """取出必填字段，缺失或对象格式错误时终止验收。"""
    if not isinstance(obj, dict) or key not in obj:
        raise GateError(code)
    return obj[key]


def _text(obj: Any, key: str, code: str) -> str:
    """验证字段是非空字符串后返回其值。"""
    value = _field(obj, key, code)
    if not isinstance(value, str) or not value:
        raise GateError(code)
    return value


def _positive_int(obj: Any, key: str, code: str) -> int:
    """读取严格正整数，避免布尔值被解释成数值标识。"""
    value = _field(obj, key, code)
    if type(value) is not int or value <= 0:
        raise GateError(code)
    return value


def _sha(obj: Any, key: str, code: str) -> str:
    """读取完整的小写十六进制提交标识。"""
    value = _text(obj, key, code)
    if not SHA_RE.fullmatch(value):
        raise GateError(code)
    return value


def _actor(obj: Any, key: str, code: str) -> Actor:
    """读取事件或审查输入中的账号标识、登录名及类型。"""
    user = _field(obj, key, code)
    return Actor(
        login=_text(user, "login", code),
        id=_positive_int(user, "id", code),
        type=_text(user, "type", code),
    )


def parse_event(event: Any) -> PullRequest:
    """提取 PR 事件中的作者、仓库所有者、编号与基线版本。"""
    code = "malformed_event"
    pull = _field(event, "pull_request", code)
    number = _positive_int(pull, "number", code)
    if "number" in event and (
        type(event["number"]) is not int or event["number"] != number
    ):
        raise GateError(code)
    head = _sha(_field(pull, "head", code), "sha", code)
    base = _sha(_field(pull, "base", code), "sha", code)
    if len(head) != len(base):
        raise GateError(code)
    return PullRequest(
        number=number,
        head=head,
        base=base,
        author=_actor(pull, "user", code),
        owner=_actor(_field(event, "repository", code), "owner", code),
    )


def flatten_pages(data: Any, code: str) -> list[dict[str, Any]]:
    """展开 GitHub API 分页响应并验证每页的数据形状。

    The top level must be a non-empty array of pages and every page an
    array of objects with a unique positive integer ``id``. Anything else,
    such as a single unslurped page or duplicated entries, fails closed.
    """
    if not isinstance(data, list) or not data:
        raise GateError(code)
    items: list[dict[str, Any]] = []
    seen: set[int] = set()
    for page in data:
        if not isinstance(page, list):
            raise GateError(code)
        for item in page:
            item_id = _positive_int(item, "id", code)
            if item_id in seen:
                raise GateError(code)
            seen.add(item_id)
            items.append(item)
    return items


def parse_comments(data: Any) -> list[Comment]:
    """校验评论结构并保留签收匹配所需字段。"""
    code = "malformed_comments"
    comments = []
    for item in flatten_pages(data, code):
        body = _field(item, "body", code)
        if not isinstance(body, str):
            raise GateError(code)
        comments.append(
            Comment(
                id=item["id"],
                author=_actor(item, "user", code),
                association=_text(item, "author_association", code),
                body=body,
            )
        )
    return comments


def parse_reviews(data: Any) -> list[Review]:
    """解析提交审查决定，已提交的审查须有 UTC 时间。"""
    code = "malformed_reviews"
    reviews = []
    for item in flatten_pages(data, code):
        state = _text(item, "state", code)
        if state not in REVIEW_STATES:
            raise GateError(code)
        commit_id = _field(item, "commit_id", code)
        if commit_id is not None and (
            not isinstance(commit_id, str) or not SHA_RE.fullmatch(commit_id)
        ):
            raise GateError(code)
        submitted_at = None
        if state != "PENDING":
            submitted_at = _text(item, "submitted_at", code)
            if not TIMESTAMP_RE.fullmatch(submitted_at):
                raise GateError(code)
        reviews.append(
            Review(
                id=item["id"],
                author=_actor(item, "user", code),
                association=_text(item, "author_association", code),
                state=state,
                commit_id=commit_id,
                submitted_at=submitted_at,
            )
        )
    return reviews


def parse_receipt(comment: Comment) -> Optional[Receipt]:
    """从独立成行的评论中提取版本和独立复核标识。"""
    match = RECEIPT_RE.fullmatch(comment.body.strip())
    if match is None:
        return None
    return Receipt(
        kind=match["kind"],
        pr=int(match["pr"]),
        head=match["head"],
        base=match["base"],
        review_ref=match["review"],
        comment_id=comment.id,
    )


def is_repo_owner(actor: Actor, association: str, owner: Actor) -> bool:
    """要求签收人为事件声明的仓库所有者用户。"""
    return (
        owner.type == "User"
        and actor.type == "User"
        and actor.login == owner.login
        and actor.id == owner.id
        and association == "OWNER"
    )


def is_independent_reviewer(
    actor: Actor, association: str, pr: PullRequest, maintainers: frozenset[str]
) -> bool:
    """确认团队审查人属于授权范围且与 PR 作者身份不同。"""
    return (
        actor.type == "User"
        and actor.login in maintainers
        and actor.login != pr.author.login
        and actor.id != pr.author.id
        and association in REVIEWER_ASSOCIATIONS
    )


def make_eligibility(
    mode: str, pr: PullRequest, maintainers: frozenset[str]
) -> Callable[[Actor, str], bool]:
    """根据维护模式构造签收与审查的账号校验。"""
    if mode == "solo":
        if pr.owner.type != "User":
            raise GateError("solo_requires_user_owner")
        return lambda actor, association: is_repo_owner(actor, association, pr.owner)
    if mode == "team":
        if not maintainers:
            raise GateError("team_requires_maintainers")
        return lambda actor, association: is_independent_reviewer(
            actor, association, pr, maintainers
        )
    raise GateError("invalid_mode")


@functools.lru_cache(maxsize=1)
def load_rules_scope() -> frozenset[str]:
    """加载版本门禁与独立复核共用的完整规则路径。

    The set is loaded from ``scripts/security/rules_scope.py`` by file
    location, so no import search path can substitute another module. The
    scope file itself is always protected, even if a change rewrites the set.
    """
    location = Path(__file__).resolve().parents[1] / "security" / "rules_scope.py"
    try:
        spec = importlib.util.spec_from_file_location("_pr_gate_rules_scope", location)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        paths = module.SCANNER_RULES_PATHS
    except Exception:  # noqa: BLE001 - any load failure fails closed
        raise GateError("rules_scope_unavailable") from None
    if not isinstance(paths, frozenset) or not all(
        isinstance(path, str) and path for path in paths
    ):
        raise GateError("rules_scope_unavailable")
    return paths | {RULES_SCOPE_PATH}


def is_scanner_path(path: str, extra_prefixes: Iterable[str] = ()) -> bool:
    """辨认须额外复核的密钥扫描规则路径。"""
    if path in load_rules_scope():
        return True
    for prefix in extra_prefixes:
        prefix = prefix.strip("/")
        if prefix and (path == prefix or path.startswith(prefix + "/")):
            return True
    return False


def find_fresh_receipt(
    comments: Sequence[Comment],
    pr: PullRequest,
    kind: str,
    eligible: Callable[[Actor, str], bool],
) -> Optional[Receipt]:
    """查找绑定当前 PR 与基线、类别匹配的最新有效签收。"""
    fresh = []
    for comment in comments:
        if not eligible(comment.author, comment.association):
            continue
        receipt = parse_receipt(comment)
        if (
            receipt is not None
            and receipt.kind == kind
            and receipt.pr == pr.number
            and receipt.head == pr.head
            and receipt.base == pr.base
        ):
            fresh.append(receipt)
    return max(fresh, key=lambda item: item.comment_id, default=None)


def latest_decisions(
    reviews: Sequence[Review], eligible: Callable[[Actor, str], bool]
) -> dict[int, Review]:
    """按审查人归并已提交的最新有效决定。

    COMMENTED and PENDING reviews do not change a decision. Ordering uses
    ``submitted_at`` and then the increasing review id, so an APPROVED
    review followed by CHANGES_REQUESTED or DISMISSED is stale.
    """
    latest: dict[int, Review] = {}
    for review in reviews:
        if review.state not in DECISION_STATES:
            continue
        if not eligible(review.author, review.association):
            continue
        current = latest.get(review.author.id)
        if current is None or (review.submitted_at or "", review.id) > (
            current.submitted_at or "",
            current.id,
        ):
            latest[review.author.id] = review
    return latest


def _receipt_evidence(receipt: Receipt) -> dict[str, Any]:
    """返回可回查评论和独立复核的标识。"""
    return {
        "type": receipt.kind,
        "comment_id": receipt.comment_id,
    }


def _base_result(
    status: str,
    reason: str,
    mode: str,
    pr: Optional[PullRequest],
    checkout: Optional[str],
) -> dict[str, Any]:
    """初始化可发布的脱敏门禁结果。"""
    return {
        "status": status,
        "reason": reason,
        "mode": mode,
        "pr": pr.number if pr else None,
        "head": pr.head if pr else None,
        "base": pr.base if pr else None,
        "checkout": checkout,
        "required": [],
        "missing": [],
        "evidence": [],
        "scanner_rules_changed": None,
    }


def evaluate(
    pr: PullRequest,
    checkout: str,
    merge_parents: Sequence[str],
    changed_paths: Iterable[str],
    comments: Sequence[Comment],
    reviews: Optional[Sequence[Review]],
    *,
    mode: str,
    maintainers: Iterable[str] = (),
    scanner_prefixes: Iterable[str] = (),
) -> dict[str, Any]:
    """检查版本、维护模式及规则变更所需的独立复核证据。

    Raises GateError for unusable configuration. Otherwise returns a result
    whose ``status`` is ``pass`` or ``fail``.
    """
    eligible = make_eligibility(mode, pr, frozenset(maintainers))
    if mode == "team" and reviews is None:
        raise GateError("team_requires_reviews")
    result = _base_result("fail", "merge_parents_mismatch", mode, pr, checkout)
    if tuple(merge_parents) != (pr.base, pr.head):
        return result

    prefixes = tuple(scanner_prefixes)
    scanner_changed = any(is_scanner_path(path, prefixes) for path in changed_paths)
    required = [PASS_TYPE if mode == "solo" else APPROVAL_TYPE]
    if scanner_changed:
        required.append(SECURITY_TYPE)
    evidence: list[dict[str, Any]] = []
    satisfied: set[str] = set()
    blocked = False

    if mode == "solo":
        receipt = find_fresh_receipt(comments, pr, PASS_TYPE, eligible)
        if receipt is not None:
            satisfied.add(PASS_TYPE)
            evidence.append(_receipt_evidence(receipt))
    else:
        decisions = latest_decisions(reviews or (), eligible)
        blocked = any(
            review.state == "CHANGES_REQUESTED" for review in decisions.values()
        )
        approved = [
            review
            for review in decisions.values()
            if review.state == "APPROVED" and review.commit_id == pr.head
        ]
        approvals = sorted(review.id for review in approved)
        evidence.extend(
            {"type": APPROVAL_TYPE, "review_id": review_id} for review_id in approvals
        )
        # GitHub approvals record only the head, so the approval requirement
        # also needs a pass receipt for this exact PR, head and base from one
        # of the reviewers whose latest decision approves this head.
        approver_ids = frozenset(review.author.id for review in approved)
        receipt = find_fresh_receipt(
            comments,
            pr,
            PASS_TYPE,
            lambda actor, association: actor.id in approver_ids
            and eligible(actor, association),
        )
        if receipt is not None:
            satisfied.add(APPROVAL_TYPE)
            evidence.append(_receipt_evidence(receipt))

    if scanner_changed:
        receipt = find_fresh_receipt(comments, pr, SECURITY_TYPE, eligible)
        if receipt is not None:
            satisfied.add(SECURITY_TYPE)
            evidence.append(_receipt_evidence(receipt))

    missing = [kind for kind in required if kind not in satisfied]
    result.update(
        required=required,
        missing=missing,
        evidence=evidence,
        scanner_rules_changed=scanner_changed,
    )
    if blocked:
        result["reason"] = "changes_requested"
    elif missing:
        result["reason"] = "missing_evidence"
    else:
        result.update(status="pass", reason="fresh_independent_review")
    return result


def _run_git(command: Sequence[str]) -> bytes:
    """执行只读 Git 查询，失败时返回固定诊断。"""
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_OPTIONAL_LOCKS="0")
    try:
        completed = subprocess.run(
            list(command),
            capture_output=True,
            check=False,
            timeout=GIT_TIMEOUT_SECONDS,
            env=env,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise GateError("git_unavailable") from None
    if completed.returncode != 0:
        raise GateError("git_failed")
    return completed.stdout


class GitReader:
    """从本地提交对象读取实际合并父提交和变更路径。"""

    def __init__(
        self, repo: str, runner: Optional[Callable[[Sequence[str]], bytes]] = None
    ) -> None:
        """绑定本地仓库和可替换的 Git 查询实现。"""
        self.repo = repo
        self._runner = runner or _run_git

    def _git(self, *args: str) -> bytes:
        """在门禁指定的仓库中执行 Git 对象查询。"""
        return self._runner(["git", "-C", self.repo, *args])

    def merge_parents(self, checkout: str) -> tuple[str, ...]:
        """读取合并提交的父提交，供匹配实际测试的版本。"""
        output = self._git("rev-list", "--parents", "-n", "1", checkout, "--")
        try:
            tokens = output.decode("ascii").split()
        except UnicodeDecodeError:
            raise GateError("git_parents_unreadable") from None
        if not tokens or tokens[0] != checkout:
            raise GateError("git_parents_unreadable")
        if not all(SHA_RE.fullmatch(token) for token in tokens):
            raise GateError("git_parents_unreadable")
        return tuple(tokens[1:])

    def changed_paths(self, base: str, checkout: str) -> tuple[str, ...]:
        """读取基线到受验提交的路径差异，保留完整文件名。"""
        output = self._git(
            "diff",
            "--name-only",
            "-z",
            "--no-renames",
            "--no-ext-diff",
            base,
            checkout,
            "--",
        )
        return tuple(
            path.decode("utf-8", "surrogateescape")
            for path in output.split(b"\0")
            if path
        )


def build_parser() -> argparse.ArgumentParser:
    """定义门禁命令需要的事件、受验版本与审查输入。"""
    parser = argparse.ArgumentParser(
        description="Verify fresh independent review evidence for a pull_request run."
    )
    parser.add_argument("--event", required=True, help="pull_request event JSON")
    parser.add_argument(
        "--checkout-sha", required=True, help="validated merge checkout SHA"
    )
    parser.add_argument(
        "--comments", required=True, help="PR issue comments (paginated, slurped)"
    )
    parser.add_argument("--reviews", help="PR reviews (paginated, slurped)")
    parser.add_argument("--mode", required=True, choices=("solo", "team"))
    parser.add_argument(
        "--maintainer",
        action="append",
        default=[],
        help="authorized team reviewer login (repeatable)",
    )
    parser.add_argument(
        "--scanner-path",
        action="append",
        default=[],
        help="additional scanner rules path prefix (repeatable)",
    )
    parser.add_argument(
        "--event-name", help="defaults to GITHUB_EVENT_NAME; must be pull_request"
    )
    parser.add_argument("--repo", default=".", help="git checkout to inspect")
    return parser


def main(argv: Optional[Sequence[str]] = None, git_reader: Any = None) -> int:
    """运行复核门禁，输出脱敏 JSON 并返回退出码。"""
    args = build_parser().parse_args(argv)
    pr: Optional[PullRequest] = None
    checkout: Optional[str] = None
    try:
        event_name = args.event_name
        if event_name is None:
            event_name = os.environ.get("GITHUB_EVENT_NAME", "")
        if event_name != "pull_request":
            raise GateError("unsupported_event")
        if not SHA_RE.fullmatch(args.checkout_sha):
            raise GateError("invalid_checkout_sha")
        checkout = args.checkout_sha
        pr = parse_event(load_json(args.event, "malformed_event"))
        comments = parse_comments(load_json(args.comments, "malformed_comments"))
        reviews = None
        if args.reviews is not None:
            reviews = parse_reviews(load_json(args.reviews, "malformed_reviews"))
        reader = git_reader if git_reader is not None else GitReader(args.repo)
        parents = tuple(reader.merge_parents(checkout))
        changed: tuple[str, ...] = ()
        if parents == (pr.base, pr.head):
            changed = tuple(reader.changed_paths(pr.base, checkout))
        result = evaluate(
            pr,
            checkout,
            parents,
            changed,
            comments,
            reviews,
            mode=args.mode,
            maintainers=args.maintainer,
            scanner_prefixes=args.scanner_path,
        )
    except GateError as exc:
        result = _base_result("error", exc.code, args.mode, pr, checkout)
    except Exception:  # noqa: BLE001 - fail closed without echoing details
        result = _base_result("error", "internal_error", args.mode, pr, checkout)
    sys.stdout.write(json.dumps(result, sort_keys=True) + "\n")
    return EXIT_CODES[result["status"]]


if __name__ == "__main__":
    sys.exit(main())
