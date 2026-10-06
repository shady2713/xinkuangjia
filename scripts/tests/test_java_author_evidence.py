"""验证 D12 来源说明例外的格式、逐项证据核验与真实门禁消费者行为。

规则测试与真实 CLI 负对照都在隔离 Git 仓库和临时证据目录中进行，
不读取本机 .bf-local，也不修改真实索引、源码或 D10 清单。

@author OpenAI Codex
"""

from __future__ import annotations

import collections
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.code.java import check_staged_java_comments as java
from scripts.common.quality_common import DEFAULT_ROOT
from scripts.tests.git_sandbox import GitSandbox, create_sandbox

JAVA_PATH = (
    "后端代码/basic-framework-boot/basic-framework-core/basic-framework-common/"
    "src/main/java/example/EvidenceDemo.java"
)
NESTED_PATH = JAVA_PATH.replace("EvidenceDemo.java", "OuterHolder.java")
UPSTREAM_REPO = "YunaiV/ruoyi-vue-pro"
UPSTREAM_COMMIT = "ac022b15a094cf9cf82903d429b9729e72309da5"
UPSTREAM_PATH = "yudao-framework/yudao-common/src/main/java/example/EvidenceDemo.java"
UPSTREAM_SOURCE = "/**\n * 上游类型。\n */\npublic class EvidenceDemo {\n}\n"
SECOND_REPO = "vbenjs/vue-vben-admin"
SECOND_COMMIT = "50f4ede309d4450c7dd417399cb8d5c02346d2d2"
SECOND_PATH = "packages/types/global.ts"
SECOND_SOURCE = "export interface Global {}\n"
QUALIFIED_NAME = "example.EvidenceDemo"

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
)


def digest(value: str) -> str:
    """返回文本的 SHA-256。"""

    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def upstream_file_url(
    *,
    repository: str = UPSTREAM_REPO,
    commit: str = UPSTREAM_COMMIT,
    upstream_path: str = UPSTREAM_PATH,
) -> str:
    """返回清单登记的固定提交 blob 地址。"""

    return f"https://github.com/{repository}/blob/{commit}/{upstream_path}"


def raw_upstream_url(
    *,
    repository: str = UPSTREAM_REPO,
    commit: str = UPSTREAM_COMMIT,
    upstream_path: str = UPSTREAM_PATH,
) -> str:
    """返回规则应从 blob 地址转换出的固定提交内容地址。"""

    return f"https://raw.githubusercontent.com/{repository}/{commit}/{upstream_path}"


def javadoc_of(source: str) -> str:
    """取出源码中第一段 JavaDoc 原文。"""

    start = source.index("/**")
    return source[start : source.index("*/", start) + 2]


def note_lines(
    *,
    repository: str = UPSTREAM_REPO,
    commit: str = UPSTREAM_COMMIT,
    upstream_path: str = UPSTREAM_PATH,
    basis: str = java.SOURCE_BASIS_FIXED,
    local_modification: str = "调整包名与类名。",
) -> list[str]:
    """按裁决格式生成四行来源说明。"""

    return [
        f" * 来源：{repository} @ {commit}（该版本未声明作者）",
        f" * 上游文件：{upstream_path}",
        f" * {basis}",
        f" * 本地修改：{local_modification}",
    ]


def demo_source(
    *,
    notes: list[str] | None = None,
    author: str | None = None,
    class_name: str = "EvidenceDemo",
    nested: str = "",
) -> str:
    """生成带来源说明或作者标签的 Java 样本。"""

    body = [" * 演示来源说明例外。", " *"]
    body.extend(note_lines() if notes is None else notes)
    if author is not None:
        body.append(f" * {author}")
    declaration = f"public class {class_name} {{\n}}\n"
    return "package example;\n\n" + "\n".join(["/**", *body, " */"]) + "\n" + nested + declaration


def type_evidence_value(
    source: str,
    *,
    qualified_name: str = QUALIFIED_NAME,
    simple_name: str = "EvidenceDemo",
    kind: str = "class",
    nested: bool = False,
    enclosing_type: str | None = None,
    upstream_author_declared: bool = False,
    javadoc_sha256: str | None = None,
    review_conclusion: str | None = None,
    sources: list[dict[str, object]] | None = None,
) -> str:
    """生成受控清单的逐类型证据 JSON。"""

    entry: dict[str, object] = {
        "qualified_name": qualified_name,
        "simple_name": simple_name,
        "kind": kind,
        "nested": nested,
        "enclosing_type": enclosing_type,
        "upstream_type": "cn.iocoder.yudao.example.EvidenceDemo",
        "upstream_author_declared": upstream_author_declared,
        "javadoc_sha256": javadoc_sha256 if javadoc_sha256 is not None else digest(javadoc_of(source)),
        "review_by": "D12 规则测试",
        "review_date": "2026-10-06",
        "review_conclusion": review_conclusion
        if review_conclusion is not None
        else f"逐项复核 {simple_name}：来源、指纹与无作者结论一致。",
    }
    value: dict[str, object] = {"schema": java.EVIDENCE_SCHEMA, "types": [entry]}
    if sources is not None:
        value["sources"] = sources
    return json.dumps(value, ensure_ascii=False)


def correspondence_points(
    *,
    upstream_commit: str = UPSTREAM_COMMIT,
    fragment: str = "来源说明例外测试片段",
) -> str:
    """生成 D14 §112 要求的 P1/P2 内容点登记（含 discrimination_reason 与语料/df 绑定）。"""

    return json.dumps(
        [
            {
                "kind": "P1 内容点（共享有区分力字符串字面量）",
                "fragment": fragment,
                "local_lines": [1],
                "upstream_lines": [1],
                "discrimination_reason": (
                    f"共享有区分力字符串字面量「{fragment}」，属具体业务事实；"
                    "非类名/方法名/通用 CRUD/惯用校验/示例值"
                ),
                "corpus_binding": (
                    f"上游固定快照 {upstream_commit} 语料（7244 个 Java 文件）；"
                    "该片段在本文件出现 1 次，df=1"
                ),
            }
        ],
        ensure_ascii=False,
    )


def evidence_record(
    source: str,
    *,
    local_path: str = JAVA_PATH,
    upstream_source: str = UPSTREAM_SOURCE,
    type_evidence: str | None = None,
    status: str = java.AUTHOR_UNDECLARED_STATUS,
    upstream_author_lines: str = "",
    local_modification_facts: str = "调整包名与类名。",
    review_conclusion: str = "逐项复核 EvidenceDemo.java：来源、指纹与无作者结论一致。",
    evidence_route: str = "路线 3",
    evidence_points: str = (
        "p_struct 连续 8 行一致（上游 12-19，本地 15-22）；"
        "p_cov 多处结构对应（上游 30-38，本地 33-41）"
    ),
    d12_verdict: str = java.SOURCE_NOTE_ACCEPTED_VERDICTS[0],
    d12_correspondence_points: str | None = None,
) -> dict[str, str]:
    """构造一条受控清单记录。"""

    return {
        "local_path": local_path,
        "local_sha256_after": digest(source),
        "upstream_repo_url": f"https://github.com/{UPSTREAM_REPO}.git",
        "upstream_path": UPSTREAM_PATH,
        "upstream_commit": UPSTREAM_COMMIT,
        "upstream_file_url": upstream_file_url(),
        "upstream_sha256": digest(upstream_source),
        "upstream_author_lines": upstream_author_lines,
        "history_basis": "引入提交未知，本行以固定见证版本作来源见证。",
        "evidence_route": evidence_route,
        "evidence_points": evidence_points,
        "author_status": status,
        "local_modification_facts": local_modification_facts,
        "open_gap": "上游该版本未声明作者；历史引入版本未核实。",
        "review_by": "D12 规则测试",
        "review_date": "2026-10-06",
        "review_conclusion": review_conclusion,
        "type_evidence": type_evidence if type_evidence is not None else type_evidence_value(source),
        "d12_verdict": d12_verdict,
        "d12_correspondence_points": (
            d12_correspondence_points
            if d12_correspondence_points is not None
            else correspondence_points()
        ),
    }


def write_registry(
    path: Path, records: list[dict[str, str]], columns: tuple[str, ...] = REGISTRY_COLUMNS
) -> Path:
    """写出 TSV 形式的受控清单。"""

    lines = ["\t".join(columns)]
    lines.extend(
        "\t".join(str(item.get(name, "")) for name in columns) for item in records
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def write_snapshot(
    root: Path,
    content: str,
    *,
    repo_name: str = "ruoyi-vue-pro",
    commit: str = UPSTREAM_COMMIT,
    upstream_path: str = UPSTREAM_PATH,
) -> Path:
    """写出固定提交的受控上游快照。"""

    target = root / f"{repo_name}@{commit}" / upstream_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return target


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
    if extra_env:
        env.update(extra_env)
    return subprocess.run(
        [sys.executable, "-B", "-X", "utf8", str(DEFAULT_ROOT / script), *args],
        cwd=sandbox.root,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=120,
    )


@pytest.fixture
def evidence_dir(tmp_path: Path) -> Path:
    """提供隔离的证据目录。"""

    folder = tmp_path / "evidence"
    folder.mkdir()
    return folder


def prepare_case(
    sandbox: GitSandbox,
    evidence_dir: Path,
    source: str,
    *,
    local_path: str = JAVA_PATH,
    upstream_source: str = UPSTREAM_SOURCE,
    record: dict[str, str] | None = None,
    write_worktree: bool = True,
) -> tuple[Path, Path]:
    """构造可运行的隔离夹具，返回清单与快照根目录。"""

    sandbox.stage(local_path, source)
    if write_worktree:
        target = sandbox.root / local_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source, encoding="utf-8")
    snapshots = evidence_dir / "snapshots"
    write_snapshot(snapshots, upstream_source)
    registry = write_registry(
        evidence_dir / "registry.tsv",
        [record if record is not None else evidence_record(source, local_path=local_path)],
    )
    return registry, snapshots


def checker_args(registry: Path, snapshots: Path) -> list[str]:
    """构造暂存入口的证据参数。"""

    return [
        "--evidence-registry",
        str(registry),
        "--evidence-snapshots",
        str(snapshots),
    ]


@pytest.mark.parametrize(
    "author",
    [
        "@author 未声明作者",
        f"@author 来源：{UPSTREAM_REPO} @ {UPSTREAM_COMMIT}（该版本未声明作者）",
        "@author basic-framework",
        "@author 来源不明",
        "@author 来源未知",
        "@author 无作者",
    ],
)
def test_neutral_author_expressions_are_rejected(author: str) -> None:
    """中性来源表达塞进 @author 时不代表作者身份。"""

    assert java._has_actual_author(f"/**\n * 职责。\n *\n * {author}\n */") is False


@pytest.mark.parametrize(
    "author",
    [
        "@author 李杰",
        "@author shady2713",
        "@author 张三, 李四",
        "@author&#x20;赵六",
        "@author John Doe",
    ],
)
def test_accurate_authors_stay_compatible(author: str) -> None:
    """准确作者、多作者与 HTML 空格形式保持兼容，不禁止特定姓名。"""

    assert java._has_actual_author(f"/**\n * 职责。\n *\n * {author}\n */") is True


