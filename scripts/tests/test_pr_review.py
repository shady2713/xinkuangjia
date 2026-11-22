"""验证独立复核的版本绑定、审核人身份与失败边界。

All fixtures are synthetic: no network access, credentials or real
repository data are used, and git is replaced by an in-memory reader.

@author Claude Code
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "workflow"))

import verify_pr_review as gate  # noqa: E402

PR_NUMBER = 7
HEAD = "a" * 40
BASE = "b" * 40
MERGE = "c" * 40
NEW_HEAD = "d" * 40
NEW_BASE = "e" * 40

OWNER = {"login": "repo-owner", "id": 1001, "type": "User"}
AUTHOR = {"login": "pr-author", "id": 2002, "type": "User"}
MAINTAINER = {"login": "maint-one", "id": 3003, "type": "User"}
SECOND_MAINTAINER = {"login": "maint-two", "id": 3004, "type": "User"}
OUTSIDER = {"login": "outside-member", "id": 4004, "type": "User"}
TEAM_ARGS = (
    "--maintainer",
    "maint-one",
    "--maintainer",
    "maint-two",
    "--maintainer",
    "pr-author",
)
SCANNER_PATHS = ("scripts/security/scan_staged_secrets.py",)
RULES_SCOPE_FILE = "scripts/security/rules_scope.py"
# Similarly named paths that must not count as scanner rules changes.
SIMILAR_PATHS = (
    "tools/scanner/rules.yml",
    "notes/scanner.md",
    "scripts/security/scan_staged_secrets.py.orig",
    "scripts/security/scan_staged_secrets_test.py",
    "scripts/Security/scan_staged_secrets.py",
    "vendor/scripts/security/scan_staged_secrets.py",
    "scripts/security/rules_scope.pyc",
)
SECURITY = "security-rules"
PRIVATE_MARKER = "SYNTHETIC-PRIVATE-NOTE-7f3a"


def make_event(head=HEAD, base=BASE, author=None, owner=None):
    """构造隔离测试用的 PR 事件与虚拟身份。"""
    return {
        "action": "synchronize",
        "number": PR_NUMBER,
        "pull_request": {
            "number": PR_NUMBER,
            "head": {"sha": head},
            "base": {"sha": base},
            "user": dict(author or OWNER),
        },
        "repository": {
            "full_name": "example/synthetic",
            "owner": dict(owner or OWNER),
        },
    }


def receipt(kind="pass", head=HEAD, base=BASE, pr=PR_NUMBER, review="offline-review-42"):
    """生成绑定指定 PR 和版本的合成回执。"""
    return (
        f"pr-review-receipt v1 type={kind} pr={pr} head={head} base={base}"
        f" review={review} access=readonly"
    )


def comment(comment_id, body, user=None, association="OWNER"):
    """生成可用于门禁校验的合成 issue 评论。"""
    return {
        "id": comment_id,
        "body": body,
        "user": dict(user or OWNER),
        "author_association": association,
    }


def review(
    review_id,
    state,
    user=None,
    commit=HEAD,
    submitted="2026-11-20T10:00:00Z",
    association="MEMBER",
):
    """生成包含决定、作者和提交版本的合成 GitHub 审查。"""
    return {
        "id": review_id,
        "state": state,
        "user": dict(user or MAINTAINER),
        "commit_id": commit,
        "submitted_at": submitted,
        "author_association": association,
        "body": "",
    }


def team_receipt(user=None, head=HEAD, base=BASE, comment_id=31):
    """生成团队维护者的合成独立审查签收。"""
    return comment(
        comment_id,
        receipt(head=head, base=base),
        user=user or MAINTAINER,
        association="MEMBER",
    )


def without(obj, *keys):
    """复制样本并删除指定嵌套字段，供格式拒绝测试。"""
    copy = json.loads(json.dumps(obj))
    target = copy
    for key in keys[:-1]:
        target = target[key]
    del target[keys[-1]]
    return copy


class FakeGit:
    """按测试输入模拟本地版本与文件差异查询。"""

    def __init__(self, parents, paths, error=None):
        """设置测试要返回的父提交、路径和查询错误。"""
        self.parents = tuple(parents)
        self.paths = tuple(paths)
        self.error = error

    def merge_parents(self, checkout):
        """读取合并提交的父提交，供匹配实际测试的版本。"""
        if self.error:
            raise gate.GateError(self.error)
        return self.parents

    def changed_paths(self, base, checkout):
        """读取基线到受验提交的路径差异，保留完整文件名。"""
        return self.paths


class GateCase(unittest.TestCase):
    """提供在临时输入上运行门禁及校验输出的公共辅助。"""

    def run_gate(
        self,
        *,
        event=None,
        comments=(),
        reviews=None,
        mode="solo",
        parents=(BASE, HEAD),
        paths=("README.md",),
        extra=(),
        checkout=MERGE,
        event_name="pull_request",
        raw=None,
        git_error=None,
    ):
        """运行真实 CLI 入口并返回退出码、结构化结果及标准输出。"""
        raw = dict(raw or {})
        payloads = {
            "event": make_event() if event is None else event,
            "comments": [list(comments)],
        }
        if reviews is not None:
            payloads["reviews"] = [list(reviews)]
        argv = ["--checkout-sha", checkout, "--mode", mode, *extra]
        if event_name is not None:
            argv += ["--event-name", event_name]
        stdout = io.StringIO()
        with tempfile.TemporaryDirectory() as tmp:
            for name in ("event", "comments", "reviews"):
                if name not in payloads and name not in raw:
                    continue
                path = os.path.join(tmp, f"{name}.json")
                text = raw[name] if name in raw else json.dumps(payloads[name])
                with open(path, "w", encoding="utf-8") as handle:
                    handle.write(text)
                argv += [f"--{name}", path]
            reader = FakeGit(parents, paths, git_error)
            with contextlib.redirect_stdout(stdout):
                code = gate.main(argv, git_reader=reader)
        output = stdout.getvalue()
        return code, json.loads(output), output

    def assert_status(self, outcome, status, reason=None):
        """核对门禁退出码、状态和诊断码后返回结果。"""
        code, result, _ = outcome
        self.assertEqual(result["status"], status)
        self.assertEqual(code, gate.EXIT_CODES[status])
        if reason is not None:
            self.assertEqual(result["reason"], reason)
        return result


class SoloModeTests(GateCase):
    """覆盖单维护者签收的版本与账号绑定。"""

    def test_owner_receipt_passes_and_reports_both_shas(self):
        """验证所有者回执及报告中的基线和 head 提交。"""
        outcome = self.run_gate(comments=[comment(11, receipt())])
        result = self.assert_status(outcome, "pass", "fresh_independent_review")
        self.assertEqual(result["head"], HEAD)
        self.assertEqual(result["base"], BASE)
        self.assertEqual(result["checkout"], MERGE)
        self.assertEqual(result["pr"], PR_NUMBER)
        self.assertEqual(result["required"], ["pass"])
        self.assertEqual(result["missing"], [])
        self.assertFalse(result["scanner_rules_changed"])
        self.assertEqual(
            result["evidence"],
            [{"type": "pass", "comment_id": 11}],
        )

    def test_review_link_is_accepted_as_reference(self):
        """验证回执可以引用可追溯的复核凭证。"""
        link = "https://reviews.example.invalid/runs/42#summary"
        outcome = self.run_gate(comments=[comment(11, receipt(review=link) + "\n")])
        result = self.assert_status(outcome, "pass")
        self.assertEqual(result["evidence"][0]["comment_id"], 11)
        self.assertNotIn(link, outcome[2])

    def test_newest_commit_rejects_previously_valid_receipt(self):
        """验证提交更新使原有合法回执失效。"""
        outcome = self.run_gate(
            event=make_event(head=NEW_HEAD),
            comments=[comment(11, receipt())],
            parents=(BASE, NEW_HEAD),
        )
        result = self.assert_status(outcome, "fail", "missing_evidence")
        self.assertEqual(result["head"], NEW_HEAD)
        self.assertEqual(result["missing"], ["pass"])
        self.assertEqual(result["evidence"], [])

    def test_fresh_receipt_for_newest_commit_passes(self):
        """验证使用新提交签收后可以重新通过。"""
        outcome = self.run_gate(
            event=make_event(head=NEW_HEAD),
            comments=[comment(11, receipt()), comment(12, receipt(head=NEW_HEAD))],
            parents=(BASE, NEW_HEAD),
        )
        result = self.assert_status(outcome, "pass")
        self.assertEqual(result["evidence"][0]["comment_id"], 12)

    def test_base_movement_rejects_previous_receipt(self):
        """验证主干基线变化使旧签收失效。"""
        outcome = self.run_gate(
            event=make_event(base=NEW_BASE),
            comments=[comment(11, receipt())],
            parents=(NEW_BASE, HEAD),
        )
        result = self.assert_status(outcome, "fail", "missing_evidence")
        self.assertEqual(result["base"], NEW_BASE)
        self.assertEqual(result["head"], HEAD)

    def test_merge_parents_must_match_event_base_and_head(self):
        """验证实际合并提交的两个父提交必须对应事件版本。"""
        cases = [
            (BASE, NEW_HEAD),
            (NEW_BASE, HEAD),
            (HEAD, BASE),
            (BASE,),
            (BASE, HEAD, NEW_HEAD),
            (),
        ]
        for parents in cases:
            with self.subTest(parents=parents):
                outcome = self.run_gate(
                    comments=[comment(11, receipt())], parents=parents
                )
                result = self.assert_status(outcome, "fail", "merge_parents_mismatch")
                self.assertEqual((result["head"], result["base"]), (HEAD, BASE))
                self.assertEqual(result["evidence"], [])

    def test_spoofed_owner_comments_are_rejected(self):
        """验证相似或身份不匹配的账号不能提供所有者回执。"""
        cases = {
            "login case": (dict(OWNER, login="Repo-Owner"), "OWNER"),
            "lookalike login": (dict(OWNER, login="repo-0wner"), "OWNER"),
            "other account id": (dict(OWNER, id=9999), "OWNER"),
            "bot account": (dict(OWNER, type="Bot"), "OWNER"),
            "member association": (OWNER, "MEMBER"),
            "collaborator association": (OWNER, "COLLABORATOR"),
            "outsider": (OUTSIDER, "OWNER"),
        }
        for label, (user, association) in cases.items():
            with self.subTest(label):
                forged = comment(11, receipt(), user=user, association=association)
                outcome = self.run_gate(comments=[forged])
                self.assert_status(outcome, "fail", "missing_evidence")

    def test_receipt_must_be_standalone_and_exact(self):
        """验证只有完整匹配的独立回执行可用。"""
        bodies = {
            "quoted": "> " + receipt(),
            "leading text": "Looks good\n" + receipt(),
            "trailing text": receipt() + " thanks",
            "no readonly": receipt().replace(" access=readonly", ""),
            "write access": receipt().replace("access=readonly", "access=write"),
            "wrong pr": receipt(pr=PR_NUMBER + 1),
            "uppercase sha": receipt(head=HEAD.upper()),
            "short sha": receipt(head=HEAD[:12]),
            "security type only": receipt(kind=SECURITY),
            "missing review": receipt(review=""),
        }
        for label, body in bodies.items():
            with self.subTest(label):
                outcome = self.run_gate(comments=[comment(11, body)])
                self.assert_status(outcome, "fail", "missing_evidence")

    def test_github_self_review_is_not_an_owner_receipt(self):
        """验证平台自审记录无法充当独立复核回执。"""
        reviews = [review(21, "APPROVED", user=OWNER, association="OWNER")]
        outcome = self.run_gate(reviews=reviews)
        self.assert_status(outcome, "fail", "missing_evidence")

    def test_organization_owned_repository_cannot_use_solo_mode(self):
        """验证组织仓库不能使用个人所有者签收模式。"""
        org = {"login": "example-org", "id": 5005, "type": "Organization"}
        outcome = self.run_gate(
            event=make_event(owner=org), comments=[comment(11, receipt(), user=org)]
        )
        result = self.assert_status(outcome, "error", "solo_requires_user_owner")
        self.assertEqual((result["head"], result["base"]), (HEAD, BASE))


class FailClosedTests(GateCase):
    """验证缺失、畸形与无法查询的输入均阻断门禁。"""

    def test_event_missing_or_invalid_fields(self):
        """验证事件关键字段缺失或格式错误时终止。"""
        base_event = make_event()
        events = {
            "no pull_request": without(base_event, "pull_request"),
            "no head sha": without(base_event, "pull_request", "head", "sha"),
            "no base": without(base_event, "pull_request", "base"),
            "no number": without(base_event, "pull_request", "number"),
            "no author": without(base_event, "pull_request", "user"),
            "no author type": without(base_event, "pull_request", "user", "type"),
            "no repository": without(base_event, "repository"),
            "no owner id": without(base_event, "repository", "owner", "id"),
            "short head": make_event(head="abc123"),
            "uppercase base": make_event(base=BASE.upper()),
        }
        mismatched = make_event()
        mismatched["number"] = PR_NUMBER + 1
        events["number mismatch"] = mismatched
        boolean_number = make_event()
        boolean_number["pull_request"]["number"] = True
        events["boolean number"] = boolean_number
        for label, event in events.items():
            with self.subTest(label):
                outcome = self.run_gate(event=event, comments=[comment(11, receipt())])
                result = self.assert_status(outcome, "error", "malformed_event")
                self.assertIsNone(result["head"])
                self.assertEqual(result["evidence"], [])

    def test_truncated_or_misshaped_event_file(self):
        """验证截断或结构不符的事件文件失败。"""
        texts = {
            "truncated": '{"pull_request": {"number": 7',
            "array": "[]",
            "nan": '{"pull_request": NaN}',
            "empty": "",
        }
        for label, text in texts.items():
            with self.subTest(label):
                outcome = self.run_gate(raw={"event": text})
                self.assert_status(outcome, "error", "malformed_event")

    def test_malformed_comment_pages(self):
        """验证不合法的评论分页数据会使门禁失败。"""
        valid = comment(11, receipt())
        encoded = json.dumps(valid)
        cases = {
            "truncated": "[[" + encoded[:-5],
            "unslurped page": json.dumps([valid]),
            "object": json.dumps({"items": [valid]}),
            "no pages": "[]",
            "page of scalars": "[[1]]",
            "duplicate ids": json.dumps([[valid], [valid]]),
            "duplicate keys": '[[{"id": 11, "id": 12}]]',
            "nan": '[[{"id": NaN}]]',
            "missing user": json.dumps([[without(valid, "user")]]),
            "missing association": json.dumps([[without(valid, "author_association")]]),
            "missing body": json.dumps([[without(valid, "body")]]),
            "null body": json.dumps([[dict(valid, body=None)]]),
            "boolean id": json.dumps([[dict(valid, id=True)]]),
            "user without type": json.dumps([[without(valid, "user", "type")]]),
        }
        for label, payload in cases.items():
            with self.subTest(label):
                outcome = self.run_gate(raw={"comments": payload})
                result = self.assert_status(outcome, "error", "malformed_comments")
                self.assertEqual((result["head"], result["base"]), (HEAD, BASE))
                self.assertEqual(result["evidence"], [])

    def test_empty_comment_page_is_valid_but_insufficient(self):
        """验证无评论的合法分页结果无法证明已签收。"""
        outcome = self.run_gate(raw={"comments": "[[]]"})
        self.assert_status(outcome, "fail", "missing_evidence")

    def test_malformed_reviews(self):
        """验证格式错误的团队审查结果失败。"""
        valid = review(21, "APPROVED")
        cases = {
            "truncated": "[[" + json.dumps(valid)[:-3],
            "unslurped page": json.dumps([valid]),
            "unknown state": json.dumps([[dict(valid, state="APPROVE")]]),
            "missing submitted_at": json.dumps([[without(valid, "submitted_at")]]),
            "bad timestamp": json.dumps([[dict(valid, submitted_at="yesterday")]]),
            "missing commit_id": json.dumps([[without(valid, "commit_id")]]),
            "short commit_id": json.dumps([[dict(valid, commit_id=HEAD[:7])]]),
            "null user": json.dumps([[dict(valid, user=None)]]),
        }
        for mode, extra in (("team", TEAM_ARGS), ("solo", ())):
            for label, payload in cases.items():
                with self.subTest(mode=mode, case=label):
                    outcome = self.run_gate(
                        event=make_event(author=AUTHOR),
                        comments=[comment(11, receipt())],
                        mode=mode,
                        extra=extra,
                        raw={"reviews": payload},
                    )
                    self.assert_status(outcome, "error", "malformed_reviews")

    def test_invalid_checkout_sha_is_rejected_and_not_echoed(self):
        """验证拒绝无效受验版本并隐藏原始输入。"""
        for value in ("HEAD", "c" * 39, "C" * 40, "c" * 40 + "\n"):
            with self.subTest(value=value):
                outcome = self.run_gate(checkout=value, comments=[comment(11, receipt())])
                result = self.assert_status(outcome, "error", "invalid_checkout_sha")
                self.assertIsNone(result["checkout"])

    def test_only_pull_request_events_are_supported(self):
        """验证门禁只接受 PR 事件。"""
        for name in ("pull_request_target", "push", ""):
            with self.subTest(name=name):
                outcome = self.run_gate(event_name=name, comments=[comment(11, receipt())])
                self.assert_status(outcome, "error", "unsupported_event")

    def test_event_name_defaults_to_environment(self):
        """验证默认从执行环境读取事件类型。"""
        cases = {"pull_request": "pass", "pull_request_target": "error", None: "error"}
        for name, status in cases.items():
            with self.subTest(name=name):
                with mock.patch.dict(os.environ, {}, clear=False):
                    os.environ.pop("GITHUB_EVENT_NAME", None)
                    if name is not None:
                        os.environ["GITHUB_EVENT_NAME"] = name
                    outcome = self.run_gate(
                        event_name=None, comments=[comment(11, receipt())]
                    )
                self.assert_status(outcome, status)

    def test_git_failures_fail_closed(self):
        """验证 Git 无法查询时不予通过。"""
        outcome = self.run_gate(comments=[comment(11, receipt())], git_error="git_failed")
        result = self.assert_status(outcome, "error", "git_failed")
        self.assertEqual((result["head"], result["base"]), (HEAD, BASE))

    def test_output_never_echoes_comment_contents(self):
        """验证门禁输出不会包含评论全文。"""
        comments = [
            comment(10, f"note {PRIVATE_MARKER}", user=OUTSIDER, association="NONE"),
            comment(11, receipt()),
            comment(12, f"{PRIVATE_MARKER} {receipt()}"),
        ]
        code, result, output = self.run_gate(comments=comments)
        self.assertEqual((code, result["status"]), (0, "pass"))
        self.assertNotIn(PRIVATE_MARKER, output)
        self.assertNotIn(OWNER["login"], output)
        self.assertEqual(output.count("\n"), 1)

    def test_errors_never_echo_comment_contents(self):
        """验证异常诊断不泄露过往评论。"""
        broken = {"id": 10, "body": PRIVATE_MARKER, "user": dict(OUTSIDER)}
        outcome = self.run_gate(raw={"comments": json.dumps([[broken]])})
        self.assert_status(outcome, "error", "malformed_comments")
        self.assertNotIn(PRIVATE_MARKER, outcome[2])
        self.assertNotIn(OUTSIDER["login"], outcome[2])


class TeamModeTests(GateCase):
    """验证团队模式中独立审批及决定顺序。"""

    def run_team(self, reviews, comments=None, extra=TEAM_ARGS, event=None, **kwargs):
        """以团队模式执行一个合成 PR 检查。"""
        # By default one approving maintainer also posts a fresh pass receipt.
        return self.run_gate(
            event=event or make_event(author=AUTHOR),
            comments=[team_receipt()] if comments is None else comments,
            reviews=reviews,
            mode="team",
            extra=extra,
            **kwargs,
        )

    def test_maintainer_approval_on_head_passes(self):
        """验证授权维护者对当前提交的审批可以通过。"""
        outcome = self.run_team([review(21, "APPROVED")])
        result = self.assert_status(outcome, "pass", "fresh_independent_review")
        self.assertEqual(result["required"], ["approval"])
        self.assertEqual(
            result["evidence"],
            [
                {"type": "approval", "review_id": 21},
                {"type": "pass", "comment_id": 31},
            ],
        )
        self.assertEqual((result["head"], result["base"]), (HEAD, BASE))

    def test_approval_requires_pass_receipt_from_head_approver(self):
        """确认当前 head 的批准者还必须签收同一基线下的复核。"""
        approvals = [review(21, "APPROVED")]
        security_only = comment(
            31, receipt(kind=SECURITY), user=MAINTAINER, association="MEMBER"
        )
        cases = {
            "no receipt": ([], "fail"),
            "non-approving maintainer": ([team_receipt(user=SECOND_MAINTAINER)], "fail"),
            "pr author": ([team_receipt(user=AUTHOR)], "fail"),
            "repository owner": ([comment(31, receipt())], "fail"),
            "security receipt only": ([security_only], "fail"),
            "approving maintainer": ([team_receipt()], "pass"),
        }
        for label, (comments, status) in cases.items():
            with self.subTest(label):
                outcome = self.run_team(approvals, comments=comments)
                result = self.assert_status(outcome, status)
                self.assertEqual(result["required"], ["approval"])
                expected = [] if status == "pass" else ["approval"]
                self.assertEqual(result["missing"], expected)

    def test_receipt_from_any_head_approver_is_accepted(self):
        """接受任一符合条件且已有同版本批准的维护者签收。"""
        reviews = [
            review(21, "APPROVED"),
            review(22, "APPROVED", user=SECOND_MAINTAINER),
        ]
        outcome = self.run_team(reviews, comments=[team_receipt(user=SECOND_MAINTAINER)])
        result = self.assert_status(outcome, "pass")
        self.assertEqual(
            result["evidence"],
            [
                {"type": "approval", "review_id": 21},
                {"type": "approval", "review_id": 22},
                {"type": "pass", "comment_id": 31},
            ],
        )

    def test_base_movement_needs_new_receipt_while_head_approval_remains(self):
        """验证主干移动后原签收失效，仍需更新复核证据。"""
        event = make_event(base=NEW_BASE, author=AUTHOR)
        approvals = [review(21, "APPROVED", commit=HEAD)]
        outcome = self.run_team(approvals, event=event, parents=(NEW_BASE, HEAD))
        result = self.assert_status(outcome, "fail", "missing_evidence")
        self.assertEqual(result["missing"], ["approval"])
        self.assertEqual(result["evidence"], [{"type": "approval", "review_id": 21}])
        self.assertEqual((result["head"], result["base"]), (HEAD, NEW_BASE))
        outcome = self.run_team(
            approvals,
            comments=[team_receipt(base=NEW_BASE)],
            event=event,
            parents=(NEW_BASE, HEAD),
        )
        self.assert_status(outcome, "pass")

    def test_authorized_associations(self):
        """验证账号与仓库的关系符合团队审批条件。"""
        for association in ("OWNER", "MEMBER", "COLLABORATOR"):
            with self.subTest(association=association):
                outcome = self.run_team([review(21, "APPROVED", association=association)])
                self.assert_status(outcome, "pass")
        for association in ("CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "NONE"):
            with self.subTest(association=association):
                outcome = self.run_team([review(21, "APPROVED", association=association)])
                self.assert_status(outcome, "fail", "missing_evidence")

    def test_newest_commit_rejects_previous_approval(self):
        """验证推送新提交使先前的团队批准失效。"""
        outcome = self.run_team(
            [review(21, "APPROVED", commit=HEAD)],
            event=make_event(head=NEW_HEAD, author=AUTHOR),
            parents=(BASE, NEW_HEAD),
        )
        result = self.assert_status(outcome, "fail", "missing_evidence")
        self.assertEqual(result["missing"], ["approval"])
        self.assertEqual(result["head"], NEW_HEAD)

    def test_merge_parents_checked_in_team_mode(self):
        """验证团队模式同样校验实际合并提交父版本。"""
        outcome = self.run_team([review(21, "APPROVED")], parents=(NEW_BASE, HEAD))
        self.assert_status(outcome, "fail", "merge_parents_mismatch")

    def test_author_cannot_approve_own_pr(self):
        """验证作者的自我审批不计入团队审批。"""
        cases = {
            "author": AUTHOR,
            "author renamed to maintainer login": dict(AUTHOR, login="maint-one"),
        }
        for label, user in cases.items():
            with self.subTest(label):
                outcome = self.run_team([review(21, "APPROVED", user=user)])
                self.assert_status(outcome, "fail", "missing_evidence")

    def test_unlisted_or_bot_reviewers_are_rejected(self):
        """验证机器人和不在授权清单内的账号不能审批。"""
        cases = {
            "unlisted member": OUTSIDER,
            "bot with maintainer login": dict(MAINTAINER, type="Bot"),
        }
        for label, user in cases.items():
            with self.subTest(label):
                outcome = self.run_team([review(21, "APPROVED", user=user)])
                self.assert_status(outcome, "fail", "missing_evidence")

    def test_latest_decision_per_reviewer_wins(self):
        """验证只采用审查人最近一次有效决定。"""
        early = "2026-11-20T10:00:00Z"
        late = "2026-11-20T11:00:00Z"
        approve = review(21, "APPROVED", submitted=early)
        cases = [
            (
                "approved then changes requested",
                [approve, review(22, "CHANGES_REQUESTED", submitted=late)],
                "fail",
                "changes_requested",
            ),
            (
                "approved then dismissed",
                [approve, review(22, "DISMISSED", submitted=late)],
                "fail",
                "missing_evidence",
            ),
            (
                "out of order listing",
                [review(22, "CHANGES_REQUESTED", submitted=late), approve],
                "fail",
                "changes_requested",
            ),
            (
                "same timestamp, newer id",
                [approve, review(22, "CHANGES_REQUESTED", submitted=early)],
                "fail",
                "changes_requested",
            ),
            (
                "changes requested then approved",
                [
                    review(20, "CHANGES_REQUESTED", submitted=early),
                    review(22, "APPROVED", submitted=late),
                ],
                "pass",
                "fresh_independent_review",
            ),
            (
                "comment after approval",
                [approve, review(22, "COMMENTED", submitted=late)],
                "pass",
                "fresh_independent_review",
            ),
        ]
        for label, reviews, status, reason in cases:
            with self.subTest(label):
                self.assert_status(self.run_team(reviews), status, reason)

    def test_changes_requested_by_another_maintainer_blocks(self):
        """验证授权维护者要求返工时门禁失败。"""
        reviews = [
            review(21, "APPROVED"),
            review(22, "CHANGES_REQUESTED", user=SECOND_MAINTAINER),
        ]
        self.assert_status(self.run_team(reviews), "fail", "changes_requested")

    def test_changes_requested_by_unauthorized_account_does_not_block(self):
        """验证未获授权账号的意见不影响合并门禁。"""
        reviews = [
            review(21, "APPROVED"),
            review(22, "CHANGES_REQUESTED", user=OUTSIDER, association="NONE"),
        ]
        self.assert_status(self.run_team(reviews), "pass")

    def test_pending_review_without_timestamp_is_ignored(self):
        """验证尚未提交的审查不计入团队决定。"""
        pending = without(review(22, "PENDING", user=SECOND_MAINTAINER), "submitted_at")
        self.assert_status(self.run_team([review(21, "APPROVED"), pending]), "pass")

    def test_owner_receipt_does_not_replace_team_approval(self):
        """验证所有者回执无法代替团队模式下的审批。"""
        outcome = self.run_team([], comments=[comment(11, receipt())])
        result = self.assert_status(outcome, "fail", "missing_evidence")
        self.assertEqual(result["missing"], ["approval"])

    def test_team_mode_requires_maintainer_allowlist(self):
        """验证团队模式必须配置授权维护者。"""
        outcome = self.run_team([review(21, "APPROVED")], extra=())
        self.assert_status(outcome, "error", "team_requires_maintainers")

    def test_team_mode_requires_reviews_input(self):
        """验证缺少审查输入时团队门禁失败。"""
        outcome = self.run_team(None)
        self.assert_status(outcome, "error", "team_requires_reviews")


class ScannerRulesTests(GateCase):
    """验证密钥规则变更需要额外复核回执。"""

    def run_team_scanner(self, comments, event=None, extra=TEAM_ARGS):
        """以团队模式检查密钥规则变更及额外签收。"""
        return self.run_gate(
            event=event or make_event(author=AUTHOR),
            comments=[team_receipt(), *comments],
            reviews=[review(21, "APPROVED")],
            mode="team",
            extra=extra,
            paths=SCANNER_PATHS,
        )

    def test_solo_scanner_change_requires_security_receipt(self):
        """验证单维护者场景的扫描规则变更必须有额外回执。"""
        outcome = self.run_gate(comments=[comment(11, receipt())], paths=SCANNER_PATHS)
        result = self.assert_status(outcome, "fail", "missing_evidence")
        self.assertTrue(result["scanner_rules_changed"])
        self.assertEqual(result["required"], ["pass", SECURITY])
        self.assertEqual(result["missing"], [SECURITY])

    def test_solo_scanner_change_with_owner_security_receipt_passes(self):
        """验证规则变更可凭同一版本的复核回执通过。"""
        comments = [
            comment(11, receipt()),
            comment(12, receipt(kind=SECURITY, review="ruleset-review-9")),
        ]
        outcome = self.run_gate(comments=comments, paths=SCANNER_PATHS)
        result = self.assert_status(outcome, "pass")
        self.assertEqual(
            result["evidence"],
            [
                {"type": "pass", "comment_id": 11},
                {"type": SECURITY, "comment_id": 12},
            ],
        )

    def test_security_receipt_must_match_pr_head_and_base(self):
        """验证规则复核回执须同时绑定 PR、head 和基线。"""
        stale = {
            "other head": receipt(kind=SECURITY, head=NEW_HEAD),
            "other base": receipt(kind=SECURITY, base=NEW_BASE),
            "other pr": receipt(kind=SECURITY, pr=PR_NUMBER + 1),
        }
        for label, body in stale.items():
            with self.subTest(label):
                comments = [comment(11, receipt()), comment(12, body)]
                outcome = self.run_gate(comments=comments, paths=SCANNER_PATHS)
                result = self.assert_status(outcome, "fail", "missing_evidence")
                self.assertEqual(result["missing"], [SECURITY])

    def test_newest_commit_requires_new_security_receipt(self):
        """验证新提交后需要重新签收规则复核。"""
        comments = [
            comment(11, receipt(head=NEW_HEAD)),
            comment(12, receipt(kind=SECURITY)),
        ]
        outcome = self.run_gate(
            event=make_event(head=NEW_HEAD),
            comments=comments,
            parents=(BASE, NEW_HEAD),
            paths=SCANNER_PATHS,
        )
        result = self.assert_status(outcome, "fail", "missing_evidence")
        self.assertEqual(result["missing"], [SECURITY])

    def test_security_receipt_from_spoofed_owner_is_rejected(self):
        """验证非真实所有者不能签收密钥规则复核。"""
        comments = [
            comment(11, receipt()),
            comment(12, receipt(kind=SECURITY), user=dict(OWNER, type="Bot")),
        ]
        outcome = self.run_gate(comments=comments, paths=SCANNER_PATHS)
        self.assert_status(outcome, "fail", "missing_evidence")

    def test_unrelated_changes_do_not_require_security_receipt(self):
        """验证普通变更只需要常规复核签收。"""
        outcome = self.run_gate(
            comments=[comment(11, receipt())], paths=SIMILAR_PATHS + ("src/app.py",)
        )
        result = self.assert_status(outcome, "pass")
        self.assertFalse(result["scanner_rules_changed"])
        self.assertEqual(result["required"], ["pass"])

    def test_team_scanner_change_needs_independent_security_receipt(self):
        """验证团队场景规则复核须由独立授权维护者签收。"""
        body = receipt(kind=SECURITY)
        cases = {
            "no attestation": ([], "fail"),
            "pr author": ([comment(12, body, user=AUTHOR, association="MEMBER")], "fail"),
            "unlisted member": (
                [comment(12, body, user=OUTSIDER, association="MEMBER")],
                "fail",
            ),
            "independent maintainer": (
                [comment(12, body, user=SECOND_MAINTAINER, association="MEMBER")],
                "pass",
            ),
        }
        for label, (comments, status) in cases.items():
            with self.subTest(label):
                result = self.assert_status(self.run_team_scanner(comments), status)
                self.assertEqual(result["required"], ["approval", SECURITY])

    def test_team_owner_who_authored_pr_cannot_attest_scanner_change(self):
        """验证团队场景中所有者也不能签收自己提交的规则变更。"""
        outcome = self.run_team_scanner(
            [comment(12, receipt(kind=SECURITY))],
            event=make_event(author=OWNER),
            extra=TEAM_ARGS + ("--maintainer", "repo-owner"),
        )
        result = self.assert_status(outcome, "fail", "missing_evidence")
        self.assertEqual(result["missing"], [SECURITY])

    def test_extra_scanner_path_prefix(self):
        """验证显式扫描规则路径可纳入额外复核范围。"""
        outcome = self.run_gate(
            comments=[comment(11, receipt())],
            paths=("config/rules/secrets.yml",),
            extra=("--scanner-path", "config/rules/"),
        )
        result = self.assert_status(outcome, "fail", "missing_evidence")
        self.assertEqual(result["missing"], [SECURITY])

    def test_is_scanner_path(self):
        """验证受规则复核约束的路径匹配边界。"""
        self.assertEqual(
            gate.load_rules_scope(), frozenset({*SCANNER_PATHS, RULES_SCOPE_FILE})
        )
        for path in (*SCANNER_PATHS, RULES_SCOPE_FILE):
            with self.subTest(path=path):
                self.assertTrue(gate.is_scanner_path(path))
        for path in SIMILAR_PATHS + ("src/app.py",):
            with self.subTest(path=path):
                self.assertFalse(gate.is_scanner_path(path))
        self.assertTrue(gate.is_scanner_path("config/rules/a.yml", ["config/rules"]))
        self.assertTrue(gate.is_scanner_path("config/rules", ["config/rules/"]))
        self.assertFalse(gate.is_scanner_path("config/rulesx/a.yml", ["config/rules"]))


class GitReaderTests(unittest.TestCase):
    """用合成 Git 输出验证父提交与中文路径解析。"""

    def make_reader(self, output):
        """创建记录调用参数的 Git 查询测试替身。"""
        calls = []

        def runner(command):
            """记录 Git 查询并提供预设的进程输出。"""
            calls.append(list(command))
            return output

        return gate.GitReader("/synthetic/repo", runner=runner), calls

    def test_merge_parents_from_rev_list(self):
        """验证从标准 Git 输出读取合并父提交。"""
        reader, calls = self.make_reader(f"{MERGE} {BASE} {HEAD}\n".encode("ascii"))
        self.assertEqual(reader.merge_parents(MERGE), (BASE, HEAD))
        self.assertEqual(calls[0][:3], ["git", "-C", "/synthetic/repo"])
        self.assertIn("--parents", calls[0])

    def test_merge_parents_reject_unexpected_output(self):
        """验证异常的父提交输出无法用作受验证据。"""
        outputs = [
            b"",
            f"{NEW_HEAD} {BASE} {HEAD}\n".encode("ascii"),
            f"{MERGE} not-a-sha\n".encode("ascii"),
            b"\xff\xfe",
        ]
        for output in outputs:
            with self.subTest(output=output):
                reader, _ = self.make_reader(output)
                with self.assertRaises(gate.GateError):
                    reader.merge_parents(MERGE)

    def test_changed_paths_split_on_nul(self):
        """验证文件差异按空字节分隔以保留路径中的空格。"""
        reader, calls = self.make_reader(b"tools/scanner/rules.yml\0docs/read me.md\0")
        self.assertEqual(
            reader.changed_paths(BASE, MERGE),
            ("tools/scanner/rules.yml", "docs/read me.md"),
        )
        self.assertIn("-z", calls[0])
        self.assertIn("--no-renames", calls[0])
        self.assertEqual(calls[0][-3:], [BASE, MERGE, "--"])


if __name__ == "__main__":
    unittest.main()
