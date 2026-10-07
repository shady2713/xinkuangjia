"""验证裁决 D16 的 ``E1-code-identity`` 严格比较分支与合入前置正负对照。

本文件同时做两件事：

1. **单元口径**：可靠词法切分、登记变换集的逐项复算、规范序列化的边界、
   非空判定、注释/署名单独校验；
2. **真实消费者对照**：全部对照都跑真实 CLI——分支入口
   ``check_staged_java_comments.py --validate-evidence-branches``、暂存入口
   ``check_staged_java_comments.py``、全量入口 ``check_full_java_comments.py``
   与 ``run_checks.py --group comments``——保留真实退出码与真实诊断，
   不以单元断言代替门禁结果。

对照输入全部在隔离 Git 仓库与临时证据目录中构造，不读取本机 ``.bf-local``，
不修改真实索引、源码、签名或暂存区，也不改判任何真实记录。

@author OpenAI Codex
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.code.java import check_staged_java_comments as java
from scripts.common.quality_common import DEFAULT_ROOT
from scripts.tests.git_sandbox import GitSandbox, create_sandbox

REPO = Path("/home/weetion/桌面/kuangjia")
UPSTREAM_REPO = "YunaiV/ruoyi-vue-pro"
UPSTREAM_COMMIT = "ac022b15a094cf9cf82903d429b9729e72309da5"
UPSTREAM_PATH = (
    "yudao-framework/yudao-common/src/main/java/cn/iocoder/yudao/framework/demo/IdentityDemo.java"
)
LOCAL_PATH = (
    "后端代码/basic-framework-boot/basic-framework-core/basic-framework-common/"
    "src/main/java/com/basicframework/framework/demo/IdentityDemo.java"
)
LOCAL_CLASS = "BasicFrameworkWebAutoConfiguration"
UPSTREAM_CLASS = "YudaoWebAutoConfiguration"
QUALIFIED_NAME = f"com.basicframework.framework.demo.{LOCAL_CLASS}"
TRANSFORM_SET_RELATIVE = java.DEFAULT_CODE_IDENTITY_TRANSFORM_SET
REPO_TRANSFORM_SET = DEFAULT_ROOT / TRANSFORM_SET_RELATIVE
SCHEMA = java.CODE_IDENTITY_SCHEMA
BRANCH = java.EVIDENCE_BRANCH_CODE_IDENTITY
ROUTE = java.CODE_IDENTITY_ROUTE

REGISTRY_COLUMNS = (
    "local_path",
    "local_sha256_after",
    "upstream_repo_url",
    "upstream_path",
    "upstream_commit",
    "upstream_file_url",
    "upstream_sha256",
    "upstream_author_lines",
    "history_basis",
    "evidence_route",
    "evidence_points",
    "author_status",
    "local_modification_facts",
    "open_gap",
    "review_by",
    "review_date",
    "review_conclusion",
    "type_evidence",
    "d12_verdict",
    "d12_blocker_reason",
    "d12_correspondence_points",
    "evidence_branch",
    "code_identity_contract",
)


def digest(value: str) -> str:
    """返回文本的 SHA-256。"""

    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def upstream_source(
    *,
    prefix: str = "yudao.api-encrypt",
    class_name: str = UPSTREAM_CLASS,
    imports: tuple[str, ...] = (
        "javax.validation.constraints.NotNull",
        "java.util.List",
    ),
    extra_body: str = "",
    method_name: str = "names",
    label: str = "a b",
) -> str:
    """生成固定上游文件正文；各参数用于构造针对性反例。"""

    lines = ["package cn.iocoder.yudao.framework.demo;", ""]
    lines.extend(f"import {item};" for item in imports)
    lines.extend(
        [
            "",
            "/**",
            " * 演示代码同一性分支的固定上游文件。",
            " *",
            " * 该固定提交未声明作者。",
            " */",
            f"public class {class_name} {{",
            "",
            f'    public static final String PREFIX = "{prefix}";',
            f'    public static final String LABEL = "{label}";',
            "",
            "    @NotNull",
            f"    public List<String> {method_name}(List<String> source) {{",
            f"        return source;{extra_body}",
            "    }",
            "}",
            "",
        ]
    )
    return "\n".join(lines)


def local_source(
    *,
    prefix: str = "basic-framework.api-encrypt",
    class_name: str = LOCAL_CLASS,
    imports: tuple[str, ...] = (
        "java.util.List",
        "jakarta.validation.constraints.NotNull",
    ),
    javadoc: str | None = None,
    body: str = "",
    method_name: str = "names",
    label: str = "a b",
) -> str:
    """生成本地文件正文；代码流必须与 ``upstream_source`` 变换后逐字节相同。"""

    lines = ["package com.basicframework.framework.demo;", ""]
    lines.extend(f"import {item};" for item in imports)
    lines.extend(["", javadoc if javadoc is not None else local_javadoc(), f"public class {class_name} {{", ""])
    lines.extend(
        [
            f'    public static final String PREFIX = "{prefix}";',
            f'    public static final String LABEL = "{label}";',
            "",
            METHOD_JAVADOC,
            "    @NotNull",
            f"    public List<String> {method_name}(List<String> source) {{",
            f"        return source;{body}",
            "    }",
            "}",
            "",
        ]
    )
    return "\n".join(lines)


METHOD_JAVADOC = """    /**
     * 返回名称列表。
     *
     * @param source 名称来源
     * @return 名称列表
     */"""


def local_javadoc(
    *,
    author_line: str | None = None,
    marker: str = java.SOURCE_REVIEW_ACCEPTED_MARKER,
) -> str:
    """生成职责 JavaDoc + D12 来源说明 + D15 就地标注（含可选署名行）。"""

    body = [
        "/**",
        " * 演示代码同一性分支的本地类型。",
        " *",
        f" * {java.SOURCE_HEADER_PREFIX}{UPSTREAM_REPO} @ {UPSTREAM_COMMIT}"
        f"{java.SOURCE_DECLARATION_SUFFIX}",
        f" * {java.SOURCE_PATH_PREFIX}{UPSTREAM_PATH}",
        f" * {java.SOURCE_BASIS_FIXED}",
        " * 本地修改：调整包名、类型名、Jakarta 导入与配置前缀。",
    ]
    if author_line is not None:
        body.append(f" * {author_line}")
    body.append(" *")
    body.append(f" * {marker}")
    body.append(" */")
    return "\n".join(body)


def type_evidence_value(source: str) -> str:
    """生成逐类型映射，绑定当前 JavaDoc 指纹。"""

    start = source.index("/**")
    javadoc = source[start : source.index("*/", start) + 2]
    entry = {
        "qualified_name": QUALIFIED_NAME,
        "simple_name": LOCAL_CLASS,
        "kind": "class",
        "nested": False,
        "enclosing_type": None,
        "upstream_type": f"cn.iocoder.yudao.framework.demo.{UPSTREAM_CLASS}",
        "upstream_author_declared": False,
        "javadoc_sha256": digest(javadoc),
        "review_by": "D16 严格比较对照测试",
        "review_date": "2026-10-07",
        "review_conclusion": f"逐项复核 {LOCAL_CLASS}：来源、指纹与无作者结论一致。",
    }
    return json.dumps(
        {"schema": java.EVIDENCE_SCHEMA, "types": [entry]}, ensure_ascii=False
    )


def correspondence_points() -> str:
    """生成路线 2 使用的 P1 内容点登记（路线 3 才要求两点）。"""

    return json.dumps(
        [
            {
                "kind": "P1 内容点（共享有区分力字符串字面量）",
                "fragment": "basic-framework.api-encrypt",
                "local_lines": [16],
                "upstream_lines": [13],
                "discrimination_reason": "共享有区分力配置前缀字面量，属具体业务事实，非通用形状",
                "corpus_binding": (
                    f"上游固定快照 {UPSTREAM_COMMIT} 语料；该片段在本文件出现 1 次，df=1"
                ),
            }
        ],
        ensure_ascii=False,
    )


def measure(local: str, remote: str, transform_set: dict | None = None) -> dict:
    """用登记变换集实测双方代码流读数。"""

    transforms = (transform_set or json.loads(REPO_TRANSFORM_SET.read_text(encoding="utf-8")))["transforms"]
    return {
        "local": java._code_identity_stream(local, transforms, "local"),
        "upstream": java._code_identity_stream(remote, transforms, "upstream"),
    }


def build_contract(
    local: str,
    remote: str,
    *,
    transform_set_document: dict,
    transform_set_path: Path,
    route: str = ROUTE,
    applied_transforms: list[str] | None = None,
    comment_bindings: list[dict] | None = None,
    difference_attribution: list[dict] | None = None,
    author_handling: dict | None = None,
    tool_sha256: str | None = None,
) -> str:
    """按实测读数生成合法的 ``E1-code-identity`` 比较契约 JSON。"""

    streams = measure(local, remote, transform_set_document)
    local_stream, upstream_stream = streams["local"], streams["upstream"]
    equal = (
        local_stream["serialized"] == upstream_stream["serialized"]
        and local_stream["import_count"] == upstream_stream["import_count"]
    )
    if difference_attribution is None:
        left, right = java._code_identity_diff_lines(local, remote)
        difference_attribution = (
            [
                {
                    "cause": "d12-source-note",
                    "rule": "D12 来源说明正文",
                    "local_lines": [8, 13],
                    "upstream_lines": [8],
                    "changed_lines": {"local": left, "upstream": right},
                }
            ]
            if (left or right)
            else []
        )
    if comment_bindings is None:
        comment_bindings = default_comment_bindings(local)
    contract = {
        "schema": SCHEMA,
        "branch": BRANCH,
        "route": route,
        "rules_version": java.CODE_IDENTITY_RULES_VERSION,
        "serialization": {
            "version": java.CODE_IDENTITY_SERIALIZATION,
            "encoding": "utf-8",
            "token_separator": "U+001F",
            "token_terminator": "U+001E",
        },
        "transform_set": {
            "path": TRANSFORM_SET_RELATIVE,
            "sha256": hashlib.sha256(transform_set_path.read_bytes()).hexdigest(),
            "transforms_sha256": transform_set_document["transforms_sha256"],
            "normalizations_sha256": transform_set_document["normalizations_sha256"],
            "rules_version": java.CODE_IDENTITY_RULES_VERSION,
        },
        "applied_transforms": applied_transforms
        if applied_transforms is not None
        else list(transform_set_document["execution_order"]),
        "inputs": {
            "local": {"path": LOCAL_PATH, "sha256": digest(local)},
            "upstream": {
                "repo_url": f"https://github.com/{UPSTREAM_REPO}.git",
                "commit": UPSTREAM_COMMIT,
                "path": UPSTREAM_PATH,
                "sha256": digest(remote),
                "file_url": f"https://github.com/{UPSTREAM_REPO}/blob/{UPSTREAM_COMMIT}/{UPSTREAM_PATH}",
            },
        },
        "comparison": {
            "equal": equal,
            "diff_count": 0 if equal else 1,
            "local_code_stream_sha256": local_stream["sha256"],
            "upstream_code_stream_sha256": upstream_stream["sha256"],
            "local_code_bytes": local_stream["bytes"],
            "upstream_code_bytes": upstream_stream["bytes"],
            "local_token_count": local_stream["token_count"],
            "upstream_token_count": upstream_stream["token_count"],
            "import_count_local": local_stream["import_count"],
            "import_count_upstream": upstream_stream["import_count"],
        },
        "difference_attribution": difference_attribution,
        "comment_bindings": comment_bindings,
        "author_handling": author_handling
        if author_handling is not None
        else {
            "code_identity_accepts_signature": False,
            "declared_author_status": java.AUTHOR_UNDECLARED_STATUS,
            "author_route": "D12 来源说明例外：上游该固定提交未声明作者，本地按 D12 格式说明来源",
            "note": "代码同一只覆盖代码流；注释与署名仍按 D12/D15 各自规则验收",
        },
        "tool": {
            "name": "check_staged_java_comments.py",
            "version": SCHEMA,
            "sha256": tool_sha256
            if tool_sha256 is not None
            else hashlib.sha256(
                (DEFAULT_ROOT / "scripts/code/java/check_staged_java_comments.py").read_bytes()
            ).hexdigest(),
        },
        "review": {
            "implementer": "D16 严格比较实施",
            "reviewer": "D16 严格比较对照测试",
            "date": "2026-10-07",
            "conclusion": "完整非空代码流在登记变换集下逐字节相同，差异全部可归因",
        },
        "counter_evidence_conclusion": "已复核本地补充注释、D12 来源说明与 D15 标注之外没有其他代码差异",
    }
    return json.dumps(contract, ensure_ascii=False)


def javadoc_span(lines: list[str]) -> tuple[int, int]:
    """返回文件第一段 JavaDoc 的 1 起起止行号。"""

    start = next(index for index, line in enumerate(lines, 1) if line.startswith("/**"))
    end = next(index for index, line in enumerate(lines, 1) if index > start and line.strip() == "*/")
    return start, end


def default_comment_bindings(local: str) -> list[dict]:
    """按实测行区间登记「职责 JavaDoc + D12 来源说明 + D15 标注」的保持不变绑定。

    行区间按**内容**定位（而不是写死偏移），保证登记值与本地真实注释逐字一致；
    判定逻辑因此真的在做实测比对，而不是把登记值抄回去。

    """

    lines = local.split("\n")
    start, end = javadoc_span(lines)
    body = [java._comment_body_line(line) for line in lines]

    def block(first: int, last: int) -> dict[str, str]:
        """按 1 起闭区间取出本地真实注释原文，并给出其逐字指纹。"""

        verbatim = "\n".join(lines[first - 1 : last])
        return {"lines": [first, last], "text": verbatim, "sha256": digest(verbatim)}

    note_start = next(
        (
            index
            for index in range(start, end)
            if body[index - 1].startswith(java.SOURCE_HEADER_PREFIX)
        ),
        None,
    )
    marker = next(
        index
        for index in range(start, end)
        if body[index - 1].strip()
        in (
            java.SOURCE_REVIEW_UNACCEPTED_MARKER,
            java.SOURCE_REVIEW_ACCEPTED_MARKER,
            java.SIGNATURE_REVIEW_UNACCEPTED_MARKER,
            java.SIGNATURE_REVIEW_ACCEPTED_MARKER,
        )
    )
    if note_start is None:
        # 作者标签形态没有 D12 来源说明：只登记职责 JavaDoc 与就地署名标注。
        return [
            {"role": "responsibility-javadoc", **block(start, marker - 2)},
            {"role": "d15-inplace-marker", **block(marker, marker)},
        ]
    note_end = next(
        index
        for index in range(note_start, end)
        if body[index - 1].startswith("本地修改：")
    )
    return [
        {"role": "responsibility-javadoc", **block(start, note_start - 2)},
        {"role": "d12-source-note", **block(note_start, note_end)},
        {"role": "d15-inplace-marker", **block(marker, marker)},
    ]


def evidence_record(
    local: str,
    remote: str,
    *,
    contract: str,
    route: str = ROUTE,
    branch: str = BRANCH,
    verdict: str = java.SOURCE_NOTE_ACCEPTED_VERDICTS[0],
    blocker_reason: str = "",
    author_status: str = java.AUTHOR_UNDECLARED_STATUS,
) -> dict[str, str]:
    """构造声明 ``E1-code-identity`` 分支的受控清单记录。"""

    return {
        "local_path": LOCAL_PATH,
        "local_sha256_after": digest(local),
        "upstream_repo_url": f"https://github.com/{UPSTREAM_REPO}.git",
        "upstream_path": UPSTREAM_PATH,
        "upstream_commit": UPSTREAM_COMMIT,
        "upstream_file_url": f"https://github.com/{UPSTREAM_REPO}/blob/{UPSTREAM_COMMIT}/{UPSTREAM_PATH}",
        "upstream_sha256": digest(remote),
        "upstream_author_lines": "",
        "history_basis": "引入提交未知，本行以固定见证版本作来源见证。",
        "evidence_route": route,
        "evidence_points": correspondence_points(),
        "author_status": author_status,
        "local_modification_facts": "调整包名、类型名、Jakarta 导入与配置前缀。",
        "open_gap": "上游该版本未声明作者；历史引入版本未核实。",
        "review_by": "D16 严格比较对照测试",
        "review_date": "2026-10-07",
        "review_conclusion": f"逐项复核 {LOCAL_CLASS}：来源、指纹与无作者结论一致。",
        "type_evidence": type_evidence_value(local),
        "d12_verdict": verdict,
        "d12_blocker_reason": blocker_reason,
        "d12_correspondence_points": correspondence_points(),
        "evidence_branch": branch,
        "code_identity_contract": contract,
    }


def write_registry(path: Path, records: list[dict[str, str]]) -> Path:
    """写出 TSV 形式的受控清单。"""

    lines = ["\t".join(REGISTRY_COLUMNS)]
    lines.extend(
        "\t".join(str(item.get(name, "")) for name in REGISTRY_COLUMNS) for item in records
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def write_json_index(path: Path, record: dict[str, str]) -> Path:
    """写出受控派生索引（声明 schema，因此消费者必须消费验收状态）。"""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "index_schema": java.EVIDENCE_INDEX_SCHEMA,
                "manifest": {"selected_records": 1, "note": "D16 严格比较对照夹具"},
                "records": [record],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return path


def write_snapshot(root: Path, content: str) -> Path:
    """写出固定提交的受控上游快照。"""

    target = root / f"ruoyi-vue-pro@{UPSTREAM_COMMIT}" / UPSTREAM_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return target


WEB_FIXTURE = "前端代码/basic-framework-admin/apps/web-ele/src/App.vue"
WEB_SOURCE = (
    "<!-- 应用入口组件：run_checks --group comments 需要至少一个受管 Web 文件。 -->\n"
    "<template>\n  <div>ok</div>\n</template>\n"
)


def seed_sandbox_tools(sandbox: GitSandbox) -> None:
    """让隔离仓库具备工作区入口与 Web 全量入口所需的最小结构。

    ``run_checks.py --group comments`` 会真实调度全部子检查；缺少规则实现或受管
    Web 文件会被如实记为 environment-error，与本轮对照无关。

    """

    (sandbox.root / "scripts").symlink_to(DEFAULT_ROOT / "scripts", target_is_directory=True)
    web = sandbox.root / WEB_FIXTURE
    web.parent.mkdir(parents=True, exist_ok=True)
    web.write_text(WEB_SOURCE, encoding="utf-8")


def run_checker(
    sandbox: GitSandbox,
    script: str,
    *args: str,
    extra_env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    """以真实 Python CLI 检查隔离仓库，保留真实退出码与诊断。"""

    env = dict(sandbox.env)
    env.pop(java.EVIDENCE_REGISTRY_ENV, None)
    env.pop(java.EVIDENCE_SNAPSHOTS_ENV, None)
    env.pop(java.CODE_IDENTITY_TRANSFORM_SET_ENV, None)
    env["PYTHONIOENCODING"] = "utf-8"
    if extra_env:
        env.update(extra_env)
    return subprocess.run(
        [sys.executable, "-B", "-X", "utf8", str(DEFAULT_ROOT / script), *args],
        cwd=sandbox.root,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=300,
    )


def run_branch_entry(
    sandbox: GitSandbox,
    registry: Path,
    snapshots: Path,
    *,
    transform_set: Path | None = None,
    root: Path | None = None,
) -> subprocess.CompletedProcess[str]:
    """运行真实的分支复算入口。"""

    arguments = [
        "--validate-evidence-branches",
        "--evidence-registry",
        str(registry),
        "--evidence-snapshots",
        str(snapshots),
        "--json",
    ]
    if transform_set is not None:
        arguments.extend(["--code-identity-transform-set", str(transform_set)])
    arguments.extend(["--code-identity-root", str(root if root is not None else sandbox.root)])
    return run_checker(
        sandbox, "scripts/code/java/check_staged_java_comments.py", *arguments
    )


def run_full_entry(
    sandbox: GitSandbox,
    registry: Path,
    snapshots: Path,
    *,
    transform_set: Path | None = None,
    maintenance: bool = False,
    json_index: Path | None = None,
) -> subprocess.CompletedProcess[str]:
    """运行真实的全量入口。

    ``json_index`` 非空时改用受控派生索引（声明 schema，强制消费验收状态），
    这与真实仓库当前的输入形态一致。

    """

    arguments = ["--root", str(sandbox.root)]
    if json_index is None:
        arguments.extend(["--evidence-registry", str(registry)])
    else:
        arguments.extend(["--evidence-registry", str(json_index)])
    arguments.extend(["--evidence-snapshots", str(snapshots), "--json"])
    if transform_set is not None:
        arguments.extend(["--code-identity-transform-set", str(transform_set)])
    if maintenance:
        arguments.append("--maintenance")
    return run_checker(
        sandbox,
        "scripts/code/java/check_full_java_comments.py",
        *arguments,
        extra_env=(
            {java.CODE_IDENTITY_TRANSFORM_SET_ENV: str(transform_set)}
            if transform_set is not None
            else None
        ),
    )


def run_run_checks(
    sandbox: GitSandbox,
    *,
    transform_set: Path | None = None,
    maintenance: bool = False,
) -> subprocess.CompletedProcess[str]:
    """运行真实的 ``run_checks.py --group comments`` 汇总入口。"""

    env = dict(sandbox.env)
    env.pop(java.EVIDENCE_REGISTRY_ENV, None)
    env.pop(java.EVIDENCE_SNAPSHOTS_ENV, None)
    env.pop(java.CODE_IDENTITY_TRANSFORM_SET_ENV, None)
    env["PYTHONIOENCODING"] = "utf-8"
    env["GIT_OPTIONAL_LOCKS"] = "0"
    # 只读复核：把索引复制到调用方私有的临时位置，并让本次汇总全程使用它。
    # 子检查（如 `git diff`）会刷新索引的 stat 缓存；那属于 Git 的锁行为而不是
    # 检查结果，若写到隔离仓库的真实索引上，前后证据快照会无谓地不相等。
    private_index = sandbox.root.parent / f"private-index-{os.getpid()}"
    shutil.copyfile(sandbox.root / ".git" / "index", private_index)
    env["GIT_INDEX_FILE"] = str(private_index)
    # 先刷新这份私有索引的 stat 缓存：否则子检查里的 `git diff` 会在汇总前后
    # 各写一次索引，前后证据快照就会因为 Git 自身行为而不同。
    subprocess.run(
        ["git", "update-index", "--refresh"],
        cwd=sandbox.root,
        env=env,
        capture_output=True,
        check=False,
    )
    if transform_set is not None:
        env[java.CODE_IDENTITY_TRANSFORM_SET_ENV] = str(transform_set)
    arguments = [sys.executable, "-B", "-X", "utf8", str(DEFAULT_ROOT / "scripts/workflow/run_checks.py")]
    arguments.extend(["--root", str(sandbox.root), "--group", "comments", "--json"])
    if maintenance:
        arguments.append("--maintenance")
    return subprocess.run(
        arguments,
        cwd=sandbox.root,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=600,
    )
    private_index.unlink(missing_ok=True)


class Case:
    """一次对照所需的隔离夹具。"""

    def __init__(
        self,
        sandbox: GitSandbox,
        registry: Path,
        snapshots: Path,
        transform_set: Path,
        record: dict[str, str],
        remote: str,
        json_index: Path,
    ) -> None:
        """登记一次对照所需的全部隔离输入，供各真实入口按需取用。"""

        self.sandbox = sandbox
        self.registry = registry
        self.snapshots = snapshots
        self.transform_set = transform_set
        self.record = record
        self.remote = remote
        self.json_index = json_index

    def restage(self, source: str) -> None:
        """在基线之上重新暂存本地对象，供真实暂存入口看到增量差异。"""

        self.sandbox.stage(LOCAL_PATH, source)


def prepare(
    tmp_path: Path,
    *,
    local: str,
    remote: str | None = None,
    contract_local: str | None = None,
    contract_remote: str | None = None,
    route: str = ROUTE,
    branch: str = BRANCH,
    verdict: str = java.SOURCE_NOTE_ACCEPTED_VERDICTS[0],
    blocker_reason: str = "",
    contract_kwargs: dict | None = None,
    transform_set_text: str | None = None,
    transform_set_path: Path | None = None,
    author_status: str = java.AUTHOR_UNDECLARED_STATUS,
    staged: str | None = None,
    baseline_local: str | None = None,
) -> Case:
    """构造一条完整的隔离对照夹具：本地对象、上游快照、清单与变换集。"""

    remote = remote if remote is not None else upstream_source()
    sandbox = create_sandbox(tmp_path / "repository")
    seed_sandbox_tools(sandbox)
    baseline = baseline_local if baseline_local is not None else local
    sandbox.stage(LOCAL_PATH, baseline)
    target = sandbox.root / LOCAL_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(baseline, encoding="utf-8")
    sandbox.record_baseline()
    if local != baseline:
        sandbox.stage(LOCAL_PATH, local)
        target.write_text(local, encoding="utf-8")
    if staged is not None and staged != local:
        sandbox.stage(LOCAL_PATH, staged)
        target.write_text(staged, encoding="utf-8")

    transform_set = tmp_path / "transform-set.json"
    if transform_set_text is None:
        shutil.copyfile(REPO_TRANSFORM_SET, transform_set)
    else:
        transform_set.write_text(transform_set_text, encoding="utf-8")
    document = json.loads(transform_set.read_text(encoding="utf-8"))

    contract = build_contract(
        contract_local if contract_local is not None else local,
        contract_remote if contract_remote is not None else remote,
        transform_set_document=document,
        transform_set_path=transform_set if transform_set_path is None else transform_set_path,
        route=route,
        **(contract_kwargs or {}),
    )
    record = evidence_record(
        local,
        remote,
        contract=contract,
        route=route,
        branch=branch,
        verdict=verdict,
        blocker_reason=blocker_reason,
        author_status=author_status,
    )
    # 受控清单同时以显式路径与仓内默认路径提供：前者供直接指定参数的真实入口，
    # 后者让 run_checks 的 evidence_environment(root) 解析到同一份输入。
    snapshots = sandbox.root / java.DEFAULT_EVIDENCE_SNAPSHOTS
    write_snapshot(snapshots, remote)
    registry = write_registry(tmp_path / "registry.tsv", [record])
    write_json_index(sandbox.root / java.DEFAULT_EVIDENCE_REGISTRY, record)
    return Case(
        sandbox,
        registry,
        snapshots,
        transform_set,
        record,
        remote,
        sandbox.root / java.DEFAULT_EVIDENCE_REGISTRY,
    )


def tamper_transform_set(tmp_path: Path, mutate) -> tuple[Path, dict]:
    """复制受控变换集并改写其中一条变换定义，返回新路径与新文档。"""

    document = json.loads(REPO_TRANSFORM_SET.read_text(encoding="utf-8"))
    mutate(document)
    document["transforms_sha256"] = hashlib.sha256(
        json.dumps(document["transforms"], ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    target = tmp_path / "tampered-transform-set.json"
    target.write_text(json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return target, document


# ───────────────────────────── 单元口径 ─────────────────────────────


def test_repository_transform_set_is_registered_and_recomputable() -> None:
    """仓内变换集清单必须自洽、可被规则实现逐项复算。"""

    document, error = java._load_code_identity_transform_set(str(REPO_TRANSFORM_SET))
    assert error is None, error
    assert document is not None
    assert document["schema"] == java.CODE_IDENTITY_TRANSFORM_SET_SCHEMA
    assert document["branch"] == BRANCH and document["route"] == ROUTE
    assert document["execution_order"] == ["T1", "T2", "T3", "T4", "T5"]
    assert document["comparison_order"] == ["N1", "T1", "T2", "T3", "T4", "T5"]
    assert document["file_sha256"] == hashlib.sha256(REPO_TRANSFORM_SET.read_bytes()).hexdigest()
    operations = {item["id"]: item["operation"] for item in document["transforms"]}
    assert operations == {
        "T1": "qualified-name-prefix-map",
        "T2": "exact-name-map",
        "T3": "exact-simple-name-map",
        "T4": "exact-string-literal-map",
        "T5": "import-group-canonical-sort",
    }
    # 本分支不授权删除 import、折叠字面量内空白或无边界全文替换。
    serialized = REPO_TRANSFORM_SET.read_text(encoding="utf-8")
    assert "strip" not in serialized and "delete-import" not in serialized


def test_tokenizer_keeps_literals_and_comment_but_never_glues_tokens() -> None:
    """去注释不得粘连 token；字面量内部空白与转义必须逐字保留。"""

    tokens, errors = java._code_identity_code_tokens(
        'String a = "x  y";\n// note\nString b = a/**/.length() + \'\\\'\';\n'
    )
    assert errors == []
    texts = [item[1] for item in tokens]
    assert '"x  y"' in texts, texts
    assert "note" not in texts and texts.count(".") == 1, texts
    assert "a" in texts and "length" in texts, texts


def test_tokenizer_rejects_unreliable_lexing_instead_of_guessing() -> None:
    """未闭合字面量与代码位置 Unicode 转义必须受控拒绝。"""

    for source, expected in (
        ('String a = "unterminated;', "未闭合"),
        ("String a = /* unterminated", "块注释"),
        ("String a = \\u0041;", "Unicode 转义"),
    ):
        _, errors = java._code_identity_code_tokens(source)
        assert errors and expected in errors[0], (source, errors)


def test_serialization_cannot_forge_boundaries() -> None:
    """规范序列化必须让不同 token 序列得到不同字节。"""

    left = java._code_identity_serialize([["ident", "a", "1"], ["op", ".", "1"], ["ident", "b", "1"]])
    right = java._code_identity_serialize([["ident", "ab", "1"]])
    assert left != right
    joined = java._code_identity_serialize([["ident", "a", "1"], ["ident", "b", "1"]])
    assert joined != right
    _, errors = java._code_identity_code_tokens('String a = "\x1f";')
    assert errors and "控制字符" in errors[0]


def test_registered_transforms_are_token_scoped_not_textual() -> None:
    """T1 只按完整路径段匹配；T4 只改写整条登记字面量。"""

    transforms = json.loads(REPO_TRANSFORM_SET.read_text(encoding="utf-8"))["transforms"]
    glued, _ = java._code_identity_code_tokens("package cn.iocoder.yudaoauth.demo;")
    after = java._code_identity_apply_transform(glued, transforms[0])
    assert [item[1] for item in after] == [
        "package",
        "cn.iocoder.yudaoauth.demo",
        ";",
    ], after
    exact, _ = java._code_identity_code_tokens("package cn.iocoder.yudao.framework.demo;")
    assert [item[1] for item in java._code_identity_apply_transform(exact, transforms[0])] == [
        "package",
        "com.basicframework.framework.demo",
        ";",
    ], exact
    literal, _ = java._code_identity_code_tokens('String a = "prefix yudao.xss.enable suffix";')
    after = java._code_identity_apply_transform(literal, transforms[3])
    texts = [item[1] for item in after]
    assert '"prefix yudao.xss.enable suffix"' in texts, texts
    # 表外的整条字面量（这里是属性占位符形式）不在登记范围内，必须原样保留。
    placeholder, _ = java._code_identity_code_tokens('@Value("${yudao.xss.enable}")')
    assert '"${yudao.xss.enable}"' in [item[1] for item in placeholder], placeholder
    comment, _ = java._code_identity_code_tokens("// cn.iocoder.yudao.framework\nint a = 1;")
    assert "cn.iocoder.yudao.framework" not in [item[1] for item in comment]


def test_imports_are_preserved_and_wildcards_are_not_equivalent() -> None:
    """T5 只排序不删除；通配符与显式导入集不能按本分支同一化。"""

    transforms = json.loads(REPO_TRANSFORM_SET.read_text(encoding="utf-8"))["transforms"]
    source = "import java.util.Set;\nimport java.util.List;\nclass A {}\n"
    kept, _ = java._code_identity_code_tokens(source)
    assert [item[1] for item in kept][:2] == ["import", "java.util.Set"]
    sorted_stream = java._code_identity_apply_transform(kept, transforms[4])
    assert sum(1 for item in sorted_stream if item[1] == "import") == 2
    assert [item[1] for item in sorted_stream][:2] == ["import", "java.util.List"], sorted_stream
    assert [item[1] for item in sorted_stream][-3:] == ["A", "{", "}"], sorted_stream
    wildcard, _ = java._code_identity_code_tokens("import java.util.*;\nclass A {}\n")
    explicit, _ = java._code_identity_code_tokens("import java.util.List;\nclass A {}\n")
    assert java._code_identity_serialize(wildcard) != java._code_identity_serialize(explicit)


def test_empty_code_sequence_is_rejected() -> None:
    """只剩注释与空白的文件没有代码序列，不能据此判派生。"""

    streams = measure("/**\n * 只有注释。\n */\n", "/**\n * 只有注释。\n */\n")
    assert streams["local"]["token_count"] == 0
    assert streams["local"]["serialized"] == b""


# ───────────────────── 正例与负例（真实消费者） ─────────────────────


def test_positive_control_passes_through_branch_and_full_entries(tmp_path: Path) -> None:
    """正例：真实满足全部条件的对象经三个真实入口通过。"""

    local, remote = local_source(), upstream_source()
    case = prepare(tmp_path, local=local, remote=remote)

    branch = run_branch_entry(case.sandbox, case.registry, case.snapshots, transform_set=case.transform_set)
    assert branch.returncode == 0, branch.stdout + branch.stderr
    report = json.loads(branch.stdout)
    assert report["checked"] == 1 and report["findings"] == [], report

    full = run_full_entry(
        case.sandbox,
        case.registry,
        case.snapshots,
        transform_set=case.transform_set,
        json_index=case.json_index,
    )
    assert full.returncode == 0, full.stdout + full.stderr
    value = json.loads(full.stdout)
    assert value["checked"] == 1 and value["status"] == "passed", value
    assert value["findings"] == [], value
    counts = value["acceptance"]["counts"]
    assert counts["accepted"] == 1 and counts["hard_failures"] == 0, counts
    assert value["acceptance"]["accepted_source_notes"], value["acceptance"]


def test_one_byte_code_difference_is_rejected(tmp_path: Path) -> None:
    """负对照①：代码有 1 字节差异必须被拒。"""

    # 上游方法名少 1 个字节（names -> name）；这正是「代码有 1 字节差异」。
    local = local_source()
    remote = upstream_source(method_name="name")
    case = prepare(tmp_path, local=local, remote=remote)

    branch = run_branch_entry(case.sandbox, case.registry, case.snapshots, transform_set=case.transform_set)
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "代码同一性比较不成立（变换后逐字节不相等）" in branch.stdout, branch.stdout

    full = run_full_entry(case.sandbox, case.registry, case.snapshots, transform_set=case.transform_set)
    assert full.returncode == 1, full.stdout + full.stderr
    assert "代码同一性比较不成立" in full.stdout, full.stdout


def test_constant_difference_is_rejected_by_real_staged_entry(tmp_path: Path) -> None:
    """负对照①（另一形态）：常量值 1 字节变化经真实暂存入口被拒。

    暂存内容在基线之上真实变化，因此增量入口确实扫到对象；契约按**变化后的**
    绑定重新生成，避免只因旧指纹不符而失败掩盖比较逻辑。

    """

    changed = local_source(prefix="basic-framework.api-encryp")
    case = prepare(
        tmp_path,
        local=changed,
        remote=upstream_source(),
        baseline_local=local_source(),
    )
    contract = json.loads(case.record["code_identity_contract"])
    contract["comparison"]["equal"] = False
    contract["comparison"]["diff_count"] = 1
    case.record["code_identity_contract"] = json.dumps(contract, ensure_ascii=False)
    write_registry(case.registry, [case.record])
    write_json_index(
        case.sandbox.root / java.DEFAULT_EVIDENCE_REGISTRY, case.record
    )
    result = run_checker(
        case.sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        "--evidence-registry",
        str(case.registry),
        "--evidence-snapshots",
        str(case.snapshots),
        "--code-identity-transform-set",
        str(case.transform_set),
        "--json",
    )
    assert result.returncode == 1, result.stdout + result.stderr
    payload = json.loads(result.stdout)
    assert payload["checked"] == 1 and payload["findings"], payload
    assert "代码同一性比较不成立" in result.stdout, result.stdout


def test_tampered_transform_set_is_rejected(tmp_path: Path) -> None:
    """负对照②：改 1 条变换定义后变换集失效，分支被拒。"""

    local, remote = local_source(), upstream_source()
    sandbox = create_sandbox(tmp_path / "repository")
    sandbox.stage(LOCAL_PATH, local)
    target = sandbox.root / LOCAL_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(local, encoding="utf-8")
    snapshots = tmp_path / "snapshots"
    write_snapshot(snapshots, remote)

    def mutate(document: dict) -> None:
        """把 T3 的一对类型名改成另一个值：看起来仍是「登记变换」，实为篡改。"""

        # 逐条改写受控清单中的 T3 对应关系，其他条目原样保留。
        for transform in document["transforms"]:
            if transform["id"] == "T3":
                transform["pairs"][0] = [
                    "YudaoApiEncryptAutoConfiguration",
                    "TamperedApiEncryptAutoConfiguration",
                ]

    tampered, document = tamper_transform_set(tmp_path, mutate)
    contract = build_contract(
        local, remote, transform_set_document=document, transform_set_path=REPO_TRANSFORM_SET
    )
    registry = write_registry(
        tmp_path / "registry.tsv", [evidence_record(local, remote, contract=contract)]
    )

    honest = run_branch_entry(sandbox, registry, snapshots, transform_set=tampered)
    assert honest.returncode == 1, honest.stdout + honest.stderr
    assert "代码同一性变换集被篡改或与记录登记不符" in honest.stdout, honest.stdout

    # 只更新自报规则哈希（把整文件指纹写成篡改后的值）而不同步重算 transforms 指纹：
    # 受控规则失效仍然必须拒绝，不能因为自报哈希「对上」就放行。
    forged_contract = json.loads(contract)
    forged_contract["transform_set"] = dict(forged_contract["transform_set"])
    forged_contract["transform_set"]["sha256"] = hashlib.sha256(
        tampered.read_bytes()
    ).hexdigest()
    forged_contract["transform_set"]["transforms_sha256"] = json.loads(
        REPO_TRANSFORM_SET.read_text(encoding="utf-8")
    )["transforms_sha256"]
    forged_registry = write_registry(
        tmp_path / "forged-registry.tsv",
        [
            evidence_record(
                local,
                remote,
                contract=json.dumps(forged_contract, ensure_ascii=False),
            )
        ],
    )
    forged_result = run_branch_entry(sandbox, forged_registry, snapshots, transform_set=tampered)
    assert forged_result.returncode == 1, forged_result.stdout + forged_result.stderr
    assert "transforms_sha256 与清单自述不符" in forged_result.stdout, forged_result.stdout


def test_transform_set_self_inconsistency_is_rejected(tmp_path: Path) -> None:
    """负对照②（另一形态）：改定义但不重算自述指纹，变换集自身即失效。"""

    document = json.loads(REPO_TRANSFORM_SET.read_text(encoding="utf-8"))
    for transform in document["transforms"]:
        if transform["id"] == "T1":
            transform["pairs"] = [["cn.iocoder.yudao", "com.otherframework"]]
    broken = tmp_path / "broken-transform-set.json"
    broken.write_text(json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    _, error = java._load_code_identity_transform_set(str(broken))
    assert error is not None and "transforms_sha256" in error, error


def test_unregistered_transform_cannot_manufacture_equality(tmp_path: Path) -> None:
    """负对照③：清单外的变换不得被执行，也不得把不等补成全等。"""

    local = local_source(prefix="totally-different-prefix")
    remote = upstream_source()
    contract_local = local_source(prefix="yudao.api-encrypt")
    case = prepare(
        tmp_path,
        local=local,
        remote=remote,
        contract_local=contract_local,
        contract_kwargs={
            "applied_transforms": ["T1", "T2", "T3", "T4", "T5", "T6-unregistered-prefix-map"],
        },
    )

    branch = run_branch_entry(case.sandbox, case.registry, case.snapshots, transform_set=case.transform_set)
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "applied_transforms 必须与受控变换集登记的执行顺序逐项一致" in branch.stdout, branch.stdout

    full = run_full_entry(case.sandbox, case.registry, case.snapshots, transform_set=case.transform_set)
    assert full.returncode == 1, full.stdout + full.stderr
    assert "代码同一性比较不成立" in full.stdout, full.stdout


def test_unknown_transform_operation_in_manifest_is_rejected(tmp_path: Path) -> None:
    """负对照③（另一形态）：清单里塞入清单外操作时变换集整体失效。"""

    document = json.loads(REPO_TRANSFORM_SET.read_text(encoding="utf-8"))
    document["transforms"].append(
        {
            "id": "T6",
            "name": "未登记变换",
            "direction": "upstream-to-local",
            "operation": "strip-imports",
            "definition": "删除全部 import（裁决 D16 明确不批准）",
            "scope": "代码流",
            "pairs": [],
        }
    )
    document["execution_order"].append("T6")
    document["comparison_order"].append("T6")
    document["transforms_sha256"] = hashlib.sha256(
        json.dumps(document["transforms"], ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    broken = tmp_path / "extra-transform.json"
    broken.write_text(json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    _, error = java._load_code_identity_transform_set(str(broken))
    assert error is not None and "不在已登记范围内" in error, error


def test_similar_but_not_equal_is_rejected(tmp_path: Path) -> None:
    """负对照④：95% 相似但不全等必须被拒。"""

    local = local_source()
    remote = upstream_source()
    # 在上游正文里插入一处与本地不同的真实代码内容（整体高度相似）。
    remote = remote.replace("return source;", "return null;")
    case = prepare(tmp_path, local=local, remote=remote)

    branch = run_branch_entry(case.sandbox, case.registry, case.snapshots, transform_set=case.transform_set)
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "代码同一性比较不成立" in branch.stdout, branch.stdout

    full = run_full_entry(case.sandbox, case.registry, case.snapshots, transform_set=case.transform_set)
    assert full.returncode == 1, full.stdout + full.stderr
    assert "代码同一性比较不成立" in full.stdout, full.stdout


def test_empty_code_sequence_is_rejected_by_consumers(tmp_path: Path) -> None:
    """负对照⑤：空代码序列 / 只剩注释与空白必须被拒。"""

    local = local_source(
        javadoc="/**\n * 演示代码同一性分支的本地类型。\n *\n"
        f" * {java.SOURCE_HEADER_PREFIX}{UPSTREAM_REPO} @ {UPSTREAM_COMMIT}"
        f"{java.SOURCE_DECLARATION_SUFFIX}\n"
        f" * {java.SOURCE_PATH_PREFIX}{UPSTREAM_PATH}\n"
        f" * {java.SOURCE_BASIS_FIXED}\n"
        " * 本地修改：删除全部声明，只留注释。\n *\n"
        f" * {java.SOURCE_REVIEW_UNACCEPTED_MARKER}\n */"
    )
    case = prepare(
        tmp_path,
        local=local,
        remote="/**\n * 演示代码同一性分支的固定上游文件。\n */\n",
        contract_local=local,
        contract_remote="/**\n * 演示代码同一性分支的固定上游文件。\n */\n",
    )
    branch = run_branch_entry(case.sandbox, case.registry, case.snapshots, transform_set=case.transform_set)
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "代码序列为空（只剩注释或空白）" in branch.stdout, branch.stdout


def test_equality_only_after_removing_imports_is_rejected(tmp_path: Path) -> None:
    """负对照⑥：删除 import 后才相等必须被拒（D16 明确否定的旧口径）。"""

    local = local_source(imports=())
    remote = upstream_source()
    case = prepare(tmp_path, local=local, remote=remote)
    branch = run_branch_entry(case.sandbox, case.registry, case.snapshots, transform_set=case.transform_set)
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "代码同一性比较不成立" in branch.stdout, branch.stdout

    full = run_full_entry(case.sandbox, case.registry, case.snapshots, transform_set=case.transform_set)
    assert full.returncode == 1, full.stdout + full.stderr
    assert "代码同一性比较不成立" in full.stdout, full.stdout


def test_equality_only_after_folding_string_whitespace_is_rejected(tmp_path: Path) -> None:
    """负对照⑥（另一形态）：折叠字面量内空白后才相等必须被拒。"""

    # 双方字面量只差一个「连续空白折叠后消失」的空格：删掉它或折叠它才相等。
    local = local_source(label="a b")
    remote = upstream_source(label="a  b")
    assert local.replace('"a b"', '"a\u0020b"') != remote  # 仅空白差异，无其他不同
    case = prepare(
        tmp_path,
        local=local,
        remote=remote,
        contract_remote=local,
    )
    branch = run_branch_entry(case.sandbox, case.registry, case.snapshots, transform_set=case.transform_set)
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "代码同一性比较不成立" in branch.stdout, branch.stdout

    full = run_full_entry(case.sandbox, case.registry, case.snapshots, transform_set=case.transform_set)
    assert full.returncode == 1, full.stdout + full.stderr
    assert "代码同一性比较不成立" in full.stdout, full.stdout


def test_wildcard_versus_explicit_imports_is_rejected(tmp_path: Path) -> None:
    """负对照⑥（第三形态）：通配符与显式导入不能按本分支同一化。"""

    local = local_source(
        imports=("java.util.List", "java.lang.annotation.ElementType", "jakarta.validation.constraints.NotNull")
    )
    remote = upstream_source(imports=("javax.validation.constraints.NotNull", "java.lang.annotation.*", "java.util.List"))
    case = prepare(tmp_path, local=local, remote=remote)
    branch = run_branch_entry(case.sandbox, case.registry, case.snapshots, transform_set=case.transform_set)
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "import 条目数不同" in branch.stdout or "逐字节不相等" in branch.stdout, branch.stdout


def test_comment_change_keeps_code_identity_but_signature_still_governed(
    tmp_path: Path,
) -> None:
    """负对照⑦：注释/署名被改动但代码未变时，代码同一性成立而署名仍按规则处理。"""

    unchanged = local_source()
    local = local_source(javadoc=local_javadoc(author_line="@author 未声明作者"))
    case = prepare(
        tmp_path, local=local, remote=upstream_source(), contract_local=unchanged
    )

    # 代码流仍逐字节相同：签名改动不进入代码流。
    streams = measure(local, upstream_source())
    assert streams["local"]["serialized"] == streams["upstream"]["serialized"]

    branch = run_branch_entry(case.sandbox, case.registry, case.snapshots, transform_set=case.transform_set)
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "代码同一性比较不成立" not in branch.stdout, branch.stdout
    assert "与本地实际注释不符" in branch.stdout, branch.stdout

    full = run_full_entry(case.sandbox, case.registry, case.snapshots, transform_set=case.transform_set)
    assert full.returncode == 1, full.stdout + full.stderr
    assert "type-author" in full.stdout, full.stdout


def test_author_tag_form_is_not_accepted_by_code_identity(tmp_path: Path) -> None:
    """负对照⑦（另一形态）：代码相同不得放行未按作者规则验收的署名形态。

    该记录是**作者标签形态**（JavaDoc 没有来源说明），判词写的是 A1 已验收；
    代码流与上游变换后逐字节相同，但代码同一性分支不是作者验收依据，必须拒绝。

    """

    local = local_source(
        javadoc="/**\n * 演示代码同一性分支的本地类型。\n *\n"
        " * @author 李杰\n"
        f" * {java.SIGNATURE_REVIEW_UNACCEPTED_MARKER}\n */",
    )
    remote = upstream_source()
    case = prepare(
        tmp_path,
        local=local,
        remote=remote,
        verdict=java.AUTHOR_TAG_ACCEPTED_VERDICTS[0],
        author_status="已核实上游作者",
    )
    streams = measure(local, remote)
    assert streams["local"]["serialized"] == streams["upstream"]["serialized"]

    full = run_full_entry(
        case.sandbox,
        case.registry,
        case.snapshots,
        transform_set=case.transform_set,
        json_index=case.json_index,
    )
    assert full.returncode == 1, full.stdout + full.stderr
    assert "代码同一性比较不成立" not in full.stdout, full.stdout
    assert "代码同一性不覆盖作者与署名验收" in full.stdout, full.stdout


def test_route_binding_rejects_code_identity_on_route_three(tmp_path: Path) -> None:
    """归属校验：``E1-code-identity`` 只允许归属路线 2。"""

    local, remote = local_source(), upstream_source()
    case = prepare(tmp_path, local=local, remote=remote, route="路线 3")
    branch = run_branch_entry(case.sandbox, case.registry, case.snapshots, transform_set=case.transform_set)
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert f"{BRANCH} 分支归属路线 2，当前 evidence_route=路线 3" in branch.stdout, branch.stdout


def test_run_checks_group_comments_rejects_broken_identity(tmp_path: Path) -> None:
    """真实汇总入口：``run_checks.py --group comments`` 必须因代码同一性不成立而非零。"""

    local = local_source(prefix="basic-framework.api-encryp")
    case = prepare(tmp_path, local=local, remote=upstream_source())

    result = run_run_checks(case.sandbox, transform_set=case.transform_set)
    assert result.returncode != 0, result.stdout + result.stderr
    summary = json.loads(result.stdout)
    assert summary["inputs_consistent"], summary
    gate = next(item for item in summary["results"] if item["name"] == "java-comments-full")
    # 真实消费者确实因代码同一性不成立而拒绝，并把目标诊断逐字上报给汇总。
    assert gate["process_code"] == 1, gate
    assert "代码同一性比较不成立" in gate["reason"], gate["reason"]
    assert "代码同一性比较不成立" in gate["output"], gate["output"][-2000:]


def test_run_checks_group_comments_completes_on_positive_case(tmp_path: Path) -> None:
    """真实汇总入口：正例在维护模式下完成且如实标注已登记阻断。"""

    local = local_source(javadoc=local_javadoc(marker=java.SOURCE_REVIEW_UNACCEPTED_MARKER))
    remote = upstream_source()
    case = prepare(
        tmp_path,
        local=local,
        remote=remote,
        verdict="复核回退，保持来源说明并登记阻断（尚未验收）",
        blocker_reason="历史引入版本未核实；代码同一性分支成立但作者/来源仍需逐条复核",
    )
    result = run_run_checks(case.sandbox, transform_set=case.transform_set, maintenance=True)
    assert result.returncode == 0, result.stdout + result.stderr[-6000:]
    assert "代码同一性比较不成立" not in result.stdout, result.stdout[-4000:]
    summary = json.loads(result.stdout)
    assert summary["status"] == java.CHECK_STATUS_MAINTENANCE and summary["inputs_consistent"], summary
    assert summary["counts"]["hard_failures"] == 0, summary["counts"]
    assert summary["counts"]["registered_blockers"] == 1, summary["counts"]
    gate = next(item for item in summary["results"] if item["name"] == "java-comments-full")
    assert gate["status"] == java.CHECK_STATUS_MAINTENANCE and gate["process_code"] == 0, gate
    assert "代码同一性比较不成立" not in gate["output"], gate["output"][-2000:]


def test_difference_attribution_must_cover_every_raw_difference(tmp_path: Path) -> None:
    """全部原始差异必须逐处归因；覆盖不足即拒绝。"""

    local, remote = local_source(), upstream_source()
    case = prepare(
        tmp_path,
        local=local,
        remote=remote,
        contract_kwargs={
            "difference_attribution": [
                {
                    "cause": "comment-difference",
                    "local_lines": [1, 2],
                    "upstream_lines": [1, 2],
                    "changed_lines": {"local": 1, "upstream": 1},
                }
            ]
        },
    )
    branch = run_branch_entry(case.sandbox, case.registry, case.snapshots, transform_set=case.transform_set)
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "归因没有覆盖全部实际差异" in branch.stdout, branch.stdout


def test_comparison_readings_must_match_measurement(tmp_path: Path) -> None:
    """登记的代码流读数必须与实测一致，不能手填。"""

    local, remote = local_source(), upstream_source()
    contract = json.loads(
        build_contract(
            local,
            remote,
            transform_set_document=json.loads(REPO_TRANSFORM_SET.read_text(encoding="utf-8")),
            transform_set_path=REPO_TRANSFORM_SET,
        )
    )
    contract["comparison"]["local_token_count"] += 1
    sandbox = create_sandbox(tmp_path / "repository")
    sandbox.stage(LOCAL_PATH, local)
    target = sandbox.root / LOCAL_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(local, encoding="utf-8")
    snapshots = tmp_path / "snapshots"
    write_snapshot(snapshots, remote)
    registry = write_registry(
        tmp_path / "registry.tsv",
        [evidence_record(local, remote, contract=json.dumps(contract, ensure_ascii=False))],
    )
    result = run_branch_entry(sandbox, registry, snapshots)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "comparison.local_token_count 与实测不符" in result.stdout, result.stdout


def test_tool_fingerprint_must_match_current_implementation(tmp_path: Path) -> None:
    """实现指纹错配必须拒绝，不能只靠旧哈希不符掩盖比较逻辑。"""

    local, remote = local_source(), upstream_source()
    case = prepare(
        tmp_path,
        local=local,
        remote=remote,
        contract_kwargs={"tool_sha256": "0" * 64},
    )
    branch = run_branch_entry(case.sandbox, case.registry, case.snapshots, transform_set=case.transform_set)
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "tool.sha256 与当前规则实现不符" in branch.stdout, branch.stdout


def test_author_handling_must_declare_no_signature_credit(tmp_path: Path) -> None:
    """契约必须显式登记「代码同一不接受署名」。"""

    local, remote = local_source(), upstream_source()
    handling = copy.deepcopy(
        {
            "code_identity_accepts_signature": False,
            "declared_author_status": java.AUTHOR_UNDECLARED_STATUS,
            "author_route": "D12",
        }
    )
    handling["code_identity_accepts_signature"] = True
    case = prepare(
        tmp_path,
        local=local,
        remote=remote,
        contract_kwargs={"author_handling": handling},
    )
    branch = run_branch_entry(case.sandbox, case.registry, case.snapshots, transform_set=case.transform_set)
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "code_identity_accepts_signature=false" in branch.stdout, branch.stdout


def test_repository_index_declares_no_code_identity_record(tmp_path: Path) -> None:
    """本轮不改判任何记录：真实索引里不得出现 ``E1-code-identity`` 声明。"""

    index = json.loads(
        (DEFAULT_ROOT / "docs/测试与可靠性/来源证据/d12-source-index.json").read_text(encoding="utf-8")
    )
    branches = [record.get("evidence_branch") for record in index["records"]]
    assert BRANCH not in branches
    assert branches.count("E1-author-only") == 12
    assert branches.count("C2-independent-content") == 4


def test_self_test_still_passes() -> None:
    """规则内置自检不得因新分支引入而失败。"""

    result = subprocess.run(
        [
            sys.executable,
            "-B",
            "-X",
            "utf8",
            str(DEFAULT_ROOT / "scripts/code/java/check_staged_java_comments.py"),
            "--self-test",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=DEFAULT_ROOT,
        timeout=180,
    )
    assert result.returncode == 0, result.stdout + result.stderr