@pytest.mark.parametrize(
    ("note", "expected"),
    [
        (
            [
                f" * 来源：{UPSTREAM_REPO} @ ac022b15（该版本未声明作者）",
                f" * 上游文件：{UPSTREAM_PATH}",
                " * 来源依据：固定见证版本；历史引入版本未核实。",
                " * 本地修改：调整包名。",
            ],
            "短 SHA",
        ),
        (
            [
                f" * 来源：{UPSTREAM_REPO} @ master（该版本未声明作者）",
                f" * 上游文件：{UPSTREAM_PATH}",
                " * 来源依据：固定见证版本；历史引入版本未核实。",
                " * 本地修改：调整包名。",
            ],
            "浮动分支",
        ),
        (
            [
                f" * 来源：{UPSTREAM_REPO} @ {UPSTREAM_COMMIT.upper()}（该版本未声明作者）",
                f" * 上游文件：{UPSTREAM_PATH}",
                " * 来源依据：固定见证版本；历史引入版本未核实。",
                " * 本地修改：调整包名。",
            ],
            "浮动分支",
        ),
        (
            [
                f" * 来源：{UPSTREAM_REPO} @ {UPSTREAM_COMMIT}",
                f" * 上游文件：{UPSTREAM_PATH}",
                " * 来源依据：固定见证版本；历史引入版本未核实。",
                " * 本地修改：调整包名。",
            ],
            "该版本未声明作者",
        ),
        (
            [
                f" * 来源：{UPSTREAM_REPO} @ {UPSTREAM_COMMIT}（该版本未声明作者）",
                " * 上游文件：../../etc/passwd",
                " * 来源依据：固定见证版本；历史引入版本未核实。",
                " * 本地修改：调整包名。",
            ],
            "相对路径",
        ),
        (
            [
                f" * 来源：{UPSTREAM_REPO} @ {UPSTREAM_COMMIT}（该版本未声明作者）",
                f" * 上游文件：{UPSTREAM_PATH}",
                " * 来源依据：已核实引入版本。",
                " * 本地修改：调整包名。",
            ],
            None,
        ),
        (
            [
                f" * 来源：{UPSTREAM_REPO} @ {UPSTREAM_COMMIT}（该版本未声明作者）",
                f" * 上游文件：{UPSTREAM_PATH}",
                " * 来源依据：固定见证版本；历史引入版本未核实。",
                " * 本地修改：",
            ],
            "本地修改",
        ),
    ],
)
def test_source_note_format_contract(note: list[str], expected: str | None) -> None:
    """固定语法逐项生效：短 SHA、分支、大写、缺限定与越界路径都被拒绝。"""

    javadoc = "\n".join(["/**", " * 职责说明。", " *", *note, " */"])
    notes, errors = java._parse_source_notes(javadoc)
    if expected is None:
        assert not errors and len(notes) == 1
    else:
        assert errors and expected in errors[0]


def test_source_note_after_block_tag_is_rejected() -> None:
    """来源说明必须位于全部块标签之前，不能写在 @author 之后。"""

    javadoc = "\n".join(
        ["/**", " * 职责说明。", " *", " * @author 张三", *note_lines(), " */"]
    )
    notes, errors = java._parse_source_notes(javadoc)
    assert notes == []
    assert any("块标签之前" in error for error in errors)


def test_source_note_without_registry_is_rejected() -> None:
    """格式正确但没有受控清单时不启用例外，仍报 type-author。"""

    source = demo_source()
    findings = java._scan_source(
        JAVA_PATH, source, set(range(1, source.count("\n") + 2))
    )
    assert [finding.rule for finding in findings] == ["type-author"]
    assert findings[0].evidence_bound is True
    assert "未提供受控证据清单" in findings[0].detail


@pytest.mark.parametrize("tag", ["@source", "@origin", "@provenance", "@upstream"])
def test_invented_provenance_tag_is_rejected(tag: str) -> None:
    """自造来源块标签不能代替正文来源说明，且诊断要说明原因。"""

    source = (
        "/**\n * 职责说明。\n *\n"
        f" * {tag} {UPSTREAM_REPO} @ {UPSTREAM_COMMIT}\n"
        " */\npublic class EvidenceDemo {\n}\n"
    )
    findings = java._scan_source(
        JAVA_PATH, source, set(range(1, source.count("\n") + 2))
    )
    assert [finding.rule for finding in findings] == ["type-author"]
    assert "自造块标签" in findings[0].detail


def test_author_with_unbacked_source_note_is_still_rejected() -> None:
    """来源说明是来源断言：即使另有准确作者，缺少逐项依据也不能保留。"""

    source = demo_source(author="@author 李杰")
    findings = java._scan_source(
        JAVA_PATH, source, set(range(1, source.count("\n") + 2))
    )
    assert [finding.rule for finding in findings] == ["type-author"]


def test_evidence_registry_reports_input_fingerprint(tmp_path: Path) -> None:
    """检查器必须报告本次采用的清单指纹，不能只写通过。"""

    sandbox = create_sandbox(tmp_path / "repository")
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    source = demo_source()
    registry, snapshots = prepare_case(sandbox, evidence, source)
    result = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        "--json",
        *checker_args(registry, snapshots),
    )
    assert result.returncode == 0, result.stdout + result.stderr
    value = json.loads(result.stdout)
    assert value["checked"] == 1 and value["status"] == "passed"
    assert value["evidence"]["registry_sha256"] == digest(registry.read_text(encoding="utf-8"))
    assert value["evidence"]["snapshots"] == str(snapshots)


@pytest.mark.parametrize(
    ("name", "argument"),
    [
        ("清单不存在", "missing-registry.tsv"),
        ("快照目录不存在", "missing-snapshots"),
    ],
)
def test_unreadable_evidence_exits_two(
    tmp_path: Path, name: str, argument: str
) -> None:
    """证据输入不可读时以退出码 2 说明原因，不回退到无条件放行。"""

    sandbox = create_sandbox(tmp_path / "repository")
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    source = demo_source()
    registry, snapshots = prepare_case(sandbox, evidence, source)
    if argument == "missing-registry.tsv":
        arguments = ["--evidence-registry", str(evidence / argument)]
        expected = "证据清单不可读"
    else:
        arguments = checker_args(registry, evidence / argument)
        expected = "证据快照目录不可读"
    result = run_checker(
        sandbox, "scripts/code/java/check_staged_java_comments.py", *arguments
    )
    assert result.returncode == 2, result.stdout + result.stderr
    assert expected in result.stderr


def test_complete_evidence_passes_staged_and_full_entries(tmp_path: Path) -> None:
    """证据齐全、固定文件确无作者时暂存与全量入口都放行并真实扫描对象。"""

    sandbox = create_sandbox(tmp_path / "repository")
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    source = demo_source()
    registry, snapshots = prepare_case(sandbox, evidence, source)
    staged = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        *checker_args(registry, snapshots),
    )
    assert staged.returncode == 0, staged.stdout + staged.stderr
    environment = {
        java.EVIDENCE_REGISTRY_ENV: str(registry),
        java.EVIDENCE_SNAPSHOTS_ENV: str(snapshots),
    }
    full = run_checker(
        sandbox,
        "scripts/code/java/check_full_java_comments.py",
        "--json",
        "--root",
        str(sandbox.root),
        extra_env=environment,
    )
    assert full.returncode == 0, full.stdout + full.stderr
    assert json.loads(full.stdout)["checked"] == 1
    broken = demo_source(
        notes=[
            f" * 来源：{UPSTREAM_REPO} @ master（该版本未声明作者）",
            f" * 上游文件：{UPSTREAM_PATH}",
            " * 来源依据：固定见证版本；历史引入版本未核实。",
            " * 本地修改：调整包名。",
        ]
    )
    (sandbox.root / JAVA_PATH).write_text(broken, encoding="utf-8")
    probe = run_checker(
        sandbox,
        "scripts/code/java/check_full_java_comments.py",
        "--json",
        "--root",
        str(sandbox.root),
        extra_env=environment,
    )
    assert probe.returncode == 1
    assert JAVA_PATH in probe.stdout and "EvidenceDemo" in probe.stdout


def test_missing_record_is_rejected(tmp_path: Path) -> None:
    """格式正确但清单没有该文件条目时拒绝，并指出无逐项依据。"""

    sandbox = create_sandbox(tmp_path / "repository")
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    source = demo_source()
    record = evidence_record(source, local_path=NESTED_PATH)
    registry, snapshots = prepare_case(sandbox, evidence, source, record=record)
    result = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        *checker_args(registry, snapshots),
    )
    assert result.returncode == 1, result.stdout + result.stderr
    assert "清单中没有" in result.stderr and "type-author" in result.stderr


def test_copied_source_note_without_type_mapping_is_rejected(tmp_path: Path) -> None:
    """从另一个合法文件复制来源句时目标类型没有映射，必须指出对象映射不足。"""

    sandbox = create_sandbox(tmp_path / "repository")
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    source = demo_source()
    other = demo_source(class_name="OtherDemo")
    mapping = type_evidence_value(
        other, qualified_name="example.OtherDemo", simple_name="OtherDemo"
    )
    record = evidence_record(source, type_evidence=mapping)
    registry, snapshots = prepare_case(sandbox, evidence, source, record=record)
    result = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        *checker_args(registry, snapshots),
    )
    assert result.returncode == 1, result.stdout + result.stderr
    assert "逐类型映射中没有" in result.stderr and "对象级授权" in result.stderr


def test_flipped_status_without_type_evidence_is_rejected(tmp_path: Path) -> None:
    """单独把状态改成已核实来源不构成批准，缺少逐类型映射仍拒绝。"""

    sandbox = create_sandbox(tmp_path / "repository")
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    source = demo_source()
    record = evidence_record(source, type_evidence="", evidence_route="无", evidence_points="")
    registry, snapshots = prepare_case(sandbox, evidence, source, record=record)
    result = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        *checker_args(registry, snapshots),
    )
    assert result.returncode == 1, result.stdout + result.stderr
    assert "逐类型映射" in result.stderr and "证据路线不受支持" in result.stderr


def test_tampered_upstream_snapshot_is_rejected(tmp_path: Path) -> None:
    """真实改变上游字节而保留旧指纹时必须按实测指纹拒绝。"""

    sandbox = create_sandbox(tmp_path / "repository")
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    source = demo_source()
    registry, snapshots = prepare_case(sandbox, evidence, source)
    snapshot = snapshots / f"ruoyi-vue-pro@{UPSTREAM_COMMIT}" / UPSTREAM_PATH
    before = digest(snapshot.read_text(encoding="utf-8"))
    snapshot.write_text(UPSTREAM_SOURCE + "// 篡改\n", encoding="utf-8")
    after = digest(snapshot.read_text(encoding="utf-8"))
    result = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        *checker_args(registry, snapshots),
    )
    assert before != after
    assert result.returncode == 1, result.stdout + result.stderr
    assert "上游内容实测指纹" in result.stderr and after in result.stderr


def test_upstream_author_declaration_blocks_exception(tmp_path: Path) -> None:
    """上游对应文件实际有作者时拒绝中性替代，指出作者被遗漏。"""

    sandbox = create_sandbox(tmp_path / "repository")
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    source = demo_source()
    upstream = "/**\n * 上游类型。\n *\n * @author 张三\n */\npublic class EvidenceDemo {\n}\n"
    record = evidence_record(source, upstream_source=upstream)
    registry, snapshots = prepare_case(
        sandbox, evidence, source, upstream_source=upstream, record=record
    )
    result = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        *checker_args(registry, snapshots),
    )
    assert result.returncode == 1, result.stdout + result.stderr
    assert "存在作者声明，必须保留作者" in result.stderr


def test_nested_public_type_needs_its_own_mapping(tmp_path: Path) -> None:
    """嵌套 public 类型不能凭文件名或外层类型授权。"""

    sandbox = create_sandbox(tmp_path / "repository")
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    inner_note = "\n".join(f"     {line[1:]}" for line in note_lines())
    source = (
        "package example;\n\n"
        "/**\n * 外层容器。\n *\n * @author 李杰\n */\n"
        "public class OuterHolder {\n"
        "    /**\n     * 嵌套枚举。\n     *\n"
        + inner_note
        + "\n     */\n"
        "    public enum InnerState {\n        /** 成功。 */\n        SUCCESS;\n    }\n"
        "}\n"
    )
    record = evidence_record(source, local_path=NESTED_PATH)
    registry, snapshots = prepare_case(
        sandbox, evidence, source, local_path=NESTED_PATH, record=record
    )
    result = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        *checker_args(registry, snapshots),
    )
    assert result.returncode == 1, result.stdout + result.stderr
    assert "OuterHolder.InnerState" in result.stderr
    assert "逐类型映射中没有" in result.stderr


def test_pure_comment_change_triggers_type_check(tmp_path: Path) -> None:
    """作者标签或来源说明变化时，声明行未变也要检查对应类型。"""

    sandbox = create_sandbox(tmp_path / "repository")
    baseline = demo_source(notes=[], author="@author 李杰")
    sandbox.stage(JAVA_PATH, baseline)
    sandbox.record_baseline()
    sandbox.stage(JAVA_PATH, baseline.replace(" * @author 李杰\n", ""))
    removed = run_checker(
        sandbox, "scripts/code/java/check_staged_java_comments.py"
    )
    assert removed.returncode == 1, removed.stdout + removed.stderr
    assert "type-author" in removed.stderr
    sandbox.stage(JAVA_PATH, baseline)
    sandbox.stage(JAVA_PATH, demo_source())
    added = run_checker(sandbox, "scripts/code/java/check_staged_java_comments.py")
    assert added.returncode == 1, added.stdout + added.stderr
    assert "未提供受控证据清单" in added.stderr


