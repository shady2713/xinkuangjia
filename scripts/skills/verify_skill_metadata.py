"""检查技能名称、YAML 结构、跨宿主调用策略及可选的生命周期与行为验收元数据。

用法：python scripts/skills/verify_skill_metadata.py [技能目录]
允许不提供 openai.yaml；已有配置必须合法且默认提示引用当前技能。
可选前置元数据字段：
- status: active | deprecated | retired（退役技能须设置 disable-model-invocation: true）
- replaced-by / retirement-reason: deprecated 或 retired 技能须声明替代技能或退役说明
- supersedes: 可选字符串列表，记录被当前技能替代的旧技能名
- verification: 可选非空字符串列表，声明该技能的行为验收命令或判据

Lifecycle and verification rules (English text pending localization):
- replaced-by and retirement-reason are only valid on deprecated or retired skills.
- A replaced-by target must be retained, declare its directory name, be active and list the
  predecessor in supersedes, so renamed, deleted or retired targets fail; replacement
  chains that loop back are reported as cycles.
- A supersedes entry still present in the checkout must be deprecated or retired and point
  back with replaced-by; entries absent from the checkout are historic and accepted.
- Terminal retirement: retirement-reason without replaced-by declares that no successor
  exists. The skill itself is valid, but it must not appear in any supersedes list.
- verification entries must be allowlisted in VERIFICATION_GATES and are never executed.
  File-based entrypoints must exist in the checkout; mvn/pnpm entrypoints must be run by the
  mapped step of .github/workflows/ci.yml (matched by stable id, else current step name).
- With a path subset, skills declaring lifecycle links are always re-checked so renames and
  deletions of linked skills are not missed.
@author 李杰
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

# 直接按文件路径运行时定位工具所属仓库，不依赖调用者的当前目录。
if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.common.quality_common import (
    CheckError,
    Finding,
    discover,
    entry,
    parser,
    read_text,
    report,
)


def load_mapping(source: str) -> dict:
    """安全加载单个 YAML 映射，拒绝重复字段以避免策略被静默覆盖。

    Args:
        source: YAML 文本，不允许自定义 Python 对象标签。
    Returns:
        顶层字段映射。
    Raises:
        ValueError: YAML 语法、重复键或顶层结构不合法。
        CheckError: 未安装 YAML 依赖。
    """
    try:
        import yaml
    except ImportError as exc:
        raise CheckError("缺少 PyYAML，请运行 python -m pip install -r tools/quality/requirements.txt") from exc

    class UniqueLoader(yaml.SafeLoader):
        """为单次调用隔离映射构造器，不改变全局 YAML 加载行为。"""

    def mapping(loader: UniqueLoader, node: object) -> dict:
        """构造映射并拒绝重复字段；复杂键由 YAML 构造器拒绝。"""
        result: dict = {}
        for key_node, value_node in node.value:
            key = loader.construct_object(key_node)
            if not isinstance(key, str):
                raise ValueError("YAML 字段名必须是字符串")
            if key in result:
                raise ValueError(f"YAML 字段重复：{key}")
            result[key] = loader.construct_object(value_node)
        return result

    UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, mapping)
    try:
        value = yaml.load(source, Loader=UniqueLoader)
    except yaml.YAMLError as exc:
        raise ValueError(f"YAML 格式错误：{exc.problem}") from exc
    if not isinstance(value, dict):
        raise ValueError("YAML 顶层必须是映射")
    return value


def frontmatter(source: str) -> dict:
    """提取完整 YAML 前置元数据，缺失或未闭合时抛出 ValueError。"""
    lines = source.splitlines()
    if not lines or lines[0] != "---":
        raise ValueError("SKILL.md 必须以 YAML 前置元数据开始")
    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise ValueError("YAML 前置元数据没有闭合") from exc
    return load_mapping("\n".join(lines[1:end]))


SKILL_NAME_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
ALLOWED_LIFECYCLE_STATUSES = frozenset({"active", "deprecated", "retired"})


WORKFLOW_PATH = ".github/workflows/ci.yml"
INACTIVE_LIFECYCLE_STATUSES = frozenset({"deprecated", "retired"})


@dataclass(frozen=True)
class VerificationGate:
    """将允许声明的验证命令与固定 CI 作业和步骤关联。

    Attributes:
        command: Exact command string accepted in SKILL.md ``verification``.
        job: Job key in .github/workflows/ci.yml.
        step_id: Stable step id; matched first so the mapping survives step renames.
        step_name: Current step name, matched until the stable id lands; None when the
            step is planned and not yet part of the workflow.
        script: Repository-relative entrypoint for file-based commands, else None.
        criteria: Pass criteria recorded in evidence reports.
        pins_head_sha: Whether passing evidence must name the commit under test.
    """

    command: str
    job: str
    step_id: str
    step_name: str | None
    script: str | None
    criteria: str
    pins_head_sha: bool = False

    @property
    def gate_id(self) -> str:
        """返回 CI 步骤结果使用的稳定作业和步骤标识。"""
        return f"{self.job}/{self.step_id}"


_COMMENTS_STEP = "Comments checks"
_COMMENTS_CRITERIA = "Changed Java and web comment checks concluded with outcome success."

# Only these verification commands may be declared. Adding one requires mapping it to a
# real CI step here, so YAML metadata can never introduce a command of its own.
VERIFICATION_GATES: dict[str, VerificationGate] = {
    gate.command: gate
    for gate in (
        VerificationGate(
            "mvn -B -ntp -Pquality-gate verify",
            "backend",
            "maven_verify",
            "Maven quality-gate verify",
            None,
            "Maven quality-gate verify step concluded with outcome success.",
        ),
        VerificationGate(
            "python -B -X utf8 scripts/code/java/check_worktree_java_comments.py",
            "docs-comments",
            "changed_comments",
            _COMMENTS_STEP,
            "scripts/code/java/check_worktree_java_comments.py",
            _COMMENTS_CRITERIA,
        ),
        VerificationGate(
            "pnpm run quality:gates",
            "frontend",
            "frontend_gates",
            "Shared frontend quality, test, build and security gates",
            None,
            "Shared frontend quality, test, build and security gates concluded with outcome success.",
        ),
        VerificationGate(
            "pnpm run test:e2e:ci",
            "frontend",
            "browser_e2e",
            "Critical browser E2E path (production preview)",
            None,
            "Critical browser E2E step concluded with outcome success.",
        ),
        VerificationGate(
            "python -B -X utf8 scripts/code/web/check_worktree_web_comments.py",
            "docs-comments",
            "changed_comments",
            _COMMENTS_STEP,
            "scripts/code/web/check_worktree_web_comments.py",
            _COMMENTS_CRITERIA,
        ),
        VerificationGate(
            "python -B -X utf8 scripts/workflow/run_checks.py --group docs",
            "docs-comments",
            "docs_checks",
            "Docs checks (with mermaid)",
            "scripts/workflow/run_checks.py",
            "Docs checks step concluded with outcome success.",
        ),
        VerificationGate(
            "python -B -X utf8 scripts/workflow/verify_slice.py --base main --plan",
            "acceptance",
            "slice_plan",
            None,
            "scripts/workflow/verify_slice.py",
            "verify_slice plan step concluded with outcome success for the commit under test.",
            pins_head_sha=True,
        ),
    )
}


def _yaml_module():
    """按需加载 YAML 解析依赖，缺失时给出项目依赖安装入口。"""
    try:
        import yaml
    except ImportError as exc:
        raise CheckError("PyYAML is required: python -m pip install -r tools/quality/requirements.txt") from exc
    return yaml


def load_workflow_jobs(root: Path) -> dict | None:
    """静态读取工作流的作业定义供门禁做路由核对。

    Args:
        root: Repository root.
    Returns:
        The ``jobs`` mapping, or None when the workflow file is absent.
    Raises:
        ValueError: The workflow is not valid YAML or has no jobs mapping.
    """
    path = root / WORKFLOW_PATH
    if not path.is_file():
        return None
    yaml = _yaml_module()
    try:
        # safe_load instead of load_mapping: workflows use the YAML 1.1 boolean key "on".
        data = yaml.safe_load(read_text(path))
    except yaml.YAMLError as exc:
        raise ValueError(f"{WORKFLOW_PATH} is not valid YAML: {getattr(exc, 'problem', None) or exc}") from exc
    jobs = data.get("jobs") if isinstance(data, dict) else None
    if not isinstance(jobs, dict):
        raise ValueError(f"{WORKFLOW_PATH} has no jobs mapping")
    return jobs


def find_workflow_step(jobs: dict, gate: VerificationGate) -> dict | None:
    """按稳定步骤标识查找对应门禁，兼容旧步骤名。"""
    job = jobs.get(gate.job)
    steps = job.get("steps") if isinstance(job, dict) else None
    if not isinstance(steps, list):
        return None
    candidates = [step for step in steps if isinstance(step, dict)]
    for key, expected in (("id", gate.step_id), ("name", gate.step_name)):
        for step in candidates:
            if expected is not None and step.get(key) == expected:
                return step
    return None


def _declared_status(metadata: dict) -> str | None:
    """解析技能状态并在字段缺省时使用 active。"""
    status = metadata.get("status", "active")
    return status if isinstance(status, str) and status in ALLOWED_LIFECYCLE_STATUSES else None


def _sibling_metadata(skills_dir: Path, name: str) -> dict | None:
    """读取仓库内相邻技能的前置元数据供替代关系校验。

    Raises:
        ValueError: The sibling SKILL.md exists but its frontmatter cannot be parsed.
    """
    path = skills_dir / name / "SKILL.md"
    if not path.is_file():
        return None
    if not path.resolve().is_relative_to(skills_dir.resolve()):
        raise ValueError("技能元数据链接超出技能目录")
    return frontmatter(read_text(path))


def _check_replacement(name: str, target: str, skills_dir: Path, skill_file: Path, fail) -> None:
    """校验替代目标仍可用、反向引用一致且未形成环。"""
    try:
        target_meta = _sibling_metadata(skills_dir, target)
    except ValueError:
        fail(skill_file, f"replaced-by target {target} has unreadable SKILL.md frontmatter")
        return
    if target_meta is None:
        return
    if target_meta.get("name") != target:
        fail(skill_file, f"replaced-by target {target} declares another name; update references after a rename")
    if _declared_status(target_meta) != "active":
        fail(skill_file, f"replaced-by target {target} must be active, found {target_meta.get('status')}")
    supersedes = target_meta.get("supersedes")
    if not isinstance(supersedes, list) or name not in supersedes:
        fail(skill_file, f"replaced-by target {target} must list {name} in supersedes")
    # Follow the replacement chain; the name pattern keeps lookups inside the skills folder.
    seen = {name}
    current: object = target
    while isinstance(current, str) and SKILL_NAME_RE.fullmatch(current) and current not in seen:
        seen.add(current)
        try:
            meta = _sibling_metadata(skills_dir, current)
        except ValueError:
            return
        current = meta.get("replaced-by") if meta else None
    if isinstance(current, str) and current in seen:
        fail(skill_file, f"replaced-by chain forms a lifecycle cycle through {current}")


def _check_predecessors(name: str, supersedes: list[str], skills_dir: Path, skill_file: Path, fail) -> None:
    """验证仍保留的旧技能已退役或弃用并回指新技能。"""
    for predecessor in supersedes:
        try:
            meta = _sibling_metadata(skills_dir, predecessor)
        except ValueError:
            fail(skill_file, f"supersedes entry {predecessor} has unreadable SKILL.md frontmatter")
            continue
        if meta is None:
            # Historic predecessor already removed from the checkout; nothing to reconcile.
            continue
        successor = meta.get("replaced-by")
        if _declared_status(meta) not in INACTIVE_LIFECYCLE_STATUSES:
            fail(skill_file, f"supersedes entry {predecessor} is still present but neither deprecated nor retired")
        elif successor is None:
            # Terminal retirement (retirement-reason only) means no successor may claim it.
            fail(
                skill_file,
                f"supersedes entry {predecessor} declares no successor (terminal retirement); "
                f"remove it from supersedes or set its replaced-by to {name}",
            )
        elif successor != name:
            fail(skill_file, f"supersedes entry {predecessor} is replaced by {successor}, not {name}")


def _validate_verification_gates(entries: list[str], root: Path, skill_file: Path, fail) -> None:
    """静态核对声明、入口文件和对应 CI 门禁。"""
    if len(set(entries)) != len(entries):
        fail(skill_file, "verification entries must be unique")
    gates = [VERIFICATION_GATES.get(command) for command in entries]
    for command, gate in zip(entries, gates, strict=True):
        if gate is None:
            fail(skill_file, f"verification command is not allowlisted: {command}")
        elif gate.script is not None:
            target = root / gate.script
            if not target.is_file() or not target.resolve().is_relative_to(root.resolve()):
                fail(skill_file, f"verification script not found in checkout: {gate.script}")
    workflow_gates = [gate for gate in gates if gate is not None and gate.script is None]
    if not workflow_gates:
        return
    try:
        jobs = load_workflow_jobs(root)
    except ValueError as exc:
        fail(skill_file, str(exc))
        return
    if jobs is None:
        fail(skill_file, f"{WORKFLOW_PATH} is missing; workflow-run verification commands cannot be confirmed")
        return
    for gate in workflow_gates:
        step = find_workflow_step(jobs, gate)
        if step is None:
            fail(skill_file, f"CI step {gate.gate_id} not found in {WORKFLOW_PATH}")
        elif gate.command not in str(step.get("run", "")):
            fail(skill_file, f"CI step {gate.gate_id} does not run: {gate.command}")


def _validate_lifecycle_and_verification(
    metadata: dict,
    name: str,
    skill_file: Path,
    root: Path,
    fail,
) -> None:
    """校验可选的技能生命周期（状态、替代、退役）与行为验收元数据约定。

    Args:
        metadata: 解析后的 SKILL.md 前置元数据字典。
        name: 当前技能目录名。
        skill_file: SKILL.md 路径。
        root: Repository root used to resolve verification entrypoints and the CI workflow.
        fail: 收集校验诊断的回调函数。
    """
    status = metadata.get("status", "active")
    if not isinstance(status, str) or status not in ALLOWED_LIFECYCLE_STATUSES:
        fail(skill_file, "status 必须是 active、deprecated 或 retired")
        status = "active"

    replaced_by = metadata.get("replaced-by")
    if replaced_by is not None:
        if not isinstance(replaced_by, str) or not SKILL_NAME_RE.fullmatch(replaced_by):
            fail(skill_file, "replaced-by 必须是合法技能名")
        elif replaced_by == name:
            fail(skill_file, "replaced-by 不能指向技能自身")
        elif not (skill_file.parent.parent / replaced_by / "SKILL.md").is_file():
            fail(skill_file, f"replaced-by 指向不存在的技能：{replaced_by}")
        else:
            _check_replacement(name, replaced_by, skill_file.parent.parent, skill_file, fail)

    reason = metadata.get("retirement-reason")
    if reason is not None and (not isinstance(reason, str) or not reason.strip()):
        fail(skill_file, "retirement-reason 必须是非空文字")

    if status in {"deprecated", "retired"} and not (replaced_by or (isinstance(reason, str) and reason.strip())):
        fail(skill_file, f"状态为 {status} 的技能必须声明 replaced-by 或 retirement-reason")
    if status == "retired" and metadata.get("disable-model-invocation") is not True:
        fail(skill_file, "状态为 retired 的技能必须设置 disable-model-invocation: true")
    if _declared_status(metadata) == "active" and (replaced_by is not None or reason is not None):
        fail(skill_file, "active skills must not declare replaced-by or retirement-reason")

    if "supersedes" in metadata:
        supersedes = metadata["supersedes"]
        if (
            not isinstance(supersedes, list)
            or not supersedes
            or any(not isinstance(item, str) or not SKILL_NAME_RE.fullmatch(item) for item in supersedes)
        ):
            fail(skill_file, "supersedes 必须是非空合法技能名列表")
        elif name in supersedes or len(set(supersedes)) != len(supersedes):
            fail(skill_file, "supersedes 不能包含技能自身或重复项")
        else:
            _check_predecessors(name, supersedes, skill_file.parent.parent, skill_file, fail)

    if "verification" in metadata:
        verification = metadata["verification"]
        if (
            not isinstance(verification, list)
            or not verification
            or any(not isinstance(item, str) or not item.strip() for item in verification)
        ):
            fail(skill_file, "verification 必须是非空字符串列表，用于声明行为验收命令或判据")
        else:
            _validate_verification_gates(verification, root, skill_file, fail)


def validate(skill_file: Path, openai_file: Path, root: Path) -> list[Finding]:
    """核对一个技能的命名和调用配置，收集规则错误而不改写文件。

    Args:
        skill_file: 技能主文件，允许缺失以诊断孤立的配置文件。
        openai_file: 对应的可选 Codex 配置。
        root: 诊断路径的仓库根目录。
    Returns:
        此技能所有已发现问题；结构无效时停止依赖该结构的后续检查。
    """
    findings: list[Finding] = []

    def fail(path: Path, message: str) -> None:
        """添加指向所属元数据文件的诊断。"""
        findings.append(Finding(path.relative_to(root).as_posix(), 1, "skill-metadata", message))

    if not skill_file.is_file():
        fail(openai_file, "配置缺少同级技能的 SKILL.md")
        return findings
    for file in (skill_file, openai_file):
        if file.exists() and not file.resolve().is_relative_to(root):
            fail(file, "元数据链接指向仓库外，拒绝读取")
            return findings
    try:
        metadata = frontmatter(read_text(skill_file))
    except ValueError as exc:
        fail(skill_file, str(exc))
        return findings
    name = skill_file.parent.name
    if metadata.get("name") != name or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name):
        fail(skill_file, "name 必须与目录名相同，并使用小写字母、数字和连字符")
    if not isinstance(metadata.get("description"), str) or not metadata["description"].strip():
        fail(skill_file, "description 必须是非空文字")
    for field in ("disable-model-invocation", "user-invocable"):
        if field in metadata and not isinstance(metadata[field], bool):
            fail(skill_file, f"{field} 必须是布尔值")
    manual = metadata.get("disable-model-invocation") is True
    if manual and metadata.get("user-invocable") is False:
        fail(skill_file, "仅手动调用的技能必须允许用户调用")
    _validate_lifecycle_and_verification(metadata, name, skill_file, root, fail)
    if not openai_file.exists():
        return findings
    try:
        config = load_mapping(read_text(openai_file))
    except ValueError as exc:
        fail(openai_file, str(exc))
        return findings
    policy = config.get("policy", {})
    if not isinstance(policy, dict):
        fail(openai_file, "policy 必须是映射")
        return findings
    implicit = policy.get("allow_implicit_invocation", True)
    if not isinstance(implicit, bool):
        fail(openai_file, "allow_implicit_invocation 必须是布尔值")
    elif manual != (implicit is False):
        fail(openai_file, "Claude 与 Codex 的仅手动调用策略不一致")
    interface = config.get("interface")
    if not isinstance(interface, dict):
        fail(openai_file, "interface 必须是映射")
        return findings
    prompt = interface.get("default_prompt")
    if not isinstance(prompt, str) or f"${name}" not in re.findall(r"\$[a-z0-9-]+", prompt):
        fail(openai_file, f"default_prompt 必须引用 ${name}")
    elif any(
        not (skill_file.parent.parent / token[1:] / "SKILL.md").is_file()
        for token in re.findall(r"\$weetion-[a-z0-9-]+", prompt)
    ):
        fail(openai_file, "default_prompt 引用了不存在的 weetion 技能")
    return findings


def _lifecycle_linked_folders(skills_dir: Path, root: Path) -> set[Path]:
    """收集依赖其他技能状态的生命周期声明目录。"""
    linked: set[Path] = set()
    for skill_file in skills_dir.glob("*/SKILL.md"):
        if not skill_file.resolve().is_relative_to(root):
            continue
        try:
            metadata = frontmatter(read_text(skill_file))
        except ValueError:
            continue
        if "replaced-by" in metadata or "supersedes" in metadata:
            linked.add(skill_file.parent)
    return linked


def skill_folders(root: Path, paths: list[str]) -> list[Path]:
    """定位本次门禁及受生命周期关联影响的技能目录。

    Linked skills are re-checked on every run because renaming, retiring or deleting one
    skill can invalidate another skill outside the requested paths.
    """
    files = discover(
        root,
        {".md", ".yaml"},
        paths or [".agents/skills"] if (root / ".agents/skills").exists() else paths,
    )
    skill_roots: set[Path] = set()
    for file in files:
        parts = file.relative_to(root).parts
        if parts[:2] != (".agents", "skills"):
            continue
        if len(parts) == 4 and parts[-1] == "SKILL.md":
            skill_roots.add(file.parent)
        elif len(parts) == 5 and parts[-2:] == ("agents", "openai.yaml"):
            skill_roots.add(file.parent.parent)
    skills_dir = root / ".agents/skills"
    if paths and skills_dir.is_dir():
        skill_roots.update(_lifecycle_linked_folders(skills_dir, root))
    return sorted(skill_roots)


def collect(root: Path, paths: list[str]) -> tuple[int, list[Finding]]:
    """发现技能主文件及孤立配置，允许完全没有技能的仓库返回零计数。"""
    folders = skill_folders(root, paths)
    findings = []
    for folder in folders:
        findings.extend(validate(folder / "SKILL.md", folder / "agents/openai.yaml", root))
    return len(folders), findings


def main() -> int:
    """读取参数并输出技能元数据检查结果。"""
    args = parser(__doc__).parse_args()
    count, findings = collect(args.root.resolve(), args.paths)
    return report("技能元数据", count, findings, as_json=args.json)


if __name__ == "__main__":
    raise SystemExit(entry(main))
