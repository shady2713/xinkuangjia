"""核对性能测量报告是否满足受控预算，并对超预算、未测量和证据不可比分别判定失败。

本模块只消费“实际运行产生的测量报告”和“受版本控制的预算文件”，自身不发请求、
不读环境变量、不联网，因此同一对输入必然得到同一结论。门禁入口与负对照都复用它，
避免判定逻辑与实际执行分叉。

报告结构（perf-report/v1）中的 samples_ms 必须保留全部原始样本，判定只用报告内的
统计量，但保留原始样本使判定可被复核。

预算文件结构（perf-budget/v2）同时表达三类依据：

* 绝对预算：响应分位数与单次请求数据库查询数的上限。
* 回归预算：相对同一负载参考基线的允许增量比例，避免只回答“比上次快”。
* 构件绑定：`applies_to.build` 声明本次校准对应的源码身份，被测报告必须给出同一身份。

构件绑定为什么是 Git 修订加源码内容摘要、而不是构件字节摘要：Maven 重建出来的 JAR
不可复现，同一提交在不同机器或不同时刻重建即得到不同 SHA-256，用它绑定会让
`build-mismatch` 在任何一次干净检出的 CI 上必现（同一提交实测 `c0a94da8…` 与
`71371e1b…`）。`perf-budget/v1` 以 `jar_sha256` 绑定的方式因此退役：绑定方式换了不等于
问题消失，本模块对该字段给出配置错误（退出码 2），并在预算未绑定可复现源码身份时同样
拒绝判定，绝不退化为“不再核对构件”。

退出码 2 也产出结论文件。判定输入不可用时本模块过去只往标准错误写一行字，标准输出为空：
被 `run_baseline.py` capture 成 `verdict.json` 时得到一个 0 字节文件，上传的制品里没有
任何结论，日志里也只剩退出码，读日志的人分不清“预算还没在目标环境重新校准”“实测报告
坏了”和“预算文件本身不可用”。因此 `--json` 下退出码 2 同样输出同一结构的结论文档，
`status` 为 `unavailable`（不是 `passed`），`checked` 为 0，并在 `unavailable` 段里分列
类别、具体情形、受影响输入、预算自己声明的 `binding_state` 与可执行处置。退出码本身不因
这次补充发生任何变化：2 仍然是 2。

@author 李杰
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

if __package__ in (None, ""):  # 直接以脚本路径运行时补上仓库根，便于复用同包绑定常量。
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.perf import source_identity  # noqa: E402

REPORT_SCHEMA = "perf-report/v1"
BUDGET_SCHEMA = "perf-budget/v2"
CHECK_NAME = "性能预算"

# 上一版结构以构件字节摘要绑定被测版本；该依据不可复现，已退役。仍然按 v1 提交的预算
# 文件必须被明确拒绝并给出迁移指引，不能被当成“没有绑定要求”而静默放行。
RETIRED_BUDGET_SCHEMA = "perf-budget/v1"
RETIRED_BINDING_FIELD = "jar_sha256"
RETIRED_BUDGET_REASON = (
    "以构件字节摘要绑定被测版本的方式已退役：Maven 重建的 JAR 摘要不可复现，"
    "同一提交在不同环境重建即不同（例如同一提交实测 c0a94da8… 与 71371e1b…），"
    f"用它绑定会让 build-mismatch 在任何一次干净检出的 CI 上必现。请迁移到 {BUDGET_SCHEMA}，"
    f"在 applies_to.build 声明 binding_method={source_identity.METHOD}、source_scope="
    f"{source_identity.SCOPE} 与 git_revision、source_sha256，并在目标环境重新校准。"
)

# 构件绑定的可比字段：方法与范围决定两次测量是否同一口径，提交与内容摘要决定测的是不是
# 被校准的那份代码。四项都只由 `source_identity` 定义，不在本模块另写一份字面量。
BINDING_METHOD = source_identity.METHOD
BINDING_SCOPE = source_identity.SCOPE
BINDING_FIELDS = {"git_revision": 40, "source_sha256": 64}

# 判定使用的分位数与对应预算字段。p99 与 p95 分别核对，任一超限即失败。
PERCENTILES = ((50, "p50_ms"), (95, "p95_ms"), (99, "p99_ms"))
SQL_BUDGET_FIELDS = ("sql_queries_median", "sql_queries_p95")

# 判定输入不可用（退出码 2）时的三类情形。处置不同，必须在结论文件里分列：读到日志或
# 制品的人只有凭这一段才能分清「预算还没在目标环境重新校准」「实测报告坏了」和
# 「预算文件本身不可用」——三者的责任人和下一步动作完全不同。
CATEGORY_BINDING_UNBOUND = "budget-binding-unbound"
CATEGORY_REPORT_INVALID = "report-invalid"
CATEGORY_BUDGET_INVALID = "budget-invalid"
CATEGORY_INPUT_INVALID = "input-invalid"

# kind → (category, 可执行处置)。处置写成「接下来做什么」，不写成「出错了」：退出码 2
# 只说明判定没做成，不说明该找谁、该改什么。
UNAVAILABLE_GUIDE: dict[str, tuple[str, str]] = {
    "report-unreadable": (
        CATEGORY_REPORT_INVALID,
        "确认合并步骤真的产出了报告文件，并检查该路径是否可读；报告读不到时判定没有执行，"
        "本次没有任何场景被核对，不得按「未发现问题」理解",
    ),
    "report-not-json": (
        CATEGORY_REPORT_INVALID,
        "实测报告不是合法 JSON：由合并步骤（merge_reports.py）重新产出该文件，"
        "不要手工编辑或截断报告；判定未执行，本次没有任何场景被核对",
    ),
    "report-shape-invalid": (
        CATEGORY_REPORT_INVALID,
        f"实测报告的结构不符合 {REPORT_SCHEMA} 或缺少必需字段：由合并步骤重新产出报告；"
        "判定未执行，本次没有任何场景被核对",
    ),
    "report-schema-unsupported": (
        CATEGORY_REPORT_INVALID,
        f"实测报告声明的 schema 不受支持，必须是 {REPORT_SCHEMA}：由测量与合并步骤重新"
        "产出报告，不要手工改写 schema 字段绕过校验；判定未执行，本次没有任何场景被核对",
    ),
    "budget-unreadable": (
        CATEGORY_BUDGET_INVALID,
        "预算文件本身不可读：确认 --budgets 指向的文件存在且当前身份可读；"
        "预算读不到时没有任何判定依据，不得按「未发现问题」理解",
    ),
    "budget-schema-unsupported": (
        CATEGORY_BUDGET_INVALID,
        f"预算文件的 schema 不受支持：迁移到 {BUDGET_SCHEMA} 并按 applies_to.build 声明 "
        f"binding_method={source_identity.METHOD}、source_scope={source_identity.SCOPE} "
        "与 git_revision、source_sha256；迁移完成前本预算不能作为门禁依据",
    ),
    "budget-shape-invalid": (
        CATEGORY_BUDGET_INVALID,
        "预算文件缺少判定必需的字段（scenarios 或场景预算结构）：修正预算文件后重跑；"
        "判定未执行，本次没有任何场景被核对",
    ),
    "budget-binding-unbound": (
        CATEGORY_BINDING_UNBOUND,
        "预算没有声明出可复现的构件绑定，无法证明读数来自被校准的那份代码："
        "需要在目标环境重新校准，并把实测的 git_revision 与 source_sha256 回填到 "
        "applies_to.build 后重跑判定；在此之前本预算不是通过，也不是不通过，而是无法判定",
    ),
    "input-invalid": (
        CATEGORY_INPUT_INVALID,
        "输入不可用但未被归入上述具体情形：以 perf_budget.py 的标准错误输出为准，"
        "判定未执行，本次没有任何场景被核对",
    ),
}

# 未在登记表内的 kind 也要给出结论而不是崩溃：处置退回到最一般的说法。
DEFAULT_GUIDE = UNAVAILABLE_GUIDE["input-invalid"]


class UnavailableInput(ValueError):
    """判定输入不可用：必须以退出码 2 结束，并在结论文件里留下可处置的原因。

    继承 ``ValueError`` 是为了不改变既有调用方捕获该错误的语义；本类额外携带
    ``kind``、``subject`` 与 ``binding_state``，让结论文件能区分三类情形，而不是
    只留一句「无法读取」。

    Attributes:
        kind: 登记表中的具体情形标识，例如 ``report-not-json``。
        subject: 受影响的输入，报告为 ``report``、预算为 ``budget``。
        detail: 面向人的具体原因，含路径与实际值。
        binding_state: 预算声明的绑定状态；预算不可读时为 ``None``。
    """

    def __init__(self, kind: str, detail: str, subject: str = "unknown",
                 binding_state: object = None) -> None:
        """登记一种具体的输入不可用情形，供结论文件分列类别与处置。

        Args:
            kind: 登记表中的情形标识，决定结论给出的类别与可执行处置。
            detail: 面向人的具体原因，含路径与实际值。
            subject: 受影响的输入，报告为 ``report``、预算为 ``budget``。
            binding_state: 预算自己声明的绑定状态；预算不可读时留空。
        """

        super().__init__(detail)
        self.kind = kind
        self.detail = detail
        self.subject = subject
        self.binding_state = binding_state


@dataclass(frozen=True)
class Finding:
    """单条预算判定结果；kind 区分证据缺口与真实超预算。"""

    kind: str
    scenario: str
    metric: str
    observed: float | None
    allowed: float | None
    message: str


def _ratio(observed: float, allowed: float) -> float:
    """返回观测值与允许值的比值，供报告直接显示超出倍数。"""

    return observed / allowed if allowed else float("inf")


def percentile(values: Sequence[float], percent: float) -> float:
    """用线性插值计算分位数，保证同一份原始样本在任何机器上得到相同结果。

    Args:
        values: 已完成排序或未排序的原始样本，单位与调用方约定一致。
        percent: 0 到 100 的分位点。
    Returns:
        对应分位数的插值结果。
    Raises:
        ValueError: 样本为空或分位点越界。
    """

    if not values:
        raise ValueError("分位数计算需要至少一个样本")
    if not 0 <= percent <= 100:
        raise ValueError("分位点必须位于 0 到 100 之间")
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    position = (len(ordered) - 1) * percent / 100
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return float(ordered[lower]) * (1 - weight) + float(ordered[upper]) * weight


def summarize(samples_ms: Sequence[float]) -> dict[str, float]:
    """由原始样本生成判定所需的统计量，避免调用方各自计算导致口径漂移。

    Args:
        samples_ms: 单次请求的端到端毫秒样本。
    Returns:
        中位数、p95、p99、最大值与样本量。
    Raises:
        ValueError: 样本为空。
    """

    if not samples_ms:
        raise ValueError("汇总需要至少一个样本")
    return {
        "samples": len(samples_ms),
        "median_ms": statistics.median(samples_ms),
        "p50_ms": percentile(samples_ms, 50),
        "p95_ms": percentile(samples_ms, 95),
        "p99_ms": percentile(samples_ms, 99),
        "max_ms": max(samples_ms),
        "min_ms": min(samples_ms),
    }


def load_document(path: Path, expected_schema: str,
                  retired: Mapping[str, str] | None = None,
                  subject: str = "report") -> dict[str, Any]:
    """读取并校验结构版本，缺失、非 JSON 或结构不符都作为配置错误拒绝。

    四种失败各自带一种 ``kind``，退出码 2 的结论文件据此区分「读不到」「不是合法
    JSON」「schema 不受支持」和「结构缺字段」，而不是把它们合成同一句话。

    Args:
        path: 报告或预算文件位置。
        expected_schema: 期望的顶层 schema 标识。
        retired: 已退役结构版本到退役原因的映射；命中时给出可执行的迁移说明而不是
            只说「版本不对」，让操作者能直接知道旧依据为什么不可用。
        subject: 该文件在判定中的角色，取 ``report`` 或 ``budget``，决定结论里记
            录的是输入报告还是预算文件。
    Returns:
        解析后的顶层对象。
    Raises:
        UnavailableInput: 文件不可读、不是 JSON 对象或 schema 不匹配；子类化
            ValueError，既有捕获逻辑不受影响。
    """

    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise UnavailableInput(f"{subject}-unreadable",
                               f"无法读取 {path}：{error.strerror or error}", subject) from error
    except json.JSONDecodeError as error:
        raise UnavailableInput(f"{subject}-not-json",
                               f"{path} 不是合法 JSON：{error}", subject) from error
    if not isinstance(document, dict):
        raise UnavailableInput(f"{subject}-shape-invalid",
                               f"{path} 的顶层必须是 JSON 对象", subject)
    declared = document.get("schema")
    if declared != expected_schema:
        # 「schema 不受支持」与「结构缺字段」分开登记：前者必须写明实际声明的是哪个
        # schema、该迁移到哪个，后者只说缺结构，两者的处置完全不同。
        reason = (retired or {}).get(str(declared))
        detail = (f"{path} 仍是 {declared}：{reason}" if reason
                  else f"{path} 的 schema 必须是 {expected_schema}（实际 {declared!r}）")
        raise UnavailableInput(f"{subject}-schema-unsupported", detail, subject)
    return document


def _hex_text(value: object, length: int) -> str | None:
    """校验十六进制定长文本；不是定长文本时返回 ``None``，布尔等类型自然被排除。"""

    if not isinstance(value, str) or len(value) != length:
        return None
    if any(character not in "0123456789abcdef" for character in value):
        return None
    return value


def binding_expectation(budget: Mapping[str, Any]) -> dict[str, str]:
    """取出预算声明的构件绑定；声明本身不可用时按配置错误拒绝而不是默认放行。

    预算必须声明受支持的绑定方法、范围与两项可复现身份。缺任何一项都意味着「这份预算
    无法证明读数来自被校准的那份代码」，此时若放行等于把绑定判定整体关掉，因此这里一律
    抛配置错误，由入口转成退出码 2，并在结论文件里记为 ``budget-binding-unbound``：
    它是「还没在目标环境重新校准」，不是「这次测慢了」。

    Args:
        budget: 已解析的 perf-budget/v2 对象。
    Returns:
        绑定方法、范围与两项身份字段。
    Raises:
        UnavailableInput: 仍按退役的构件字节摘要绑定、方法或范围不支持、或缺少/填错
            身份字段；``binding_state`` 记录预算自己声明的绑定状态。
    """

    applies = budget.get("applies_to") or {}
    build = applies.get("build")
    if not isinstance(build, dict):
        raise _binding_unbound(
            "预算文件必须在 applies_to.build 中声明构件绑定", None)
    if RETIRED_BINDING_FIELD in build:
        raise _binding_unbound(
            f"预算文件仍以 {RETIRED_BINDING_FIELD} 绑定被测版本：{RETIRED_BUDGET_REASON}",
            build.get("binding_state"))
    state = build.get("binding_state")
    method = build.get("binding_method")
    if method != BINDING_METHOD:
        raise _binding_unbound(
            f"预算文件的 binding_method 必须声明为 {BINDING_METHOD}"
            f"（当前 {method!r}，binding_state={state!r}）", state)
    scope = build.get("source_scope")
    if scope != BINDING_SCOPE:
        raise _binding_unbound(
            f"预算文件的 source_scope 必须声明为 {BINDING_SCOPE}"
            f"（当前 {scope!r}，binding_state={state!r}）", state)
    expected = {"binding_method": str(method), "source_scope": str(scope)}
    for field, length in BINDING_FIELDS.items():
        value = _hex_text(build.get(field), length)
        if value is None:
            raise _binding_unbound(
                f"预算文件的构件绑定缺少可用的 {field}（binding_state={state!r}）："
                f"必须回填 {length} 位小写十六进制；绑定未回填前本预算不能作为判定依据，"
                "需要在目标环境重新校准", state)
        expected[field] = value
    return expected


def _binding_unbound(detail: str, state: object) -> UnavailableInput:
    """构造「预算声明不出可复现绑定」这一情形，附带预算自己声明的绑定状态。

    Args:
        detail: 面向人的具体原因。
        state: 预算在 ``applies_to.build.binding_state`` 中声明的状态；缺失时为 None。
    Returns:
        携带 ``budget-binding-unbound`` 标识的输入不可用异常。
    """

    return UnavailableInput("budget-binding-unbound", detail, "budget", state)


def binding_findings(report: Mapping[str, Any], expected: Mapping[str, str]) -> list[Finding]:
    """核对实测报告是否就是预算所绑定的那份代码，并区分「不符」与「根本没给证据」。

    两类问题的处置不同，因此分成两种 kind：口径不同或身份不符判 ``build-mismatch`` /
    ``build-binding-mismatch``（测的不是被校准的那份代码，数字不可用于判定）；报告完全
    没有给出绑定证据判 ``build-binding-missing``（证据缺口，同样不能算通过）。两者都让
    判定失败，绝不因为换了绑定方式就消失。

    Args:
        report: 已解析的 perf-report/v1 对象。
        expected: 预算声明的绑定。
    Returns:
        绑定不一致或绑定证据缺失的问题；空列表表示实测报告与被校准代码同源。
    """

    build = report.get("build")
    build = build if isinstance(build, dict) else {}
    findings: list[Finding] = []
    for field in ("binding_method", "source_scope"):
        observed = build.get(field)
        if observed != expected[field]:
            findings.append(Finding(
                "build-binding-mismatch", "*", field, None, None,
                f"报告 {field}={observed!r} 与预算声明的 {expected[field]!r} 不一致，"
                "两次测量的绑定口径不可比",
            ))
    for field in BINDING_FIELDS:
        observed = build.get(field)
        if not isinstance(observed, str) or not observed:
            findings.append(Finding(
                "build-binding-missing", "*", field, None, None,
                f"报告没有给出 {field}，无法证明读数来自预算所绑定的源码",
            ))
        elif observed != expected[field]:
            findings.append(Finding(
                "build-mismatch", "*", field, None, None,
                f"报告 {field}={observed} 与预算声明的 {expected[field]} 不一致，"
                "测的不是被校准的那份代码",
            ))
    return findings


def binding_summary(report: Mapping[str, Any], budget: Mapping[str, Any],
                    findings: Sequence[Finding]) -> dict[str, Any]:
    """汇总判定实际使用的绑定，供日志、制品与发布证据核对。

    Args:
        report: 已解析的 perf-report/v1 对象。
        budget: 已解析的 perf-budget/v2 对象。
        findings: 本次判定产生的问题；用于给出绑定是否成立的结论。
    Returns:
        含方法、范围、预算声明值、实测值与是否一致的记录。
    """

    declared_build = (budget.get("applies_to") or {}).get("build")
    declared_build = declared_build if isinstance(declared_build, dict) else {}
    build = report.get("build")
    build = build if isinstance(build, dict) else {}
    observed = {field: build.get(field) for field in ("binding_method", "source_scope",
                                                      *BINDING_FIELDS)}
    matched = not any(item.kind.startswith("build-") for item in findings)
    return {
        "method": BINDING_METHOD,
        "scope": BINDING_SCOPE,
        "declared": {field: declared_build.get(field) for field in ("binding_method",
                                                                     "source_scope",
                                                                     *BINDING_FIELDS)},
        "observed": observed,
        "matched": matched,
    }


def _scenario_samples(scenario: Mapping[str, Any]) -> list[float]:
    """取出场景原始样本并拒绝非数值，避免字符串样本被静默丢弃。

    Args:
        scenario: 报告中的单场景结果。
    Returns:
        全部原始样本的浮点形式，保留原始顺序。
    Raises:
        UnavailableInput: 样本列表缺失或含非数值样本，归属为报告结构不可用。
    """

    raw = scenario.get("samples_ms")
    if not isinstance(raw, list):
        raise UnavailableInput("report-shape-invalid", "场景缺少 samples_ms 原始样本列表",
                               "report")
    samples: list[float] = []
    for item in raw:
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            raise UnavailableInput("report-shape-invalid", "samples_ms 只允许数值样本",
                                   "report")
        samples.append(float(item))
    return samples


def _resource_findings(report: Mapping[str, Any], budget: Mapping[str, Any]) -> list[Finding]:
    """核对运行期资源上限；缺少资源证据时按证据缺口处理而不是默认通过。

    Args:
        report: 已解析的 perf-report/v1 对象。
        budget: 已解析的 perf-budget/v1 对象。
    Returns:
        资源超限或证据缺失问题。
    Raises:
        UnavailableInput: 预算的 resources 段不是对象，归属为预算结构不可用。
    """

    limits = budget.get("resources")
    if limits is None:
        return []
    if not isinstance(limits, dict):
        raise UnavailableInput("budget-shape-invalid", "resources 预算必须是对象", "budget")
    resources = report.get("resources")
    if not isinstance(resources, dict):
        return [Finding("resource-not-measured", "*", "resources", None, None,
                        "预算要求资源证据，但本次报告没有采集资源指标")]

    findings: list[Finding] = []
    peak = resources.get("peak_rss_kb")
    peak_limit = limits.get("peak_rss_kb")
    if peak_limit is not None:
        if not isinstance(peak, (int, float)) or isinstance(peak, bool):
            findings.append(Finding("resource-not-measured", "*", "peak_rss_kb", None,
                                    float(peak_limit), "没有峰值驻留内存证据"))
        elif float(peak) > float(peak_limit):
            findings.append(Finding("over-budget", "*", "peak_rss_kb", float(peak), float(peak_limit),
                                    f"峰值驻留内存 {float(peak) / 1024:.0f} MiB 超过预算"
                                    f" {float(peak_limit) / 1024:.0f} MiB"))

    after = resources.get("after") or {}
    for field in ("threads", "fds"):
        limit = limits.get(field)
        if limit is None:
            continue
        observed = after.get(field)
        if not isinstance(observed, (int, float)) or isinstance(observed, bool):
            findings.append(Finding("resource-not-measured", "*", field, None, float(limit),
                                    f"没有结束时的 {field} 证据"))
        elif float(observed) > float(limit):
            findings.append(Finding("over-budget", "*", field, float(observed), float(limit),
                                    f"结束时 {field}={float(observed):.0f} 超过预算 {float(limit):.0f}"))
    return findings


def _scenario_resource_findings(name: str, scenario: Mapping[str, Any],
                                budget: Mapping[str, Any]) -> list[Finding]:
    """核对单个场景内资源是否随迭代无界增长；未采集时跳过而不报假通过。

    Args:
        name: 场景名。
        scenario: 报告中的单场景结果。
        budget: 已解析的 perf-budget/v1 对象。
    Returns:
        该场景的资源增长问题。
    Raises:
        UnavailableInput: 预算的 resources 段不是对象，归属为预算结构不可用。
    """

    limits = budget.get("resources") or {}
    if not isinstance(limits, dict):
        raise UnavailableInput("budget-shape-invalid", "resources 预算必须是对象", "budget")
    if not any(key in limits for key in ("max_thread_growth", "max_fd_growth")):
        return []
    resources = scenario.get("resources")
    if not isinstance(resources, dict):
        return []
    before = resources.get("before") or {}
    after = resources.get("after") or {}
    findings: list[Finding] = []
    for field, limit_key in (("threads", "max_thread_growth"), ("fds", "max_fd_growth")):
        limit = limits.get(limit_key)
        if limit is None:
            continue
        start, end = before.get(field), after.get(field)
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            continue
        growth = float(end) - float(start)
        if growth > float(limit):
            findings.append(Finding(
                "resource-growth", name, field, growth, float(limit),
                f"该场景 {field} 增长 {growth:.0f}，超过允许的 {float(limit):.0f}；"
                f"资源未随迭代释放时不能只报告延迟",
            ))
    return findings


def evaluate(report: Mapping[str, Any], budget: Mapping[str, Any]) -> list[Finding]:
    """按预算逐场景判定，返回全部问题而不是遇到首个问题即停止。

    Args:
        report: 已解析的 perf-report/v1 对象。
        budget: 已解析的 perf-budget/v2 对象。
    Returns:
        所有证据缺口与超预算问题，空列表表示全部满足。
    Raises:
        UnavailableInput: 报告或预算缺少必需结构，属于配置错误而非超预算；退出码 2 的
            结论文件据此登记 `report-shape-invalid` 或 `budget-shape-invalid`。
    """

    budget_scenarios = budget.get("scenarios")
    if not isinstance(budget_scenarios, dict) or not budget_scenarios:
        raise UnavailableInput("budget-shape-invalid", "预算文件必须包含非空的 scenarios 映射",
                               "budget")
    report_scenarios = report.get("scenarios")
    if not isinstance(report_scenarios, dict):
        raise UnavailableInput("report-shape-invalid", "报告必须包含 scenarios 映射",
                               "report")

    findings: list[Finding] = []

    # 环境与负载必须与预算声明的适用条件一致，否则数字不可比，不能给出通过。
    applies = budget.get("applies_to") or {}
    workload = report.get("workload") or {}
    concurrency = report.get("concurrency")
    if applies.get("workload") and applies.get("workload") != workload.get("id"):
        findings.append(Finding(
            "workload-mismatch", "*", "workload", None, None,
            f"报告负载 {workload.get('id')!r} 与预算适用负载 {applies.get('workload')!r} 不一致",
        ))
    if applies.get("concurrency") is not None and applies.get("concurrency") != concurrency:
        findings.append(Finding(
            "concurrency-mismatch", "*", "concurrency", float(concurrency or 0),
            float(applies.get("concurrency")), "报告并发度与预算适用并发度不一致",
        ))

    # 结果必须对应预算声明的那份源码：读数只对被校准的代码成立，绑定不符时下面各项
    # 指标即使达标也不能算通过。绑定先单独核对，使「测的不是被校准的提交」与「该提交
    # 的某项指标超限」在结论里分列为不同 kind，不混为一类。
    findings.extend(binding_findings(report, binding_expectation(budget)))

    findings.extend(_resource_findings(report, budget))

    for name, limits in budget_scenarios.items():
        if not isinstance(limits, dict):
            raise UnavailableInput("budget-shape-invalid", f"场景 {name} 的预算必须是对象",
                                   "budget")
        scenario = report_scenarios.get(name)
        if not isinstance(scenario, dict):
            findings.append(Finding(
                "scenario-missing", name, "samples", None, None, "报告中没有该场景的测量结果",
            ))
            continue
        errors = scenario.get("errors")
        if not isinstance(errors, int) or errors < 0:
            raise UnavailableInput("report-shape-invalid",
                                   f"场景 {name} 的 errors 必须是非负整数", "report")
        if errors:
            findings.append(Finding(
                "request-errors", name, "errors", float(errors), 0.0,
                f"该场景有 {errors} 次请求失败，失败样本不能作为延迟证据",
            ))
        samples = _scenario_samples(scenario)
        if not samples:
            findings.append(Finding(
                "not-measured", name, "samples", 0.0, 1.0, "该场景没有任何有效样本，未执行测量不算通过",
            ))
            continue
        stats = summarize(samples)
        findings.extend(_scenario_resource_findings(name, scenario, budget))

        # 延迟绝对预算：p50/p95/p99 全部分别核对。
        for percent, field in PERCENTILES:
            limit = limits.get(field)
            if limit is None:
                continue
            observed = float(stats[field])
            if observed > float(limit):
                findings.append(Finding(
                    "over-budget", name, field, observed, float(limit),
                    f"p{percent} {observed:.1f} ms 超过预算 {float(limit):.1f} ms"
                    f"（{_ratio(observed, float(limit)):.2f} 倍）",
                ))

        # 并发场景的分位数对排队与调度敏感，吞吐下限是更稳定的判据。
        throughput_floor = limits.get("min_throughput_per_second")
        if throughput_floor is not None:
            observed = scenario.get("throughput_per_second")
            if not isinstance(observed, (int, float)) or isinstance(observed, bool):
                findings.append(Finding(
                    "throughput-not-measured", name, "throughput_per_second", None,
                    float(throughput_floor), "没有取得吞吐证据，缺少该项证据不能判为通过",
                ))
            elif float(observed) < float(throughput_floor):
                findings.append(Finding(
                    "over-budget", name, "throughput_per_second", float(observed),
                    float(throughput_floor),
                    f"吞吐 {float(observed):.1f} 次/秒 低于下限 {float(throughput_floor):.1f} 次/秒",
                ))

        # 数据库查询数：绝对值上限用于识别 N+1 与无界查询。
        for field in SQL_BUDGET_FIELDS:
            limit = limits.get(field)
            if limit is None:
                continue
            sql = scenario.get("sql") or {}
            observed = sql.get(field)
            if not isinstance(observed, (int, float)) or isinstance(observed, bool):
                findings.append(Finding(
                    "sql-not-measured", name, field, None, float(limit),
                    "没有取得数据库查询数，缺少该项证据不能判为通过",
                ))
                continue
            if float(observed) > float(limit):
                findings.append(Finding(
                    "over-budget", name, field, float(observed), float(limit),
                    f"{field} {float(observed):.1f} 超过预算 {float(limit):.1f}",
                ))

        # 噪声下限：预算低于已验证的噪声下限时会在正常波动下误报，属于预算本身不可用。
        reference = limits.get("reference")
        tolerance = limits.get("relative_tolerance")
        noise = budget.get("noise_floor") or {}
        noise_ratio = noise.get("p95_relative") if isinstance(noise, dict) else None
        if isinstance(reference, dict) and isinstance(noise_ratio, (int, float)):
            baseline = reference.get("p95_ms")
            limit = limits.get("p95_ms")
            if isinstance(baseline, (int, float)) and isinstance(limit, (int, float)):
                floor = float(baseline) * (1 + float(noise_ratio))
                if float(limit) < floor:
                    findings.append(Finding(
                        "budget-below-noise-floor", name, "p95_ms", float(limit), floor,
                        f"p95 预算 {float(limit):.1f} ms 低于参考基线 {float(baseline):.1f} ms"
                        f" 加已验证噪声 {float(noise_ratio) * 100:.0f}% 的下限 {floor:.1f} ms",
                    ))

        if isinstance(reference, dict) and isinstance(tolerance, (int, float)):
            for field in ("p95_ms", "p99_ms"):
                baseline = reference.get(field)
                if not isinstance(baseline, (int, float)) or isinstance(baseline, bool):
                    continue
                allowed = float(baseline) * (1 + float(tolerance))
                observed = float(stats[field])
                if observed > allowed:
                    findings.append(Finding(
                        "regression-budget", name, field, observed, allowed,
                        f"{field} {observed:.1f} ms 超过参考基线 {float(baseline):.1f} ms"
                        f" 加 {float(tolerance) * 100:.0f}% 容差后的 {allowed:.1f} ms",
                    ))
    return findings


def payload(report: Mapping[str, Any], budget: Mapping[str, Any], findings: Sequence[Finding]) -> dict[str, object]:
    """生成结构化结果；checked 取实际参与判定的场景数，不用计划数量代替。

    结论必须自带构件绑定的期望值与实测值：绑定是否成立是发布证据链要独立复核的一项，
    只留一个 `build-mismatch` 文字结论会让复核方无从判断「测的是哪份代码」。

    Args:
        report: 已解析的 perf-report/v1 对象。
        budget: 已解析的 perf-budget/v2 对象。
        findings: 本次判定产生的问题。
    Returns:
        可直接写成发布证据的结构化结论。
    """

    budget_scenarios = budget.get("scenarios") or {}
    report_scenarios = report.get("scenarios") or {}
    checked = sum(1 for name in budget_scenarios if name in report_scenarios)
    return {
        "protocol": "quality-check/v1",
        "check": CHECK_NAME,
        "schema": BUDGET_SCHEMA,
        "budget_status": budget.get("status"),
        "workload": (report.get("workload") or {}).get("id"),
        "checked": checked,
        "binding": binding_summary(report, budget, findings),
        "status": "failed" if findings else "passed",
        "findings": [
            {
                "kind": item.kind, "scenario": item.scenario, "metric": item.metric,
                "observed": item.observed, "allowed": item.allowed, "message": item.message,
            }
            for item in findings
        ],
    }


def unavailable_binding(report: Mapping[str, Any] | None,
                        budget: Mapping[str, Any] | None) -> dict[str, Any]:
    """登记判定未执行时的构件绑定实况，不假装已经比较过。

    ``binding_summary`` 只在真实比较过后才给得出「相符 / 不相符」；输入不可用时比较
    从未发生，这里固定写 ``matched=None`` 并附 ``compared=False``：把它写成 ``True``
    等于凭空造出一条绑定成立的结论。

    Args:
        report: 已解析的报告对象；报告不可用时为 ``None``。
        budget: 已解析的预算对象；预算不可用时为 ``None``。
    Returns:
        方法、范围、预算声明值、实测值与「本次是否做过比较」的登记记录。
    """

    declared_build = ((budget or {}).get("applies_to") or {}).get("build")
    declared_build = declared_build if isinstance(declared_build, dict) else {}
    observed_build = (report or {}).get("build")
    observed_build = observed_build if isinstance(observed_build, dict) else {}
    fields = ("binding_method", "source_scope", *BINDING_FIELDS)
    return {
        "method": BINDING_METHOD,
        "scope": BINDING_SCOPE,
        "declared": {field: declared_build.get(field) for field in fields},
        "observed": {field: observed_build.get(field) for field in fields},
        "matched": None,
        "compared": False,
        "state": declared_build.get("binding_state"),
    }


def unavailable_payload(error: UnavailableInput, report: Mapping[str, Any] | None,
                        budget: Mapping[str, Any] | None) -> dict[str, object]:
    """生成「判定未执行」的结论文件内容：状态 unavailable，不冒充通过也不冒充超标。

    退出码 2 过去只往标准错误写一行字，标准输出为空，被 capture 成结论文件时得到一个
    0 字节文件，上传的制品里因此没有任何结论，日志里也只剩一个退出码。这里让退出码 2
    同样产出结论：``status`` 为 ``unavailable``（不是 ``passed``），``findings`` 为空但
    ``checked`` 为 0，并在 ``unavailable`` 段里分列类别、具体情形、受影响输入、预算自己
    声明的绑定状态与可执行处置。

    Args:
        error: 判定失败时捕获到的输入不可用异常。
        report: 已解析的报告对象；报告不可用时为 ``None``。
        budget: 已解析的预算对象；预算不可用时为 ``None``。
    Returns:
        与正常判定同一结构的结论文档，多出 ``exit_code`` 与 ``unavailable`` 两段。
    """

    category, action = UNAVAILABLE_GUIDE.get(error.kind, DEFAULT_GUIDE)
    binding = unavailable_binding(report, budget)
    state = binding.get("state")
    if state is None:
        state = error.binding_state
    workload = (report or {}).get("workload")
    return {
        "protocol": "quality-check/v1",
        "check": CHECK_NAME,
        "schema": BUDGET_SCHEMA,
        "budget_status": (budget or {}).get("status"),
        "workload": workload.get("id") if isinstance(workload, dict) else None,
        # 判定一次也没有执行：写实际执行数 0，不写预算声明的场景数。
        "checked": 0,
        "binding": binding,
        "status": "unavailable",
        "exit_code": 2,
        "findings": [],
        "unavailable": {
            "category": category,
            "kind": error.kind,
            "subject": error.subject,
            "detail": error.detail,
            "binding_state": state,
            "action": action,
        },
    }


def main(argv: Sequence[str] | None = None) -> int:
    """执行预算核对并按结果返回退出码：0 通过、1 超预算或绑定不符、2 输入不可用。

    退出码 2 同样产出结论文件（``status`` 为 ``unavailable``），并把三类输入不可用
    分列在 ``unavailable`` 段里。退出码本身不因这次补充而改动：2 仍然是 2。

    Args:
        argv: 命令行参数；省略时读取真实进程参数。
    Returns:
        0 表示全部满足；1 表示存在超预算、证据不足或构件绑定不符；2 表示报告、预算或
        预算声明的构件绑定本身不可用。
    """

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", required=True, help="本次实测生成的 perf-report/v1 文件")
    parser.add_argument("--budgets", required=True,
                        help=f"受版本控制的 {BUDGET_SCHEMA} 文件")
    parser.add_argument("--json", action="store_true", help="输出结构化结果")
    args = parser.parse_args(argv)
    report: dict[str, Any] | None = None
    budget: dict[str, Any] | None = None
    try:
        report = load_document(Path(args.report), REPORT_SCHEMA, subject="report")
        budget = load_document(Path(args.budgets), BUDGET_SCHEMA,
                               retired={RETIRED_BUDGET_SCHEMA: RETIRED_BUDGET_REASON},
                               subject="budget")
        findings = evaluate(report, budget)
    except UnavailableInput as error:
        return _report_unavailable(args.json, error, report, budget)
    except ValueError as error:  # 未登记在册的输入错误同样必须留下结论文件。
        return _report_unavailable(args.json, UnavailableInput("input-invalid", str(error)),
                                   report, budget)
    result = payload(report, budget, findings)
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        binding = result["binding"]
        print(f"性能预算核对：检查 {result['checked']} 个场景，{len(findings)} 项问题；"
              f"构件绑定 {binding['method']} {'相符' if binding['matched'] else '不相符'}"
              f"（实测修订 {binding['observed']['git_revision']}、"
              f"预算修订 {binding['declared']['git_revision']}）")
        for item in findings:
            print(f"  [{item.kind}] {item.scenario} {item.metric}：{item.message}")
    return 1 if findings else 0


def _report_unavailable(as_json: bool, error: UnavailableInput,
                        report: Mapping[str, Any] | None,
                        budget: Mapping[str, Any] | None) -> int:
    """把判定输入不可用写成结论文件内容，并按真实语义返回退出码 2。

    标准输出在 ``--json`` 下承载结论（调用方据此得到非空的结论文件），标准错误承载
    面向人的原因与处置；两者都不含凭据。退出码固定为 2，不改写成 0 或 1。

    Args:
        as_json: 是否按结构化结论输出。
        error: 判定失败时捕获到的输入不可用异常。
        report: 已解析的报告对象；报告不可用时为 ``None``。
        budget: 已解析的预算对象；预算不可用时为 ``None``。
    Returns:
        固定为 2，表示判定输入不可用。
    """

    verdict = unavailable_payload(error, report, budget)
    blocked = verdict["unavailable"]
    print(f"性能预算核对无法执行：{blocked['detail']}", file=sys.stderr)
    print(f"情形 {blocked['category']}/{blocked['kind']}（受影响输入：{blocked['subject']}）；"
          f"处置：{blocked['action']}", file=sys.stderr)
    if as_json:
        print(json.dumps(verdict, ensure_ascii=False))
    return 2


if __name__ == "__main__":
    sys.exit(main())