def test_neutral_author_swap_is_not_exempted_as_history(tmp_path: Path) -> None:
    """把一种中性文字换成另一种同样中性时，旧版本同样失败也不能按历史欠账豁免。"""

    sandbox = create_sandbox(tmp_path / "repository")
    sandbox.stage(JAVA_PATH, demo_source(notes=[], author="@author 来源不明"))
    sandbox.record_baseline()
    sandbox.stage(JAVA_PATH, demo_source(notes=[], author="@author 未声明作者"))
    result = run_checker(sandbox, "scripts/code/java/check_staged_java_comments.py")
    assert result.returncode == 1, result.stdout + result.stderr
    assert "type-author" in result.stderr


def test_multi_source_requires_every_registered_source(tmp_path: Path) -> None:
    """多来源逐一列明：漏掉一条登记即拒绝，全部登记时通过。"""

    sandbox = create_sandbox(tmp_path / "repository")
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    notes = note_lines() + note_lines(
        repository=SECOND_REPO,
        commit=SECOND_COMMIT,
        upstream_path=SECOND_PATH,
        local_modification="改为本地类型声明。",
    )
    source = demo_source(notes=notes)
    sources = [
        {
            "repository": UPSTREAM_REPO,
            "commit": UPSTREAM_COMMIT,
            "path": UPSTREAM_PATH,
            "sha256": digest(UPSTREAM_SOURCE),
            "author_declared": False,
        },
        {
            "repository": SECOND_REPO,
            "commit": SECOND_COMMIT,
            "path": SECOND_PATH,
            "sha256": digest(SECOND_SOURCE),
            "author_declared": False,
        },
    ]
    record = evidence_record(source, type_evidence=type_evidence_value(source, sources=sources))
    registry, snapshots = prepare_case(sandbox, evidence, source, record=record)
    write_snapshot(
        snapshots,
        SECOND_SOURCE,
        repo_name="vue-vben-admin",
        commit=SECOND_COMMIT,
        upstream_path=SECOND_PATH,
    )
    complete = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        *checker_args(registry, snapshots),
    )
    assert complete.returncode == 0, complete.stdout + complete.stderr
    partial = dict(record)
    partial["type_evidence"] = type_evidence_value(source, sources=sources[:1])
    write_registry(registry, [partial])
    result = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        *checker_args(registry, snapshots),
    )
    assert result.returncode == 1, result.stdout + result.stderr
    assert "多来源登记中没有" in result.stderr


def test_registry_schema_and_format_errors_are_configuration_failures(
    tmp_path: Path,
) -> None:
    """清单缺少必需字段或 JSON 损坏时属于配置失败，退出码为 2。"""

    incomplete = tmp_path / "incomplete.tsv"
    incomplete.write_text("local_path\tauthor_status\n", encoding="utf-8")
    with pytest.raises(java.EvidenceError):
        java.load_evidence_registry(incomplete, None)
    broken = tmp_path / "broken.json"
    broken.write_text("[{", encoding="utf-8")
    with pytest.raises(java.EvidenceError):
        java.load_evidence_registry(broken, None)


def test_json_registry_is_supported(tmp_path: Path) -> None:
    """JSON 形式的同一账本字段必须能被同一套核验消费。"""

    sandbox = create_sandbox(tmp_path / "repository")
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    source = demo_source()
    sandbox.stage(JAVA_PATH, source)
    write_snapshot(evidence / "snapshots", UPSTREAM_SOURCE)
    registry = evidence / "registry.json"
    registry.write_text(
        json.dumps([evidence_record(source)], ensure_ascii=False), encoding="utf-8"
    )
    result = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        *checker_args(registry, evidence / "snapshots"),
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_staged_bytes_bind_the_evidence_version(tmp_path: Path) -> None:
    """暂存入口按暂存字节判定，工作区内容不能替代该输入绑定的证据版本。"""

    sandbox = create_sandbox(tmp_path / "repository")
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    source = demo_source()
    registry, snapshots = prepare_case(sandbox, evidence, source)
    sandbox.stage(JAVA_PATH, source + "\n// 暂存内容变化\n")
    stale = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        *checker_args(registry, snapshots),
    )
    assert stale.returncode == 1, stale.stdout + stale.stderr
    assert "本地最终指纹不符" in stale.stderr
    sandbox.stage(JAVA_PATH, source)
    (sandbox.root / JAVA_PATH).write_text(source + "\n// 仅工作区变化\n", encoding="utf-8")
    staged_only = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        *checker_args(registry, snapshots),
    )
    assert staged_only.returncode == 0, staged_only.stdout + staged_only.stderr


