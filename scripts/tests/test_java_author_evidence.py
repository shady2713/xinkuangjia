"""验证 D12 来源说明例外的格式、逐项证据核验与真实门禁消费者行为。

规则测试与真实 CLI 负对照都在隔离 Git 仓库和临时证据目录中进行，
不读取本机 .bf-local，也不修改真实索引、源码或 D10 清单。

@author OpenAI Codex
"""

from __future__ import annotations

import hashlib
import json
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
    assert manifest["source_ledger_sha256"] == (
        "5b3e12f2853eec00a31dc69f6c01defb182e9a716b5fe74df22e5b598a4c7e67"
    )
    assert manifest["source_ledger_records"] == 997
    assert len(records) == 174 and manifest["selected_records"] == 174
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
    assert len(registry.records) == 174 and not registry.unparsable
    applied = [
        record
        for record in records
        if record["d12_verdict"] == "已按 D12 格式写入来源说明并撤回无依据署名"
    ]
    assert len(applied) == 136
    for record in records:
        assert set(java.EVIDENCE_REQUIRED_FIELDS) <= set(record), record.get("local_path")
        evidence = json.loads(record["type_evidence"])
        assert evidence["schema"] == java.EVIDENCE_SCHEMA and evidence["types"]
        assert record["upstream_commit"] in record["upstream_file_url"]
        assert record["upstream_file_url"].endswith(record["upstream_path"])
    for record in applied:
        source = DEFAULT_ROOT / record["local_path"]
        assert hashlib.sha256(source.read_bytes()).hexdigest() == record["local_sha256_after"]
