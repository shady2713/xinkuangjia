"""验证来源说明路径消费索引验收状态（D14 §120/§132）与内容点 §112 绑定。

负对照全部用**真实 CLI** 在隔离根目录上运行，保留真实退出码与诊断：
① 阻断记录的来源说明必须拒绝；② 已回退记录必须拒绝；③ 需补证记录必须拒绝；
④ 合法 accepted 记录必须通过；⑤ 无索引记录必须拒绝。
规则测试不读取本机 .bf-local，也不修改真实索引、源码或 D10 清单。

@author OpenAI Codex
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

from scripts.common.quality_common import DEFAULT_ROOT

REPO = "YunaiV/ruoyi-vue-pro"
COMMIT = "ac022b15a094cf9cf82903d429b9729e72309da5"
UPSTREAM_PATH = "yudao-framework/yudao-common/src/main/java/example/ProbeDemo.java"
UPSTREAM_SOURCE = "/**\n * 上游类型。\n */\npublic class ProbeDemo {\n}\n"
LOCAL_DIR = (
    "后端代码/basic-framework-boot/basic-framework-core/basic-framework-common/"
    "src/main/java/example"
)
ACCEPTED = "已按 D12 格式写入来源说明并撤回无依据署名"
BLOCKED = "证据不足，保持原状并登记阻断"
ROLLED_BACK = "复核回退，保持来源说明并登记阻断（尚未验收）"
PENDING = "需补证，尚未验收"
UNACCEPTED_MARKER = "来源验收：尚未验收"


def digest(value: str) -> str:
    """返回文本的 SHA-256。"""

    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def upstream_url() -> str:
    """返回固定提交的 blob 地址。"""

    return f"https://github.com/{REPO}/blob/{COMMIT}/{UPSTREAM_PATH}"


def local_source(*, marker: str = "", fragment: str = "来源说明例外测试片段") -> str:
    """生成带来源说明（可选机读验收标注）的 Java 样本。"""

    body = [
        " * 演示来源说明的验收状态判据。",
        " *",
        f" * 来源：{REPO} @ {COMMIT}（该版本未声明作者）",
        f" * 上游文件：{UPSTREAM_PATH}",
        " * 来源依据：固定见证版本；历史引入版本未核实。",
        " * 本地修改：调整包名与类名。",
    ]
    if marker:
        body.append(f" * {marker}")
    body.append(f" * 说明：{fragment}。")
    return (
        "package example;\n\n"
        + "\n".join(["/**", *body, " */"])
        + "\npublic class ProbeDemo {\n}\n"
    )


def javadoc_of(source: str) -> str:
    """取出源码中第一段 JavaDoc 原文。"""

    start = source.index("/**")
    return source[start : source.index("*/", start) + 2]


def correspondence_points(*, fragment: str = "来源说明例外测试片段") -> str:
    """生成 D14 §112 要求的 P1/P2 内容点登记。"""

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
                    f"上游固定快照 {COMMIT} 语料（7244 个 Java 文件）；"
                    "该片段在本文件出现 1 次，df=1"
                ),
            }
        ],
        ensure_ascii=False,
    )


def record(
    local_path: str,
    source: str,
    *,
    verdict: str = ACCEPTED,
    blocker: str = "",
    points: str | None = None,
) -> dict[str, object]:
    """构造一条隔离探针使用的受控索引记录。"""

    return {
        "local_path": local_path,
        "local_sha256_after": digest(source),
        "upstream_repo_url": f"https://github.com/{REPO}.git",
        "upstream_path": UPSTREAM_PATH,
        "upstream_commit": COMMIT,
        "upstream_file_url": upstream_url(),
        "upstream_sha256": digest(UPSTREAM_SOURCE),
        "upstream_author_lines": "",
        "history_basis": "引入提交未知，本行以固定见证版本作来源见证。",
        "evidence_route": "路线 3",
        "evidence_points": (
            "P1 内容点（共享有区分力字符串字面量）：来源说明例外测试片段 本地 L1 / 上游 L1；"
            "P2 注释点（共享独特注释正文）：演示来源说明的验收状态判据 本地 L2 / 上游 L2"
        ),
        "author_status": "已核实来源但作者未声明",
        "local_modification_facts": "调整包名与类名。",
        "open_gap": "上游该版本未声明作者；历史引入版本未核实。",
        "review_by": "D12 规则测试",
        "review_date": "2026-10-06",
        "review_conclusion": "逐项复核 ProbeDemo：来源、指纹与无作者结论一致。",
        "type_evidence": json.dumps(
            {
                "schema": "d12-type-evidence/v1",
                "file": {"local_sha256_final": digest(source)},
                "types": [
                    {
                        "qualified_name": "example.ProbeDemo",
                        "simple_name": "ProbeDemo",
                        "kind": "class",
                        "nested": False,
                        "enclosing_type": None,
                        "upstream_type": "cn.iocoder.yudao.example.ProbeDemo",
                        "upstream_author_declared": False,
                        "javadoc_sha256": digest(javadoc_of(source)),
                        "review_by": "D12 规则测试",
                        "review_date": "2026-10-06",
                        "review_conclusion": "逐项复核 ProbeDemo：来源、指纹与无作者结论一致。",
                    }
                ],
            },
            ensure_ascii=False,
        ),
        "d12_verdict": verdict,
        "d12_blocker_reason": blocker,
        "d12_correspondence_points": points if points is not None else correspondence_points(),
    }


def build_root(
    tmp_path: Path,
    *,
    name: str,
    sources: dict[str, str],
    records: list[dict[str, object]],
) -> tuple[Path, Path]:
    """写出隔离根目录、受控索引与上游快照。"""

    root = tmp_path / name
    for relative, source in sources.items():
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source, encoding="utf-8")
    index = root / "docs/测试与可靠性/来源证据/d12-source-index.json"
    index.parent.mkdir(parents=True, exist_ok=True)
    index.write_text(
        json.dumps(
            {"index_schema": "d12-source-index/v1", "records": records},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    snapshots = tmp_path / f"{name}-snapshots"
    snapshot = snapshots / f"ruoyi-vue-pro@{COMMIT}" / UPSTREAM_PATH
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    snapshot.write_text(UPSTREAM_SOURCE, encoding="utf-8")
    return root, snapshots


def run_cli(root: Path, snapshots: Path) -> subprocess.CompletedProcess[str]:
    """用真实全量入口 CLI 检查隔离根目录，保留退出码与诊断。"""

    return subprocess.run(
        [
            sys.executable,
            "-B",
            "-X",
            "utf8",
            str(DEFAULT_ROOT / "scripts/code/java/check_full_java_comments.py"),
            "--json",
            "--root",
            str(root),
            "--evidence-snapshots",
            str(snapshots),
            str(root / "后端代码"),
        ],
        cwd=DEFAULT_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=120,
    )


def details(result: subprocess.CompletedProcess[str]) -> list[str]:
    """读取真实 CLI 的结构化诊断。"""

    assert result.stdout.strip(), result.stderr
    return [str(item["detail"]) for item in json.loads(result.stdout)["findings"]]


def test_source_note_rejects_unaccepted_verdicts(tmp_path: Path) -> None:
    """①②③：阻断、已回退、需补证记录的来源说明都必须被拒绝（D14 §120）。"""

    for label, verdict, blocker in (
        ("blocked", BLOCKED, "路线 3 复核只有 1 个独立定位对应点。"),
        ("rolled", ROLLED_BACK, "两个结构点均为 MyBatis-Plus 通用 CRUD。"),
        ("pending", PENDING, "现有合格点数=1，缺第二个非通用业务事实。"),
    ):
        path = f"{LOCAL_DIR}/ProbeDemo.java"
        source = local_source()
        root, snapshots = build_root(
            tmp_path,
            name=f"case-{label}",
            sources={path: source},
            records=[record(path, source, verdict=verdict, blocker=blocker)],
        )
        result = run_cli(root, snapshots)
        assert result.returncode == 1, result.stdout + result.stderr
        report = json.loads(result.stdout)
        assert report["checked"] == 1 and report["status"] == "failed"
        assert len(report["findings"]) == 1
        detail = report["findings"][0]["detail"]
        assert "尚未验收" in detail and verdict in detail, detail
        assert blocker[:10] in detail, detail


def test_source_note_accepts_accepted_verdict(tmp_path: Path) -> None:
    """④：合法 accepted 记录（含 §112 内容点绑定）必须通过，退出 0。"""

    path = f"{LOCAL_DIR}/ProbeDemo.java"
    source = local_source()
    root, snapshots = build_root(
        tmp_path,
        name="case-accepted",
        sources={path: source},
        records=[record(path, source)],
    )
    result = run_cli(root, snapshots)
    assert result.returncode == 0, result.stdout + result.stderr
    report = json.loads(result.stdout)
    assert report["checked"] == 1 and report["status"] == "passed"
    assert report["findings"] == []


def test_source_note_rejects_missing_index_record(tmp_path: Path) -> None:
    """⑤：没有索引记录的来源说明必须拒绝，诊断指向缺少逐项记录。"""

    path = f"{LOCAL_DIR}/ProbeDemo.java"
    source = local_source()
    other = f"{LOCAL_DIR}/OtherDemo.java"
    root, snapshots = build_root(
        tmp_path,
        name="case-unindexed",
        sources={path: source, other: source},
        records=[record(other, source)],
    )
    result = run_cli(root, snapshots)
    assert result.returncode == 1, result.stdout + result.stderr
    joined = "；".join(details(result))
    assert "清单中没有" in joined and "逐项记录" in joined, joined


def test_source_note_rejects_unaccepted_marker_even_when_index_accepts(tmp_path: Path) -> None:
    """文件内「来源验收：尚未验收」标注与索引状态共同约束：标注为未验收即拒绝。"""

    path = f"{LOCAL_DIR}/ProbeDemo.java"
    source = local_source(marker=UNACCEPTED_MARKER)
    root, snapshots = build_root(
        tmp_path,
        name="case-marker",
        sources={path: source},
        records=[record(path, source)],
    )
    result = run_cli(root, snapshots)
    assert result.returncode == 1, result.stdout + result.stderr
    joined = "；".join(details(result))
    assert UNACCEPTED_MARKER in joined, joined


def test_source_note_rejects_missing_content_point_binding(tmp_path: Path) -> None:
    """⑤补充：accepted 记录缺少 §112 的 discrimination_reason/语料绑定必须拒绝。"""

    path = f"{LOCAL_DIR}/ProbeDemo.java"
    source = local_source()
    stripped = json.dumps(
        [{"kind": "P1 内容点（共享有区分力字符串字面量）", "fragment": "来源说明例外测试片段"}],
        ensure_ascii=False,
    )
    root, snapshots = build_root(
        tmp_path,
        name="case-no-binding",
        sources={path: source},
        records=[record(path, source, points=stripped)],
    )
    result = run_cli(root, snapshots)
    assert result.returncode == 1, result.stdout + result.stderr
    joined = "；".join(details(result))
    assert "discrimination_reason" in joined and "corpus_binding" in joined, joined


def test_source_note_missing_verdict_field_is_rejected(tmp_path: Path) -> None:
    """派生索引记录缺少 d12_verdict 时不能按“未声明”放行，必须拒绝。"""

    path = f"{LOCAL_DIR}/ProbeDemo.java"
    source = local_source()
    item = record(path, source)
    item.pop("d12_verdict")
    root, snapshots = build_root(
        tmp_path,
        name="case-no-verdict",
        sources={path: source},
        records=[item],
    )
    result = run_cli(root, snapshots)
    assert result.returncode == 1, result.stdout + result.stderr
    joined = "；".join(details(result))
    assert "d12_verdict" in joined, joined


def test_source_note_legacy_tsv_registry_keeps_existing_behaviour(tmp_path: Path) -> None:
    """未声明派生 schema 的清单不参与验收状态判据，避免误判历史账本。"""

    path = f"{LOCAL_DIR}/ProbeDemo.java"
    source = local_source()
    root = tmp_path / "case-legacy"
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(source, encoding="utf-8")
    index = root / "docs/测试与可靠性/来源证据/d12-source-index.json"
    index.parent.mkdir(parents=True, exist_ok=True)
    item = record(path, source)
    index.write_text(
        json.dumps({"records": [item]}, ensure_ascii=False), encoding="utf-8"
    )
    snapshots = tmp_path / "case-legacy-snapshots"
    snapshot = snapshots / f"ruoyi-vue-pro@{COMMIT}" / UPSTREAM_PATH
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    snapshot.write_text(UPSTREAM_SOURCE, encoding="utf-8")
    result = run_cli(root, snapshots)
    assert result.returncode == 0, result.stdout + result.stderr
    assert json.loads(result.stdout)["findings"] == []