def test_default_index_resolution_prefers_explicit_configuration(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """受控证据默认取仓库内索引；命令行参数与环境变量优先，快照仍需显式配置。"""

    root = tmp_path / "repository"
    index = root / java.DEFAULT_EVIDENCE_REGISTRY
    index.parent.mkdir(parents=True)
    index.write_text("[]", encoding="utf-8")
    explicit = tmp_path / "explicit.tsv"
    explicit.write_text("local_path\n", encoding="utf-8")
    snapshots = tmp_path / "snapshots"
    snapshots.mkdir()
    assert java.resolve_evidence_paths(root=root) == (index, None, "repository-default")
    monkeypatch.setenv(java.EVIDENCE_REGISTRY_ENV, str(explicit))
    assert java.resolve_evidence_paths(root=root) == (explicit, None, "environment")
    monkeypatch.setenv(java.EVIDENCE_SNAPSHOTS_ENV, str(snapshots))
    assert java.resolve_evidence_paths(root=root) == (explicit, snapshots, "environment")
    arguments, description = java.evidence_cli_arguments(root)
    assert arguments == [
        "--evidence-registry",
        str(explicit),
        "--evidence-snapshots",
        str(snapshots),
    ]
    assert "证据输入不可用" in description
    monkeypatch.delenv(java.EVIDENCE_SNAPSHOTS_ENV)
    assert java.resolve_evidence_paths(Path("cli.json"), None, root) == (
        Path("cli.json"),
        None,
        "argument",
    )
    # 只配置快照时仍然启用仓库内默认索引，离线开发不必重复指定清单位置。
    monkeypatch.delenv(java.EVIDENCE_REGISTRY_ENV)
    monkeypatch.setenv(java.EVIDENCE_SNAPSHOTS_ENV, str(snapshots))
    assert java.resolve_evidence_paths(root=root) == (index, snapshots, "repository-default")


def test_missing_repository_default_index_stays_absent(tmp_path: Path) -> None:
    """仓库内没有受控索引时不得凭默认位置放行，仍按无证据拒绝来源说明。"""

    root = tmp_path / "repository"
    root.mkdir()
    assert java.resolve_evidence_paths(root=root) == (None, None, "absent")
    arguments, description = java.evidence_cli_arguments(root)
    assert arguments == []
    assert "未配置受控清单与快照" in description
    assert java.resolve_evidence(None, None, root) is None


@pytest.mark.parametrize(
    ("file_url", "expected"),
    [
        (upstream_file_url(commit="ac022b15"), "未固定在登记的提交"),
        (upstream_file_url(upstream_path="example/Other.java"), "路径不是登记的上游文件"),
        (f"https://github.com/Other/repo/blob/{UPSTREAM_COMMIT}/{UPSTREAM_PATH}", "仓库与来源说明不一致"),
        (f"http://github.com/{UPSTREAM_REPO}/blob/{UPSTREAM_COMMIT}/{UPSTREAM_PATH}", "必须是 https"),
        (upstream_file_url(), None),
    ],
)
def test_fixed_content_url_must_be_pinned(file_url: str, expected: str | None) -> None:
    """固定地址必须固定在登记提交与路径上，GitHub blob 地址转换为 raw 内容地址。"""

    content_url, error = java._fixed_content_url(
        file_url, UPSTREAM_REPO, UPSTREAM_COMMIT, UPSTREAM_PATH
    )
    if expected is None:
        assert error is None
        assert content_url == raw_upstream_url()
    else:
        assert content_url is None and expected in error


def test_upstream_content_is_fetched_and_fingerprint_checked(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """快照缺失时按固定地址取回内容，复算指纹并按同提交地址发起请求。"""

    evidence = tmp_path / "evidence"
    evidence.mkdir()
    source = demo_source()
    registry = write_registry(evidence / "registry.tsv", [evidence_record(source)])
    loaded = java.load_evidence_registry(registry, None)
    requested: list[str] = []

    def fake_fetch(url: str) -> bytes:
        """记录请求地址并返回与清单指纹一致的原始字节。"""

        requested.append(url)
        return UPSTREAM_SOURCE.encode("utf-8")

    monkeypatch.setattr(java, "_fetch_upstream_bytes", fake_fetch)
    reason, actual = java._verify_upstream_snapshot(
        loaded,
        repository=UPSTREAM_REPO,
        commit=UPSTREAM_COMMIT,
        upstream_path=UPSTREAM_PATH,
        expected_sha256=digest(UPSTREAM_SOURCE),
        file_url=upstream_file_url(),
    )
    assert reason is None, reason
    assert actual == digest(UPSTREAM_SOURCE)
    assert requested == [raw_upstream_url()]


def test_unreachable_or_mismatched_upstream_content_is_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """取不回、指纹不符或上游实际有作者时都给出原因并拒绝，不无条件放行。"""

    evidence = tmp_path / "evidence"
    evidence.mkdir()
    source = demo_source()
    registry = write_registry(evidence / "registry.tsv", [evidence_record(source)])
    loaded = java.load_evidence_registry(registry, None)

    def mismatch(_url: str) -> bytes:
        """返回与清单登记指纹不一致的内容。"""

        return (UPSTREAM_SOURCE + "\n").encode("utf-8")

    monkeypatch.setattr(java, "_fetch_upstream_bytes", mismatch)
    reason, actual = java._verify_upstream_snapshot(
        loaded,
        repository=UPSTREAM_REPO,
        commit=UPSTREAM_COMMIT,
        upstream_path=UPSTREAM_PATH,
        expected_sha256=digest(UPSTREAM_SOURCE),
        file_url=upstream_file_url(),
    )
    assert reason is not None and "实测指纹" in reason and actual is not None

    def declare_author(_url: str) -> bytes:
        """返回带作者声明的上游内容。"""

        return "/** 上游类型。\n * @author 张三\n */\npublic class EvidenceDemo {}\n".encode("utf-8")

    monkeypatch.setattr(java, "_fetch_upstream_bytes", declare_author)
    reason, _ = java._verify_upstream_snapshot(
        loaded,
        repository=UPSTREAM_REPO,
        commit=UPSTREAM_COMMIT,
        upstream_path=UPSTREAM_PATH,
        expected_sha256=hashlib.sha256(declare_author("")).hexdigest(),
        file_url=upstream_file_url(),
    )
    assert reason is not None and "存在作者声明" in reason

    def unreachable(url: str) -> bytes:
        """模拟地址不可达。"""

        raise OSError(f"connection refused: {url}")

    monkeypatch.setattr(java, "_fetch_upstream_bytes", unreachable)
    reason, _ = java._verify_upstream_snapshot(
        loaded,
        repository=UPSTREAM_REPO,
        commit=UPSTREAM_COMMIT,
        upstream_path=UPSTREAM_PATH,
        expected_sha256=digest(UPSTREAM_SOURCE),
        file_url=upstream_file_url(),
    )
    assert reason is not None and "无法从固定地址取回上游内容" in reason


def test_fetch_failure_without_fixed_address_is_rejected(tmp_path: Path) -> None:
    """既没有快照也没有固定地址时必须拒绝，不能静默跳过内容核验。"""

    evidence = tmp_path / "evidence"
    evidence.mkdir()
    source = demo_source()
    registry = write_registry(evidence / "registry.tsv", [evidence_record(source)])
    loaded = java.load_evidence_registry(registry, None)
    reason, actual = java._verify_upstream_snapshot(
        loaded,
        repository=UPSTREAM_REPO,
        commit=UPSTREAM_COMMIT,
        upstream_path=UPSTREAM_PATH,
        expected_sha256=digest(UPSTREAM_SOURCE),
        file_url="",
    )
    assert reason is not None and "upstream_file_url" in reason
    assert actual is None


def test_duplicate_tsv_columns_are_rejected(tmp_path: Path) -> None:
    """表头重复列名会让取值优先级不明确，必须显式拒绝而不是后列覆盖前列。"""

    source = demo_source()
    record = evidence_record(source)
    columns = [*REGISTRY_COLUMNS, "upstream_author_lines"]
    path = tmp_path / "duplicate.tsv"
    path.write_text(
        "\t".join(columns)
        + "\n"
        + "\t".join(str(record.get(name, "")) for name in columns)
        + "\n",
        encoding="utf-8",
    )
    with pytest.raises(java.EvidenceError, match="重复列名"):
        java.load_evidence_registry(path, None)


def test_unsupported_index_schema_is_rejected(tmp_path: Path) -> None:
    """派生索引声明的 schema 版本不受支持时属于配置失败，不能按宽松解析放行。"""

    path = tmp_path / "index.json"
    path.write_text(
        json.dumps({"index_schema": "d12-source-index/v0", "records": []}), encoding="utf-8"
    )
    with pytest.raises(java.EvidenceError, match="schema 版本不受支持"):
        java.load_evidence_registry(path, None)
    supported = tmp_path / "supported.json"
    supported.write_text(
        json.dumps({"index_schema": java.EVIDENCE_INDEX_SCHEMA, "records": [evidence_record(demo_source())]}),
        encoding="utf-8",
    )
    assert len(java.load_evidence_registry(supported, None).records) == 1


def test_full_entry_uses_repository_default_index_and_reports_fingerprint(
    tmp_path: Path,
) -> None:
    """全量入口默认读取仓库内索引，并在 JSON 与非 JSON 输出中报告输入指纹。"""

    sandbox = create_sandbox(tmp_path / "repository")
    source = demo_source()
    sandbox.stage(JAVA_PATH, source)
    target = sandbox.root / JAVA_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(source, encoding="utf-8")
    index = sandbox.root / java.DEFAULT_EVIDENCE_REGISTRY
    index.parent.mkdir(parents=True)
    index.write_text(
        json.dumps(
            {"index_schema": "d12-source-index/v1", "records": [evidence_record(source)]},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    snapshots = tmp_path / "snapshots"
    write_snapshot(snapshots, UPSTREAM_SOURCE)
    environment = {java.EVIDENCE_SNAPSHOTS_ENV: str(snapshots)}
    structured = run_checker(
        sandbox,
        "scripts/code/java/check_full_java_comments.py",
        "--json",
        "--root",
        str(sandbox.root),
        extra_env=environment,
    )
    assert structured.returncode == 0, structured.stdout + structured.stderr
    value = json.loads(structured.stdout)
    assert value["checked"] == 1 and value["status"] == "passed"
    assert value["evidence"] == {
        "registry": str(index),
        "registry_sha256": digest(index.read_text(encoding="utf-8")),
        "snapshots": str(snapshots),
        "records": 1,
    }
    readable = run_checker(
        sandbox,
        "scripts/code/java/check_full_java_comments.py",
        "--root",
        str(sandbox.root),
        extra_env=environment,
    )
    assert readable.returncode == 0, readable.stdout + readable.stderr
    assert "Java 注释检查证据输入：清单" in readable.stdout
    assert digest(index.read_text(encoding="utf-8")) in readable.stdout


def test_full_entry_without_evidence_reports_null_and_rejects_notes(
    tmp_path: Path,
) -> None:
    """没有受控证据时全量入口报告 null 指纹并拒绝来源说明，不回退到放行。"""

    sandbox = create_sandbox(tmp_path / "repository")
    source = demo_source()
    sandbox.stage(JAVA_PATH, source)
    target = sandbox.root / JAVA_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(source, encoding="utf-8")
    result = run_checker(
        sandbox,
        "scripts/code/java/check_full_java_comments.py",
        "--json",
        "--root",
        str(sandbox.root),
    )
    assert result.returncode == 1, result.stdout + result.stderr
    value = json.loads(result.stdout)
    assert value["evidence"] is None
    assert [item["rule"] for item in value["findings"]] == ["type-author"]
    assert value["findings"][0]["evidence_bound"] is True


def test_run_checks_reports_and_exports_resolved_evidence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """CI 调度导出同一受控证据位置并在报告中给出指纹；显式配置不可读时不回落。"""

    from scripts.workflow import run_checks

    root = tmp_path / "repository"
    index = root / java.DEFAULT_EVIDENCE_REGISTRY
    index.parent.mkdir(parents=True)
    index.write_text(
        json.dumps([evidence_record(demo_source())], ensure_ascii=False), encoding="utf-8"
    )
    assert run_checks.evidence_environment(root) == {java.EVIDENCE_REGISTRY_ENV: str(index)}
    report = run_checks.evidence_report(root)
    assert report["status"] == "configured"
    assert report["registry"] == str(index) and report["records"] == 1
    empty = tmp_path / "empty"
    empty.mkdir()
    assert run_checks.evidence_environment(empty) == {}
    assert run_checks.evidence_report(empty)["status"] == "absent"
    monkeypatch.setenv(java.EVIDENCE_REGISTRY_ENV, str(tmp_path))
    unusable = run_checks.evidence_report(root)
    assert unusable["status"] == "unusable"
    assert "证据清单不可读" in str(unusable["reason"])


def test_repository_source_index_covers_applied_objects() -> None:
    """交付的仓库内索引必须与账本指纹、记录数和当前源码字节一致。"""

    index = DEFAULT_ROOT / java.DEFAULT_EVIDENCE_REGISTRY
    assert index.is_file(), "仓库内受控来源索引必须存在"
    document = json.loads(index.read_text(encoding="utf-8"))
    manifest, records = document["manifest"], document["records"]
    assert document["index_schema"] == "d12-source-index/v1"
    assert manifest["source_ledger_name"] == "registry-d12b.tsv"
    # D10close 轮在同一 v3 账本内追加 6 列（evidence_branch、author_only_contract、content_points、
    # independence_reason、counter_evidence_conclusion、b1_review），账本指纹随之更新。
    assert manifest["source_ledger_sha256"] == (
        "986b40a03f5d8d26c7d1977f5e659e24d22a928a44bbb29f9c18715892afd94e"
    )
    assert manifest["source_ledger_records"] == 997
    assert manifest["source_ledger_columns"] == 73
    assert len(records) == 186 and manifest["selected_records"] == 186
    counted = collections.Counter(record["d12_verdict"] for record in records)
    assert manifest["selected_by_verdict"] == dict(sorted(counted.items()))
    # D14 §132 逐项复核落地后的判词分布，再加上 D15 §107 对 114 条逐项核实其他充分路线后的
    # 1 条改判：18 条 accepted、58 条复核回退、22 条需补证、77 条证据不足阻断、11 条 A1。
    # 前序「92 + 6 accepted」口径未被独立复核追认。
    assert dict(sorted(counted.items())) == {
        "A1（E1-author-only）成立，恢复上游证据支持的作者": 11,
        "复核回退，保持来源说明并登记阻断（尚未验收）": 58,
        "已按 D12 格式写入来源说明并撤回无依据署名": 18,
        "证据不足，保持原状并登记阻断": 77,
        "需补证，尚未验收": 22,
    }
    canonical = json.dumps(records, ensure_ascii=False, sort_keys=True).encode("utf-8")
    assert hashlib.sha256(canonical).hexdigest() == manifest["records_sha256"]
    assert manifest["duplicate_columns"] == [
        "author_status",
        "evidence_points",
        "evidence_route",
        "history_basis",
        "local_modification_facts",
        "local_sha256_after",
        "open_gap",
        "review_by",
        "review_conclusion",
        "review_date",
        "upstream_author_lines",
    ]
    registry = java.load_evidence_registry(index, None)
    assert len(registry.records) == 186 and not registry.unparsable
    applied = [
        record
        for record in records
        if record["d12_verdict"] == "已按 D12 格式写入来源说明并撤回无依据署名"
    ]
    assert len(applied) == 18
    for record in records:
        assert set(java.EVIDENCE_REQUIRED_FIELDS) <= set(record), record.get("local_path")
        evidence = json.loads(record["type_evidence"])
        assert evidence["schema"] == java.EVIDENCE_SCHEMA and evidence["types"]
        assert record["upstream_commit"] in record["upstream_file_url"]
        assert record["upstream_file_url"].endswith(record["upstream_path"])
        # D14 §132：本轮复核覆盖的 98 条（accepted + 回退 + 需补证）必须落复核方记录与逐项判断。
        rollback = record["d12_verdict"] in {
            "复核回退，保持来源说明并登记阻断（尚未验收）",
            "需补证，尚未验收",
        }
        if record["d12_verdict"] in java.SOURCE_NOTE_ACCEPTED_VERDICTS or rollback:
            assert record["independent_review"].startswith("复核方：")
            assert "D14 §118/§132 逐项判断" in record["b1_review"]
        if record["d12_verdict"] in java.SOURCE_NOTE_ACCEPTED_VERDICTS:
            # D14 §112：已验收记录的 P1/P2 内容点必须带 discrimination_reason 与语料/df 绑定。
            points = json.loads(record["d12_correspondence_points"])
            content = [
                point
                for point in points
                if str(point.get("kind", "")).startswith(("P1", "P2"))
            ]
            assert content, record["local_path"]
            for point in content:
                assert len(point["discrimination_reason"].strip()) >= 8
                assert record["upstream_commit"] in point["corpus_binding"]
                assert "df=" in point["corpus_binding"]
            # Q3：文件内来源说明的「本地修改」行与索引字段必须是同一句真实 diff 事实。
            note = re.search(
                r"^[ \t]*\*[ \t]*本地修改：(?P<body>.*)$",
                (DEFAULT_ROOT / record["local_path"]).read_text(encoding="utf-8"),
                re.MULTILINE,
            )
            assert note is not None, record["local_path"]
            assert note.group("body").strip() == record["local_modification_facts"]
        elif rollback:
            # D14 §120：本轮回退/需补证记录必须带阻断原因与可机械识别的「尚未验收」标注。
            assert record["d12_blocker_reason"], record["local_path"]
            assert "尚未验收" in record["open_gap"], record["local_path"]
    for record in applied:
        source = DEFAULT_ROOT / record["local_path"]
        assert hashlib.sha256(source.read_bytes()).hexdigest() == record["local_sha256_after"]
    # D14：11 条 A1 记录必须带完整的 E1-author-only 版本化契约，且契约自述的剩余内容一致成立；
    # D15 §107 改判的 ApiEncrypt 同样声明该分支，故为 12 条。
    author_only = [record for record in records if record.get("evidence_branch") == "E1-author-only"]
    assert len(author_only) == 12
    for record in author_only:
        contract = json.loads(record["author_only_contract"])
        assert contract["schema"] == "d10-author-only/v1"
        assert contract["branch"] == "E1-author-only" and contract["route"] == "路线 2"
        assert contract["normalization_order"] == list(java.AUTHOR_ONLY_NORMALIZATION_ORDER)
        assert contract["remaining"]["equal"] is True and contract["remaining"]["diff_lines"] == 0
        assert contract["remaining"]["line_count"] > 0
        assert contract["excluded_author_declarations"], record["local_path"]
        assert contract["attribution"] and contract["review"]["conclusion"]
        assert contract["tool"]["sha256"] == hashlib.sha256(
            (DEFAULT_ROOT / "scripts/code/java/check_staged_java_comments.py").read_bytes()
        ).hexdigest()
    # D14：4 条 C2 记录必须登记两个可定位的内容点与独立性/反证结论。
    content_independent = [
        record for record in records if record.get("evidence_branch") == "C2-independent-content"
    ]
    assert len(content_independent) == 4
    for record in content_independent:
        points = json.loads(record["content_points"])
        assert len(points) == 2
        assert record["independence_reason"] and record["counter_evidence_conclusion"]
        for point in points:
            assert point["point_kind"] in java.CONTENT_POINT_KINDS
            assert point["local_lines"] and point["upstream_lines"]
            assert hashlib.sha256(point["fragment"].encode("utf-8")).hexdigest() == point["fragment_sha256"]
    # 分支入口必须对已声明分支的记录真实复算：12 条 A1（含 D15 §107 改判）+ 4 条 C2。
    completed = subprocess.run(
        [
            sys.executable,
            str(DEFAULT_ROOT / "scripts/code/java/check_staged_java_comments.py"),
            "--validate-evidence-branches",
            "--evidence-registry",
            str(index),
            "--json",
        ],
        cwd=DEFAULT_ROOT,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    branch_report = json.loads(completed.stdout)
    assert branch_report["checked"] == 16 and branch_report["findings"] == []


RECORD_VO_PATH = JAVA_PATH.replace("EvidenceDemo.java", "EvidenceVO.java")
VO_QUALIFIED_NAME = "example.EvidenceVO"


def continuation_notes(
    segments: list[str], *, local_modification: str = "调整包名与类名。"
) -> list[str]:
    """按裁决 D13 生成带可选续行的来源说明行。

    Args:
        segments: 路径段序列，按出现顺序直接拼接即为完整上游路径。
        local_modification: 本地修改行正文。

    Returns:
        来源说明块的 JavaDoc 正文行。
    """

    lines = [
        f" * 来源：{UPSTREAM_REPO} @ {UPSTREAM_COMMIT}（该版本未声明作者）",
        f" * 上游文件：{segments[0]}",
    ]
    lines.extend(f" * 上游文件续：{segment}" for segment in segments[1:])
    lines.extend([f" * {java.SOURCE_BASIS_FIXED}", f" * 本地修改：{local_modification}"])
    return lines


def broken_continuation_cases() -> list[tuple[str, list[str], str]]:
    """返回裁决 D13 要求拒绝的续行用例：名称、来源说明行、期望诊断子串。"""

    header = f" * 来源：{UPSTREAM_REPO} @ {UPSTREAM_COMMIT}（该版本未声明作者）"
    first = f" * 上游文件：{UPSTREAM_PATH[:40]}"
    second = f" * 上游文件续：{UPSTREAM_PATH[40:]}"
    basis = f" * {java.SOURCE_BASIS_FIXED}"
    local = " * 本地修改：调整包名与类名。"
    return [
        ("删除续行导致路径截断", [header, first, basis, local], "上游文件路径与清单不一致"),
        ("续段截掉一个字符", [header, first, second[:-1], basis, local], "上游文件路径与清单不一致"),
        (
            "调换段顺序",
            [header, f" * 上游文件：{UPSTREAM_PATH[40:]}", f" * 上游文件续：{UPSTREAM_PATH[:40]}", basis, local],
            "上游文件路径与清单不一致",
        ),
        ("缺少首行只留续行", [header, second, basis, local], "上游文件首行必须以"),
        ("首行前缀错误", [header, f" * 上游文件X：{UPSTREAM_PATH[:40]}", second, basis, local], "上游文件首行必须以"),
        ("首段为空", [header, " * 上游文件：", second, basis, local], "上游文件首行必须以"),
        ("空续行载荷", [header, first, " * 上游文件续：", basis, local], "上游文件续行载荷为空"),
        ("只有空白的续行载荷", [header, first, " * 上游文件续：   ", basis, local], "上游文件续行载荷为空"),
        ("段边界插入空格", [header, first, f" * 上游文件续： {UPSTREAM_PATH[40:]}", basis, local], "上游文件路径与清单不一致"),
        ("续行位于本地修改之后", [header, first, basis, local, second], "续行必须紧跟"),
        ("首行与续行之间插空行", [header, first, " *", second, basis, local], "来源依据行不是固定取值"),
        ("首行与续行之间插块标签", [header, first, " * @author 李杰", second, basis, local], "来源依据行不是固定取值"),
        (
            "首行加三条续行",
            [
                header,
                f" * 上游文件：{UPSTREAM_PATH[:20]}",
                f" * 上游文件续：{UPSTREAM_PATH[20:40]}",
                f" * 上游文件续：{UPSTREAM_PATH[40:60]}",
                f" * 上游文件续：{UPSTREAM_PATH[60:]}",
                basis,
                local,
            ],
            "最多 3 段",
        ),
        (
            "重复斜杠",
            [header, " * 上游文件：yudao-framework//yudao-common/", f" * 上游文件续：{UPSTREAM_PATH[25:]}", basis, local],
            "不是有效的上游仓库相对路径",
        ),
        (
            "省略号替代原字符",
            [header, " * 上游文件：yudao-framework/…/", f" * 上游文件续：{UPSTREAM_PATH.rsplit('/', 1)[1]}", basis, local],
            "上游文件路径与清单不一致",
        ),
    ]


@pytest.mark.parametrize(
    "segments",
    [
        [UPSTREAM_PATH],
        [UPSTREAM_PATH[:40], UPSTREAM_PATH[40:]],
        [UPSTREAM_PATH[:20], UPSTREAM_PATH[20:45], UPSTREAM_PATH[45:]],
    ],
    ids=["一段", "两段", "三段"],
)
def test_path_continuation_segments_pass_the_real_checker(
    tmp_path: Path, segments: list[str]
) -> None:
    """一段、两段、三段路径都必须通过真实暂存入口，且拼接字节与清单逐字节一致。"""

    sandbox = create_sandbox(tmp_path / "repository")
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    assert "".join(segments) == UPSTREAM_PATH
    source = demo_source(notes=continuation_notes(segments))
    registry, snapshots = prepare_case(sandbox, evidence, source)
    result = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        *checker_args(registry, snapshots),
    )
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize(
    "name,notes,expected",
    broken_continuation_cases(),
    ids=[item[0] for item in broken_continuation_cases()],
)
def test_path_continuation_broken_forms_are_rejected(
    tmp_path: Path, name: str, notes: list[str], expected: str
) -> None:
    """续行的语法、位置、段数与载荷问题都必须因预期原因被真实入口拒绝。"""

    sandbox = create_sandbox(tmp_path / "repository")
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    source = demo_source(notes=notes)
    registry, snapshots = prepare_case(sandbox, evidence, source)
    result = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        *checker_args(registry, snapshots),
    )
    assert result.returncode == 1, result.stdout + result.stderr
    assert expected in result.stderr, result.stderr


def test_continuation_never_rebuilds_a_path_from_a_broken_first_line(tmp_path: Path) -> None:
    """首行前缀错误时不能靠续行拼出与清单一致的路径。"""

    sandbox = create_sandbox(tmp_path / "repository")
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    notes = [
        f" * 来源：{UPSTREAM_REPO} @ {UPSTREAM_COMMIT}（该版本未声明作者）",
        f" * 上游文件x：{UPSTREAM_PATH[:40]}",
        f" * 上游文件续：{UPSTREAM_PATH[40:]}",
        f" * {java.SOURCE_BASIS_FIXED}",
        " * 本地修改：调整包名与类名。",
    ]
    source = demo_source(notes=notes)
    registry, snapshots = prepare_case(sandbox, evidence, source)
    result = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        *checker_args(registry, snapshots),
    )
    assert result.returncode == 1, result.stdout + result.stderr
    assert "上游文件首行必须以" in result.stderr, result.stderr
    assert "上游文件路径与清单不一致" not in result.stderr, result.stderr


def test_registry_path_whitespace_is_not_trimmed_away(tmp_path: Path) -> None:
    """清单路径值首尾空白属于值本身，不能被 strip 后放行。"""

    sandbox = create_sandbox(tmp_path / "repository")
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    source = demo_source()
    record = evidence_record(source)
    record["upstream_path"] = f" {UPSTREAM_PATH} "
    registry, snapshots = prepare_case(sandbox, evidence, source, record=record)
    result = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        *checker_args(registry, snapshots),
    )
    assert result.returncode == 1, result.stdout + result.stderr
    assert "上游文件路径与清单不一致" in result.stderr, result.stderr


def record_vo_source(
    *,
    header_params: bool = True,
    component_javadoc: bool = False,
    empty_param_text: bool = False,
) -> str:
    """生成一个 VO record 样本，用于验证组件职责说明的两条等价通道。

    Args:
        header_params: 是否在 record 头部 JavaDoc 写 ``@param``。
        component_javadoc: 是否在每个组件上方写 JavaDoc。
        empty_param_text: ``@param`` 只写组件名、不写说明。

    Returns:
        完整的 Java 源码。
    """

    body = [" * 演示 record 组件职责说明通道。", " *"]
    if header_params:
        if empty_param_text:
            body.append(" * @param code")
            body.append(" * @param message")
        else:
            body.append(" * @param code 编码；0 表示成功，其它值表示失败")
            body.append(" * @param message 描述；固定文案，不回显原始报文")
    body.append(" * @author 李杰")
    components = []
    if component_javadoc:
        components.append("        /** 编码：0 表示成功，其它值表示失败。 */")
    components.append("        Integer code,")
    if component_javadoc:
        components.append("        /** 描述：固定文案，不回显原始报文。 */")
    components.append("        String message) {")
    components.append("}")
    return (
        "package example;\n\n"
        + "\n".join(["/**", *body, " */"])
        + "\npublic record EvidenceVO(\n"
        + "\n".join(components)
        + "\n"
    )


def prepare_vo_case(tmp_path: Path, source: str) -> tuple[GitSandbox, list[str]]:
    """构造 VO record 的隔离夹具，返回沙箱与真实检查参数。"""

    sandbox = create_sandbox(tmp_path / "repository")
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    record = evidence_record(source, local_path=RECORD_VO_PATH)
    record["type_evidence"] = type_evidence_value(
        source,
        qualified_name=VO_QUALIFIED_NAME,
        simple_name="EvidenceVO",
        kind="record",
        review_conclusion="逐项复核 EvidenceVO.java：来源、指纹与无作者结论一致。",
    )
    registry, snapshots = prepare_case(
        sandbox, evidence, source, local_path=RECORD_VO_PATH, record=record
    )
    return sandbox, checker_args(registry, snapshots)


def test_record_component_header_param_satisfies_responsibility(tmp_path: Path) -> None:
    """record 头部 @param 是组件职责说明的等价通道，不再要求悬空 JavaDoc。"""

    source = record_vo_source(header_params=True, component_javadoc=False)
    sandbox, arguments = prepare_vo_case(tmp_path, source)
    result = run_checker(
        sandbox, "scripts/code/java/check_staged_java_comments.py", *arguments
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_record_component_without_any_responsibility_is_rejected(tmp_path: Path) -> None:
    """既无组件上方 JavaDoc 又无头部 @param 时仍必须拒绝。"""

    source = record_vo_source(header_params=False, component_javadoc=False)
    sandbox, arguments = prepare_vo_case(tmp_path, source)
    result = run_checker(
        sandbox, "scripts/code/java/check_staged_java_comments.py", *arguments
    )
    assert result.returncode == 1, result.stdout + result.stderr
    assert "record 组件 code 缺少职责说明" in result.stderr, result.stderr
    assert "record 组件 message 缺少职责说明" in result.stderr, result.stderr


def test_record_component_header_param_without_text_is_rejected(tmp_path: Path) -> None:
    """头部 @param 只写组件名、没有说明时不算通过。"""

    source = record_vo_source(
        header_params=True, component_javadoc=False, empty_param_text=True
    )
    sandbox, arguments = prepare_vo_case(tmp_path, source)
    result = run_checker(
        sandbox, "scripts/code/java/check_staged_java_comments.py", *arguments
    )
    assert result.returncode == 1, result.stdout + result.stderr
    assert "record 组件 code 缺少职责说明" in result.stderr, result.stderr


def test_record_component_attached_javadoc_still_passes(tmp_path: Path) -> None:
    """原有的组件上方 JavaDoc 通道保持兼容。"""

    source = record_vo_source(header_params=False, component_javadoc=True)
    sandbox, arguments = prepare_vo_case(tmp_path, source)
    result = run_checker(
        sandbox, "scripts/code/java/check_staged_java_comments.py", *arguments
    )
    assert result.returncode == 0, result.stdout + result.stderr


# ---------------------------------------------------------------------------
# D14：E1-author-only 与 C2-independent-content 分支契约
# ---------------------------------------------------------------------------

A1_LOCAL_BASELINE = (
    "package com.basicframework.demo;\n\n"
    "/**\n"
    " * 演示来源说明例外。\n"
    " *\n"
    " * @author 李杰\n"
    " */\n"
    "public class EvidenceDemo {\n"
    "}\n"
)
A1_UPSTREAM = (
    "package cn.iocoder.yudao.demo;\n\n"
    "/**\n"
    " * 演示来源说明例外。\n"
    " *\n"
    " * @author 芋道源码\n"
    " */\n"
    "public class EvidenceDemo {\n"
    "}\n"
)
A1_LOCAL_FINAL = A1_LOCAL_BASELINE.replace("@author 李杰", "@author 芋道源码")
A1_MAPPING = [["com.basicframework", "cn.iocoder.yudao"]]
BRANCH_REGISTRY_COLUMNS = REGISTRY_COLUMNS + (
    "evidence_branch",
    "author_only_contract",
    "content_points",
    "independence_reason",
    "counter_evidence_conclusion",
)
CHECKER_SHA256 = hashlib.sha256(
    (DEFAULT_ROOT / "scripts/code/java/check_staged_java_comments.py").read_bytes()
).hexdigest()


def independent_remaining(
    text: str, excluded: list[int], mapping: list[list[str]] = A1_MAPPING
) -> list[str]:
    """测试侧独立实现 R1–R4 与作者行排除，用于构造期望值（不调用被测量实现）。"""

    dropped = set(excluded)
    lines = []
    for number, raw in enumerate(text.replace("\r\n", "\n").split("\n"), 1):
        if number in dropped:
            continue
        line = raw
        for source, target in mapping:
            line = line.replace(source, target)
        line = line.strip()
        if line:
            lines.append(line)
    return lines


def independent_raw_changed(left: str, right: str) -> tuple[int, int]:
    """测试侧独立统计两侧原始不相等行数。"""

    import difflib

    left_changed = right_changed = 0
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(
        None, left.split("\n"), right.split("\n"), autojunk=False
    ).get_opcodes():
        if tag == "equal":
            continue
        left_changed += i2 - i1
        right_changed += j2 - j1
    return left_changed, right_changed


def exclusion_entry(
    side: str, text: str, number: int, sha256: str, *, kind: str = "author", counterpart: str = ""
) -> dict[str, object]:
    """按实际原文构造一条排除记录。"""

    raw = text.split("\n")[number - 1]
    verbatim = raw.lstrip()
    if verbatim.startswith("*"):
        verbatim = verbatim[1:]
        if verbatim.startswith(" "):
            verbatim = verbatim[1:]
    return {
        "file": side,
        "sha256": sha256,
        "line_start": number,
        "line_end": number,
        "verbatim": verbatim,
        "declaration_kind": kind,
        "owner": "com.basicframework.demo.EvidenceDemo" if side == "local" else "cn.iocoder.yudao.demo.EvidenceDemo",
        "counterpart": counterpart,
        "counterpart_absent_reason": "" if counterpart else "对侧该注释块没有对应的作者声明行",
    }


def a1_contract(
    *,
    local_baseline: str = A1_LOCAL_BASELINE,
    upstream: str = A1_UPSTREAM,
    local_commit: str,
    excluded_local: list[int],
    excluded_upstream: list[int],
    continued_local: tuple[int, ...] = (),
    continued_upstream: tuple[int, ...] = (),
    remaining_equal: bool = True,
    attribution: list[dict[str, object]] | None = None,
) -> str:
    """构造 E1-author-only 比较契约（期望值由测试侧独立计算）。"""

    local_remaining = independent_remaining(local_baseline, excluded_local)
    upstream_remaining = independent_remaining(upstream, excluded_upstream)
    raw_local, raw_upstream = independent_raw_changed(local_baseline, upstream)
    if attribution is None:
        author_local = len(excluded_local)
        author_upstream = len(excluded_upstream)
        attribution = [
            {
                "cause": "excluded-author-declaration",
                "changed_lines": {"local": author_local, "upstream": author_upstream},
            },
            {
                "cause": "R2-mapping",
                "changed_lines": {
                    "local": max(0, raw_local - author_local),
                    "upstream": max(0, raw_upstream - author_upstream),
                },
            },
        ]
    contract = {
        "schema": java.AUTHOR_ONLY_SCHEMA,
        "branch": java.EVIDENCE_BRANCH_AUTHOR_ONLY,
        "route": java.AUTHOR_ONLY_ROUTE,
        "local_baseline": {
            "commit": local_commit,
            "path": JAVA_PATH,
            "sha256": digest(local_baseline),
        },
        "upstream_input": {
            "repo_url": f"https://github.com/{UPSTREAM_REPO}.git",
            "commit": UPSTREAM_COMMIT,
            "path": UPSTREAM_PATH,
            "file_url": upstream_file_url(),
            "sha256": digest(upstream),
        },
        "normalization_order": list(java.AUTHOR_ONLY_NORMALIZATION_ORDER),
        "mapping_basis": "D10 §0.3 原列 R2 命名空间映射",
        "r2_mapping": A1_MAPPING,
        "excluded_author_declarations": [
            exclusion_entry(
                "local",
                local_baseline,
                number,
                digest(local_baseline),
                kind="author-continuation" if number in continued_local else "author",
            )
            for number in excluded_local
        ]
        + [
            exclusion_entry(
                "upstream",
                upstream,
                number,
                digest(upstream),
                kind="author-continuation" if number in continued_upstream else "author",
            )
            for number in excluded_upstream
        ],
        "remaining": {
            "local_sha256": hashlib.sha256("\n".join(local_remaining).encode("utf-8")).hexdigest(),
            "upstream_sha256": hashlib.sha256("\n".join(upstream_remaining).encode("utf-8")).hexdigest(),
            "line_count": len(local_remaining),
            "equal": remaining_equal,
            "diff_lines": 0 if remaining_equal else 1,
        },
        "attribution": attribution,
        "tool": {
            "name": "scripts/code/java/check_staged_java_comments.py",
            "version": java.AUTHOR_ONLY_SCHEMA,
            "sha256": CHECKER_SHA256,
        },
        "review": {
            "implementer": "D14 规则测试",
            "reviewer": "D14 规则测试复核",
            "date": "2026-10-06",
            "conclusion": "逐项复核 EvidenceDemo：只差作者声明及 R2 映射，其余内容逐行一致。",
        },
        "counter_evidence_conclusion": "无反证：本地无创建记录、无共同贡献记录，未发现其他来源。",
    }
    return json.dumps(contract, ensure_ascii=False)


def branch_record(
    source: str,
    *,
    contract: str | None = None,
    branch: str = java.EVIDENCE_BRANCH_AUTHOR_ONLY,
    content_points: str = "",
    independence_reason: str = "",
    route: str = java.AUTHOR_ONLY_ROUTE,
) -> dict[str, str]:
    """构造声明证据分支的清单记录。"""

    record = evidence_record(source, evidence_route=route)
    record["evidence_branch"] = branch
    record["local_sha256_after"] = digest(source)
    if contract is not None:
        record["author_only_contract"] = contract
    if content_points:
        record["content_points"] = content_points
    if independence_reason:
        record["independence_reason"] = independence_reason
    record["counter_evidence_conclusion"] = "无反证：未发现其他来源或共同贡献记录。"
    return record


def prepare_branch_case(
    tmp_path: Path,
    *,
    local_baseline: str = A1_LOCAL_BASELINE,
    final_source: str = A1_LOCAL_FINAL,
    upstream: str = A1_UPSTREAM,
    contract_builder=None,
    branch: str = java.EVIDENCE_BRANCH_AUTHOR_ONLY,
    content_points: str = "",
    independence_reason: str = "两点各自独立提供不同业务事实。",
    route: str = java.AUTHOR_ONLY_ROUTE,
):
    """构造声明分支的隔离夹具，返回沙箱、清单与参数。"""

    sandbox = create_sandbox(tmp_path / "repository")
    sandbox.stage(JAVA_PATH, local_baseline)
    sandbox.record_baseline()
    baseline_commit = sandbox.git("rev-parse", "HEAD").decode().strip()
    sandbox.stage(JAVA_PATH, final_source)
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    snapshots = evidence / "snapshots"
    write_snapshot(snapshots, upstream)
    contract = None if contract_builder is None else contract_builder(baseline_commit)
    record = branch_record(
        local_baseline,
        contract=contract,
        branch=branch,
        content_points=content_points,
        independence_reason=independence_reason,
        route=route,
    )
    record["local_sha256_after"] = digest(final_source)
    record["upstream_sha256"] = digest(upstream)
    registry = write_registry(
        evidence / "registry.tsv", [record], columns=BRANCH_REGISTRY_COLUMNS
    )
    return sandbox, registry, snapshots


def run_branch_checker(sandbox, registry: Path, snapshots: Path):
    """以真实 CLI 复算声明的证据分支。"""

    return run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        "--validate-evidence-branches",
        *checker_args(registry, snapshots),
    )


def test_author_only_branch_legal_case_passes_the_real_consumer(tmp_path: Path) -> None:
    """D14 正例：只差作者声明与 R2 映射时，E1-author-only 成立并退出 0。"""

    sandbox, registry, snapshots = prepare_branch_case(
        tmp_path,
        contract_builder=lambda commit: a1_contract(
            local_commit=commit, excluded_local=[6], excluded_upstream=[6]
        ),
    )
    result = run_branch_checker(sandbox, registry, snapshots)
    assert result.returncode == 0, result.stdout + result.stderr
    assert '"checked": 1' in result.stdout, result.stdout
    assert '"status": "passed"' in result.stdout, result.stdout


def test_author_only_branch_rejects_remaining_difference(tmp_path: Path) -> None:
    """D14 负对照①：忽略作者行后仍有差异，不得判派生。"""

    upstream = A1_UPSTREAM.replace(
        "public class EvidenceDemo {\n}\n",
        "public class EvidenceDemo {\n    /** 业务常量 */\n    static final String CLIENT_ID = \"default\";\n}\n",
    )
    sandbox, registry, snapshots = prepare_branch_case(
        tmp_path,
        upstream=upstream,
        contract_builder=lambda commit: a1_contract(
            upstream=upstream,
            local_commit=commit,
            excluded_local=[6],
            excluded_upstream=[6],
        ),
    )
    result = run_branch_checker(sandbox, registry, snapshots)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "E1-author-only 比较不成立" in result.stdout, result.stdout


def test_author_only_branch_rejects_non_author_excluded_line(tmp_path: Path) -> None:
    """D14 负对照②：被忽略的行不只有作者声明时，不得整行排除。"""

    sandbox, registry, snapshots = prepare_branch_case(
        tmp_path,
        contract_builder=lambda commit: a1_contract(
            local_commit=commit,
            excluded_local=[4, 6],
            excluded_upstream=[6],
        ),
    )
    result = run_branch_checker(sandbox, registry, snapshots)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "不能作为纯作者声明排除" in result.stdout, result.stdout


def test_author_only_branch_rejects_mixed_author_and_business_line(tmp_path: Path) -> None:
    """D14 负对照②变体：一行混合作者与业务事实时不得整行排除。"""

    baseline = A1_LOCAL_BASELINE.replace("@author 李杰", "@author 李杰 负责订单模块")
    final = baseline.replace("@author 李杰 负责订单模块", "@author 芋道源码")
    sandbox, registry, snapshots = prepare_branch_case(
        tmp_path,
        local_baseline=baseline,
        final_source=final,
        contract_builder=lambda commit: a1_contract(
            local_baseline=baseline,
            local_commit=commit,
            excluded_local=[6],
            excluded_upstream=[6],
        ),
    )
    result = run_branch_checker(sandbox, registry, snapshots)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "不能作为纯作者声明排除" in result.stdout, result.stdout


def test_author_only_branch_accepts_pure_author_continuation(tmp_path: Path) -> None:
    """纯作者身份续行（主页地址）可以排除，且仍要求其余内容逐行一致。"""

    baseline = A1_LOCAL_BASELINE.replace(
        " * @author 李杰\n", " * @author 李杰\n * <https://github.com/lijie>\n"
    )
    upstream = A1_UPSTREAM.replace(
        " * @author 芋道源码\n", " * @author 芋道源码\n * <https://github.com/YunaiV>\n"
    )
    final = baseline.replace("@author 李杰", "@author 芋道源码")
    sandbox, registry, snapshots = prepare_branch_case(
        tmp_path,
        local_baseline=baseline,
        final_source=final,
        upstream=upstream,
        contract_builder=lambda commit: a1_contract(
            local_baseline=baseline,
            upstream=upstream,
            local_commit=commit,
            excluded_local=[6, 7],
            excluded_upstream=[6, 7],
            continued_local=(7,),
            continued_upstream=(7,),
        ),
    )
    result = run_branch_checker(sandbox, registry, snapshots)
    assert result.returncode == 0, result.stdout + result.stderr


def test_author_only_branch_rejects_unregistered_author_line(tmp_path: Path) -> None:
    """漏登记独立 @author 行时不允许静默排除。"""

    sandbox, registry, snapshots = prepare_branch_case(
        tmp_path,
        contract_builder=lambda commit: a1_contract(
            local_commit=commit, excluded_local=[], excluded_upstream=[6]
        ),
    )
    result = run_branch_checker(sandbox, registry, snapshots)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "没有登记在排除记录中" in result.stdout, result.stdout


def test_author_only_branch_rejects_tampered_tool_fingerprint(tmp_path: Path) -> None:
    """工具指纹与当前规则实现不符时拒绝（版本绑定不能被绕过）。"""

    def builder(commit: str) -> str:
        """构造工具指纹被篡改的 A1 契约，用于验证版本绑定不可绕过。"""
        contract = json.loads(
            a1_contract(local_commit=commit, excluded_local=[6], excluded_upstream=[6])
        )
        contract["tool"]["sha256"] = "0" * 64
        return json.dumps(contract, ensure_ascii=False)

    sandbox, registry, snapshots = prepare_branch_case(tmp_path, contract_builder=builder)
    result = run_branch_checker(sandbox, registry, snapshots)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "tool.sha256 与当前规则实现不符" in result.stdout, result.stdout


def c2_point(
    fragment: str,
    *,
    field_or_behavior: str,
    local_lines: list[int],
    upstream_lines: list[int],
    point_kind: str = "内容点",
    discrimination_reason: str = "该片段是本文件独有的业务事实，另一处无法替代。",
) -> dict[str, object]:
    """构造一个 C2 内容点。"""

    return {
        "fragment": fragment,
        "fragment_sha256": digest(fragment),
        "local_path": JAVA_PATH,
        "local_sha256": digest(A1_LOCAL_FINAL),
        "upstream_path": UPSTREAM_PATH,
        "upstream_sha256": digest(A1_UPSTREAM),
        "local_lines": local_lines,
        "upstream_lines": upstream_lines,
        "owner_type": QUALIFIED_NAME,
        "field_or_behavior": field_or_behavior,
        "point_kind": point_kind,
        "corpus_binding": "上游语料 7244 个 Java 文件，df=1",
        "discrimination_reason": discrimination_reason,
    }


def test_content_independent_branch_accepts_two_distinct_points(tmp_path: Path) -> None:
    """D14 正例：两个不同字段的非通用业务事实可以按 C2 分支通过。"""

    points = [
        c2_point("订单超时时间默认 30 分钟", field_or_behavior="timeoutMinutes", local_lines=[12], upstream_lines=[10]),
        c2_point("库存扣减失败必须整体回滚", field_or_behavior="rollbackOnStockFailure", local_lines=[24], upstream_lines=[19]),
    ]
    sandbox, registry, snapshots = prepare_branch_case(
        tmp_path,
        branch=java.EVIDENCE_BRANCH_CONTENT_INDEPENDENT,
        route="路线 3",
        content_points=json.dumps(points, ensure_ascii=False),
        independence_reason="两点分别指超时时间与回滚条件，各自独立提供不同业务事实。",
    )
    result = run_branch_checker(sandbox, registry, snapshots)
    assert result.returncode == 0, result.stdout + result.stderr
    assert '"checked": 1' in result.stdout, result.stdout


def test_content_independent_branch_rejects_generic_and_duplicate_points(tmp_path: Path) -> None:
    """D14 B1 负对照：通用校验串、同字段复述、同一句拆两点都不能通过。"""

    points = [
        c2_point("不能为空", field_or_behavior="clientId", local_lines=[12], upstream_lines=[10]),
        c2_point("不能为空", field_or_behavior="clientId", local_lines=[12], upstream_lines=[10]),
    ]
    sandbox, registry, snapshots = prepare_branch_case(
        tmp_path,
        branch=java.EVIDENCE_BRANCH_CONTENT_INDEPENDENT,
        route="路线 3",
        content_points=json.dumps(points, ensure_ascii=False),
    )
    result = run_branch_checker(sandbox, registry, snapshots)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "通用形状" in result.stdout, result.stdout
    assert "同一片段" in result.stderr or "重复描述" in result.stdout, result.stdout


def test_content_independent_branch_rejects_structural_points(tmp_path: Path) -> None:
    """两个结构点不能满足 C2（裁决 D14 §118）。"""

    points = [
        c2_point("结构块 A 连续 9 行", field_or_behavior="blockA", local_lines=[12, 20], upstream_lines=[10, 18], point_kind="结构点"),
        c2_point("结构块 B 连续 12 行", field_or_behavior="blockB", local_lines=[30, 44], upstream_lines=[28, 42], point_kind="结构点"),
    ]
    sandbox, registry, snapshots = prepare_branch_case(
        tmp_path,
        branch=java.EVIDENCE_BRANCH_CONTENT_INDEPENDENT,
        route="路线 3",
        content_points=json.dumps(points, ensure_ascii=False),
    )
    result = run_branch_checker(sandbox, registry, snapshots)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "结构点不能作为 C2 的内容点" in result.stdout, result.stdout


def test_branch_validation_ignores_records_without_declared_branch(tmp_path: Path) -> None:
    """未声明分支的记录不由分支入口判定，本入口不改变既有条目的结论。"""

    sandbox = create_sandbox(tmp_path / "repository")
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    source = demo_source()
    registry, snapshots = prepare_case(sandbox, evidence, source)
    result = run_branch_checker(sandbox, registry, snapshots)
    assert result.returncode == 0, result.stdout + result.stderr
    assert '"checked": 0' in result.stdout, result.stdout


# ---------------------------------------------------------------------------
# N1：分支↔路线归属必须由分支入口复算，且与来源说明入口口径一致
# ---------------------------------------------------------------------------


def route_content_point(
    fragment: str,
    *,
    field_or_behavior: str,
    local_lines: list[int],
    upstream_lines: list[int],
) -> dict[str, object]:
    """构造 C2 内容点，双方路径与指纹取自来源说明夹具。"""

    return {
        "fragment": fragment,
        "fragment_sha256": digest(fragment),
        "local_path": JAVA_PATH,
        "local_sha256": digest(demo_source()),
        "upstream_path": UPSTREAM_PATH,
        "upstream_sha256": digest(UPSTREAM_SOURCE),
        "local_lines": local_lines,
        "upstream_lines": upstream_lines,
        "owner_type": QUALIFIED_NAME,
        "field_or_behavior": field_or_behavior,
        "point_kind": "内容点",
        "corpus_binding": "上游语料 7244 个 Java 文件，df=1",
        "discrimination_reason": "该片段是本文件独有的业务事实，另一处无法替代。",
    }


def route_content_points() -> str:
    """返回两个互不重复、不同字段的 C2 内容点 JSON。"""

    return json.dumps(
        [
            route_content_point(
                "订单超时时间默认 30 分钟",
                field_or_behavior="timeoutMinutes",
                local_lines=[12],
                upstream_lines=[10],
            ),
            route_content_point(
                "库存扣减失败必须整体回滚",
                field_or_behavior="rollbackOnStockFailure",
                local_lines=[24],
                upstream_lines=[19],
            ),
        ],
        ensure_ascii=False,
    )


def prepare_declared_route_case(
    tmp_path: Path, *, route: str | None, branch: str = java.EVIDENCE_BRANCH_CONTENT_INDEPENDENT
) -> tuple[GitSandbox, Path, Path, dict[str, str]]:
    """构造「带来源说明 + 声明 C2 分支」的隔离夹具，返回沙箱、清单、快照与记录。"""

    sandbox = create_sandbox(tmp_path / "repository")
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    source = demo_source()
    record = branch_record(
        source,
        branch=branch,
        route=route if route is not None else "路线 3",
        content_points=route_content_points(),
        independence_reason="两点分别指超时时间与回滚条件，各自独立提供不同业务事实。",
    )
    if route is None:
        del record["evidence_route"]
    sandbox.stage(JAVA_PATH, source)
    target = sandbox.root / JAVA_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(source, encoding="utf-8")
    snapshots = evidence / "snapshots"
    write_snapshot(snapshots, UPSTREAM_SOURCE)
    registry = write_registry(
        evidence / "registry.tsv", [record], columns=BRANCH_REGISTRY_COLUMNS
    )
    return sandbox, registry, snapshots, record


def run_full_entry(
    sandbox: GitSandbox, registry: Path, snapshots: Path
) -> subprocess.CompletedProcess[str]:
    """以真实全量入口检查隔离仓库。"""

    return run_checker(
        sandbox,
        "scripts/code/java/check_full_java_comments.py",
        "--json",
        "--root",
        str(sandbox.root),
        *checker_args(registry, snapshots),
    )


def finding_details(result: subprocess.CompletedProcess[str]) -> list[str]:
    """取出真实 JSON 输出里的诊断文本。"""

    value = json.loads(result.stdout)
    return [str(item["detail"]) for item in value["findings"]]


def test_c2_route_mismatch_is_rejected_by_branch_and_source_note_entries(tmp_path: Path) -> None:
    """N1 负对照①：C2 记录写成路线 2 时，分支入口必须与来源说明入口给出同一诊断。"""

    sandbox, registry, snapshots, _ = prepare_declared_route_case(tmp_path, route="路线 2")
    expected = "C2-independent-content 分支归属路线 3，当前 evidence_route=路线 2"
    branch = run_branch_checker(sandbox, registry, snapshots)
    assert branch.returncode == 1, branch.stdout + branch.stderr
    branch_reasons = json.loads(branch.stdout)["findings"]
    assert branch_reasons == [f"{JAVA_PATH}：[{expected}]"], branch.stdout
    staged = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        "--json",
        *checker_args(registry, snapshots),
    )
    assert staged.returncode == 1, staged.stdout + staged.stderr
    assert any(expected in detail for detail in finding_details(staged)), staged.stdout
    full = run_full_entry(sandbox, registry, snapshots)
    assert full.returncode == 1, full.stdout + full.stderr
    assert any(expected in detail for detail in finding_details(full)), full.stdout


def test_c2_missing_route_is_rejected_by_branch_and_source_note_entries(tmp_path: Path) -> None:
    """N1 负对照④：C2 记录缺失 evidence_route 时，两个入口都按同一条路线诊断拒绝。"""

    sandbox, registry, snapshots, _ = prepare_declared_route_case(tmp_path, route=None)
    expected = "证据路线不受支持：空"
    branch = run_branch_checker(sandbox, registry, snapshots)
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert json.loads(branch.stdout)["findings"] == [f"{JAVA_PATH}：[{expected}]"]
    staged = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        "--json",
        *checker_args(registry, snapshots),
    )
    assert staged.returncode == 1, staged.stdout + staged.stderr
    assert any(expected in detail for detail in finding_details(staged)), staged.stdout
    full = run_full_entry(sandbox, registry, snapshots)
    assert full.returncode == 1, full.stdout + full.stderr
    assert any(expected in detail for detail in finding_details(full)), full.stdout


def test_author_only_route_mismatch_is_rejected_by_branch_entry(tmp_path: Path) -> None:
    """N1 负对照②：E1 记录写成路线 3 时，分支入口必须拒绝并给出路线归属诊断。"""

    sandbox, registry, snapshots = prepare_branch_case(
        tmp_path,
        route="路线 3",
        contract_builder=lambda commit: a1_contract(
            local_commit=commit, excluded_local=[6], excluded_upstream=[6]
        ),
    )
    result = run_branch_checker(sandbox, registry, snapshots)
    assert result.returncode == 1, result.stdout + result.stderr
    expected = "E1-author-only 分支归属路线 2，当前 evidence_route=路线 3"
    assert json.loads(result.stdout)["findings"] == [f"{JAVA_PATH}：[{expected}]"], result.stdout
    record = evidence_record(A1_LOCAL_FINAL, evidence_route="路线 3")
    record["evidence_branch"] = java.EVIDENCE_BRANCH_AUTHOR_ONLY
    # 两个入口共用同一判据：函数级结果必须逐字相同。
    assert java._branch_route_reasons(record) == java._route_reasons(record) == [expected]


def test_legal_route_ownership_passes_branch_and_source_note_entries(tmp_path: Path) -> None:
    """N1 负对照③：合法归属（C2 ↔ 路线 3）在两个入口都放行。"""

    sandbox, registry, snapshots, _ = prepare_declared_route_case(tmp_path, route="路线 3")
    branch = run_branch_checker(sandbox, registry, snapshots)
    assert branch.returncode == 0, branch.stdout + branch.stderr
    assert json.loads(branch.stdout)["checked"] == 1
    staged = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        "--json",
        *checker_args(registry, snapshots),
    )
    assert staged.returncode == 0, staged.stdout + staged.stderr
    full = run_full_entry(sandbox, registry, snapshots)
    assert full.returncode == 0, full.stdout + full.stderr
    assert json.loads(full.stdout)["findings"] == []


def test_branch_route_ownership_judgement_is_shared_by_both_entries() -> None:
    """两个入口对分支↔路线归属共用同一判据，不接受两处各写一份口径。"""

    base = evidence_record(demo_source())
    for route in ("路线 1", "路线 2", "路线 3", ""):
        for branch in (
            java.EVIDENCE_BRANCH_AUTHOR_ONLY,
            java.EVIDENCE_BRANCH_CONTENT_INDEPENDENT,
        ):
            record = dict(base)
            record["evidence_route"] = route
            record["evidence_branch"] = branch
            branch_reasons = java._branch_route_reasons(record)
            route_reasons = java._route_reasons(record)
            if route_reasons and route_reasons[0].startswith(
                ("证据路线不受支持", f"{branch} 分支归属")
            ):
                # 分支判据之前只有路线判据，两个入口必须逐字一致。
                assert branch_reasons == route_reasons, (route, branch)
            expected = java.EVIDENCE_BRANCH_ROUTES[branch]
            if route == expected:
                assert branch_reasons == [], (route, branch)
            else:
                assert branch_reasons, (route, branch)


# ---------------------------------------------------------------------------
# D13 §72/§88：尾部空白不得被裁剪后放行（真实消费者负对照）
# ---------------------------------------------------------------------------


def source_note_with_tail_whitespace_cases() -> list[tuple[str, list[str], str]]:
    """返回行尾/段内空白负对照：名称、来源说明行、期望诊断子串。"""

    header = f" * 来源：{UPSTREAM_REPO} @ {UPSTREAM_COMMIT}（该版本未声明作者）"
    first = f" * 上游文件：{UPSTREAM_PATH[:40]}"
    second = f" * 上游文件续：{UPSTREAM_PATH[40:]}"
    basis = f" * {java.SOURCE_BASIS_FIXED}"
    local = " * 本地修改：调整包名与类名。"
    return [
        ("首行行尾空格", [header, first + " ", basis, local], "上游文件路径与清单不一致"),
        ("首行行尾制表符", [header, first + "\t", basis, local], "上游文件路径与清单不一致"),
        ("首行前缀后空格", [header, f" * 上游文件： {UPSTREAM_PATH[:40]}", second, basis, local], "上游文件路径与清单不一致"),
        ("续行行尾空格", [header, first, second + " ", basis, local], "上游文件路径与清单不一致"),
        ("续行行尾制表符", [header, first, second + "\t", basis, local], "上游文件路径与清单不一致"),
        ("续行前缀后空格", [header, first, f" * 上游文件续： {UPSTREAM_PATH[40:]}", basis, local], "上游文件路径与清单不一致"),
        (
            "段中间插入空格",
            [header, f" * 上游文件：{UPSTREAM_PATH[:20]} {UPSTREAM_PATH[20:40]}", second, basis, local],
            "上游文件路径与清单不一致",
        ),
        ("来源行行尾空格", [header + " ", first, second, basis, local], "来源说明首行不符合固定语法"),
        ("来源依据行行尾空格", [header, first, second, basis + " ", local], "来源依据行不是固定取值"),
    ]


@pytest.mark.parametrize(
    "name,notes,expected",
    source_note_with_tail_whitespace_cases(),
    ids=[item[0] for item in source_note_with_tail_whitespace_cases()],
)
def test_source_note_tail_whitespace_is_rejected(
    tmp_path: Path, name: str, notes: list[str], expected: str
) -> None:
    """行尾空格/制表符、段中间空格、前缀后空格都必须被真实入口拒绝，不能靠 strip 放行。"""

    sandbox = create_sandbox(tmp_path / "repository")
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    source = demo_source(notes=notes)
    registry, snapshots = prepare_case(sandbox, evidence, source)
    result = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        *checker_args(registry, snapshots),
    )
    assert result.returncode == 1, result.stdout + result.stderr
    assert expected in result.stderr, result.stderr


def test_javadoc_body_lines_preserve_payload_tail(tmp_path: Path) -> None:
    """JavaDoc 正文行解析只剥离外框/缩进/装饰星号，行尾字符原样保留。"""

    lines = java._javadoc_body_lines("/**\n * 上游文件：a/b.java \n *\t尾部制表符\t\n */")
    assert lines[1] == "上游文件：a/b.java "
    assert lines[2] == "\t尾部制表符\t"


def test_source_note_without_tail_whitespace_still_passes(tmp_path: Path) -> None:
    """正对照：同样的两段路径在没有尾部空白时通过，证明拒绝来自空白本身。"""

    sandbox = create_sandbox(tmp_path / "repository")
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    source = demo_source(
        notes=continuation_notes([UPSTREAM_PATH[:40], UPSTREAM_PATH[40:]])
    )
    registry, snapshots = prepare_case(sandbox, evidence, source)
    result = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        *checker_args(registry, snapshots),
    )
    assert result.returncode == 0, result.stdout + result.stderr


# ---------------------------------------------------------------------------
# 复核 A/C 的仓库内回归守卫：索引字段与工作树逐条一致、对应点可在当前文件定位
# ---------------------------------------------------------------------------


def expected_type_fields(source: str) -> dict[tuple[str, bool], dict[str, object]]:
    """按检查器口径从当前源码独立复算类型行号与 JavaDoc 指纹。"""

    masked = java._mask_java(source)
    starts = java._line_starts(source)
    brace_depths = java._depths(masked, "{", "}")
    brace_pairs = java._matching_delimiters(masked, "{", "}")
    declarations = java._type_declarations(masked, brace_depths, brace_pairs)
    package = java._package_name(masked)
    result: dict[tuple[str, bool], dict[str, object]] = {}
    for declaration in declarations:
        enclosing, qualified = java._qualified_type_names(declarations, declaration, package)
        span = java._attached_javadoc_span(source, declaration.declaration_offset)
        javadoc = "" if span is None else source[span[0] : span[1]]
        result[(qualified, enclosing is not None)] = {
            "declaration_line": java._line_number(starts, declaration.name_offset),
            "javadoc_start_line": None if span is None else java._line_number(starts, span[0]),
            "javadoc_end_line": None if span is None else java._line_number(starts, span[1] - 1),
            "javadoc_sha256": digest(javadoc),
        }
    return result


def test_repository_source_index_fields_match_worktree_bytes() -> None:
    """索引内部字段必须随最终字节重绑：六类字段与工作树逐条一致（0 不符）。"""

    index = DEFAULT_ROOT / java.DEFAULT_EVIDENCE_REGISTRY
    document = json.loads(index.read_text(encoding="utf-8"))
    mismatches: collections.Counter = collections.Counter()
    for record in document["records"]:
        data = (DEFAULT_ROOT / record["local_path"]).read_bytes()
        expected = hashlib.sha256(data).hexdigest()
        if record["local_sha256_after"] != expected:
            mismatches["local_sha256_after"] += 1
        evidence = json.loads(record["type_evidence"])
        if evidence["file"]["local_sha256_final"] != expected:
            mismatches["local_sha256_final"] += 1
        mapping = expected_type_fields(data.decode("utf-8"))
        for entry in evidence["types"]:
            key = (entry["qualified_name"], bool(entry.get("nested")))
            computed = mapping.get(key)
            assert computed is not None, (record["local_path"], key)
            for field in (
                "declaration_line",
                "javadoc_start_line",
                "javadoc_end_line",
                "javadoc_sha256",
            ):
                if entry[field] != computed[field]:
                    mismatches[field] += 1
    assert not mismatches, dict(mismatches)
    rebinding = document["manifest"]["field_rebinding"]
    assert set(rebinding["after_mismatch"].values()) == {0}
    assert rebinding["repeatable_step"]


def test_repository_correspondence_points_locate_on_current_files() -> None:
    """路线 3 的对应点必须能在当前文件定位（D12 §112），不可定位项应逐条列出。"""

    index = DEFAULT_ROOT / java.DEFAULT_EVIDENCE_REGISTRY
    document = json.loads(index.read_text(encoding="utf-8"))
    checked = unlocated = structural = 0
    for record in document["records"]:
        lines = (DEFAULT_ROOT / record["local_path"]).read_text(encoding="utf-8").split("\n")
        for point in json.loads(record["d12_correspondence_points"]):
            fragment = point.get("fragment")
            numbers = list(point.get("local_lines") or [])
            if not fragment:
                structural += 1
                continue
            checked += 1
            assert numbers, (record["local_path"], fragment)
            if "->" in fragment:
                names = [name.strip() for name in fragment.split("->") if name.strip()]
                located = bool(
                    re.search(rf"\b{re.escape(names[0])}\b", lines[numbers[0] - 1])
                    and re.search(rf"\b{re.escape(names[-1])}\b", lines[numbers[-1] - 1])
                )
            else:
                located = all(fragment in lines[number - 1] for number in numbers)
            if not located:
                unlocated += 1
    assert unlocated == 0
    relocalization = document["manifest"]["relocalization"]
    # manifest 声明的计数必须与逐条实测一致，且“每个片段点都能定位”是绝对不变量。
    assert relocalization["points_total"] == checked + structural
    assert relocalization["points_with_fragment"] == checked
    assert relocalization["structural_points_out_of_scope"]["count"] == structural
    assert relocalization["unlocated"] == 0
    assert relocalization["relocated"] + relocalization["kept"] == checked


def test_repository_structural_points_all_have_current_line_numbers() -> None:
    """155 个无 fragment 的结构/说明点必须都有落在当前文件内的行号（不可定位为 0）。"""

    index = DEFAULT_ROOT / java.DEFAULT_EVIDENCE_REGISTRY
    document = json.loads(index.read_text(encoding="utf-8"))
    localization = document["manifest"]["structural_point_localization"]
    items = localization["items"]
    assert len(items) == localization["summary"]["points_without_fragment"] == 155
    assert localization["summary"]["unlocated"] == 0
    assert localization["summary"]["one_side"] == 0
    assert (
        localization["summary"]["localized"] + localization["summary"]["author_declaration_notes"]
        == len(items)
    )
    for item in items:
        assert item["status"] in {"起点已定位", "说明点（作者声明）"}, item
        assert item["localized_local_lines"] and item["localized_upstream_lines"], item["local_path"]
        source_lines = (DEFAULT_ROOT / item["local_path"]).read_text(encoding="utf-8").split("\n")
        assert max(item["localized_local_lines"]) <= len(source_lines), item["local_path"]


def test_repository_manifest_declares_ledger_replay_relation() -> None:
    """索引必须如实登记与声明账本的差异字段与重放输入，不得假称一致。"""

    index = DEFAULT_ROOT / java.DEFAULT_EVIDENCE_REGISTRY
    document = json.loads(index.read_text(encoding="utf-8"))
    manifest = document["manifest"]
    replay = manifest["ledger_replay"]
    assert replay["declared_ledger_name"] == manifest["source_ledger_name"]
    assert replay["declared_ledger_sha256"] == manifest["source_ledger_sha256"]
    assert replay["declared_ledger_records"] == 997
    assert replay["ledger_local_sha_compared"] == len(document["records"])
    # 账本每条指纹必须等于当前工作树、整改前 daf4d23^、本轮回退前工作树或标注回填前
    # 工作树四者之一，不允许第五种来源；d14_review_round 已登记第三者为 Q3 改写前的
    # 合法比较输入，manifest.marker_backfill.prerebind_sha256 登记第四者的逐文件指纹。
    assert replay["ledger_local_sha_matches_neither"] == 0
    assert replay["d14_review_round"]
    assert (
        replay["ledger_local_sha_matches_worktree"]
        + sum(replay["ledger_local_sha_matches_revision"].values())
        + replay["ledger_local_sha_matches_d14_prerebind"]
        + replay["ledger_local_sha_matches_marker_backfill_prerebind"]
        >= len(document["records"])
    )
    # 索引按工作树重绑、账本是混合快照：差异必须如实登记，不得声称逐字节一致。
    assert replay["differing_records"] > 0
    assert "local_sha256_after" in replay["differing_fields"]
    assert replay["replay_inputs"] and replay["replay_command"] and replay["replay_rule"]
    assert manifest["duplicate_column_mismatches"]
    assert manifest["producer"].startswith("由 .bf-local/d10fix/")
