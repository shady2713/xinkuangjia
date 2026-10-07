#!/usr/bin/env python3
"""检查 Git 暂存区新增或修改的 Java 声明是否具备项目要求的注释。

检查器读取暂存版本而非工作区版本，只校验本次变更覆盖的声明，避免历史注释欠账
阻塞无关提交。DO、VO 的成员变量同样要求使用 JavaDoc 说明字段职责。

public 类型有两条合规路径：准确的 ``@author``，或按 D12 裁决固定格式书写、并由受控
清单与上游快照逐项核验的来源说明。来源说明只主张“某固定上游版本的对应文件未声明
作者”，不主张历史引入版本，也不得写成具体人名。

按裁决 D15，报告必须区分「通过 / 已登记阻断 / 失败」三种结论：``quality-check/v2``
把硬失败诊断、已验收来源（含独立 A1 分支）与已登记阻断分列，维护完成态使用
``completed-with-registered-blockers`` 而不是 ``passed``。未验收条目只有在索引、对象、
保留文本、状态、最终版本都能核对且就地标注与索引相符时才进入独立阻断集合；无标注、
重复/冲突标注、未知取值或自称已验收一律硬失败。作者标签形态（含 33 条只有 ``@author``
的原阻断项）与来源说明形态走同一验收状态汇总，使用独立的 ``署名验收：`` 标注，
不能借作者格式分支漏报。只有显式维护模式才允许以“执行完成、存在已登记阻断”结束；
未显式选择时既有验收入口保持严格拒绝。

清单与快照位置按“命令行参数 > 环境变量 > 仓库内受控默认位置”解析：
``--evidence-registry``/``--evidence-snapshots`` 或
``JAVA_COMMENT_EVIDENCE_REGISTRY``/``JAVA_COMMENT_EVIDENCE_SNAPSHOTS`` 显式配置优先；
都没有时读取被检查仓库内的 ``DEFAULT_EVIDENCE_REGISTRY``，并在该目录真实存在时启用
``DEFAULT_EVIDENCE_SNAPSHOTS``，不写死任何本机绝对路径。
上游内容的**逐字节副本**已按 D7 授权作为最小固定证据快照纳入版本控制：快照根目录下的
``上游快照清单.json`` 逐条登记相对路径、字节数、SHA-256、上游固定提交、原始取回地址与
声明指纹；存在清单时逐条复算，文件缺失、字节或指纹不符、以及许可证材料缺位都按硬失败
拒绝。清单缺失的外部快照仍沿用既有行为：受控快照优先，缺失时按清单登记的固定提交地址
取回并复算 SHA-256；取不回或指纹不符即拒绝。证据不可读时以退出码 2 报告原因，
不回退到无条件放行。

@author 李杰
"""

from __future__ import annotations

import argparse
import bisect
import csv
import difflib
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from pathlib import Path

if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scripts.common.repository_layout import JAVA_SOURCE_ROOT, is_java_source
from scripts.common.quality_common import CheckError

# Windows Git Hook 可能继承非 UTF-8 控制台编码，统一输出编码以保证中文提示可读。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


GIT_TIMEOUT_SECONDS = 30
HUNK_HEADER_PATTERN = re.compile(
    r"^@@ -\d+(?:,\d+)? \+(?P<line>\d+)(?:,\d+)? @@"
)
TYPE_PATTERN = re.compile(
    r"(?<![\w$])"
    r"(?P<modifiers>(?:(?:public|protected|private|abstract|static|final|"
    r"sealed|non-sealed|strictfp)\s+)*)"
    r"(?P<kind>@interface|class|interface|enum|record)\s+"
    r"(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)"
)
IDENTIFIER_BEFORE_PAREN_PATTERN = re.compile(
    r"(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*$"
)
FIELD_PREFIX_PATTERN = re.compile(
    r"^(?:(?:public|protected|private|static|final|transient|volatile)\s+)*"
    r"(?:@[A-Za-z_$][A-Za-z0-9_$.]*(?:\s*\([^)]*\))?\s+)*"
    r"[A-Za-z_$][A-Za-z0-9_$.,<>?\[\] @]*\s+"
    r"[A-Za-z_$][A-Za-z0-9_$]*\b",
    re.DOTALL,
)
# 兼容普通空白和 JavaDoc/HTML 中常见的空格实体，避免不同模板导致漏检。
AUTHOR_PATTERN = re.compile(
    r"@author(?:[ \t]|&(?:#x20;|#32;|nbsp;))+"
    r"(?P<name>[^\r\n*]+)",
    re.IGNORECASE,
)
# 只拦截无法代表真实身份的明确占位值；真实姓名由执行流程按用户规则核对。
AUTHOR_PLACEHOLDERS = {
    "<author>",
    "<实际作者>",
    "author",
    "name",
    "todo",
    "unknown",
    "unknown author",
    "作者",
    "作者姓名",
    "姓名",
    "实际作者",
    "待填写",
    "开发者",
}
CONTROL_KEYWORDS = {
    "assert",
    "catch",
    "do",
    "for",
    "if",
    "new",
    "return",
    "super",
    "switch",
    "synchronized",
    "this",
    "throw",
    "try",
    "while",
}
# 中性表达不能代表作者身份，也不能借 @author 承载来源说明。
AUTHOR_NEUTRAL_VALUES = {
    "basic-framework",
    "basicframework",
    "未声明作者",
    "来源不明",
    "来源未知",
    "无作者",
    "作者未声明",
    "上游未声明作者",
}
AUTHOR_SOURCE_SENTENCE_PATTERN = re.compile(
    r"来源\s*[:：]|未声明作者|来源不明|来源未知|无作者|作者未声明|"
    r"[A-Za-z0-9._-]+/[A-Za-z0-9._-]+\s*@\s*[0-9a-f]{8,40}"
)
# D12 方案 A：固定格式的来源说明，只能出现在职责 JavaDoc 正文且位于全部块标签之前。
SOURCE_HEADER_PREFIX = "来源："
SOURCE_DECLARATION_SUFFIX = "（该版本未声明作者）"
SOURCE_HEADER_PATTERN = re.compile(
    r"^来源：(?P<repository>[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*)"
    r" @ (?P<commit>[0-9a-f]{40})（该版本未声明作者）$"
)
SOURCE_REPOSITORY_PATTERN = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$"
)
SOURCE_PATH_PREFIX = "上游文件："
SOURCE_PATH_PATTERN = re.compile(r"^上游文件：(?P<path>.+)$")
# 长上游路径的续行前缀。PMD 7.17 的 CommentSize 只有 maxLineLength 一个全局旋钮，
# 注释不是 XPath 节点，按行放宽无法表达（抑制表达式在实际求值上下文里只能看到编译单元，
# 无法只豁免一行），因此按裁决 D13 把来源说明块扩展为“四行基础格式 + 可选的上游文件续行”：
# 续行只续接路径值本身，路径总段数（含首行）上限 3，拼接结果仍与清单 upstream_path
# 逐字节全等比较，且不对路径载荷或清单值做任何 strip / 归一化，证据门槛不变。
SOURCE_PATH_CONTINUATION_PREFIX = "上游文件续："
SOURCE_PATH_MAX_SEGMENTS = 3
SOURCE_LOCAL_PATTERN = re.compile(r"^本地修改：(?P<text>.*)$")
SOURCE_BASIS_FIXED = "来源依据：固定见证版本；历史引入版本未核实。"
SOURCE_BASIS_VERIFIED = "来源依据：已核实引入版本。"
SOURCE_BASIS_LINES = (SOURCE_BASIS_FIXED, SOURCE_BASIS_VERIFIED)
SOURCE_NOTE_LINE_COUNT = 4
SOURCE_NOTE_INCOMPLETE_MESSAGE = (
    "来源说明不完整：必须依次给出来源、上游文件（可用“上游文件续：”续行）、来源依据、本地修改"
)
LOCAL_MODIFICATION_NONE_LINE = "无。"
LOCAL_MODIFICATION_NONE_MARKERS = {"无", "无本地修改", "no-local-modification", "none"}
# 裁决 D14 §120/§132：来源说明的**验收状态**登记在受控派生索引（index_schema 为
# d12-source-index/v1）的 d12_verdict 字段。只有列在 SOURCE_NOTE_ACCEPTED_VERDICTS 的
# 状态才允许该来源说明作为「证据充分」通过；判为阻断、已回退或需补证时，来源说明路径
# 必须拒绝，并给出指向该记录验收状态的诊断。未声明派生 schema 的清单（如账本 TSV）
# 不带验收状态，沿用既有逐项核验，不在本判据内改判。
SOURCE_NOTE_VERDICT_FIELD = "d12_verdict"
SOURCE_NOTE_BLOCKER_FIELD = "d12_blocker_reason"
SOURCE_NOTE_ACCEPTED_VERDICTS = (
    "已按 D12 格式写入来源说明并撤回无依据署名",
    "已按 D12 格式写入来源说明（D10b 改判）",
)
# 文件内来源说明的机读验收标注：来源说明正文中独占一行的标记行。
# 规则与索引共同约束——标记行非「已验收」即拒绝；索引状态非已验收时，即使正文未写标注
# 也拒绝（不能靠省略标注绕过），写了「已验收」而索引未验收同样拒绝。
SOURCE_REVIEW_PREFIX = "来源验收："
SOURCE_REVIEW_ACCEPTED_MARKER = "来源验收：已验收"
SOURCE_REVIEW_UNACCEPTED_MARKER = "来源验收：尚未验收"
SOURCE_REVIEW_MARKERS = (SOURCE_REVIEW_ACCEPTED_MARKER, SOURCE_REVIEW_UNACCEPTED_MARKER)
# 裁决 D15 §128：只有作者标签、没有来源说明的原阻断项必须同等纳管。它们使用独立的
# 就地署名验收标注；标注不能塞进 @author 取值，也不能描述该姓名已核实。
SIGNATURE_REVIEW_PREFIX = "署名验收："
SIGNATURE_REVIEW_ACCEPTED_MARKER = "署名验收：已验收"
SIGNATURE_REVIEW_UNACCEPTED_MARKER = "署名验收：尚未验收"
SIGNATURE_REVIEW_MARKERS = (
    SIGNATURE_REVIEW_ACCEPTED_MARKER,
    SIGNATURE_REVIEW_UNACCEPTED_MARKER,
)
# 作者标签形态的独立已验收分支：A1（E1-author-only）不是来源说明 accepted 集合的成员，
# 不能因为它不在 SOURCE_NOTE_ACCEPTED_VERDICTS 里就把这 11 条算成失败。
AUTHOR_TAG_ACCEPTED_VERDICTS = (
    "A1（E1-author-only）成立，恢复上游证据支持的作者",
)
# 报告状态的固定取值（裁决 D15 §65/§74/§78）：维护完成态必须与 passed 分开表达，
# 不能用同一个 passed 兼任“执行完成”与“来源已验收”两个结论。
CHECK_STATUS_PASSED = "passed"
CHECK_STATUS_FAILED = "failed"
CHECK_STATUS_MAINTENANCE = "completed-with-registered-blockers"
# 验收状态记录的三种分类；只有第一条进入“已验收对象数”，第二条只进入独立阻断清单，
# 第三条是硬失败。禁止把 registered-blocker 计入 passed 或来源验收通过数。
ACCEPTANCE_STATE_ACCEPTED = "accepted"
ACCEPTANCE_STATE_REGISTERED_BLOCKER = "registered-blocker"
ACCEPTANCE_STATE_HARD_FAILURE = "hard-failure"
# 逐项验收状态记录的形态：来源说明形态与作者标签形态必须走同一汇总入口。
ACCEPTANCE_FORM_SOURCE_NOTE = "来源说明"
ACCEPTANCE_FORM_AUTHOR_TAG = "作者标签"
# 验收报告与 v2 计数协议版本；v1 仍是其它检查器沿用的通过/失败协议。
ACCEPTANCE_REPORT_SCHEMA = "source-acceptance-report/v1"
ACCEPTANCE_PROTOCOL = "quality-check/v2"
# 裁决 D14 §112：内容点必须绑定有区分力理由与语料/df 绑定字段，语料绑定须指回固定输入版本。
CORRESPONDENCE_POINT_FIELDS = ("discrimination_reason", "corpus_binding")
CORRESPONDENCE_POINT_KIND_PREFIXES = ("P1", "P2")
CORRESPONDENCE_POINT_MIN_REASON = 8
CORRESPONDENCE_POINT_MIN_BINDING = 8
CORRESPONDENCE_DF_MARKER = "df="
# 受控清单的逐类型证据 schema；类型映射与复核结论必须是结构化结果。
EVIDENCE_SCHEMA = "d12-type-evidence/v1"
# 仓库内派生来源索引的 schema；只在清单显式声明时校验，普通记录数组不受影响。
EVIDENCE_INDEX_SCHEMA = "d12-source-index/v1"
EVIDENCE_HISTORY_BASIS = "introduced-verified"
AUTHOR_UNDECLARED_STATUS = "已核实来源但作者未声明"
EVIDENCE_REGISTRY_ENV = "JAVA_COMMENT_EVIDENCE_REGISTRY"
# 工作区入口只负责准备私有索引并转发本检查器，不接受额外命令行开关；因此维护模式
# 同时提供等价的环境变量入口，让既有调用方无需改动即可显式选择维护模式。
ACCEPTANCE_MODE_ENV = "JAVA_COMMENT_ACCEPTANCE_MODE"
ACCEPTANCE_MODE_MAINTENANCE = "maintenance"
EVIDENCE_SNAPSHOTS_ENV = "JAVA_COMMENT_EVIDENCE_SNAPSHOTS"
# 仓库内受控来源索引；相对被检查仓库根目录解析，不是任何本机绝对路径。
DEFAULT_EVIDENCE_REGISTRY = "docs/测试与可靠性/来源证据/d12-source-index.json"
# 仓库内受控上游证据快照根目录（D7：最小固定上游证据快照已纳入版本控制）。只在目录
# 真实存在时启用，因此外部受控快照、临时夹具与既有“未配置快照”行为都不受影响。
DEFAULT_EVIDENCE_SNAPSHOTS = "docs/测试与可靠性/来源证据/上游快照"
# 快照根目录下的机器可读哈希清单；存在时逐条复算文件字节与指纹，并要求许可证条目
# 随快照交付，缺失、篡改或许可材料缺位都按硬失败拒绝，不静默回落到固定地址取回。
SNAPSHOT_MANIFEST_NAME = "上游快照清单.json"
SNAPSHOT_MANIFEST_SCHEMA = "d12-upstream-snapshot/v1"
SNAPSHOT_MANIFEST_MAX_BYTES = 4 * 1024 * 1024
SNAPSHOT_MANIFEST_KINDS = ("upstream-source", "local-baseline", "license")
# 固定地址取回的边界：单个上游文件不超过 4 MiB，连接与读取合计不超过 30 秒；
# 瞬时连接中断按固定次数重试，仍失败即按“取不回”拒绝。
EVIDENCE_FETCH_TIMEOUT_SECONDS = 30.0
EVIDENCE_FETCH_ATTEMPTS = 3
EVIDENCE_FETCH_BACKOFF_SECONDS = 0.2
MAX_UPSTREAM_BYTES = 4 * 1024 * 1024
EVIDENCE_ROUTES = ("路线 1", "路线 2", "路线 3")
EVIDENCE_REQUIRED_FIELDS = (
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
)
# D14：D10 §0.5 的 E1 作者排除分支（E1-author-only）与路线 3 内容独立分支
# （C2-independent-content）是**按记录显式声明**启用的版本化契约：
# 记录未声明分支时沿用既有“原有充分路线”结构校验，不改判任何已有条目；
# 记录一旦声明分支，就必须满足该分支的全部必需字段与判据，否则拒绝该来源例外。
EVIDENCE_BRANCH_FIELD = "evidence_branch"
EVIDENCE_BRANCH_AUTHOR_ONLY = "E1-author-only"
EVIDENCE_BRANCH_CONTENT_INDEPENDENT = "C2-independent-content"
# 裁决 D16 §10：代码同一性新分支归入 D10 路线 2，标识 E1-code-identity。
# 它**不是**绕过作者、历史、类型映射与发布门禁的通用第四路线：作者/来源仍按
# D10/D12/D15 各自条件验收，代码同一只提供内容关系证据（§120）。
EVIDENCE_BRANCH_CODE_IDENTITY = "E1-code-identity"
EVIDENCE_BRANCHES = (
    EVIDENCE_BRANCH_AUTHOR_ONLY,
    EVIDENCE_BRANCH_CONTENT_INDEPENDENT,
    EVIDENCE_BRANCH_CODE_IDENTITY,
)
AUTHOR_ONLY_SCHEMA = "d10-author-only/v1"
CONTENT_INDEPENDENT_SCHEMA = "d10-content-independent/v1"
CODE_IDENTITY_SCHEMA = "d16-code-identity/v1"
CODE_IDENTITY_TRANSFORM_SET_SCHEMA = "d16-code-identity-transforms/v1"
CODE_IDENTITY_RULES_VERSION = "d16-strict-compare/v1"
CODE_IDENTITY_SERIALIZATION = "d16-token-major/v1"
AUTHOR_ONLY_ROUTE = "路线 2"
CONTENT_INDEPENDENT_ROUTE = "路线 3"
CODE_IDENTITY_ROUTE = "路线 2"
# 分支是版本化契约的启用开关，同时约束记录必须归属的证据路线；分支入口与
# 来源说明入口都只认这一份映射，避免两处口径不一致（N1 覆盖缺口）。
EVIDENCE_BRANCH_ROUTES = {
    EVIDENCE_BRANCH_AUTHOR_ONLY: AUTHOR_ONLY_ROUTE,
    EVIDENCE_BRANCH_CONTENT_INDEPENDENT: CONTENT_INDEPENDENT_ROUTE,
    EVIDENCE_BRANCH_CODE_IDENTITY: CODE_IDENTITY_ROUTE,
}
# 比较契约只允许 D10 §0.3 原列的 R1–R4，且顺序固定；R5/R6 不得用于本分支。
AUTHOR_ONLY_NORMALIZATION_ORDER = ("R1 LF 化", "R2 映射", "R3 行首尾空白", "R4 丢空行")
AUTHOR_ONLY_ATTRIBUTION_CAUSES = (
    "excluded-author-declaration",
    "R1-lf",
    "R2-mapping",
    "R3-line-trim",
    "R4-blank-drop",
)
AUTHOR_ONLY_EXCLUSION_KINDS = ("author", "author-continuation")
AUTHOR_ONLY_CONTINUATION_MAX_TOKENS = 8
# 除作者身份之外的事实标记：出现在 @author 值或紧随行里就拒绝整行排除。
# 这是保守的“无法安全识别即拒绝”边界（裁决 D14 §52/§83），不扩大可忽略范围。
AUTHOR_ONLY_FACT_MARKERS = (
    "职责",
    "负责",
    "版权",
    "许可",
    "license",
    "copyright",
    "参数",
    "修改",
    "版本",
    "日期",
    "说明",
    "模块",
    "接口",
    "实现",
    "示例",
    "用法",
    "注意",
    "来源",
    "上游文件",
    "本地修改",
    "来源依据",
)
# 纯作者身份 token：姓名、邮箱、主页/URL 或 HTML 作者标记；其余形状一律拒绝。
AUTHOR_IDENTITY_TOKEN_PATTERN = re.compile(
    r"^(?:<a\s+href=\"[^\"]+\">[^<]+</a>|<https?://[^>]+>|[A-Za-z0-9_.@/:\-]+|[\u4e00-\u9fff]{1,8})$"
)
STRICT_AUTHOR_LINE_PATTERN = re.compile(
    r"^@author(?:[ \t]|&(?:#x20;|#32;|nbsp;))+\S", re.IGNORECASE
)
CONTENT_POINT_REQUIRED_FIELDS = (
    "fragment",
    "fragment_sha256",
    "local_path",
    "local_sha256",
    "upstream_path",
    "upstream_sha256",
    "local_lines",
    "upstream_lines",
    "owner_type",
    "field_or_behavior",
    "point_kind",
    "corpus_binding",
    "discrimination_reason",
)
CONTENT_POINT_KINDS = ("内容点", "注释点")
# ── 裁决 D16：E1-code-identity 严格代码同一性比较契约 ──
# 变换集必须显式登记、版本化、可复算：清单是仓内受控文件，规则实现按整文件
# SHA-256 与清单自述的 transforms 规范化指纹双重复算，任一处被改动都拒绝。
CODE_IDENTITY_TRANSFORM_SET_ENV = "JAVA_COMMENT_CODE_IDENTITY_TRANSFORM_SET"
# 比较执行顺序：先双方共用登记的空白规范化，再按登记顺序施加变换。
CODE_IDENTITY_NORMALIZATION_ID = "N1"
CODE_IDENTITY_NORMALIZATION_NAME = "代码 token 之间空白规范化"
DEFAULT_CODE_IDENTITY_TRANSFORM_SET = "docs/测试与可靠性/来源证据/代码同一性变换集.json"
# 规范序列化的边界字符：token 类别 + 分隔符 + 原文 + 终止符，不同 token 序列
# 不可能拼成同一文本（D16 §64）。源码代码流里出现这两个控制字符即受控拒绝，
# 因为那会让边界本身变得不可靠。
CODE_IDENTITY_TOKEN_SEPARATOR = "\x1f"
CODE_IDENTITY_TOKEN_TERMINATOR = "\x1e"
CODE_IDENTITY_FORBIDDEN_SOURCE_CHARS = (CODE_IDENTITY_TOKEN_SEPARATOR, CODE_IDENTITY_TOKEN_TERMINATOR)
# 只允许以下五种确定性变换操作；清单出现清单外的操作一律拒绝，绝不按失败残差
# 临时生成替换表（D16 §63）。
CODE_IDENTITY_OPERATIONS = (
    "qualified-name-prefix-map",
    "exact-name-map",
    "exact-simple-name-map",
    "exact-string-literal-map",
    "import-group-canonical-sort",
)
# 变换方向：命名/类型/配置适配只在上游→本地方向生效；import 规范化双方共用。
CODE_IDENTITY_DIRECTIONS = ("upstream-to-local", "both")
# 双方原始差异的可接受归因；任何未解释的差异继续阻断（D16 §65）。
CODE_IDENTITY_ATTRIBUTION_CAUSES = (
    "registered-transform",
    "code-outside-whitespace",
    "comment-difference",
    "local-responsibility-javadoc",
    "d12-source-note",
    "d15-inplace-marker",
    "license-or-copyright",
)
# 注释/署名必须被单独校验的角色（“代码同一”不覆盖注释与署名，D16 §86）。
CODE_IDENTITY_COMMENT_ROLES = (
    "responsibility-javadoc",
    "d12-source-note",
    "d15-inplace-marker",
    "license-or-copyright",
)
# 比较结果必须逐项登记的双方读数（D16 §64：双方代码流 SHA-256、字节数与 token 数）。
CODE_IDENTITY_COMPARISON_FIELDS = (
    "local_code_stream_sha256",
    "upstream_code_stream_sha256",
    "local_code_bytes",
    "upstream_code_bytes",
    "local_token_count",
    "upstream_token_count",
    "import_count_local",
    "import_count_upstream",
)
# Java 运算符/标点，按最长匹配排序；用于切出与原文字节一致的 token 边界。
CODE_IDENTITY_PUNCTUATION = tuple(
    sorted(
        (
            ">>>=", "<<=", ">>=", ">>>", "...", "->", "::",
            "==", "!=", "<=", ">=", "&&", "||", "++", "--",
            "+=", "-=", "*=", "/=", "&=", "|=", "^=", "%=", "<<", ">>",
            "+", "-", "*", "/", "%", "=", "<", ">", "!", "~", "?", ":",
            ";", ",", ".", "(", ")", "[", "]", "{", "}", "&", "|", "^", "@", "#",
        ),
        key=len,
        reverse=True,
    )
)
# 无区分力的内容形状：同类名/方法名、标准协议串、通用 CRUD、惯用校验、自动生成描述与常见示例值。
CONTENT_POINT_GENERIC_PATTERNS = (
    re.compile(r"^(?:校验|验证)?(?:不能为空|必须|长度不能超过|格式不正确|已存在|不存在|不正确)"),
    re.compile(r"^(?:管理后台 - |获得|获取|创建|修改|删除|导出|导入|新增|更新|查询|分页|列表)"),
    re.compile(r"^(?:Request|Response) VO$"),
    re.compile(r"^@(?:Schema|NotNull|NotBlank|Size|Min|Max|Valid|ApiModelProperty|ApiOperation)\b"),
    re.compile(r"^(?:true|false|null|0|1|示例|example|test|demo)$", re.IGNORECASE),
    re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$"),
)
# 上游文件的等价作者声明；版权与许可证主体不当作作者姓名。
UPSTREAM_AUTHOR_PATTERN = re.compile(
    r"@author\b"
    r"|^(?:\s*(?:/\*\*?|\*|//|#)?\s*(?:authors?|原作者|作者)\s*[:：=])",
    re.IGNORECASE | re.MULTILINE,
)
REVIEW_CROSS_REFERENCE_PATTERN = re.compile(
    r"(?:见|详见|参见|同)\s*(?:author_reason|open_gap|原因|缺口|上文|下节|证据\.md|本文件|该文件)"
)
# 自造的来源块标签不能代替正文来源说明。
PROVENANCE_TAG_PATTERN = re.compile(
    r"^@(?P<tag>sources?|origin|provenance|upstream|from|来源)\b", re.IGNORECASE
)
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40}$")
# record 组件职责说明的等价通道：record 头部 JavaDoc 的 @param <组件名> <非空说明>。
# 组件位置上的 /** */ 在 PMD 里属于悬空 JavaDoc（DanglingJavadoc 会报违规），
# 该位置的规范写法是 record 头部 JavaDoc 的 @param；说明正文仍必须非空。
RECORD_COMPONENT_PARAM_PATTERN = re.compile(
    r"^@param\s+(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s+(?P<text>\S.*)$"
)


@dataclass(frozen=True)
class Finding:
    """表示一个注释门禁问题。

    Attributes:
        path: 仓库内 Java 文件路径。
        line: 暂存版本中的声明行号。
        rule: 命中的规则标识。
        detail: 可直接展示的整改说明。
        evidence_bound: 是否为来源证据主张类诊断。该类诊断必须在每次检查时按当前
            证据重新成立，不因旧版本存在同样失败而按历史欠账豁免。
    """

    path: str
    line: int
    rule: str
    detail: str
    evidence_bound: bool = False


@dataclass(frozen=True)
class AcceptanceState:
    """表示一条受控索引记录的逐项验收状态（裁决 D15 §65/§66）。

    这是“完整消费未验收状态”的唯一载体：已验收、已登记阻断与硬失败三类都必须
    逐项落到这里，文件数、声明数与诊断数分别统计，不再把 33 条作者标签形态漏掉。

    Attributes:
        record_id: 唯一记录标识，``local_path#qualified_name``。
        path: 仓库相对路径。
        line: 当前源码中该 public 类型的声明行号。
        type_name: 含外层类型链的类型限定名。
        form: 标注形态，来源说明或作者标签。
        classification: accepted / registered-blocker / hard-failure。
        verdict: 索引 ``d12_verdict`` 当前判词。
        blocker_reason: 索引 ``d12_blocker_reason`` 阻断原因。
        open_gap: 索引 ``open_gap`` 缺口登记。
        route: 索引 ``evidence_route`` 所用路线。
        branch: 索引 ``evidence_branch`` 声明的独立分支；未声明时为空串。
        local_sha256: 记录登记的本地最终指纹。
        upstream_commit: 记录登记的上游固定提交。
        upstream_sha256: 记录登记的上游内容指纹。
        review_by: 逐项复核负责方。
        review_conclusion: 逐项复核依据。
        reasons: 该条目落到当前分类的逐项依据或硬失败原因。
    """

    record_id: str
    path: str
    line: int
    type_name: str
    form: str
    classification: str
    verdict: str
    blocker_reason: str
    open_gap: str
    route: str
    branch: str
    local_sha256: str
    upstream_commit: str
    upstream_sha256: str
    review_by: str
    review_conclusion: str
    reasons: tuple[str, ...] = ()

    def summary(self) -> dict[str, object]:
        """返回可写入结构化报告的逐项摘要，不含源码正文。"""

        return {
            "record_id": self.record_id,
            "path": self.path,
            "line": self.line,
            "type_name": self.type_name,
            "form": self.form,
            "classification": self.classification,
            "verdict": self.verdict,
            "blocker_reason": self.blocker_reason,
            "open_gap": self.open_gap,
            "route": self.route,
            "branch": self.branch,
            "local_sha256": self.local_sha256,
            "upstream_commit": self.upstream_commit,
            "upstream_sha256": self.upstream_sha256,
            "review_by": self.review_by,
            "review_conclusion": self.review_conclusion,
            "reasons": list(self.reasons),
        }


@dataclass
class AcceptanceLedger:
    """收集一次扫描内全部逐项验收状态，供 v2 报告与阻断入口使用（D15 §65）。"""

    states: list[AcceptanceState] = field(default_factory=list)

    def add(self, state: AcceptanceState) -> None:
        """登记一条逐项验收状态。"""

        self.states.append(state)

    def accepted(self) -> list[AcceptanceState]:
        """返回已验收条目（含独立 A1 分支）。"""

        return [
            state
            for state in self.states
            if state.classification == ACCEPTANCE_STATE_ACCEPTED
        ]

    def registered_blockers(self) -> list[AcceptanceState]:
        """返回独立列出的已登记阻断条目；它们不得进入 passed。"""

        return [
            state
            for state in self.states
            if state.classification == ACCEPTANCE_STATE_REGISTERED_BLOCKER
        ]

    def hard_failures(self) -> list[AcceptanceState]:
        """返回登记不完整、绑定失效或标注不符的硬失败条目。"""

        return [
            state
            for state in self.states
            if state.classification == ACCEPTANCE_STATE_HARD_FAILURE
        ]


@dataclass(frozen=True)
class TypeDeclaration:
    """记录 Java 类型声明及其主体边界。

    Attributes:
        name: 类型简单名称。
        kind: class、interface、enum、record 或 @interface。
        public: 是否为 public 类型。
        declaration_offset: 声明修饰符或注解的起始偏移量。
        name_offset: 类型名称的起始偏移量。
        open_brace: 类型主体左大括号偏移量。
        close_brace: 类型主体右大括号偏移量。
        outer_depth: 类型声明所在的大括号深度。
    """

    name: str
    kind: str
    public: bool
    declaration_offset: int
    name_offset: int
    open_brace: int
    close_brace: int
    outer_depth: int


def _run_git(arguments: list[str], *, text: bool = True) -> str | bytes:
    """执行只读 Git 命令并返回标准输出。

    Args:
        arguments: 不包含 ``git`` 本身的参数列表。
        text: 是否将输出严格解码为 UTF-8 文本。

    Returns:
        Git 命令的标准输出。

    Raises:
        RuntimeError: Git 命令失败或输出不是有效 UTF-8 时抛出。
    """

    try:
        completed = subprocess.run(
            ["git", "-c", "core.quotepath=false", *arguments],
            check=False,
            capture_output=True,
            timeout=GIT_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(
            f"Git 命令超过 {GIT_TIMEOUT_SECONDS} 秒未完成"
        ) from error
    if completed.returncode != 0:
        stderr = completed.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(stderr or "Git 命令执行失败")
    if not text:
        return completed.stdout
    try:
        return completed.stdout.decode("utf-8")
    except UnicodeDecodeError as error:
        raise RuntimeError("Git 输出不是有效 UTF-8，已停止注释检查") from error


def _staged_java_paths() -> list[str]:
    """读取本次提交中新增、复制、修改或重命名的 Java 源文件。

    Returns:
        位于 Java 工程源码目录下的仓库相对路径列表。
    """

    output = _run_git(
        ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR", "--"],
        text=False,
    )
    assert isinstance(output, bytes)
    paths = []
    for raw_path in output.split(b"\0"):
        if not raw_path:
            continue
        try:
            path = raw_path.decode("utf-8")
        except UnicodeDecodeError as error:
            raise RuntimeError("暂存区文件路径不是有效 UTF-8") from error
        normalized = path.replace("\\", "/")
        if is_java_source(normalized):
            paths.append(normalized)
    return paths


def _staged_source(path: str) -> str:
    """读取指定 Java 文件的暂存版本。

    Args:
        path: 仓库相对路径。

    Returns:
        严格按 UTF-8 解码的 Java 源码。

    Raises:
        RuntimeError: 暂存对象不存在或源码不是有效 UTF-8 时抛出。
    """

    output = _run_git(["show", f":{path}"], text=False)
    assert isinstance(output, bytes)
    try:
        return output.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise RuntimeError(f"{path} 不是有效 UTF-8，已停止注释检查") from error


def _staged_bytes(path: str) -> bytes:
    """读取指定 Java 文件的暂存版本原始字节。

    Args:
        path: 仓库相对路径。

    Returns:
        暂存对象的原始字节，用于复算证据清单登记的最终指纹。

    Raises:
        RuntimeError: 暂存对象不存在或 Git 读取失败时抛出。
    """

    output = _run_git(["show", f":{path}"], text=False)
    assert isinstance(output, bytes)
    return output


def _added_lines(path: str) -> set[int]:
    """读取指定文件在暂存差异中的新增行号。

    Args:
        path: 仓库相对路径。

    Returns:
        以暂存版本为基准的一组新增行号。
    """

    output = _run_git(
        [
            "diff",
            "--cached",
            "--unified=0",
            "--no-color",
            "--diff-filter=ACMR",
            "--",
            path,
        ]
    )
    assert isinstance(output, str)
    line_number = 0
    added: set[int] = set()
    for diff_line in output.splitlines():
        hunk = HUNK_HEADER_PATTERN.match(diff_line)
        if hunk:
            line_number = int(hunk.group("line"))
            continue
        if diff_line.startswith("+") and not diff_line.startswith("+++"):
            added.add(line_number)
            line_number += 1
        elif diff_line.startswith(" "):
            line_number += 1
    return added


@lru_cache(maxsize=2)
def _lex_java(source: str) -> tuple[str, tuple[tuple[int, int], ...]]:
    """屏蔽注释和字面量并记录真实块注释边界，复用同一文件的声明分析结果。

    Args:
        source: 原始 Java 源码。

    Returns:
        与原文等长的结构化文本及块注释起止偏移；最多缓存两个源码版本。
    """

    chars = list(source)
    masked = list(source)
    index = 0
    state = "normal"
    comments: list[tuple[int, int]] = []
    comment_start = 0
    while index < len(chars):
        char = chars[index]
        next_char = chars[index + 1] if index + 1 < len(chars) else ""
        if state == "normal":
            if char == "/" and next_char == "/":
                masked[index] = masked[index + 1] = " "
                index += 2
                state = "line-comment"
                continue
            if char == "/" and next_char == "*":
                comment_start = index
                masked[index] = masked[index + 1] = " "
                index += 2
                state = "block-comment"
                continue
            if source.startswith('"""', index):
                masked[index : index + 3] = [" ", " ", " "]
                index += 3
                state = "text-block"
                continue
            if char == '"':
                masked[index] = " "
                index += 1
                state = "string"
                continue
            if char == "'":
                masked[index] = " "
                index += 1
                state = "char"
                continue
        elif state == "line-comment":
            if char == "\n":
                state = "normal"
            else:
                masked[index] = " "
        elif state == "block-comment":
            if char == "*" and next_char == "/":
                comments.append((comment_start, index + 2))
                masked[index] = masked[index + 1] = " "
                index += 2
                state = "normal"
                continue
            if char != "\n":
                masked[index] = " "
        elif state in {"string", "char"}:
            if char == "\\":
                masked[index] = " "
                if index + 1 < len(chars):
                    if chars[index + 1] != "\n":
                        masked[index + 1] = " "
                    index += 2
                    continue
            delimiter = '"' if state == "string" else "'"
            if char == delimiter:
                state = "normal"
            if char != "\n":
                masked[index] = " "
        elif state == "text-block":
            if source.startswith('"""', index):
                masked[index : index + 3] = [" ", " ", " "]
                index += 3
                state = "normal"
                continue
            if char != "\n":
                masked[index] = " "
        index += 1
    return "".join(masked), tuple(comments)


def _mask_java(source: str) -> str:
    """返回屏蔽注释及字面量的等长源码，保留调用方使用的结构定位接口。"""
    return _lex_java(source)[0]


def _depths(masked: str, opening: str, closing: str) -> list[int]:
    """计算每个字符之前的指定结构嵌套深度。

    Args:
        masked: 已屏蔽注释和字面量的源码。
        opening: 左分隔符。
        closing: 右分隔符。

    Returns:
        与源码等长的深度列表。
    """

    result = [0] * len(masked)
    depth = 0
    for index, char in enumerate(masked):
        result[index] = depth
        if char == opening:
            depth += 1
        elif char == closing:
            depth = max(0, depth - 1)
    return result


def _matching_delimiters(masked: str, opening: str, closing: str) -> dict[int, int]:
    """建立成对分隔符从左侧到右侧的偏移映射。

    Args:
        masked: 已屏蔽注释和字面量的源码。
        opening: 左分隔符。
        closing: 右分隔符。

    Returns:
        每个完整左分隔符对应的右分隔符偏移。
    """

    pairs: dict[int, int] = {}
    stack: list[int] = []
    for index, char in enumerate(masked):
        if char == opening:
            stack.append(index)
        elif char == closing and stack:
            pairs[stack.pop()] = index
    return pairs


def _line_starts(source: str) -> list[int]:
    """计算每一行在源码中的起始偏移。

    Args:
        source: Java 源码。

    Returns:
        第一项固定为 0 的行起始偏移列表。
    """

    starts = [0]
    starts.extend(index + 1 for index, char in enumerate(source) if char == "\n")
    return starts


def _line_number(starts: list[int], offset: int) -> int:
    """将字符偏移转换为一基行号。

    Args:
        starts: 行起始偏移列表。
        offset: 源码字符偏移。

    Returns:
        一基行号。
    """

    return bisect.bisect_right(starts, offset)


def _intersects_added_lines(
    starts: list[int], start_offset: int, end_offset: int, added_lines: set[int]
) -> bool:
    """判断声明范围是否与暂存新增行相交。

    Args:
        starts: 行起始偏移列表。
        start_offset: 声明起始偏移。
        end_offset: 声明结束偏移。
        added_lines: 暂存差异中的新增行号。

    Returns:
        至少一个声明行属于新增行时返回 ``True``。
    """

    start_line = _line_number(starts, start_offset)
    end_line = _line_number(starts, end_offset)
    return any(line in added_lines for line in range(start_line, end_line + 1))


def _member_start(
    masked: str, brace_depths: list[int], position: int, member_depth: int
) -> int:
    """定位类型成员在上一个同级结构边界之后的起点。

    Args:
        masked: 已屏蔽注释和字面量的源码。
        brace_depths: 每个字符之前的大括号深度。
        position: 当前声明内的字符偏移。
        member_depth: 类型成员所在的大括号深度。

    Returns:
        可能包含 JavaDoc 和注解的成员片段起始偏移。
    """

    parentheses = 0
    for index in range(position - 1, -1, -1):
        char = masked[index]
        if char == ")":
            parentheses += 1
            continue
        if char == "(" and parentheses:
            parentheses -= 1
            continue
        # 注解参数中的数组也有大括号，但不结束前一个类型成员。
        # 反向匹配小括号可同时覆盖多行数组与嵌套注解，不依赖注解名称。
        if parentheses:
            continue
        if char == ";" and brace_depths[index] == member_depth:
            return index + 1
        if char == "}" and brace_depths[index] == member_depth + 1:
            return index + 1
        if char == "{" and brace_depths[index] == member_depth - 1:
            return index + 1
    return 0


def _first_code_offset(masked: str, start: int, end: int) -> int:
    """返回指定区间内第一个未被屏蔽的非空白字符偏移。

    Args:
        masked: 已屏蔽注释和字面量的源码。
        start: 搜索起始偏移。
        end: 搜索结束偏移，不包含该位置。

    Returns:
        首个代码字符偏移；区间没有代码时返回 ``end``。
    """

    index = start
    while index < end and masked[index].isspace():
        index += 1
    return index


def _attached_javadoc_span(source: str, declaration_offset: int) -> tuple[int, int] | None:
    """读取紧邻声明或其注解之前的 JavaDoc 偏移区间。

    Args:
        source: 原始 Java 源码。
        declaration_offset: 声明修饰符或首个注解的起始偏移。

    Returns:
        JavaDoc 的 ``[起始, 结束)`` 偏移；不存在时返回 ``None``。
    """

    prefix = source[:declaration_offset].rstrip()
    if not prefix.endswith("*/"):
        return None
    for start, end in reversed(_lex_java(source)[1]):
        if end == len(prefix):
            return (start, end) if source.startswith("/**", start) else None
        if end < len(prefix):
            break
    return None


def _attached_javadoc(source: str, declaration_offset: int) -> str | None:
    """读取紧邻声明或其注解之前的 JavaDoc。

    Args:
        source: 原始 Java 源码。
        declaration_offset: 声明修饰符或首个注解的起始偏移。

    Returns:
        已关联的 JavaDoc 文本；不存在时返回 ``None``。
    """

    span = _attached_javadoc_span(source, declaration_offset)
    return None if span is None else source[span[0] : span[1]]


def _strip_leading_annotations(fragment: str) -> tuple[str, int]:
    """移除成员片段开头的 Java 注解并返回相对偏移。

    Args:
        fragment: 已屏蔽注释和字面量的成员片段。

    Returns:
        ``(去除注解后的片段, 片段内代码起始偏移)``。
    """

    index = 0
    length = len(fragment)
    while True:
        while index < length and fragment[index].isspace():
            index += 1
        if index >= length or fragment[index] != "@":
            break
        index += 1
        while index < length and (
            fragment[index].isalnum() or fragment[index] in {"_", "$", "."}
        ):
            index += 1
        while index < length and fragment[index].isspace():
            index += 1
        if index < length and fragment[index] == "(":
            depth = 1
            index += 1
            while index < length and depth:
                if fragment[index] == "(":
                    depth += 1
                elif fragment[index] == ")":
                    depth -= 1
                index += 1
    return fragment[index:], index


def _type_declarations(
    masked: str, brace_depths: list[int], brace_pairs: dict[int, int]
) -> list[TypeDeclaration]:
    """解析源码中的显式类型声明及其主体范围。

    Args:
        masked: 已屏蔽注释和字面量的源码。
        brace_depths: 每个字符之前的大括号深度。
        brace_pairs: 左右大括号偏移映射。

    Returns:
        能够确定完整主体边界的类型声明列表。
    """

    declarations = []
    for match in TYPE_PATTERN.finditer(masked):
        # 模式匹配中的 `record instanceof Type value` 不是 record 类型声明。
        if match.group("kind") == "record" and match.group("name") == "instanceof":
            continue
        open_brace = masked.find("{", match.end())
        if open_brace < 0 or open_brace not in brace_pairs:
            continue
        semicolon = masked.find(";", match.end(), open_brace)
        if semicolon >= 0:
            continue
        outer_depth = brace_depths[match.start()]
        if brace_depths[open_brace] != outer_depth:
            continue
        segment_start = _member_start(
            masked, brace_depths, match.start(), outer_depth
        )
        declaration_offset = _first_code_offset(
            masked, segment_start, match.start() + 1
        )
        modifiers = match.group("modifiers")
        declarations.append(
            TypeDeclaration(
                name=match.group("name"),
                kind=match.group("kind"),
                public="public" in modifiers.split(),
                declaration_offset=declaration_offset,
                name_offset=match.start("name"),
                open_brace=open_brace,
                close_brace=brace_pairs[open_brace],
                outer_depth=outer_depth,
            )
        )
    return declarations


def _enclosing_type(
    declarations: list[TypeDeclaration], position: int, depth: int
) -> TypeDeclaration | None:
    """查找指定偏移所在的最内层类型。

    Args:
        declarations: 全部类型声明。
        position: 待定位字符偏移。
        depth: 该字符之前的大括号深度。

    Returns:
        成员深度匹配的最内层类型；不存在时返回 ``None``。
    """

    candidates = [
        declaration
        for declaration in declarations
        if declaration.open_brace < position < declaration.close_brace
        and depth == declaration.outer_depth + 1
    ]
    return max(candidates, key=lambda declaration: declaration.open_brace, default=None)


def _author_values(javadoc: str) -> list[str]:
    """提取 JavaDoc 中全部 @author 值，去掉行尾空白与 HTML 空格实体。

    Args:
        javadoc: 待检查的完整 JavaDoc 文本。

    Returns:
        按出现顺序排列的作者值列表。
    """

    values = []
    for match in AUTHOR_PATTERN.finditer(javadoc):
        values.append(
            re.sub(
                r"(?:\s|&(?:#x20;|#32;|nbsp;))+$",
                "",
                match.group("name"),
                flags=re.IGNORECASE,
            ).strip()
        )
    return values


def _has_actual_author(javadoc: str) -> bool:
    """判断 JavaDoc 是否包含非占位、非中性的作者姓名。

    Args:
        javadoc: 待检查的完整 JavaDoc 文本。

    Returns:
        至少存在一个非空且既不是常见占位值、也不是中性来源表达的作者时返回 ``True``。

    Note:
        静态检查只能排除明显占位或中性文字，作者真实性仍由生成或评审流程核对。
        “未声明作者”“来源不明”和本裁决的来源句被塞进 ``@author`` 时不代表作者身份。
    """

    for author in _author_values(javadoc):
        if not author:
            continue
        if author.casefold() in AUTHOR_PLACEHOLDERS:
            continue
        if author.casefold() in AUTHOR_NEUTRAL_VALUES:
            continue
        if AUTHOR_SOURCE_SENTENCE_PATTERN.search(author):
            continue
        return True
    return False


@dataclass(frozen=True)
class SourceNote:
    """记录一条固定格式的来源说明。

    Attributes:
        repository: 真实上游 URL 对应的“拥有者/仓库名”。
        commit: 完整 40 位小写提交 SHA。
        upstream_path: 清单中的上游仓库相对文件路径。
        basis: 来源依据行原文。
        local_modification: 本地修改说明。
        line: 来源说明首行在 JavaDoc 正文中的 1 起始行号。
    """

    repository: str
    commit: str
    upstream_path: str
    basis: str
    local_modification: str
    line: int


@dataclass(frozen=True)
class EvidenceRegistry:
    """持有受控来源证据清单、快照根目录与本次采用的输入指纹。

    Attributes:
        path: 清单文件路径。
        sha256: 清单原始字节的 SHA-256，用于报告本次采用的证据版本。
        snapshots: 受控上游快照根目录；未配置时为 ``None``。
        records: ``local_path`` 到清单记录的映射。
        unparsable: 字段数与表头不一致、无法逐项核验的 ``local_path``。
        requires_acceptance_state: 清单是否声明受控派生索引 schema（``d12-source-index/v1``）；
            声明时必须消费 ``d12_verdict`` 验收状态，否则沿用既有逐项核验。
        snapshot_manifest: 已复算通过的受控快照哈希清单摘要；快照根目录没有哈希清单
            （外部快照、旧夹具）时为 ``None``。
    """

    path: Path
    sha256: str
    snapshots: Path | None
    records: dict[str, dict[str, object]]
    unparsable: frozenset[str]
    requires_acceptance_state: bool = False
    snapshot_manifest: dict[str, object] | None = None

    def describe(self) -> dict[str, object]:
        """返回可写入结构化报告的输入指纹，不含任何证据内容。"""

        return {
            "registry": str(self.path),
            "registry_sha256": self.sha256,
            "snapshots": None if self.snapshots is None else str(self.snapshots),
            "records": len(self.records),
            "snapshot_manifest": self.snapshot_manifest,
        }


class EvidenceError(CheckError):
    """表示受控证据输入不可读或结构不受支持，检查无法完成（退出码 2）。"""


def _text(record: dict[str, object], key: str) -> str:
    """读取清单字段的文本值；字段缺失或为 ``null`` 时返回空串。"""

    value = record.get(key)
    return "" if value is None else str(value).strip()


def _raw_text(record: dict[str, object], key: str) -> str:
    """读取清单字段的原始字符串值，不做 strip。

    路径载荷与清单路径值都必须按原字符序列比较（裁决 D13）：前导或尾随空白属于值本身，
    未经裁剪的值与原值不同时必须拒绝，不能先裁剪再比较。

    Args:
        record: 清单记录。
        key: 字段名。

    Returns:
        字段的原始字符串值；缺失或为 ``null`` 时返回空串。
    """

    value = record.get(key)
    return "" if value is None else str(value)


def _provenance_tag_errors(javadoc: str) -> list[str]:
    """识别自造的来源块标签；来源说明只能写在职责 JavaDoc 正文。

    Args:
        javadoc: 完整 JavaDoc 文本。

    Returns:
        自造标签的拒绝原因列表；没有时为空白列表。
    """

    errors = []
    for line in _javadoc_body_lines(javadoc):
        match = PROVENANCE_TAG_PATTERN.match(line.strip())
        if match is not None:
            errors.append(f"自造块标签 @{match.group('tag')} 不能代替正文来源说明")
    return errors


def _comment_body_line(raw: str) -> str:
    """剥离单行 JavaDoc 装饰，返回正文行。

    只移除行首缩进、装饰星号及其约定分隔空格；行尾字符属于载荷本身，必须原样保留
    （裁决 D13 §72、D14 §54）。

    Args:
        raw: 单行原始文本。

    Returns:
        去除注释边框后的正文行。
    """

    line = raw.lstrip()
    if line.startswith("*"):
        line = line[1:]
        if line.startswith(" "):
            line = line[1:]
    return line


def _javadoc_body_lines(javadoc: str) -> list[str]:
    """把 JavaDoc 拆成正文行，只去掉外框、行首缩进与装饰星号。

    裁决 D13 §72 规定解析仅移除 JavaDoc 外框、行首缩进、装饰星号及其约定分隔空格，
    **不得**对路径载荷或索引值执行 strip、空白折叠或任何归一化：行尾空白属于载荷
    本身的字符序列，必须原样保留并由逐字节比较否定，不能先裁剪再比较。

    Args:
        javadoc: 完整 JavaDoc 文本。

    Returns:
        与源码行一一对应的正文行列表，行内不含注释边框，载荷尾部字符原样保留。
    """

    text = javadoc
    if text.startswith("/**"):
        text = text[3:]
    if text.endswith("*/"):
        text = text[:-2]
    return [_comment_body_line(raw) for raw in text.splitlines()]


def _parse_source_header(line: str) -> tuple[tuple[str, str] | None, str | None]:
    """解析来源说明首行，返回 ``((仓库标识, 提交), 错误说明)``。

    Args:
        line: JavaDoc 正文中的首行文本。

    Returns:
        语法完全匹配时返回仓库标识与完整 SHA；否则返回可直接展示的拒绝原因。
    """

    match = SOURCE_HEADER_PATTERN.match(line)
    if match is not None:
        return (match.group("repository"), match.group("commit")), None
    if not line.startswith(SOURCE_HEADER_PREFIX):
        return None, f"来源说明首行必须以“{SOURCE_HEADER_PREFIX}”开头：{line!r}"
    rest = line[len(SOURCE_HEADER_PREFIX) :]
    if SOURCE_DECLARATION_SUFFIX not in rest:
        return None, "来源说明首行缺少“（该版本未声明作者）”限定，不能断言该固定版本未声明作者"
    body = rest.split(SOURCE_DECLARATION_SUFFIX)[0].strip()
    if " @ " not in body:
        return None, f"来源说明首行缺少“ @ ”提交引用：{line!r}"
    repository, _, reference = body.rpartition(" @ ")
    repository = repository.strip()
    reference = reference.strip()
    if not SOURCE_REPOSITORY_PATTERN.match(repository):
        return None, f"仓库标识必须是真实上游 URL 对应的“拥有者/仓库名”：{repository!r}"
    if re.fullmatch(r"[0-9a-fA-F]{7,39}", reference):
        return None, f"提交引用必须是完整 40 位小写十六进制 SHA，不能使用短 SHA：{reference!r}"
    if not COMMIT_PATTERN.match(reference):
        return None, f"提交引用是浮动分支、标签或非法值，必须固定为完整 40 位小写 SHA：{reference!r}"
    return None, f"来源说明首行不符合固定语法：{line!r}"


def _is_safe_upstream_path(path: str) -> bool:
    """判断上游文件行是否为受控的相对路径，拒绝绝对路径与目录穿越。"""

    if not path or path.startswith("/") or "\\" in path or "://" in path:
        return False
    return all(segment not in {"", ".", ".."} for segment in path.split("/"))


def _parse_source_notes(javadoc: str) -> tuple[list[SourceNote], list[str]]:
    """解析类型 JavaDoc 正文中的固定格式来源说明块。

    Args:
        javadoc: 完整 JavaDoc 文本。

    Returns:
        ``(来源说明列表, 格式错误说明列表)``；错误说明可直接用于诊断。
    """

    lines = _javadoc_body_lines(javadoc)
    first_tag = next(
        (index for index, line in enumerate(lines) if line.startswith("@")), len(lines)
    )
    notes: list[SourceNote] = []
    errors: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if line.startswith(SOURCE_PATH_CONTINUATION_PREFIX):
            errors.append(
                "“上游文件续：”续行必须紧跟在“上游文件：”行之后："
                f"第 {index + 1} 行"
            )
            index += 1
            continue
        if not line.startswith(SOURCE_HEADER_PREFIX):
            index += 1
            continue
        if index >= first_tag:
            errors.append(
                f"来源说明必须位于全部块标签之前，当前第 {index + 1} 行在块标签之后"
            )
            index += 1
            continue
        block = lines[index : index + SOURCE_NOTE_LINE_COUNT]
        if len(block) < SOURCE_NOTE_LINE_COUNT:
            errors.append(SOURCE_NOTE_INCOMPLETE_MESSAGE)
            break
        header, header_error = _parse_source_header(block[0])
        if header is None:
            errors.append(str(header_error))
            index += 1
            continue
        path_match = SOURCE_PATH_PATTERN.match(block[1])
        if path_match is None:
            # 首行必须自身成立：载荷非空且前缀正确，续行不得替代或重建首行。
            errors.append(
                f"上游文件首行必须以“{SOURCE_PATH_PREFIX}”开头且载荷非空：{block[1]!r}"
            )
            index += 1
            continue
        # 长上游路径可以在“上游文件：”行之后用“上游文件续：”逐段续写；各段按原字符序列
        # 直接拼接（不做 strip、空白折叠或任何归一化），再按同一口径做相对路径校验，
        # 并与清单 upstream_path 逐字节比较；路径总段数（含首行）上限 3。
        segments: list[str] = [path_match.group("path")]
        cursor = index + 2
        continuation_error = ""
        while cursor < len(lines) and lines[cursor].startswith(
            SOURCE_PATH_CONTINUATION_PREFIX
        ):
            segment = lines[cursor][len(SOURCE_PATH_CONTINUATION_PREFIX) :]
            if not segment.strip():
                continuation_error = f"上游文件续行载荷为空：{lines[cursor]!r}"
                break
            if len(segments) >= SOURCE_PATH_MAX_SEGMENTS:
                continuation_error = (
                    f"上游文件路径最多 {SOURCE_PATH_MAX_SEGMENTS} 段（首行加两条续行），"
                    f"第 {cursor + 1} 行是多余续行"
                )
                break
            segments.append(segment)
            cursor += 1
        if continuation_error:
            errors.append(continuation_error)
            index = cursor + 1
            continue
        if cursor + 1 >= len(lines):
            errors.append(SOURCE_NOTE_INCOMPLETE_MESSAGE)
            break
        upstream_path = "".join(segments)
        basis_line, local_line = lines[cursor], lines[cursor + 1]
        if not _is_safe_upstream_path(upstream_path):
            errors.append(f"上游文件行不是有效的上游仓库相对路径：{block[1]!r}")
            index += 1
            continue
        if basis_line not in SOURCE_BASIS_LINES:
            errors.append(f"来源依据行不是固定取值：{basis_line!r}")
            index += 1
            continue
        local_match = SOURCE_LOCAL_PATTERN.match(local_line)
        local_modification = (
            "" if local_match is None else local_match.group("text").strip()
        )
        if not local_modification:
            errors.append(f"本地修改行缺少实际差异说明：{local_line!r}")
            index += 1
            continue
        notes.append(
            SourceNote(
                repository=header[0],
                commit=header[1],
                upstream_path=upstream_path,
                basis=basis_line,
                local_modification=local_modification,
                line=index + 1,
            )
        )
        index = cursor + 2
    return notes, errors


def _claims_source_evidence(javadoc: str) -> bool:
    """判断 JavaDoc 是否主张来源证据（正文来源句或被塞进 @author 的来源句）。"""

    if any(
        line.startswith(SOURCE_HEADER_PREFIX) for line in _javadoc_body_lines(javadoc)
    ):
        return True
    if _provenance_tag_errors(javadoc):
        return True
    return any(
        AUTHOR_SOURCE_SENTENCE_PATTERN.search(author) is not None
        for author in _author_values(javadoc)
    )


def _repository_identifier(url: str) -> str | None:
    """从上游仓库 URL 提取“拥有者/仓库名”。"""

    value = url.strip()
    if not value:
        return None
    value = re.sub(r"^[A-Za-z][A-Za-z0-9+.-]*://", "", value)
    if "/" not in value.split(":", 1)[0]:
        value = value.split(":", 1)[-1]
    value = value.split("@")[-1]
    value = value.split("?", 1)[0].split("#", 1)[0].rstrip("/")
    if value.endswith(".git"):
        value = value[: -len(".git")]
    parts = [part for part in value.split("/") if part]
    if len(parts) < 2:
        return None
    return f"{parts[-2]}/{parts[-1]}"


def _upstream_author_lines(text: str) -> list[str]:
    """列出上游源码中的作者声明行；版权与许可证主体不算作者姓名。"""

    return [
        line.strip()
        for line in text.splitlines()
        if UPSTREAM_AUTHOR_PATTERN.search(line)
    ]


def _declares_source_index_schema(text: str) -> bool:
    """判断 JSON 清单是否显式声明受控派生来源索引 schema。

    声明该 schema 的清单是**验收账本**：记录必须给出 ``d12_verdict`` 验收状态，来源说明
    路径按该状态决定是否通过（裁决 D14 §120/§132）。未声明的清单（账本 TSV、普通记录数组）
    不参与验收状态判据，避免把没有该字段的历史清单误判为“未验收”。

    Args:
        text: 清单原文。

    Returns:
        声明 ``EVIDENCE_INDEX_SCHEMA`` 时为 ``True``。
    """

    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return False
    return isinstance(value, dict) and value.get("index_schema") == EVIDENCE_INDEX_SCHEMA


def _read_json_records(
    path: Path, text: str
) -> tuple[dict[str, dict[str, object]], frozenset[str], tuple[str, ...]]:
    """读取 JSON 形式的受控清单，保留 ``type_evidence`` 的结构化值。"""

    try:
        value = json.loads(text)
    except json.JSONDecodeError as error:
        raise EvidenceError(f"证据清单 JSON 无法解析：{path}：{error}") from error
    if isinstance(value, dict) and "index_schema" in value:
        declared = value["index_schema"]
        if declared != EVIDENCE_INDEX_SCHEMA:
            raise EvidenceError(
                f"派生来源索引 schema 版本不受支持：{declared!r}，期望 {EVIDENCE_INDEX_SCHEMA}"
            )
    items = value.get("records") if isinstance(value, dict) else value
    if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
        raise EvidenceError(f"证据清单 JSON 必须是记录数组：{path}")
    records: dict[str, dict[str, object]] = {}
    unparsable: set[str] = set()
    columns: set[str] = set()
    for item in items:
        columns.update(str(key) for key in item)
        record = {str(key): value for key, value in item.items()}
        local_path = _text(record, "local_path")
        if not local_path:
            unparsable.add(f"{path}:<缺少 local_path>")
            continue
        records[local_path] = record
    return records, frozenset(unparsable), tuple(sorted(columns))


def _read_tsv_records(
    text: str,
) -> tuple[dict[str, dict[str, object]], frozenset[str], tuple[str, ...]]:
    """读取 TSV 形式的受控清单，拒绝重复列名与字段数不一致的记录。

    Raises:
        EvidenceError: 表头存在重复列名，逐列取值不唯一。
    """

    rows = list(csv.reader(text.splitlines(), delimiter="\t"))
    if not rows:
        raise EvidenceError("证据清单为空文件")
    header = [name.strip() for name in rows[0]]
    duplicates = sorted({name for name in header if header.count(name) > 1})
    if duplicates:
        # 重复列名会让“后列覆盖前列”成为隐式优先级，必须显式拒绝并指向派生索引。
        raise EvidenceError(
            "证据清单表头存在重复列名，逐列取值不唯一："
            f"{'、'.join(duplicates)}；请提供唯一列名的受控派生索引（JSON）"
        )
    records: dict[str, dict[str, object]] = {}
    unparsable: set[str] = set()
    for number, row in enumerate(rows[1:], start=2):
        if not row or all(not cell.strip() for cell in row):
            continue
        local_index = header.index("local_path") if "local_path" in header else -1
        local_path = row[local_index].strip() if 0 <= local_index < len(row) else ""
        if len(row) != len(header):
            unparsable.add(local_path or f"第 {number} 行")
            continue
        record = {name: value for name, value in zip(header, row)}
        if not local_path:
            unparsable.add(f"第 {number} 行")
            continue
        records[local_path] = record
    return records, frozenset(unparsable), tuple(header)


def load_evidence_registry(
    registry_path: Path, snapshots_path: Path | None
) -> EvidenceRegistry:
    """读取受控证据清单与快照位置，并记录清单原始字节指纹。

    Args:
        registry_path: 清单文件路径，支持 TSV 与 JSON。
        snapshots_path: 受控上游快照根目录；未配置时为 ``None``。

    Returns:
        已解析的受控清单，含本次采用的输入指纹。

    Raises:
        EvidenceError: 清单或快照位置不可读、清单结构不受支持。
    """

    try:
        raw = registry_path.read_bytes()
    except OSError as error:
        raise EvidenceError(f"证据清单不可读：{registry_path}（{error.strerror or error}）") from error
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise EvidenceError(f"证据清单不是有效 UTF-8：{registry_path}") from error
    if registry_path.suffix.lower() == ".json" or text.lstrip()[:1] in {"[", "{"}:
        records, unparsable, columns = _read_json_records(registry_path, text)
        # 只有显式声明受控派生索引 schema 的清单才携带验收状态；账本等其他清单没有该字段。
        requires_acceptance_state = _declares_source_index_schema(text)
    else:
        records, unparsable, columns = _read_tsv_records(text)
        requires_acceptance_state = False
    missing = [name for name in EVIDENCE_REQUIRED_FIELDS if name not in columns]
    if missing:
        raise EvidenceError(
            f"证据清单缺少必需字段，结构不受支持：{'、'.join(missing)}"
        )
    if snapshots_path is not None:
        try:
            readable = snapshots_path.is_dir()
        except OSError as error:
            raise EvidenceError(
                f"证据快照目录不可读：{snapshots_path}（{error.strerror or error}）"
            ) from error
        if not readable:
            raise EvidenceError(f"证据快照目录不可读：{snapshots_path}")
    snapshot_manifest = None
    if snapshots_path is not None:
        document = _load_snapshot_manifest(snapshots_path)
        if document is not None:
            snapshot_manifest = verify_snapshot_manifest(snapshots_path, document, records)
    return EvidenceRegistry(
        path=registry_path,
        sha256=hashlib.sha256(raw).hexdigest(),
        snapshots=snapshots_path,
        records=records,
        unparsable=unparsable,
        requires_acceptance_state=requires_acceptance_state,
        snapshot_manifest=snapshot_manifest,
    )


def _environment_path(name: str) -> Path | None:
    """读取显式配置的证据位置环境变量；未配置时返回 ``None``。"""

    value = os.environ.get(name, "").strip()
    return Path(value).expanduser() if value else None


def resolve_evidence_paths(
    registry: Path | None = None,
    snapshots: Path | None = None,
    root: Path | None = None,
) -> tuple[Path | None, Path | None, str]:
    """按“命令行参数 > 环境变量 > 仓库内受控默认索引”解析证据位置。

    Args:
        registry: ``--evidence-registry`` 指定的清单路径。
        snapshots: ``--evidence-snapshots`` 指定的快照根目录。
        root: 被检查仓库根目录；提供时才使用仓库内默认索引。

    Returns:
        ``(清单路径或 None, 快照路径或 None, 来源标识)``。来源标识为
        ``argument``/``environment``/``repository-default``/``absent``，用于报告
        本次采用的输入来自哪里。显式配置不可读时不再回落到默认位置。
    """

    registry_path = registry if registry is not None else _environment_path(EVIDENCE_REGISTRY_ENV)
    snapshots_path = (
        snapshots if snapshots is not None else _environment_path(EVIDENCE_SNAPSHOTS_ENV)
    )
    if snapshots_path is None and root is not None:
        # 仓库内受控快照只在目录真实存在时启用；外部快照与未配置快照的既有行为不变。
        default_snapshots = root / DEFAULT_EVIDENCE_SNAPSHOTS
        try:
            if default_snapshots.is_dir():
                snapshots_path = default_snapshots
        except OSError:
            snapshots_path = None
    if registry is not None:
        source = "argument"
    elif registry_path is not None:
        source = "environment"
    elif root is not None and (root / DEFAULT_EVIDENCE_REGISTRY).is_file():
        # 只显式配置快照时仍然使用仓库内受控索引，离线复核不必重复指定清单。
        registry_path = root / DEFAULT_EVIDENCE_REGISTRY
        source = "repository-default"
    else:
        source = "absent"
    return registry_path, snapshots_path, source


def _resolve_evidence(
    registry: Path | None, snapshots: Path | None, root: Path | None = None
) -> EvidenceRegistry | None:
    """解析并加载受控证据输入，未配置任何位置时返回 ``None``。

    Args:
        registry: ``--evidence-registry`` 指定的清单路径。
        snapshots: ``--evidence-snapshots`` 指定的快照根目录。
        root: 被检查仓库根目录；提供时才允许使用仓库内默认索引。

    Returns:
        已加载的受控清单；没有任何清单位置时返回 ``None``。

    Raises:
        EvidenceError: 配置不完整，或清单与快照位置不可读、结构不受支持。
    """

    registry_path, snapshots_path, _ = resolve_evidence_paths(registry, snapshots, root)
    if registry_path is None and snapshots_path is None:
        return None
    if registry_path is None:
        raise EvidenceError(
            f"配置了受控快照但没有来源证据清单，请设置 {EVIDENCE_REGISTRY_ENV} 或 --evidence-registry"
        )
    return load_evidence_registry(registry_path, snapshots_path)


@lru_cache(maxsize=8)
def _cached_evidence(registry: str, snapshots: str, root: str) -> EvidenceRegistry | None:
    """按路径缓存同一进程内重复使用的受控清单，避免逐文件重读账本。"""

    return _resolve_evidence(
        Path(registry) if registry else None,
        Path(snapshots) if snapshots else None,
        Path(root) if root else None,
    )


def _configured_evidence() -> EvidenceRegistry | None:
    """读取仅由环境变量配置的受控证据输入，不启用仓库内默认索引。

    全量入口在 ``main`` 中显式解析默认位置并传入，这里保持“只认显式配置”
    的语义，供不接收根目录的既有调用方继续使用。
    """

    return _cached_evidence(
        os.environ.get(EVIDENCE_REGISTRY_ENV, "").strip(),
        os.environ.get(EVIDENCE_SNAPSHOTS_ENV, "").strip(),
        "",
    )


def evidence_cli_arguments(root: Path | None = None) -> tuple[list[str], str]:
    """解析受控证据位置，返回子检查参数与可读的输入指纹说明。

    Args:
        root: 被检查仓库根目录；用于解析仓库内默认索引。

    Returns:
        ``(命令行参数, 说明)``。清单不可读时不退回“无证据”语义：参数仍然指向
        该位置，由子检查以非零退出报告真实原因，说明中同时保留原因。
    """

    registry, snapshots, _ = resolve_evidence_paths(root=root)
    arguments: list[str] = []
    if registry is not None:
        arguments = ["--evidence-registry", str(registry)]
        if snapshots is not None:
            arguments.extend(["--evidence-snapshots", str(snapshots)])
    try:
        loaded = load_evidence_registry(registry, snapshots) if registry is not None else None
    except EvidenceError as error:
        return arguments, f"Java 注释检查证据输入不可用：{error}"
    return arguments, _describe_evidence(loaded)


def _git_head(directory: Path) -> str | None:
    """读取快照检出目录的 HEAD 提交；不是 Git 检出时返回 ``None``。"""

    try:
        output = _run_git(["-C", str(directory), "rev-parse", "HEAD"])
    except RuntimeError:
        return None
    return output.strip() if isinstance(output, str) else None


def _resolve_snapshot(
    root: Path, repository: str, commit: str, upstream_path: str
) -> Path | None:
    """在受控快照根目录中定位固定提交的对应上游文件。

    依次尝试 ``<仓库名>@<提交>/``、``<仓库名>/<提交>/`` 和固定见证版本检出目录；
    检出目录只在 HEAD 等于该提交时才作为固定版本使用。
    """

    name = repository.split("/", 1)[-1]
    for candidate in (root / f"{name}@{commit}" / upstream_path, root / name / commit / upstream_path):
        if candidate.is_file():
            return candidate
    checkout = root / name
    if checkout.is_dir() and _git_head(checkout) == commit:
        target = checkout / upstream_path
        if target.is_file():
            return target
    return None


def _load_snapshot_manifest(snapshots: Path) -> dict[str, object] | None:
    """读取受控快照根目录下的机器可读哈希清单。

    快照根目录没有该清单时返回 ``None``（外部受控快照与旧夹具继续按固定地址取回）；
    清单存在但不可读、结构不受支持或超出字节上限时一律拒绝，不静默跳过完整性复核。

    Args:
        snapshots: 受控快照根目录。

    Returns:
        解析后的清单结构化对象，或 ``None``。

    Raises:
        EvidenceError: 清单存在但不可读、不是有效 UTF-8 JSON、结构或 schema 不受支持。
    """

    path = snapshots / SNAPSHOT_MANIFEST_NAME
    if not path.is_file():
        return None
    try:
        raw = path.read_bytes()
    except OSError as error:
        raise EvidenceError(
            f"上游快照哈希清单不可读：{path}（{error.strerror or error}）"
        ) from error
    if len(raw) > SNAPSHOT_MANIFEST_MAX_BYTES:
        raise EvidenceError(
            f"上游快照哈希清单超过 {SNAPSHOT_MANIFEST_MAX_BYTES} 字节上限：{path}"
        )
    try:
        document = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise EvidenceError(f"上游快照哈希清单不是有效 UTF-8 JSON：{path}（{error}）") from error
    if not isinstance(document, dict):
        raise EvidenceError(f"上游快照哈希清单必须是结构化对象：{path}")
    if document.get("manifest_schema") != SNAPSHOT_MANIFEST_SCHEMA:
        raise EvidenceError(
            "上游快照哈希清单 schema 不受支持："
            f"{document.get('manifest_schema') or '空'}；期望 {SNAPSHOT_MANIFEST_SCHEMA}"
        )
    return document


def verify_snapshot_manifest(
    snapshots: Path,
    document: dict[str, object],
    records: dict[str, dict[str, object]] | None = None,
) -> dict[str, object]:
    """逐条复算受控快照哈希清单，并核对许可证材料随快照交付。

    每条条目都必须存在、字节数与 SHA-256 与清单一致；上游来源文件的实测指纹还必须
    与条目登记的声明指纹相同。清单必须至少包含一条许可证条目；当受控来源清单登记了
    ``license_sha256`` 时，快照的许可证条目必须逐个覆盖该指纹。任一条不成立即拒绝，
    诊断指向具体条目与具体路径；不回落到固定地址取回，也不放宽阈值。

    Args:
        snapshots: 受控快照根目录。
        document: ``_load_snapshot_manifest`` 解析出的清单。
        records: 受控来源清单的记录映射，用于核对登记的许可证指纹。

    Returns:
        清单摘要，含清单路径、指纹、条目数、字节数与许可证条目数。

    Raises:
        EvidenceError: 条目缺失、路径越界、字节或指纹不符，或许可证材料缺位。
    """

    entries = document.get("files")
    if not isinstance(entries, list) or not entries:
        raise EvidenceError("上游快照哈希清单缺少非空 files 条目数组")
    declared_licenses = {
        _text(record, "license_sha256").lower()
        for record in (records or {}).values()
        if _text(record, "license_sha256")
    }
    total_bytes = 0
    license_entries = 0
    for number, entry in enumerate(entries, 1):
        if not isinstance(entry, dict):
            raise EvidenceError(f"上游快照清单第 {number} 条不是结构化对象")
        kind = _text(entry, "kind")
        if kind not in SNAPSHOT_MANIFEST_KINDS:
            raise EvidenceError(
                f"上游快照清单第 {number} 条的 kind 必须是 {'、'.join(SNAPSHOT_MANIFEST_KINDS)}"
                f"：{kind or '空'}"
            )
        relative = _text(entry, "path")
        if not relative or Path(relative).is_absolute() or ".." in Path(relative).parts:
            raise EvidenceError(
                f"上游快照清单第 {number} 条的 path 不是安全的相对路径：{relative or '空'}"
            )
        target = snapshots / relative
        if not target.is_file():
            raise EvidenceError(
                f"上游快照文件缺失：{target}（哈希清单第 {number} 条 {relative}）"
            )
        try:
            raw = target.read_bytes()
        except OSError as error:
            raise EvidenceError(
                f"上游快照文件不可读：{target}（{error.strerror or error}）"
            ) from error
        expected_bytes = entry.get("bytes")
        if not isinstance(expected_bytes, int) or expected_bytes < 0:
            raise EvidenceError(
                f"上游快照清单第 {number} 条缺少有效字节数：{relative}"
            )
        if len(raw) != expected_bytes:
            raise EvidenceError(
                f"上游快照字节数不符：{target} 清单 {expected_bytes}，实测 {len(raw)}"
            )
        digest = hashlib.sha256(raw).hexdigest()
        expected = _text(entry, "sha256").lower()
        if not SHA256_PATTERN.match(expected):
            raise EvidenceError(f"上游快照清单第 {number} 条缺少有效 SHA-256：{relative}")
        if digest != expected:
            raise EvidenceError(
                f"上游快照指纹不符：{target} 期望 {expected}，实测 {digest}"
            )
        total_bytes += len(raw)
        if kind == "license":
            license_entries += 1
            continue
        if kind == "local-baseline":
            declared = _text(entry, "declared_baseline_sha256").lower()
            if not SHA256_PATTERN.match(declared):
                raise EvidenceError(
                    f"上游快照清单第 {number} 条缺少有效的声明基线 SHA-256：{relative}"
                )
            if declared != digest:
                raise EvidenceError(
                    f"仓内基线副本与声明指纹不一致：{target} 声明 {declared}，实测 {digest}"
                )
            if entry.get("matches_declared_baseline_sha256") is not True:
                raise EvidenceError(
                    f"上游快照清单第 {number} 条未登记一致结论 "
                    f"matches_declared_baseline_sha256：{relative}"
                )
            if not COMMIT_PATTERN.match(_text(entry, "baseline_commit")):
                raise EvidenceError(
                    f"上游快照清单第 {number} 条的基线提交不是完整 40 位 SHA：{relative}"
                )
            if not _text(entry, "baseline_repository_path"):
                raise EvidenceError(
                    f"上游快照清单第 {number} 条缺少仓库内基线路径：{relative}"
                )
            continue
        declared = _text(entry, "declared_upstream_sha256").lower()
        if not SHA256_PATTERN.match(declared):
            raise EvidenceError(
                f"上游快照清单第 {number} 条缺少有效的声明上游 SHA-256：{relative}"
            )
        if declared != digest:
            raise EvidenceError(
                f"上游快照与声明的上游指纹不一致：{target} 声明 {declared}，实测 {digest}"
            )
        if entry.get("matches_declared_upstream_sha256") is not True:
            raise EvidenceError(
                f"上游快照清单第 {number} 条未登记一致结论 matches_declared_upstream_sha256：{relative}"
            )
        commit = _text(entry, "upstream_commit")
        if not COMMIT_PATTERN.match(commit):
            raise EvidenceError(
                f"上游快照清单第 {number} 条的上游固定提交不是完整 40 位 SHA：{relative}"
            )
        url = _text(entry, "upstream_file_url")
        if commit not in url or not _text(entry, "upstream_path"):
            raise EvidenceError(
                f"上游快照清单第 {number} 条缺少固定在登记提交上的原始取回地址：{relative}"
            )
    if license_entries == 0:
        raise EvidenceError(
            f"上游快照清单没有任何许可证条目（kind=license）：{snapshots / SNAPSHOT_MANIFEST_NAME}"
        )
    license_digests = {
        _text(entry, "sha256").lower()
        for entry in entries
        if isinstance(entry, dict) and _text(entry, "kind") == "license"
    }
    for expected in sorted(declared_licenses):
        if expected not in license_digests:
            raise EvidenceError(
                f"受控清单声明的许可证指纹 {expected} 未随快照交付："
                f"{snapshots / SNAPSHOT_MANIFEST_NAME} 的许可证条目为"
                f"{'、'.join(sorted(license_digests)) or '空'}"
            )
    baseline_digests = {
        _text(entry, "sha256").lower()
        for entry in entries
        if isinstance(entry, dict) and _text(entry, "kind") == "local-baseline"
    }
    for path, record in sorted((records or {}).items()):
        contract = record.get("author_only_contract")
        if not contract:
            continue
        if isinstance(contract, str):
            try:
                contract = json.loads(contract)
            except json.JSONDecodeError:
                continue
        if not isinstance(contract, dict):
            continue
        baseline = contract.get("local_baseline")
        if not isinstance(baseline, dict):
            continue
        expected = _text(baseline, "sha256").lower()
        if expected and expected not in baseline_digests:
            raise EvidenceError(
                f"记录 {path} 的 A1 本地比较输入指纹 {expected} 未随快照纳入仓内副本："
                f"{snapshots / SNAPSHOT_MANIFEST_NAME} 的基线条目为"
                f"{'、'.join(sorted(baseline_digests)) or '空'}"
            )
    return {
        "manifest": str(snapshots / SNAPSHOT_MANIFEST_NAME),
        "manifest_sha256": hashlib.sha256(
            (snapshots / SNAPSHOT_MANIFEST_NAME).read_bytes()
        ).hexdigest(),
        "files": len(entries),
        "bytes": total_bytes,
        "licenses": license_entries,
    }


def _fixed_content_url(
    file_url: str, repository: str, commit: str, upstream_path: str
) -> tuple[str | None, str | None]:
    """校验清单登记的固定地址并转换为可重取的内容地址。

    地址必须使用 https、固定在登记的提交上并指向登记的上游文件；GitHub 的
    ``blob`` 页面地址转换为同提交的 ``raw`` 内容地址。只把固定地址当作来源，
    不把上游正文复制进仓库。

    Args:
        file_url: 清单 ``upstream_file_url`` 登记的固定地址。
        repository: 来源说明中的“拥有者/仓库名”。
        commit: 固定的完整提交 SHA。
        upstream_path: 上游仓库相对路径。

    Returns:
        ``(可重取内容地址, 错误说明)``；地址合法时错误说明为 ``None``。
    """

    value = file_url.strip()
    if not value:
        return None, "清单缺少可重取的 upstream_file_url 固定地址"
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or not parsed.netloc:
        return None, f"upstream_file_url 必须是 https 固定地址：{value}"
    segments = [urllib.parse.unquote(part) for part in parsed.path.split("/") if part]
    if commit not in segments:
        return None, f"upstream_file_url 未固定在登记的提交 {commit}：{value}"
    index = segments.index(commit)
    tail = "/".join(segments[index + 1 :])
    if tail != upstream_path:
        return None, f"upstream_file_url 指向的路径不是登记的上游文件 {upstream_path}：{value}"
    host = parsed.netloc.lower()
    if host in {"github.com", "www.github.com", "raw.githubusercontent.com"}:
        owner_repo = "/".join(segments[:2])
        if owner_repo != repository:
            return None, (
                f"upstream_file_url 的仓库与来源说明不一致：地址 {owner_repo}，来源 {repository}"
            )
    if host in {"github.com", "www.github.com"}:
        if len(segments) < 4 or segments[2] != "blob":
            return None, f"upstream_file_url 不是固定提交的 blob 地址：{value}"
        return (
            f"https://raw.githubusercontent.com/{segments[0]}/{segments[1]}/{commit}/{tail}",
            None,
        )
    return value, None


@lru_cache(maxsize=512)
def _fetch_upstream_bytes(url: str) -> bytes:
    """按固定地址取回上游内容，只返回原始字节供调用方复算指纹。

    瞬时的连接中断与超时按固定次数重试；重试仍失败时抛出真实异常，由调用方
    转换为“取不回”的拒绝原因，不把网络故障当作内容通过。

    Raises:
        OSError: 网络不可达、HTTP 错误或响应超过字节上限。
    """

    request = urllib.request.Request(url, headers={"User-Agent": "basic-framework-quality-gate"})
    last_error: OSError | None = None
    for attempt in range(EVIDENCE_FETCH_ATTEMPTS):
        if attempt:
            time.sleep(EVIDENCE_FETCH_BACKOFF_SECONDS * attempt)
        try:
            with urllib.request.urlopen(request, timeout=EVIDENCE_FETCH_TIMEOUT_SECONDS) as response:
                raw = response.read(MAX_UPSTREAM_BYTES + 1)
        except (OSError, ValueError) as error:
            last_error = error if isinstance(error, OSError) else OSError(str(error))
            continue
        if len(raw) > MAX_UPSTREAM_BYTES:
            raise OSError(f"上游内容超过 {MAX_UPSTREAM_BYTES} 字节上限")
        return raw
    assert last_error is not None
    raise last_error


def _verify_upstream_content(
    raw: bytes, expected_sha256: str, subject: str
) -> tuple[str | None, str | None]:
    """复算上游内容指纹并检查作者声明，返回 ``(拒绝原因, 实测指纹)``。"""

    digest = hashlib.sha256(raw).hexdigest()
    if digest != expected_sha256:
        return f"{subject}实测指纹 {digest} 与清单 {expected_sha256} 不符", digest
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return f"{subject}不是有效 UTF-8", digest
    authors = _upstream_author_lines(text)
    if authors:
        return f"上游该固定版本存在作者声明，必须保留作者：{authors[0]}", digest
    return None, digest


def _verify_upstream_snapshot(
    registry: EvidenceRegistry,
    *,
    repository: str,
    commit: str,
    upstream_path: str,
    expected_sha256: str,
    file_url: str | None = None,
) -> tuple[str | None, str | None]:
    """复核固定上游内容：受控快照优先，缺失时按固定地址取回并复算指纹。

    Args:
        registry: 受控证据清单，含快照根目录。
        repository: 来源说明中的“拥有者/仓库名”。
        commit: 来源说明中的完整提交 SHA。
        upstream_path: 来源说明中的上游仓库相对路径。
        expected_sha256: 清单登记的上游内容 SHA-256。
        file_url: 清单登记的固定重取地址；快照缺失时使用。

    Returns:
        ``(拒绝原因, 实测指纹)``；拒绝原因为 ``None`` 时该内容通过复核。
    """

    if registry.snapshots is not None:
        candidate = _resolve_snapshot(registry.snapshots, repository, commit, upstream_path)
        if candidate is not None:
            try:
                raw = candidate.read_bytes()
            except OSError as error:
                return f"上游快照不可读：{candidate}（{error.strerror or error}）", None
            return _verify_upstream_content(raw, expected_sha256, "上游内容")
    content_url, url_error = _fixed_content_url(file_url or "", repository, commit, upstream_path)
    if url_error:
        return url_error, None
    try:
        raw = _fetch_upstream_bytes(content_url)
    except (OSError, ValueError) as error:
        detail = getattr(error, "reason", None) or error
        return (
            f"无法从固定地址取回上游内容 {content_url}（{type(error).__name__}: {detail}）"
            f"；可设置 {EVIDENCE_SNAPSHOTS_ENV} 提供受控快照",
            None,
        )
    return _verify_upstream_content(raw, expected_sha256, "上游内容")


def _evidence_branch(record: dict[str, object]) -> tuple[str | None, str | None]:
    """读取记录声明的证据分支。

    Returns:
        ``(分支名或 None, 错误说明)``；未声明分支时返回 ``(None, None)``，
        表示沿用既有“原有充分路线”结构校验。声明了未知分支即拒绝。
    """

    branch = _text(record, EVIDENCE_BRANCH_FIELD)
    if not branch:
        return None, None
    if branch not in EVIDENCE_BRANCHES:
        return None, f"证据分支不受支持：{branch}"
    return branch, None


def _json_field(record: dict[str, object], key: str) -> tuple[object | None, str | None]:
    """读取结构化 JSON 字段；缺失、空值或无法解析时返回错误说明。"""

    raw = record.get(key)
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None, f"清单缺少 {key}"
    if isinstance(raw, str):
        try:
            return json.loads(raw), None
        except json.JSONDecodeError:
            return None, f"清单的 {key} 不是有效 JSON"
    return raw, None


def _exclusion_reason(line: str, kind: str) -> str | None:
    """判断经装饰剥离后的整行能否作为纯作者声明排除。

    裁决 D14 §52：只可排除独立 ``@author`` 行与同处紧随、只延续作者身份或角色的声明行；
    职责、参数、业务约束、本地修改、版权、许可证、普通说明与其他块标签都不得排除，
    混合作者与业务事实的一行也不能整行排除。

    Args:
        line: 已剥离 JavaDoc 装饰的正文行。
        kind: ``author`` 或 ``author-continuation``。

    Returns:
        拒绝原因；可以安全排除时返回 ``None``。
    """

    if not line:
        return "空行不能作为作者声明排除"
    if (
        line.startswith(SOURCE_HEADER_PREFIX)
        or line.startswith(SOURCE_PATH_PREFIX)
        or line.startswith(SOURCE_PATH_CONTINUATION_PREFIX)
        or line.startswith("来源依据：")
        or line.startswith("本地修改：")
    ):
        return f"来源说明字段不是作者声明，不能整行排除：{line!r}"
    if re.match(r"^@(?!author\b)\w", line, re.IGNORECASE):
        return f"{line!r} 是其他块标签，不是作者声明"
    if kind not in AUTHOR_ONLY_EXCLUSION_KINDS:
        return f"排除种类不受支持：{kind}"
    if kind == "author":
        match = STRICT_AUTHOR_LINE_PATTERN.match(line)
        if match is None:
            return f"{line!r} 不是独占整行的独立 @author 声明"
        value = AUTHOR_PATTERN.match(line)
        author_value = "" if value is None else value.group("name").strip()
    else:
        author_value = line.strip()
    if not author_value:
        return f"作者声明行为空，不能作为可排除的作者声明：{line!r}"
    if AUTHOR_SOURCE_SENTENCE_PATTERN.search(author_value) or (
        author_value.casefold() in AUTHOR_NEUTRAL_VALUES
    ):
        return f"{line!r} 承载来源或中性表达，不是作者声明"
    for marker in AUTHOR_ONLY_FACT_MARKERS:
        if marker.casefold() in author_value.casefold():
            return f"{line!r} 含作者身份之外的事实（{marker}），不能整行排除"
    if re.search(r"[。；！？，、]", author_value):
        return f"{line!r} 含陈述性标点，不能整行排除"
    tokens = author_value.split()
    if len(tokens) > AUTHOR_ONLY_CONTINUATION_MAX_TOKENS:
        return f"{line!r} 超出纯作者身份 token 上限，无法安全识别"
    if kind == "author-continuation" and not all(
        AUTHOR_IDENTITY_TOKEN_PATTERN.match(token) for token in tokens
    ):
        return f"{line!r} 不是纯作者身份/角色续行，无法安全识别"
    return None


def _a1_normalize(lines: list[str], r2_mapping: list[tuple[str, str]]) -> list[str]:
    """按记录的 R1–R4 顺序规范化行序列（不做 R5/R6，不做相似率容差）。

    Args:
        lines: 原始行序列（不含行尾换行符）。
        r2_mapping: 记录在契约中的 R2 精确映射表，按顺序逐条字面替换。

    Returns:
        R1（LF 化）、R2（映射）、R3（行首尾空白）、R4（丢空行）之后的非空行序列。
    """

    normalized = []
    for line in lines:
        line = line.replace("\r\n", "\n").replace("\r", "\n")
        for source, target in r2_mapping:
            line = line.replace(source, target)
        line = line.strip()
        if line:
            normalized.append(line)
    return normalized


def _a1_raw_changed_lines(left: list[str], right: list[str]) -> tuple[int, int]:
    """统计两侧原始行序列中不相等行的数量。"""

    left_changed = right_changed = 0
    for block in difflib.SequenceMatcher(None, left, right, autojunk=False).get_opcodes():
        tag, i1, i2, j1, j2 = block
        if tag == "equal":
            continue
        left_changed += i2 - i1
        right_changed += j2 - j1
    return left_changed, right_changed


def _a1_compare(
    local_text: str,
    upstream_text: str,
    r2_mapping: list[tuple[str, str]],
    local_excluded: set[int],
    upstream_excluded: set[int],
) -> dict[str, object]:
    """按 E1-author-only 判据比较双方内容。

    只排除登记的作者声明行，再按 R1–R4 比较全部剩余内容；不使用 R5/R6、去 package/import、
    去普通注释、裁剪文件或相似率容差（裁决 D14 §54）。

    Args:
        local_text: 本地比较输入原文。
        upstream_text: 上游比较输入原文。
        r2_mapping: 契约登记的 R2 映射表。
        local_excluded: 本地被排除行的 1 起行号集合。
        upstream_excluded: 上游被排除行的 1 起行号集合。

    Returns:
        含 ``remaining_equal``、``remaining_local_lines``、``remaining_upstream_lines``、
        ``remaining_local_sha256``、``remaining_upstream_sha256``、``raw_changed`` 与
        ``first_difference`` 的结果字典。
    """

    local_lines = local_text.split("\n")
    upstream_lines = upstream_text.split("\n")
    kept_local = [
        line for number, line in enumerate(local_lines, 1) if number not in local_excluded
    ]
    kept_upstream = [
        line for number, line in enumerate(upstream_lines, 1) if number not in upstream_excluded
    ]
    remaining_local = _a1_normalize(kept_local, r2_mapping)
    remaining_upstream = _a1_normalize(kept_upstream, r2_mapping)
    difference = ""
    for index in range(max(len(remaining_local), len(remaining_upstream))):
        left = remaining_local[index] if index < len(remaining_local) else "<缺失>"
        right = remaining_upstream[index] if index < len(remaining_upstream) else "<缺失>"
        if left != right:
            difference = f"剩余内容第 {index + 1} 行不同：本地 {left!r}，上游 {right!r}"
            break
    raw_local, raw_upstream = _a1_raw_changed_lines(local_lines, upstream_lines)
    return {
        "remaining_equal": remaining_local == remaining_upstream,
        "remaining_local_lines": len(remaining_local),
        "remaining_upstream_lines": len(remaining_upstream),
        "remaining_local_sha256": hashlib.sha256(
            "\n".join(remaining_local).encode("utf-8")
        ).hexdigest(),
        "remaining_upstream_sha256": hashlib.sha256(
            "\n".join(remaining_upstream).encode("utf-8")
        ).hexdigest(),
        "raw_changed": (raw_local, raw_upstream),
        "first_difference": difference,
    }


def _a1_baseline_bytes(contract: dict[str, object], registry: EvidenceRegistry) -> tuple[bytes | None, str | None]:
    """取回 E1-author-only 的本地比较输入。

    先按契约登记的受控快照相对路径取，再按 ``<提交>:<路径>`` 从 Git 对象库取；
    两者都没有或指纹不符即拒绝。比较输入必须是整改前输入，不能拿最终文件替代。

    Args:
        contract: 记录声明的比较契约。
        registry: 受控证据清单，含快照根目录。

    Returns:
        ``(字节或 None, 拒绝原因)``。
    """

    baseline = contract.get("local_baseline")
    if not isinstance(baseline, dict):
        return None, "E1-author-only 契约缺少 local_baseline（本地比较输入）"
    expected = _text(baseline, "sha256").lower()
    if not SHA256_PATTERN.match(expected):
        return None, "E1-author-only 契约的 local_baseline.sha256 不是有效 SHA-256"
    snapshot_path = _text(baseline, "snapshot_path")
    if snapshot_path and registry.snapshots is not None:
        candidate = registry.snapshots / snapshot_path
        try:
            raw = candidate.read_bytes()
        except OSError:
            return None, f"本地比较输入的受控快照不可读：{candidate}"
        if hashlib.sha256(raw).hexdigest() != expected:
            return None, f"本地比较输入快照 {candidate} 的指纹与契约不符"
        return raw, None
    commit = _text(baseline, "commit")
    path = _text(baseline, "path")
    if commit and path and COMMIT_PATTERN.match(commit):
        try:
            output = _run_git(["show", f"{commit}:{path}"], text=False)
        except RuntimeError as error:
            return None, f"本地比较输入无法从固定提交取回：{error}"
        assert isinstance(output, bytes)
        if hashlib.sha256(output).hexdigest() != expected:
            return None, f"本地比较输入 {commit}:{path} 的指纹与契约不符"
        return output, None
    return None, "本地比较输入既没有受控快照相对路径，也没有固定的提交地址"


def _author_only_contract_reasons(
    record: dict[str, object],
    local_path: str,
    local_sha256: str,
    registry: EvidenceRegistry,
) -> list[str]:
    """核验 E1-author-only 分支的版本化契约，并重新执行比较。

    记录声明该分支时，比较输入、排除记录与一致结果都必须可复算；本函数不采信
    “R1–R6 后一致”“高相似率”一类表述，也不允许把来源说明加入排除列表。

    Args:
        record: 清单记录。
        local_path: 被检查的本地对象路径。
        local_sha256: 当前对象原始字节 SHA-256。
        registry: 受控证据清单。

    Returns:
        逐项拒绝原因；为空表示该分支的契约与结果成立。
    """

    reasons: list[str] = []
    route = _text(record, "evidence_route")
    if route != AUTHOR_ONLY_ROUTE:
        reasons.append(f"E1-author-only 分支归属路线 2，当前 evidence_route={route or '空'}")
    value, error = _json_field(record, "author_only_contract")
    if value is None:
        return reasons + [f"E1-author-only 分支缺少比较契约：{error}"]
    if not isinstance(value, dict):
        return reasons + ["E1-author-only 比较契约必须是结构化对象"]
    contract = value
    if contract.get("schema") != AUTHOR_ONLY_SCHEMA:
        reasons.append(f"比较契约 schema 不是 {AUTHOR_ONLY_SCHEMA}")
    if contract.get("branch") != EVIDENCE_BRANCH_AUTHOR_ONLY:
        reasons.append(f"比较契约 branch 不是 {EVIDENCE_BRANCH_AUTHOR_ONLY}")
    if contract.get("route") != AUTHOR_ONLY_ROUTE:
        reasons.append(f"比较契约 route 不是 {AUTHOR_ONLY_ROUTE}")
    if [str(item) for item in contract.get("normalization_order") or []] != list(
        AUTHOR_ONLY_NORMALIZATION_ORDER
    ):
        reasons.append(
            "比较契约的 normalization_order 必须恰为 "
            + "、".join(AUTHOR_ONLY_NORMALIZATION_ORDER)
            + "（不得使用 R5/R6）"
        )
    if not _text(contract, "mapping_basis"):
        reasons.append("比较契约缺少 R2 映射的批准依据 mapping_basis")
    mapping_raw = contract.get("r2_mapping")
    mapping: list[tuple[str, str]] = []
    if not isinstance(mapping_raw, list) or not mapping_raw:
        reasons.append("比较契约的 r2_mapping 必须是至少一条字面映射")
    else:
        for item in mapping_raw:
            if (
                not isinstance(item, list)
                or len(item) != 2
                or not all(isinstance(part, str) and part for part in item)
            ):
                reasons.append(f"r2_mapping 条目不是“源→目标”字面对：{item!r}")
                continue
            mapping.append((str(item[0]), str(item[1])))
    # 上游比较输入复用既有的固定提交核验（快照优先，其次固定地址取回）。
    upstream_input = contract.get("upstream_input")
    if not isinstance(upstream_input, dict):
        reasons.append("E1-author-only 契约缺少 upstream_input（上游比较输入）")
    else:
        for key, record_key in (
            ("repo_url", "upstream_repo_url"),
            ("commit", "upstream_commit"),
            ("path", "upstream_path"),
            ("sha256", "upstream_sha256"),
            ("file_url", "upstream_file_url"),
        ):
            if _text(upstream_input, key) != _text(record, record_key):
                reasons.append(
                    f"E1-author-only 契约的 upstream_input.{key} 与记录登记不一致"
                )
    # E1-author-only 的上游允许声明作者（这正是该分支的适用场景），因此只复核固定输入的
    # 字节指纹与登记一致性，不套用“上游必须无作者”的来源说明门槛。
    upstream_sha = _text(record, "upstream_sha256").lower()
    if not SHA256_PATTERN.match(upstream_sha):
        reasons.append("E1-author-only 分支缺少有效的上游内容 SHA-256")
    upstream_raw, upstream_error = _upstream_bytes_for_contract(registry, record)
    if upstream_error:
        reasons.append(f"E1-author-only 上游比较输入未通过核验：{upstream_error}")
    elif upstream_raw is not None and hashlib.sha256(upstream_raw).hexdigest() != upstream_sha:
        reasons.append("E1-author-only 上游比较输入的实测指纹与记录登记不符")
    local_raw, local_error = _a1_baseline_bytes(contract, registry)
    if local_error:
        reasons.append(local_error)
    if local_raw is None or upstream_raw is None:
        return reasons
    local_text = local_raw.decode("utf-8-sig", errors="replace")
    upstream_text = upstream_raw.decode("utf-8-sig", errors="replace")
    # 排除记录：逐条绑定文件、输入指纹、行区间、原文与声明种类。
    exclusions = contract.get("excluded_author_declarations")
    if not isinstance(exclusions, list) or not exclusions:
        return reasons + ["E1-author-only 分支必须逐条登记 excluded_author_declarations"]
    local_excluded: set[int] = set()
    upstream_excluded: set[int] = set()
    local_lines = local_text.split("\n")
    upstream_lines = upstream_text.split("\n")
    for entry in exclusions:
        if not isinstance(entry, dict):
            reasons.append(f"排除记录不是结构化对象：{entry!r}")
            continue
        side = _text(entry, "file")
        kind = _text(entry, "declaration_kind")
        if side not in {"local", "upstream"}:
            reasons.append(f"排除记录的 file 必须是 local 或 upstream：{side!r}")
            continue
        if kind not in AUTHOR_ONLY_EXCLUSION_KINDS:
            reasons.append(f"排除记录的 declaration_kind 不受支持：{kind!r}")
            continue
        source_lines = local_lines if side == "local" else upstream_lines
        expected_side = (
            hashlib.sha256(local_raw).hexdigest()
            if side == "local"
            else hashlib.sha256(upstream_raw).hexdigest()
        )
        if _text(entry, "sha256").lower() != expected_side:
            reasons.append(f"排除记录声明的 {side} 输入指纹与比较输入不符")
            continue
        start = entry.get("line_start")
        end = entry.get("line_end")
        if not isinstance(start, int) or not isinstance(end, int) or not 1 <= start <= end <= len(source_lines):
            reasons.append(f"排除记录的行区间非法：{start!r}-{end!r}")
            continue
        verbatim = "\n".join(_comment_body_line(raw) for raw in source_lines[start - 1 : end])
        if _text(entry, "verbatim") != verbatim:
            reasons.append(
                f"排除记录的 verbatim 与实际原文不符（{side} {start}-{end}）："
                f"记录 {_text(entry, 'verbatim')!r}，实测 {verbatim!r}"
            )
            continue
        for offset, raw in enumerate(source_lines[start - 1 : end]):
            line = _comment_body_line(raw)
            line_reason = _exclusion_reason(line, kind)
            if line_reason:
                reasons.append(f"第 {start + offset} 行不能作为纯作者声明排除：{line_reason}")
        if not _text(entry, "owner"):
            reasons.append(f"排除记录 {side} {start}-{end} 缺少所属注释/类型 owner")
        if not _text(entry, "counterpart") and not _text(entry, "counterpart_absent_reason"):
            reasons.append(f"排除记录 {side} {start}-{end} 缺少对应关系或缺对应行理由")
        target = local_excluded if side == "local" else upstream_excluded
        target.update(range(start, end + 1))
    # 完整性：双方比较输入中的独立 @author 行必须全部登记，不能静默漏排。
    for side, source_lines, excluded in (
        ("local", local_lines, local_excluded),
        ("upstream", upstream_lines, upstream_excluded),
    ):
        for number, raw in enumerate(source_lines, 1):
            if STRICT_AUTHOR_LINE_PATTERN.match(_comment_body_line(raw)) and number not in excluded:
                reasons.append(
                    f"{side} 第 {number} 行的独立 @author 声明没有登记在排除记录中"
                )
    result = _a1_compare(
        local_text, upstream_text, mapping, local_excluded, upstream_excluded
    )
    remaining = contract.get("remaining")
    if not isinstance(remaining, dict):
        reasons.append("E1-author-only 契约缺少 remaining 一致结果")
    else:
        if remaining.get("equal") is not True:
            reasons.append("E1-author-only 契约的 remaining.equal 必须为 true")
        if remaining.get("diff_lines") != 0:
            reasons.append("E1-author-only 契约的 remaining.diff_lines 必须为 0")
        if remaining.get("line_count") != result["remaining_local_lines"]:
            reasons.append(
                "E1-author-only 契约的 remaining.line_count 与实测不符："
                f"记录 {remaining.get('line_count')!r}，实测 {result['remaining_local_lines']}"
            )
        for key, field in (
            ("remaining_local_sha256", "local_sha256"),
            ("remaining_upstream_sha256", "upstream_sha256"),
        ):
            declared = _text(remaining, field).lower()
            if declared != result[key]:
                reasons.append(
                    f"E1-author-only 契约的 remaining.{field} 与实测不符："
                    f"记录 {declared or '空'}，实测 {result[key]}"
                )
    if not result["remaining_equal"]:
        reasons.append(f"E1-author-only 比较不成立：{result['first_difference']}")
    if not result["remaining_local_lines"]:
        reasons.append("E1-author-only 剩余实质内容为空，不能据此判派生")
    attribution = contract.get("attribution")
    raw_local, raw_upstream = result["raw_changed"]
    if not isinstance(attribution, list) or not attribution:
        reasons.append("E1-author-only 契约必须逐处登记原始差异归因 attribution")
    else:
        total_local = total_upstream = 0
        for entry in attribution:
            if not isinstance(entry, dict):
                reasons.append(f"归因记录不是结构化对象：{entry!r}")
                continue
            if _text(entry, "cause") not in AUTHOR_ONLY_ATTRIBUTION_CAUSES:
                reasons.append(f"归因记录的 cause 不受支持：{_text(entry, 'cause')!r}")
            changed = entry.get("changed_lines")
            if (
                not isinstance(changed, dict)
                or not isinstance(changed.get("local"), int)
                or not isinstance(changed.get("upstream"), int)
            ):
                reasons.append(f"归因记录缺少 changed_lines.local/upstream：{entry!r}")
                continue
            total_local += int(changed["local"])
            total_upstream += int(changed["upstream"])
        if (total_local, total_upstream) != (raw_local, raw_upstream):
            reasons.append(
                "E1-author-only 的归因没有覆盖全部原始差异："
                f"归因 {total_local}/{total_upstream}，实测 {raw_local}/{raw_upstream}"
            )
    tool = contract.get("tool")
    if not isinstance(tool, dict) or not _text(tool, "name") or not _text(tool, "version"):
        reasons.append("E1-author-only 契约缺少工具名与规则版本（tool.name/tool.version）")
    else:
        if _text(tool, "version") != AUTHOR_ONLY_SCHEMA:
            reasons.append(f"E1-author-only 契约的 tool.version 不是 {AUTHOR_ONLY_SCHEMA}")
        checker_sha = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        declared_tool_sha = _text(tool, "sha256").lower()
        if declared_tool_sha != checker_sha:
            reasons.append(
                "E1-author-only 契约的 tool.sha256 与当前规则实现不符："
                f"记录 {declared_tool_sha or '空'}，实测 {checker_sha}"
            )
    review = contract.get("review")
    if not isinstance(review, dict):
        reasons.append("E1-author-only 契约缺少复核记录 review")
    else:
        for field in ("implementer", "reviewer", "date"):
            if not _text(review, field):
                reasons.append(f"E1-author-only 契约缺少 review.{field}")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", _text(review, "date")):
            reasons.append("E1-author-only 契约的 review.date 必须是 YYYY-MM-DD")
        if not _text(review, "conclusion"):
            reasons.append("E1-author-only 契约缺少 review.conclusion")
    if not _text(contract, "counter_evidence_conclusion"):
        reasons.append("E1-author-only 契约缺少反证结论 counter_evidence_conclusion")
    return reasons


def _upstream_bytes_for_contract(
    registry: EvidenceRegistry, record: dict[str, object]
) -> tuple[bytes | None, str | None]:
    """取回 E1-author-only 的上游比较输入字节（快照优先，其次固定地址）。"""

    repository = _repository_identifier(_text(record, "upstream_repo_url")) or ""
    commit = _text(record, "upstream_commit")
    upstream_path = _raw_text(record, "upstream_path")
    if registry.snapshots is not None:
        candidate = _resolve_snapshot(registry.snapshots, repository, commit, upstream_path)
        if candidate is not None:
            try:
                return candidate.read_bytes(), None
            except OSError as error:
                return None, f"上游快照不可读：{candidate}（{error.strerror or error}）"
    content_url, url_error = _fixed_content_url(
        _text(record, "upstream_file_url"), repository, commit, upstream_path
    )
    if url_error:
        return None, url_error
    try:
        return _fetch_upstream_bytes(content_url), None
    except (OSError, ValueError) as error:
        detail = getattr(error, "reason", None) or error
        return None, f"无法从固定地址取回上游内容 {content_url}（{type(error).__name__}: {detail}）"


def _content_independent_reasons(record: dict[str, object]) -> list[str]:
    """核验 C2-independent-content 分支：两个内容点必须独立且有区分力。

    数量、行距与语料频率不能代替语义判断（裁决 D14 §108）：本函数只机械拒绝可判定的
    不合格形状（重复、包含、同字段复述、同注释/注解复述、通用校验串与常见示例值），
    合格与否仍以记录中绑定的逐项复核结论为准。

    Args:
        record: 清单记录。

    Returns:
        逐项拒绝原因；为空表示结构层面成立。
    """

    raw, error = _json_field(record, "content_points")
    if raw is None:
        return [f"C2-independent-content 分支缺少内容点登记：{error}"]
    if not isinstance(raw, list):
        return ["C2-independent-content 的 content_points 必须是结构化数组"]
    if len(raw) < 2:
        return ["C2-independent-content 分支必须登记至少两个内容点"]
    reasons: list[str] = []
    if not _text(record, "independence_reason"):
        reasons.append("C2-independent-content 分支缺少独立性说明 independence_reason")
    if not _text(record, "counter_evidence_conclusion"):
        reasons.append("C2-independent-content 分支缺少反证结论 counter_evidence_conclusion")
    local_path = _text(record, "local_path")
    upstream_path = _raw_text(record, "upstream_path")
    upstream_sha = _text(record, "upstream_sha256").lower()
    fragments: list[str] = []
    owners: list[tuple[str, str]] = []
    positions: list[tuple[tuple[int, ...], tuple[int, ...]]] = []
    for index, point in enumerate(raw, 1):
        if not isinstance(point, dict):
            reasons.append(f"第 {index} 个内容点不是结构化对象")
            continue
        missing = [name for name in CONTENT_POINT_REQUIRED_FIELDS if not point.get(name)]
        if missing:
            reasons.append(f"第 {index} 个内容点缺少必需字段：{'、'.join(missing)}")
            continue
        fragment = str(point["fragment"])
        if hashlib.sha256(fragment.encode("utf-8")).hexdigest() != str(
            point["fragment_sha256"]
        ).lower():
            reasons.append(f"第 {index} 个内容点的片段指纹与片段原文不符")
        if str(point["local_path"]) != local_path:
            reasons.append(f"第 {index} 个内容点不是同一本地文件：{point['local_path']}")
        if str(point["upstream_path"]) != upstream_path:
            reasons.append(f"第 {index} 个内容点不是同一固定上游文件：{point['upstream_path']}")
        if str(point["upstream_sha256"]).lower() != upstream_sha:
            reasons.append(f"第 {index} 个内容点的上游输入指纹与记录不一致")
        if str(point["point_kind"]) not in CONTENT_POINT_KINDS:
            reasons.append(
                f"第 {index} 个内容点的 point_kind 必须是 {'、'.join(CONTENT_POINT_KINDS)}；"
                "结构点不能作为 C2 的内容点"
            )
        for field in ("local_lines", "upstream_lines"):
            value = point[field]
            if not isinstance(value, list) or not value or not all(
                isinstance(item, int) and item > 0 for item in value
            ):
                reasons.append(f"第 {index} 个内容点的 {field} 必须是至少一个正整数行号")
        if len(str(point["discrimination_reason"]).strip()) < 8:
            reasons.append(f"第 {index} 个内容点缺少有区分力理由 discrimination_reason")
        if len(str(point["corpus_binding"]).strip()) < 4:
            reasons.append(f"第 {index} 个内容点缺少语料绑定 corpus_binding")
        if len(str(point["field_or_behavior"]).strip()) < 2:
            reasons.append(f"第 {index} 个内容点缺少所属字段或行为 field_or_behavior")
        for pattern in CONTENT_POINT_GENERIC_PATTERNS:
            if pattern.search(fragment.strip()):
                reasons.append(
                    f"第 {index} 个内容点是通用形状、不计为有区分力：{fragment!r}"
                )
                break
        fragments.append(fragment.strip())
        owners.append((str(point["owner_type"]), str(point["field_or_behavior"])))
        positions.append(
            (
                tuple(int(item) for item in point["local_lines"]),
                tuple(int(item) for item in point["upstream_lines"]),
            )
        )
    for index, fragment in enumerate(fragments):
        for other in range(index + 1, len(fragments)):
            if fragment == fragments[other]:
                reasons.append(f"第 {index + 1} 与第 {other + 1} 个内容点是同一片段，不独立")
            elif fragment and (fragment in fragments[other] or fragments[other] in fragment):
                reasons.append(
                    f"第 {index + 1} 与第 {other + 1} 个内容点互为包含，不是两个独立事实"
                )
    for index in range(len(owners)):
        for other in range(index + 1, len(owners)):
            if owners[index] == owners[other]:
                reasons.append(
                    f"第 {index + 1} 与第 {other + 1} 个内容点是同一字段/行为的重复描述，不独立"
                )
    for index in range(len(positions)):
        for other in range(index + 1, len(positions)):
            if positions[index][0] == positions[other][0] or (
                positions[index][1] == positions[other][1]
            ):
                reasons.append(
                    f"第 {index + 1} 与第 {other + 1} 个内容点的双方行号重合，不能证明独立"
                )
    return reasons


def _code_identity_tokenize(source: str) -> tuple[list[list[str]], list[str]]:
    """按 Java 词法把源码分解为带边界的代码 token。

    只按 Java 的真实词法边界切分：行注释、块注释、字符串、字符与文本块分别
    整体成 token，去注释**不会**把两个 token 粘连（D16 §62）。Unicode 转义
    （``\\uXXXX``）出现在代码位置会先于词法被编译器改写，无法可靠解析时受控
    拒绝，绝不退回正则全文剥离。

    Args:
        source: 原始 Java 源码。

    Returns:
        ``(token 列表, 受控拒绝原因列表)``。token 元素为
        ``[类别, 原文, 起始行号]``；类别取 ``ident``/``number``/``string``/
        ``char``/``textblock``/``op``/``nl``/``ws``/``comment``，其中
        ``ws`` 与 ``comment`` 只是词法屏障，不进入代码流。
    """

    tokens: list[list[str]] = []
    errors: list[str] = []
    index = 0
    total = len(source)
    line = 1

    while index < total:
        char = source[index]
        if char == "\n":
            tokens.append(["nl", "\n", str(line)])
            index += 1
            line += 1
            continue
        if char.isspace():
            end = index
            while end < total and source[end] != "\n" and source[end].isspace():
                end += 1
            tokens.append(["ws", source[index:end], str(line)])
            line += source.count("\n", index, end)
            index = end
            continue
        if source.startswith("//", index):
            end = source.find("\n", index)
            end = total if end < 0 else end
            tokens.append(["comment", source[index:end], str(line)])
            index = end
            continue
        if source.startswith("/*", index):
            end = source.find("*/", index + 2)
            if end < 0:
                errors.append(f"第 {line} 行的块注释未闭合，不能可靠识别词法边界")
                tokens.append(["comment", source[index:total], str(line)])
                index = total
                break
            end += 2
            tokens.append(["comment", source[index:end], str(line)])
            line += source.count("\n", index, end)
            index = end
            continue
        if source.startswith('"""', index):
            cursor = index + 3
            closed = False
            while cursor < total:
                if source[cursor] == "\\":
                    cursor += 2
                    continue
                if source.startswith('"""', cursor):
                    cursor += 3
                    closed = True
                    break
                cursor += 1
            if not closed:
                errors.append(f"第 {line} 行的文本块未闭合，不能可靠识别词法边界")
                cursor = total
            tokens.append(["textblock", source[index:cursor], str(line)])
            line += source.count("\n", index, cursor)
            index = cursor
            continue
        if char in {'"', "'"}:
            kind = "string" if char == '"' else "char"
            cursor = index + 1
            closed = False
            while cursor < total:
                current = source[cursor]
                if current == "\\":
                    if cursor + 1 >= total:
                        errors.append(f"第 {line} 行的{kind}字面量以悬空转义结束")
                        break
                    if kind == "string" and current == "\\" and source[cursor + 1] == "u":
                        # 字符串/字符内部的 \u 转义按原文保留：它不改变本比较器
                        # 的 token 边界，双方逐字节不同仍会被严格比较捕获。
                        pass
                    cursor += 2
                    continue
                if current == "\n":
                    errors.append(f"第 {line} 行的{kind}字面量未闭合")
                    break
                if current == char:
                    cursor += 1
                    closed = True
                    break
                cursor += 1
            if not closed and not errors:
                errors.append(f"第 {line} 行的{kind}字面量未闭合")
            tokens.append([kind, source[index:cursor], str(line)])
            line += source.count("\n", index, cursor)
            index = cursor
            continue
        if char.isdigit() or (char == "." and index + 1 < total and source[index + 1].isdigit()):
            cursor = index
            while cursor < total and (
                source[cursor].isalnum() or source[cursor] in "._+-"
            ):
                # 指数符号只在 e/E 之后才算数字的一部分。
                if source[cursor] in "+-" and source[cursor - 1] not in "eE":
                    break
                cursor += 1
            tokens.append(["number", source[index:cursor], str(line)])
            index = cursor
            continue
        if char == "\\":
            # 代码位置的 Unicode 转义会在词法之前被编译器改写，token 边界不再可靠；
            # 字面量内部已经整体成 token 并按原文保留，不会走到这里。
            if re.match(r"\\u[0-9a-fA-F]{4}", source[index : index + 6]):
                errors.append(f"第 {line} 行的 Unicode 转义影响词法边界，不能可靠解析")
            else:
                errors.append(f"第 {line} 行出现代码位置的裸反斜杠，不能可靠识别词法边界")
            tokens.append(["op", char, str(line)])
            index += 1
            continue
        if char.isalpha() or char in "_$" or ord(char) > 127:
            cursor = index
            while cursor < total and (
                source[cursor].isalnum() or source[cursor] in "_$" or ord(source[cursor]) > 127
            ):
                cursor += 1
            tokens.append(["ident", source[index:cursor], str(line)])
            index = cursor
            continue
        operator = next(
            (item for item in CODE_IDENTITY_PUNCTUATION if source.startswith(item, index)),
            None,
        )
        if operator is None:
            errors.append(f"第 {line} 行出现未登记的词法字符 {char!r}，不能可靠解析")
            tokens.append(["op", char, str(line)])
            index += 1
            continue
        tokens.append(["op", operator, str(line)])
        index += len(operator)
    for control in CODE_IDENTITY_FORBIDDEN_SOURCE_CHARS:
        if control in source:
            errors.append(
                f"源码含规范序列化保留的控制字符 U+{ord(control):04X}，token 边界不可靠"
            )
            break
    return tokens, errors


def _code_identity_code_tokens(source: str) -> tuple[list[list[str]], list[str]]:
    """返回去掉注释与空白、合并点号限定名后的代码 token 流。

    ``ws``、``nl`` 与 ``comment`` 只作词法屏障，不进入代码流：它们是变换集登记的
    N1「代码 token 之间空白规范化」的作用对象，删除注释不会把两个 token 粘连。
    字符串/字符/文本块字面量是整体 token，其内部空白逐字保留，不受 N1 影响。

    Args:
        source: 原始 Java 源码。

    Returns:
        ``(代码 token 流, 受控拒绝原因列表)``。
    """

    tokens, errors = _code_identity_tokenize(source)
    merged: list[list[str]] = []
    index = 0
    total = len(tokens)
    while index < total:
        kind, text, line = tokens[index]
        if kind in {"ws", "comment", "nl"}:
            index += 1
            continue
        if kind == "ident":
            cursor = index + 1
            segments = [text]
            while cursor + 1 < total and tokens[cursor][0] == "op" and tokens[cursor][1] == ".":
                segments.append(tokens[cursor + 1][1])
                cursor += 2
            if len(segments) > 1:
                merged.append(["name", ".".join(segments), line])
            else:
                merged.append(["ident", text, line])
            index = cursor
            continue
        merged.append([kind, text, line])
        index += 1
    return merged, errors


def _code_identity_serialize(tokens: list[list[str]]) -> bytes:
    """把代码 token 流序列化为带明确编码与边界的规范字节串。

    每个 token 贡献 ``类别 + U+001F + 原文 + U+001E``，不同 token 序列不可能
    拼成同一文本（D16 §64）。
    """

    parts: list[str] = []
    for kind, text, _ in tokens:
        parts.append(kind)
        parts.append(CODE_IDENTITY_TOKEN_SEPARATOR)
        parts.append(text)
        parts.append(CODE_IDENTITY_TOKEN_TERMINATOR)
    return "".join(parts).encode("utf-8")


def _code_identity_import_spans(tokens: list[list[str]]) -> list[tuple[int, int]]:
    """返回 import 语句在代码 token 流中的半开区间。

    ``import`` 之后到分号（含）为一个语句；**不做任何删除**，T5 只允许在
    双方各自流内做确定性排序（D16 变换集 T5）。
    """

    spans: list[tuple[int, int]] = []
    index = 0
    total = len(tokens)
    while index < total:
        kind, text, _ = tokens[index]
        previous_is_dot = index > 0 and tokens[index - 1][0] == "op" and tokens[index - 1][1] == "."
        if kind == "ident" and text == "import" and not previous_is_dot:
            cursor = index
            while cursor < total and not (tokens[cursor][0] == "op" and tokens[cursor][1] == ";"):
                cursor += 1
            end = cursor + 1 if cursor < total else total
            spans.append((index, end))
            index = end
            continue
        index += 1
    return spans


def _code_identity_sort_imports(tokens: list[list[str]]) -> list[list[str]]:
    """在双方代码流内对 import 语句组做确定性排序（保留全部 import 条目）。"""

    spans = _code_identity_import_spans(tokens)
    if not spans:
        return tokens
    groups: list[list[tuple[int, int]]] = [[spans[0]]]
    for span in spans[1:]:
        previous = groups[-1][-1]
        between = tokens[previous[1] : span[0]]
        if all(item[0] in {"ws", "nl"} for item in between):
            groups[-1].append(span)
        else:
            groups.append([span])
    result: list[list[str]] = []
    cursor = 0
    for group in groups:
        result.extend(tokens[cursor : group[0][0]])
        statements = []
        for start, end in group:
            statement = tokens[start:end]
            statements.append((_code_identity_serialize(statement), statement))
        statements.sort(key=lambda item: item[0])
        cursor = group[-1][1]
        for _, statement in statements:
            result.extend(statement)
    result.extend(tokens[cursor:])
    return result


def _code_identity_apply_transform(
    tokens: list[list[str]], transform: dict[str, object]
) -> list[list[str]]:
    """按登记操作对**代码流**执行一次确定性变换。

    变换只作用于代码 token：注释早已排除在代码流之外，字符串/文本块/字符
    字面量保留逐字原文，只有显式登记为 ``exact-string-literal-map`` 的整条
    字面量才会被改写——绝不做无边界全文替换，也绝不折叠字面量内空白。

    Args:
        tokens: 代码 token 流。
        transform: 变换集清单中的单条变换。

    Returns:
        变换后的代码 token 流。
    """

    operation = str(transform.get("operation"))
    pairs = [
        (str(item[0]), str(item[1]))
        for item in transform.get("pairs") or []
        if isinstance(item, list) and len(item) == 2 and all(isinstance(part, str) and part for part in item)
    ]
    if operation == "import-group-canonical-sort":
        return _code_identity_sort_imports(tokens)
    if not pairs:
        return tokens
    mapping = dict(pairs)
    result: list[list[str]] = []
    for kind, text, line in tokens:
        if operation == "qualified-name-prefix-map":
            segments = text.split(".")
            replaced = False
            for source, target in pairs:
                key = source.split(".")
                if len(segments) > len(key) and segments[: len(key)] == key:
                    result.append([kind, ".".join(target.split(".") + segments[len(key) :]), line])
                    replaced = True
                    break
            if not replaced:
                result.append([kind, text, line])
        elif operation == "exact-name-map":
            result.append([kind, mapping.get(text, text), line])
        elif operation == "exact-simple-name-map":
            # 只改写与登记键**逐段完全相等**的那一段：限定名的任意一段都可能是被
            # 登记的类型标识符，但绝不做子串匹配，也不改动更长的无关标识符。
            if kind == "ident":
                result.append([kind, mapping.get(text, text), line])
            elif kind == "name":
                segments = [mapping.get(item, item) for item in text.split(".")]
                result.append([kind, ".".join(segments), line])
            else:
                result.append([kind, text, line])
        elif operation == "exact-string-literal-map":
            result.append([kind, mapping.get(text, text), line])
        else:
            result.append([kind, text, line])
    return result


def _code_identity_stream(
    source: str, transforms: list[dict[str, object]], side: str
) -> dict[str, object]:
    """产出单侧代码流读数；解析不可靠时以受控拒绝结束，不退回宽松比较。

    Args:
        source: 单侧原文。
        transforms: 已按执行顺序排列的变换。
        side: ``local`` 或 ``upstream``，决定变换方向是否适用。

    Returns:
        含 ``tokens``/``serialized``/``sha256``/``bytes``/``token_count``/
        ``import_count`` 与 ``errors`` 的结果字典。
    """

    tokens, errors = _code_identity_code_tokens(source)
    for transform in transforms:
        direction = str(transform.get("direction"))
        if direction == "both" or side == "upstream":
            tokens = _code_identity_apply_transform(tokens, transform)
    serialized = _code_identity_serialize(tokens)
    return {
        "tokens": tokens,
        "serialized": serialized,
        "sha256": hashlib.sha256(serialized).hexdigest(),
        "bytes": len(serialized),
        "token_count": len(tokens),
        "import_count": len(_code_identity_import_spans(tokens)),
        "errors": errors,
    }


def _code_identity_first_difference(
    left: list[list[str]], right: list[list[str]]
) -> str:
    """返回两侧代码流的第一处差异（按 token 序号）。"""

    for position in range(max(len(left), len(right))):
        lhs = left[position] if position < len(left) else ["<缺失>", "<缺失>", "0"]
        rhs = right[position] if position < len(right) else ["<缺失>", "<缺失>", "0"]
        if lhs[0] != rhs[0] or lhs[1] != rhs[1]:
            return (
                f"代码流第 {position + 1} 个 token 不同：本地 {lhs[0]}:{lhs[1]!r}（第 {lhs[2]} 行），"
                f"上游 {rhs[0]}:{rhs[1]!r}（第 {rhs[2]} 行）"
            )
    return ""


def _code_identity_diff_lines(local_text: str, upstream_text: str) -> tuple[int, int]:
    """统计双方原始行序列中不相等的行数（用于逐处差异归因的完整性核对）。"""

    left_changed = right_changed = 0
    for block in difflib.SequenceMatcher(
        None, local_text.split("\n"), upstream_text.split("\n"), autojunk=False
    ).get_opcodes():
        tag, i1, i2, j1, j2 = block
        if tag == "equal":
            continue
        left_changed += i2 - i1
        right_changed += j2 - j1
    return left_changed, right_changed


def _code_identity_implementation_root() -> Path:
    """返回本规则实现所在仓库的根目录（变换集与本地对象的默认解析基准）。"""

    return Path(__file__).resolve().parents[3]


@lru_cache(maxsize=4)
def _load_code_identity_transform_set(path: str) -> dict[str, object] | None:
    """加载并逐项校验仓内受控的代码同一性变换集清单。

    清单不可读、schema 不符、变换条目不自洽、``transforms_sha256`` 与实测
    规范化指纹不符、执行顺序与登记顺序不符、出现清单外操作或方向时，都返回
    原因而不放行。

    Args:
        path: 变换集清单路径。

    Returns:
        ``(校验通过的清单内容, None)`` 或 ``(None, 拒绝原因)``。
    """

    target = Path(path)
    try:
        raw = target.read_bytes()
    except OSError as error:
        return None, f"代码同一性变换集不可读：{target}（{error.strerror or error}）"
    try:
        document = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        return None, f"代码同一性变换集不是有效 UTF-8 JSON：{target}（{error}）"
    if not isinstance(document, dict):
        return None, "代码同一性变换集必须是结构化对象"
    if document.get("schema") != CODE_IDENTITY_TRANSFORM_SET_SCHEMA:
        return None, f"代码同一性变换集 schema 不是 {CODE_IDENTITY_TRANSFORM_SET_SCHEMA}"
    if document.get("branch") != EVIDENCE_BRANCH_CODE_IDENTITY:
        return None, f"代码同一性变换集的 branch 不是 {EVIDENCE_BRANCH_CODE_IDENTITY}"
    if document.get("route") != CODE_IDENTITY_ROUTE:
        return None, f"代码同一性变换集的 route 不是 {CODE_IDENTITY_ROUTE}"
    if document.get("rules_version") != CODE_IDENTITY_RULES_VERSION:
        return None, f"代码同一性变换集的 rules_version 不是 {CODE_IDENTITY_RULES_VERSION}"
    if document.get("serialization") != CODE_IDENTITY_SERIALIZATION:
        return None, f"代码同一性变换集的 serialization 不是 {CODE_IDENTITY_SERIALIZATION}"
    transforms = document.get("transforms")
    if not isinstance(transforms, list) or not transforms:
        return None, "代码同一性变换集缺少 transforms 数组"
    declared = hashlib.sha256(
        json.dumps(transforms, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    if document.get("transforms_sha256") != declared:
        return None, (
            "代码同一性变换集自述的 transforms_sha256 与实测规范化指纹不符："
            f"清单 {_text(document, 'transforms_sha256') or '空'}，实测 {declared}"
        )
    normalizations = document.get("normalizations")
    if not isinstance(normalizations, list) or len(normalizations) != 1:
        return None, "代码同一性变换集必须逐条登记 normalizations（当前只允许一条空白规范化）"
    normalization = normalizations[0]
    if not isinstance(normalization, dict) or _text(normalization, "id") != CODE_IDENTITY_NORMALIZATION_ID:
        return None, f"代码同一性变换集的规范化标识必须是 {CODE_IDENTITY_NORMALIZATION_ID}"
    if _text(normalization, "name") != CODE_IDENTITY_NORMALIZATION_NAME:
        return None, f"代码同一性变换集的规范化名称必须是 {CODE_IDENTITY_NORMALIZATION_NAME}"
    if not _text(normalization, "definition") or not _text(normalization, "scope"):
        return None, f"{CODE_IDENTITY_NORMALIZATION_ID} 必须同时给出精确定义 definition 与适用范围 scope"
    declared_norm = hashlib.sha256(
        json.dumps(normalizations, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    if document.get("normalizations_sha256") != declared_norm:
        return None, (
            "代码同一性变换集自述的 normalizations_sha256 与实测规范化指纹不符："
            f"清单 {_text(document, 'normalizations_sha256') or '空'}，实测 {declared_norm}"
        )
    comparison_order = [str(item) for item in document.get("comparison_order") or []]
    if comparison_order != [CODE_IDENTITY_NORMALIZATION_ID, *(
        [str(item) for item in document.get("execution_order") or []]
    )]:
        return None, (
            "代码同一性变换集的 comparison_order 必须是"
            f" [{CODE_IDENTITY_NORMALIZATION_ID}, …execution_order]"
        )
    order = [str(item) for item in document.get("execution_order") or []]
    identifiers = [str(_text(item, "id")) for item in transforms if isinstance(item, dict)]
    if order != identifiers:
        return None, (
            "代码同一性变换集的 execution_order 必须与 transforms 的登记顺序逐项一致："
            f"登记 {order}，清单 {identifiers}"
        )
    if len(set(order)) != len(order):
        return None, "代码同一性变换集存在重复的变换标识"
    for transform in transforms:
        identifier = _text(transform, "id")
        if str(transform.get("operation")) not in CODE_IDENTITY_OPERATIONS:
            return None, f"变换 {identifier} 的操作不在已登记范围内：{transform.get('operation')!r}"
        if str(transform.get("direction")) not in CODE_IDENTITY_DIRECTIONS:
            return None, f"变换 {identifier} 的方向不受支持：{transform.get('direction')!r}"
        if not _text(transform, "scope"):
            return None, f"变换 {identifier} 缺少适用范围 scope"
        if not _text(transform, "definition"):
            return None, f"变换 {identifier} 缺少精确定义 definition"
        if str(transform.get("operation")) != "import-group-canonical-sort":
            pairs = transform.get("pairs")
            if not isinstance(pairs, list) or not pairs:
                return None, f"变换 {identifier} 必须逐条登记确切对应关系 pairs"
            for pair in pairs:
                if (
                    not isinstance(pair, list)
                    or len(pair) != 2
                    or not all(isinstance(part, str) and part for part in pair)
                ):
                    return None, f"变换 {identifier} 的对应关系不是“源→目标”字面对：{pair!r}"
    document["file_sha256"] = hashlib.sha256(raw).hexdigest()
    return document, None


# 入口显式指定的变换集位置（由 --code-identity-transform-set 写入，进程内共享）。
_CODE_IDENTITY_TRANSFORM_SET_OVERRIDE: str | None = None


def set_code_identity_transform_set(path: str | Path | None) -> None:
    """登记本次运行显式采用的代码同一性变换集清单路径。

    全部真实消费者（分支入口、暂存、工作区、全量、run_checks 子检查）必须消费
    **同一份**显式变换集契约；清单不存在或不可复算时抛 ``EvidenceError`` 受控失败，
    绝不静默回落到「没有变换」把该分支变成永假。

    Args:
        path: 显式指定的清单路径；``None`` 表示按环境变量与仓内默认位置解析。

    Raises:
        EvidenceError: 显式位置不可读或清单结构/指纹不受支持。
    """

    global _CODE_IDENTITY_TRANSFORM_SET_OVERRIDE
    _CODE_IDENTITY_TRANSFORM_SET_OVERRIDE = str(path) if path is not None else None
    _load_code_identity_transform_set.cache_clear()


def _code_identity_resolve_transform_set(path: str | Path | None = None) -> dict[str, object] | None:
    """按“命令行参数 > 环境变量 > 仓内受控默认清单”解析并校验变换集。

    Args:
        path: ``--code-identity-transform-set`` 指定的清单路径。

    Returns:
        ``(清单内容或 None, 拒绝原因)``。
    """

    if path is not None:
        candidate = Path(path)
    elif _CODE_IDENTITY_TRANSFORM_SET_OVERRIDE:
        candidate = Path(_CODE_IDENTITY_TRANSFORM_SET_OVERRIDE)
    else:
        configured = os.environ.get(CODE_IDENTITY_TRANSFORM_SET_ENV, "").strip()
        candidate = (
            Path(configured)
            if configured
            else _code_identity_implementation_root() / DEFAULT_CODE_IDENTITY_TRANSFORM_SET
        )
    return _load_code_identity_transform_set(str(candidate))


def _code_identity_contract_reasons(
    record: dict[str, object],
    local_path: str,
    local_source: str | None,
    local_sha256: str,
    registry: EvidenceRegistry,
    *,
    root: Path | None = None,
    transform_set_path: Path | None = None,
) -> list[str]:
    """核验 ``E1-code-identity`` 分支：完整非空代码流在登记变换后逐字节相同。

    本函数落实裁决 D16 的严格比较：显式登记的版本化变换集 → 可靠词法 →
    仅作用于代码流 → 保留 import 与字符串内空白的逐字节比较 → 非空且含实际
    声明 → 全部原始差异可归因 → 注释与署名另行校验。**不采信**旧测量口径
    （删除 import、折叠字面量内空白、全文替换），**也不**替代作者/来源验收。

    Args:
        record: 清单记录。
        local_path: 被检查的本地对象路径。
        local_source: 本地对象当前原文；``None`` 时按 ``root`` 读取工作树。
        local_sha256: 当前对象原始字节 SHA-256。
        registry: 受控证据清单。
        root: 读取本地对象与默认变换集的仓库根；默认取本规则实现所在仓库根。
        transform_set_path: 显式指定的变换集清单路径。

    Returns:
        逐项拒绝原因；为空表示代码同一性分支的契约与实测结果全部成立。
    """

    reasons: list[str] = []
    if _text(record, "evidence_route") != CODE_IDENTITY_ROUTE:
        reasons.append(
            f"{EVIDENCE_BRANCH_CODE_IDENTITY} 分支归属路线 2，"
            f"当前 evidence_route={_text(record, 'evidence_route') or '空'}"
        )
    value, error = _json_field(record, "code_identity_contract")
    if value is None:
        return reasons + [f"{EVIDENCE_BRANCH_CODE_IDENTITY} 分支缺少比较契约：{error}"]
    if not isinstance(value, dict):
        return reasons + [f"{EVIDENCE_BRANCH_CODE_IDENTITY} 比较契约必须是结构化对象"]
    contract = value
    if contract.get("schema") != CODE_IDENTITY_SCHEMA:
        reasons.append(f"代码同一性比较契约 schema 不是 {CODE_IDENTITY_SCHEMA}")
    if contract.get("branch") != EVIDENCE_BRANCH_CODE_IDENTITY:
        reasons.append(f"代码同一性比较契约 branch 不是 {EVIDENCE_BRANCH_CODE_IDENTITY}")
    if contract.get("route") != CODE_IDENTITY_ROUTE:
        reasons.append(f"代码同一性比较契约 route 不是 {CODE_IDENTITY_ROUTE}")
    if contract.get("rules_version") != CODE_IDENTITY_RULES_VERSION:
        reasons.append(f"代码同一性比较契约 rules_version 不是 {CODE_IDENTITY_RULES_VERSION}")
    serialization = contract.get("serialization")
    if not isinstance(serialization, dict):
        reasons.append("代码同一性比较契约缺少规范序列化契约 serialization")
    else:
        if serialization.get("version") != CODE_IDENTITY_SERIALIZATION:
            reasons.append(
                f"代码同一性比较契约的 serialization.version 不是 {CODE_IDENTITY_SERIALIZATION}"
            )
        if serialization.get("encoding") != "utf-8":
            reasons.append("代码同一性比较契约的 serialization.encoding 必须是 utf-8")
        if serialization.get("token_separator") != "U+001F":
            reasons.append("代码同一性比较契约的 serialization.token_separator 必须是 U+001F")
        if serialization.get("token_terminator") != "U+001E":
            reasons.append("代码同一性比较契约的 serialization.token_terminator 必须是 U+001E")

    # 变换集：整文件指纹与清单自述指纹双重绑定，任一处被篡改都拒绝。
    transform_set, set_error = _code_identity_resolve_transform_set(transform_set_path)
    if transform_set is None:
        return reasons + [f"代码同一性变换集不可用：{set_error}"]
    declared_set = contract.get("transform_set")
    if not isinstance(declared_set, dict):
        reasons.append("代码同一性比较契约缺少变换集绑定 transform_set")
    else:
        if _text(declared_set, "path") != DEFAULT_CODE_IDENTITY_TRANSFORM_SET:
            reasons.append(
                "代码同一性比较契约的 transform_set.path 必须是仓内受控清单 "
                f"{DEFAULT_CODE_IDENTITY_TRANSFORM_SET}"
            )
        if _text(declared_set, "sha256").lower() != transform_set["file_sha256"]:
            reasons.append(
                "代码同一性变换集被篡改或与记录登记不符："
                f"记录 {_text(declared_set, 'sha256').lower() or '空'}，"
                f"实测 {transform_set['file_sha256']}"
            )
        if _text(declared_set, "transforms_sha256").lower() != _text(transform_set, "transforms_sha256").lower():
            reasons.append(
                "代码同一性变换集登记的 transforms_sha256 与清单自述不符："
                f"记录 {_text(declared_set, 'transforms_sha256').lower() or '空'}，"
                f"清单 {_text(transform_set, 'transforms_sha256').lower() or '空'}"
            )
        if _text(declared_set, "normalizations_sha256").lower() != _text(
            transform_set, "normalizations_sha256"
        ).lower():
            reasons.append(
                "代码同一性变换集登记的 normalizations_sha256 与清单自述不符："
                f"记录 {_text(declared_set, 'normalizations_sha256').lower() or '空'}，"
                f"清单 {_text(transform_set, 'normalizations_sha256').lower() or '空'}"
            )
    registered_order = [str(item) for item in transform_set.get("execution_order") or []]
    applied = [str(item) for item in contract.get("applied_transforms") or []]
    if applied != registered_order:
        reasons.append(
            "代码同一性比较契约的 applied_transforms 必须与受控变换集登记的执行顺序逐项一致："
            f"记录 {applied}，清单 {registered_order}"
        )
    by_id = {str(_text(item, "id")): item for item in transform_set["transforms"]}  # type: ignore[index]
    transforms: list[dict[str, object]] = []
    for identifier in registered_order:
        transform = by_id.get(identifier)
        if transform is None:
            reasons.append(f"代码同一性变换集缺少已登记的变换 {identifier}")
            continue
        transforms.append(transform)
    reasons.extend(_code_identity_attribution_reasons(contract))
    comment_binding_reasons = _code_identity_comment_binding_reasons(contract)
    reasons.extend(comment_binding_reasons)
    reasons.extend(_code_identity_author_handling_reasons(contract, record))

    # 固定输入：本地对象当前原始字节与上游固定提交内容。
    inputs = contract.get("inputs")
    if not isinstance(inputs, dict):
        return reasons + ["代码同一性比较契约缺少固定输入 inputs"]
    local_input = inputs.get("local")
    if not isinstance(local_input, dict):
        reasons.append("代码同一性比较契约缺少本地固定输入 inputs.local")
    else:
        if _text(local_input, "path") != local_path:
            reasons.append("代码同一性比较契约的 inputs.local.path 与被检查对象不一致")
        if _text(local_input, "sha256").lower() != local_sha256:
            reasons.append(
                "代码同一性比较的本地最终指纹不符："
                f"记录 {_text(local_input, 'sha256').lower() or '空'}，实测 {local_sha256}"
            )
    if local_source is None:
        base = root or _code_identity_implementation_root()
        candidate = base / local_path
        try:
            local_text = candidate.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as error:
            return reasons + [f"代码同一性比较的本地对象不可读：{candidate}（{error}）"]
    else:
        local_text = local_source
    reasons.extend(
        _code_identity_comment_unchanged_reasons(contract, local_text)
    )
    upstream_input = inputs.get("upstream")
    if not isinstance(upstream_input, dict):
        return reasons + ["代码同一性比较契约缺少上游固定输入 inputs.upstream"]
    for key, record_key in (
        ("repo_url", "upstream_repo_url"),
        ("commit", "upstream_commit"),
        ("path", "upstream_path"),
        ("sha256", "upstream_sha256"),
        ("file_url", "upstream_file_url"),
    ):
        if _text(upstream_input, key) != _text(record, record_key):
            reasons.append(f"代码同一性比较契约的 inputs.upstream.{key} 与记录登记不一致")
    upstream_sha = _text(record, "upstream_sha256").lower()
    if not SHA256_PATTERN.match(upstream_sha):
        reasons.append(f"{EVIDENCE_BRANCH_CODE_IDENTITY} 分支缺少有效的上游内容 SHA-256")
    upstream_raw, upstream_error = _upstream_bytes_for_contract(registry, record)
    if upstream_error:
        reasons.append(f"代码同一性上游比较输入未通过核验：{upstream_error}")
        return reasons
    assert upstream_raw is not None
    if hashlib.sha256(upstream_raw).hexdigest() != upstream_sha:
        reasons.append("代码同一性上游比较输入的实测指纹与记录登记不符")
        return reasons
    upstream_text = upstream_raw.decode("utf-8-sig", errors="replace")

    local_stream = _code_identity_stream(local_text, transforms, "local")
    upstream_stream = _code_identity_stream(upstream_text, transforms, "upstream")
    for side, stream in (("本地", local_stream), ("上游", upstream_stream)):
        for message in stream["errors"]:  # type: ignore[union-attr]
            reasons.append(f"{side}代码流无法可靠解析，受控拒绝：{message}")
    if local_stream["errors"] or upstream_stream["errors"]:  # type: ignore[index]
        return reasons
    # 完整且非空：代码序列不得为空、不得只剩注释或空白。
    if not local_stream["token_count"]:  # type: ignore[index]
        reasons.append("代码同一性比较的本地代码序列为空（只剩注释或空白），不能据此判派生")
    if not upstream_stream["token_count"]:  # type: ignore[index]
        reasons.append("代码同一性比较的上游代码序列为空（只剩注释或空白），不能据此判派生")
    if not local_stream["serialized"] == upstream_stream["serialized"]:  # type: ignore[index]
        reasons.append(
            "代码同一性比较不成立（变换后逐字节不相等）："
            + _code_identity_first_difference(
                local_stream["tokens"], upstream_stream["tokens"]  # type: ignore[arg-type]
            )
        )
    if local_stream["import_count"] != upstream_stream["import_count"]:  # type: ignore[index]
        reasons.append(
            "代码同一性比较双方 import 条目数不同："
            f"本地 {local_stream['import_count']}，上游 {upstream_stream['import_count']}；"
            "本分支不批准剥离 import（D16 §变换集 T5）"
        )
    comparison = contract.get("comparison")
    if not isinstance(comparison, dict):
        reasons.append("代码同一性比较契约缺少逐项登记的 comparison 读数")
    else:
        if comparison.get("equal") is not True:
            reasons.append("代码同一性比较契约的 comparison.equal 必须为 true")
        if comparison.get("diff_count") != 0:
            reasons.append("代码同一性比较契约的 comparison.diff_count 必须为 0")
        measured = {
            "local_code_stream_sha256": local_stream["sha256"],
            "upstream_code_stream_sha256": upstream_stream["sha256"],
            "local_code_bytes": local_stream["bytes"],
            "upstream_code_bytes": upstream_stream["bytes"],
            "local_token_count": local_stream["token_count"],
            "upstream_token_count": upstream_stream["token_count"],
            "import_count_local": local_stream["import_count"],
            "import_count_upstream": upstream_stream["import_count"],
        }
        for field in CODE_IDENTITY_COMPARISON_FIELDS:
            if comparison.get(field) != measured[field]:
                reasons.append(
                    f"代码同一性比较契约的 comparison.{field} 与实测不符："
                    f"记录 {comparison.get(field)!r}，实测 {measured[field]!r}"
                )
    left_changed, right_changed = _code_identity_diff_lines(local_text, upstream_text)
    if left_changed or right_changed:
        if not _code_identity_attribution_covers(contract, left_changed, right_changed):
            reasons.append(
                "代码同一性的原始差异归因没有覆盖全部实际差异："
                f"实测本地 {left_changed} 行 / 上游 {right_changed} 行"
            )
    tool = contract.get("tool")
    if not isinstance(tool, dict) or not _text(tool, "name"):
        reasons.append("代码同一性比较契约缺少工具名 tool.name")
    else:
        if _text(tool, "version") != CODE_IDENTITY_SCHEMA:
            reasons.append(f"代码同一性比较契约的 tool.version 不是 {CODE_IDENTITY_SCHEMA}")
        checker_sha = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        if _text(tool, "sha256").lower() != checker_sha:
            reasons.append(
                "代码同一性比较契约的 tool.sha256 与当前规则实现不符："
                f"记录 {_text(tool, 'sha256').lower() or '空'}，实测 {checker_sha}"
            )
    review = contract.get("review")
    if not isinstance(review, dict):
        reasons.append("代码同一性比较契约缺少复核记录 review")
    else:
        for field in ("implementer", "reviewer", "date"):
            if not _text(review, field):
                reasons.append(f"代码同一性比较契约缺少 review.{field}")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", _text(review, "date")):
            reasons.append("代码同一性比较契约的 review.date 必须是 YYYY-MM-DD")
        if not _text(review, "conclusion"):
            reasons.append("代码同一性比较契约缺少 review.conclusion")
    if not _text(contract, "counter_evidence_conclusion"):
        reasons.append("代码同一性比较契约缺少反证结论 counter_evidence_conclusion")
    return reasons


def _code_identity_attribution_covers(
    contract: dict[str, object], left_changed: int, right_changed: int
) -> bool:
    """判断逐处归因是否恰好覆盖全部原始差异行数。"""

    attribution = contract.get("difference_attribution")
    if not isinstance(attribution, list) or not attribution:
        return False
    total_local = total_upstream = 0
    for entry in attribution:
        if not isinstance(entry, dict):
            return False
        changed = entry.get("changed_lines")
        if (
            not isinstance(changed, dict)
            or not isinstance(changed.get("local"), int)
            or not isinstance(changed.get("upstream"), int)
        ):
            return False
        total_local += int(changed["local"])
        total_upstream += int(changed["upstream"])
    return (total_local, total_upstream) == (left_changed, right_changed)


def _code_identity_comment_unchanged_reasons(
    contract: dict[str, object], local_text: str
) -> list[str]:
    """实测核对本地职责 JavaDoc / D12 来源说明 / D15 标注**保持不变**。

    “代码同一”只覆盖代码流；注释与署名不因此获得豁免（D16 §86）。本函数按
    契约登记的行区间取本地真实注释原文逐字比对，指纹或原文不符即拒绝。

    Args:
        contract: 记录声明的代码同一性比较契约。
        local_text: 本地对象当前原文。

    Returns:
        逐项拒绝原因；为空表示全部登记注释与本地实际注释逐字一致。
    """

    reasons: list[str] = []
    bindings = contract.get("comment_bindings")
    if not isinstance(bindings, list):
        return reasons
    lines = local_text.split("\n")
    for entry in bindings:
        if not isinstance(entry, dict):
            continue
        span = entry.get("lines")
        if (
            not isinstance(span, list)
            or len(span) != 2
            or not all(isinstance(item, int) and item > 0 for item in span)
            or span[0] > span[1]
        ):
            continue
        start, end = int(span[0]), int(span[1])
        if end > len(lines):
            reasons.append(
                f"代码同一性注释绑定 {entry.get('role')!r} 的行区间 {start}-{end} 超出本地对象范围"
            )
            continue
        verbatim = "\n".join(lines[start - 1 : end])
        # 逐字原文必须按原字符序列比较，不能先 strip 再比（D13 同一口径）。
        recorded = _raw_text(entry, "text")
        measured = hashlib.sha256(verbatim.encode("utf-8")).hexdigest()
        if _text(entry, "sha256").lower() != measured:
            reasons.append(
                f"代码同一性注释绑定 {entry.get('role')!r}（第 {start}-{end} 行）"
                f"与本地实际注释不符：记录 {_text(entry, 'sha256').lower() or '空'}，实测 {measured}"
            )
        if recorded and recorded != verbatim:
            reasons.append(
                f"代码同一性注释绑定 {entry.get('role')!r}（第 {start}-{end} 行）"
                f"登记的逐字原文与本地实际注释不符：记录 {recorded!r}，实测 {verbatim!r}"
            )
    return reasons


def _code_identity_attribution_reasons(contract: dict[str, object]) -> list[str]:
    """校验逐处原始差异归因的形状（覆盖计数在比较后按实测核对）。"""

    reasons: list[str] = []
    attribution = contract.get("difference_attribution")
    if not isinstance(attribution, list) or not attribution:
        return ["代码同一性比较契约必须逐处登记原始差异归因 difference_attribution"]
    for entry in attribution:
        if not isinstance(entry, dict):
            reasons.append(f"代码同一性归因记录不是结构化对象：{entry!r}")
            continue
        cause = _text(entry, "cause")
        if cause not in CODE_IDENTITY_ATTRIBUTION_CAUSES:
            reasons.append(f"代码同一性归因记录的 cause 不受支持：{cause!r}")
        if cause == "registered-transform" and not _text(entry, "rule"):
            reasons.append("代码同一性归因为获准变换时必须指明具体规则 rule（变换标识）")
        changed = entry.get("changed_lines")
        if (
            not isinstance(changed, dict)
            or not isinstance(changed.get("local"), int)
            or not isinstance(changed.get("upstream"), int)
            or int(changed["local"]) < 0
            or int(changed["upstream"]) < 0
        ):
            reasons.append(f"代码同一性归因记录缺少 changed_lines.local/upstream：{entry!r}")
    return reasons


def _code_identity_comment_binding_reasons(contract: dict[str, object]) -> list[str]:
    """要求“代码同一”不覆盖注释与署名：注释角色必须逐条登记且保持不变。

    登记本身只是形状校验；逐条“保持不变”的实测比对在
    ``_code_identity_contract_reasons`` 中按本地对象真实注释文本完成。

    """

    reasons: list[str] = []
    bindings = contract.get("comment_bindings")
    if not isinstance(bindings, list) or not bindings:
        return ["代码同一性比较契约必须单独登记 comment_bindings（职责 JavaDoc/D12 来源说明/D15 标注）"]
    for entry in bindings:
        if not isinstance(entry, dict):
            reasons.append(f"代码同一性注释绑定不是结构化对象：{entry!r}")
            continue
        if _text(entry, "role") not in CODE_IDENTITY_COMMENT_ROLES:
            reasons.append(f"代码同一性注释绑定的 role 不受支持：{_text(entry, 'role')!r}")
        if not SHA256_PATTERN.match(_text(entry, "sha256").lower()):
            reasons.append(f"代码同一性注释绑定缺少有效 SHA-256：{entry!r}")
        lines = entry.get("lines")
        if (
            not isinstance(lines, list)
            or len(lines) != 2
            or not all(isinstance(item, int) and item > 0 for item in lines)
            or lines[0] > lines[1]
        ):
            reasons.append(f"代码同一性注释绑定的 lines 必须是递增的正整数行区间：{entry!r}")
        if not _text(entry, "text"):
            reasons.append(f"代码同一性注释绑定缺少逐字原文 text：{entry!r}")
    return reasons


def _code_identity_author_handling_reasons(
    contract: dict[str, object], record: dict[str, object]
) -> list[str]:
    """要求作者/来源另行验收：代码同一性不得当作署名通过依据。"""

    reasons: list[str] = []
    handling = contract.get("author_handling")
    if not isinstance(handling, dict):
        return ["代码同一性比较契约缺少 author_handling（代码同一不覆盖作者与来源验收）"]
    if handling.get("code_identity_accepts_signature") is not False:
        reasons.append("代码同一性比较契约必须显式登记 code_identity_accepts_signature=false")
    if not _text(handling, "declared_author_status"):
        reasons.append("代码同一性比较契约缺少现存署名形态声明 declared_author_status")
    if not _text(handling, "author_route"):
        reasons.append("代码同一性比较契约缺少作者/来源各自的验收路径 author_route")
    if not _text(record, "author_status"):
        reasons.append("清单缺少 author_status，代码同一性不替代作者判断")
    return reasons


def _type_evidence_value(
    record: dict[str, object],
) -> tuple[dict[str, object] | None, str | None]:
    """读取清单记录的逐类型映射，并校验其 schema 版本。"""

    raw = record.get("type_evidence")
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None, "清单缺少逐类型映射（type_evidence），不能凭文件名授权文件内所有类型"
    if isinstance(raw, str):
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            return None, "清单的 type_evidence 不是有效 JSON"
    else:
        value = raw
    if not isinstance(value, dict):
        return None, "清单的 type_evidence 必须是结构化对象"
    if value.get("schema") != EVIDENCE_SCHEMA:
        return None, f"逐类型映射 schema 不是 {EVIDENCE_SCHEMA}"
    if not isinstance(value.get("types"), list):
        return None, "逐类型映射缺少 types 数组"
    return value, None


def _review_conclusion_reason(conclusion: str, subject: str) -> str | None:
    """判断逐项复核结论是否指向被复核对象且给出了独立结论。"""

    if not conclusion:
        return "清单缺少逐项复核结论"
    if subject and subject not in conclusion:
        return f"逐项复核结论没有指向被复核对象 {subject}，不能只写跨字段引用"
    stripped = REVIEW_CROSS_REFERENCE_PATTERN.sub("", conclusion)
    stripped = re.sub(r"[\s，。；、：:（）()【】\[\]的以及和与]", "", stripped)
    if len(stripped) < 6:
        return f"逐项复核结论只指向其他字段，未给出独立结论：{conclusion!r}"
    return None


def _review_reasons(record: dict[str, object], subject: str) -> list[str]:
    """校验逐项复核人、复核日期与复核结论。"""

    reasons = []
    if not _text(record, "review_by"):
        reasons.append("清单缺少逐项复核人 review_by")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", _text(record, "review_date")):
        reasons.append("清单缺少逐项复核日期 review_date（YYYY-MM-DD）")
    conclusion_reason = _review_conclusion_reason(_text(record, "review_conclusion"), subject)
    if conclusion_reason:
        reasons.append(conclusion_reason)
    return reasons


def _upstream_binding_reasons(record: dict[str, object], note: SourceNote) -> list[str]:
    """校验来源说明与清单登记的上游仓库、提交、路径和作者结论一致。"""

    reasons = []
    repository = _repository_identifier(_text(record, "upstream_repo_url"))
    if repository is None:
        reasons.append("清单缺少可解析的上游仓库 URL")
    elif repository != note.repository:
        reasons.append(f"来源仓库标识与清单不一致：注释 {note.repository}，清单 {repository}")
    commit = _text(record, "upstream_commit")
    if not COMMIT_PATTERN.match(commit):
        reasons.append("清单的上游提交不是完整 40 位小写 SHA")
    elif commit != note.commit:
        reasons.append(f"固定提交与清单不一致：注释 {note.commit}，清单 {commit}")
    upstream_path = _raw_text(record, "upstream_path")
    if upstream_path != note.upstream_path:
        reasons.append(
            f"上游文件路径与清单不一致：注释 {note.upstream_path}，清单 {upstream_path or '空'}"
        )
    author_lines = _text(record, "upstream_author_lines")
    if author_lines:
        reasons.append(f"清单登记上游存在作者声明，必须保留作者：{author_lines}")
    return reasons


def _history_reasons(
    record: dict[str, object], note: SourceNote, registry: EvidenceRegistry
) -> list[str]:
    """校验来源依据行与清单登记的历史见证或引入版本记录一致。"""

    if note.basis == SOURCE_BASIS_FIXED:
        reasons = []
        if not _text(record, "history_basis"):
            reasons.append("清单缺少 history_basis 见证与引入版本的关系")
        if not _text(record, "open_gap"):
            reasons.append("固定见证版本路径必须在清单 open_gap 登记历史引入版本缺口")
        return reasons
    value, error = _type_evidence_value(record)
    if value is None:
        return [f"来源依据写成已核实引入版本，但{error}"]
    history = value.get("history")
    if not isinstance(history, dict) or history.get("basis") != EVIDENCE_HISTORY_BASIS:
        return ["来源依据写成已核实引入版本，但清单没有绑定已核实的引入版本记录"]
    reasons = []
    commit = _text(history, "introduced_commit")
    if not COMMIT_PATTERN.match(commit):
        return ["引入版本提交必须是完整 40 位小写 SHA"]
    if _repository_identifier(_text(history, "introduced_repo_url")) != note.repository:
        reasons.append("引入版本仓库与来源说明的仓库标识不一致")
    upstream_path = _text(history, "introduced_path")
    if not _is_safe_upstream_path(upstream_path):
        return reasons + ["引入版本路径不是有效的上游仓库相对路径"]
    digest = _text(history, "introduced_sha256").lower()
    if not SHA256_PATTERN.match(digest):
        return reasons + ["引入版本缺少有效的内容 SHA-256"]
    snapshot_reason, _ = _verify_upstream_snapshot(
        registry,
        repository=note.repository,
        commit=commit,
        upstream_path=upstream_path,
        expected_sha256=digest,
        file_url=_text(history, "file_url"),
    )
    if snapshot_reason:
        reasons.append(f"引入版本快照未通过核验：{snapshot_reason}")
    return reasons


def _branch_route_reasons(record: dict[str, object]) -> list[str]:
    """校验记录显式声明的证据分支是否归属到契约规定的证据路线。

    分支是版本化契约的启用开关：``E1-author-only`` 只允许归属路线 2，
    ``C2-independent-content`` 只允许归属路线 3。未声明分支的记录返回空列表，
    由调用方沿用既有“原有充分路线”结构校验，本函数不改判任何已有条目。
    分支入口（``_validate_declared_branches``）与来源说明入口（``_route_reasons``）
    共用本函数，保证两个入口对同一异常给出同一诊断。

    Args:
        record: 清单记录。

    Returns:
        逐项拒绝原因；为空表示路线取值受支持且归属正确。
    """

    route = _text(record, "evidence_route")
    if route not in EVIDENCE_ROUTES:
        return [f"证据路线不受支持：{route or '空'}"]
    branch, branch_error = _evidence_branch(record)
    if branch_error:
        return [branch_error]
    expected = EVIDENCE_BRANCH_ROUTES.get(branch or "")
    if expected is None or route == expected:
        return []
    return [f"{branch} 分支归属{expected}，当前 evidence_route={route}"]


def _route_reasons(record: dict[str, object]) -> list[str]:
    """校验证据路线取值与路线 3 的独立对应点结构。

    Note:
        记录显式声明的分支优先：``E1-author-only`` 必须归属路线 2（比较契约由
        ``_author_only_contract_reasons`` 复算），``C2-independent-content`` 必须归属
        路线 3 并按内容点独立门槛校验。未声明分支的记录沿用既有“原有充分路线”结构校验，
        本函数不改判任何已有条目。机器校验只能确认结构与可判定的不合格形状，
        有区分力的对应与身份贡献仍需人工判断。
    """

    branch_route_reasons = _branch_route_reasons(record)
    if branch_route_reasons:
        return branch_route_reasons
    branch, _ = _evidence_branch(record)
    if branch == EVIDENCE_BRANCH_AUTHOR_ONLY:
        return []
    if branch == EVIDENCE_BRANCH_CODE_IDENTITY:
        # 裁决 D16 §120：代码同一性作为 D10 路线 2 的局部补充分支，完整比较
        # 契约由 _code_identity_contract_reasons 复算；不改变 C2 的路线 3 门槛。
        return []
    if branch == EVIDENCE_BRANCH_CONTENT_INDEPENDENT:
        return _content_independent_reasons(record)
    points = _text(record, "evidence_points")
    if not points:
        return ["缺少 evidence_points 比对依据"]
    if _text(record, "evidence_route") == CONTENT_INDEPENDENT_ROUTE:
        segments = [segment.strip() for segment in re.split(r"[；;]", points) if segment.strip()]
        if len(segments) < 2 or len(set(segments)) < 2:
            return ["路线 3 的 evidence_points 必须有两个独立且有区分力的对应点"]
        if not all(len(re.findall(r"\d+", segment)) >= 2 for segment in segments):
            return ["路线 3 的每个对应点都必须给出双方行号"]
    return []


def _type_mapping_reasons(
    record: dict[str, object],
    declaration: TypeDeclaration,
    javadoc: str,
    qualified_name: str,
    enclosing_type: str | None,
) -> list[str]:
    """校验逐类型映射：限定名、嵌套关系、绑定 JavaDoc 与上游类型。"""

    value, error = _type_evidence_value(record)
    if value is None:
        return [str(error)]
    entry = None
    for candidate in value["types"]:  # type: ignore[union-attr]
        if not isinstance(candidate, dict):
            continue
        if candidate.get("qualified_name") != qualified_name:
            continue
        if bool(candidate.get("nested")) != bool(enclosing_type):
            continue
        if candidate.get("simple_name") not in (None, declaration.name):
            continue
        if candidate.get("kind") not in (None, declaration.kind):
            continue
        entry = candidate
        break
    if entry is None:
        return [f"逐类型映射中没有 {qualified_name} 的条目，目标类型没有对象级授权"]
    reasons = []
    if entry.get("upstream_author_declared") is not False:
        reasons.append(f"逐类型映射没有确认上游对应内容未声明作者：{qualified_name}")
    recorded_javadoc = _text(entry, "javadoc_sha256").lower()
    if not SHA256_PATTERN.match(recorded_javadoc):
        reasons.append("逐类型映射缺少绑定 JavaDoc 的 SHA-256")
    elif recorded_javadoc != hashlib.sha256(javadoc.encode("utf-8")).hexdigest():
        reasons.append("绑定 JavaDoc 指纹不符，来源说明必须由清单绑定当前类型的 JavaDoc")
    if enclosing_type is not None and _text(entry, "enclosing_type") != enclosing_type:
        reasons.append(f"逐类型映射的外层类型不是 {enclosing_type}")
    if not _text(entry, "upstream_type"):
        reasons.append("逐类型映射缺少上游类型或片段")
    reasons.extend(_review_reasons(entry, declaration.name))
    return reasons


def _local_modification_reasons(record: dict[str, object], note: SourceNote) -> list[str]:
    """校验本地修改行与清单记录的实际差异一致。"""

    facts = _text(record, "local_modification_facts")
    if facts.rstrip("。").casefold() in LOCAL_MODIFICATION_NONE_MARKERS:
        if note.local_modification.strip() != LOCAL_MODIFICATION_NONE_LINE:
            return [
                "清单记录该文件相对来源没有本地修改，本地修改行必须写"
                f"“{LOCAL_MODIFICATION_NONE_LINE}”：{note.local_modification!r}"
            ]
        return []
    if note.local_modification.rstrip("。").casefold() in LOCAL_MODIFICATION_NONE_MARKERS:
        return ["清单记录了实际本地修改，本地修改行不能写“无。”"]
    if len(note.local_modification) < 4:
        return [f"本地修改行缺少实际差异说明：{note.local_modification!r}"]
    return []


def _record_sources(
    record: dict[str, object],
) -> tuple[list[dict[str, object]] | None, str | None]:
    """读取清单记录的多来源登记。

    Returns:
        ``(来源条目列表或 None, 错误说明)``；没有 ``sources`` 扩展时返回 ``None``，
        表示按记录的单来源字段核验。
    """

    raw = record.get("type_evidence")
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None, None
    if isinstance(raw, str):
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            return None, None
    else:
        value = raw
    if not isinstance(value, dict) or "sources" not in value:
        return None, None
    sources = value.get("sources")
    if (
        not isinstance(sources, list)
        or not sources
        or not all(isinstance(item, dict) for item in sources)
    ):
        return None, "清单的多来源登记（sources）必须是至少一条结构化记录"
    return sources, None


def _source_entry_matches(entry: dict[str, object], note: SourceNote) -> bool:
    """判断多来源登记条目是否与来源说明块指向同一固定版本。"""

    return (
        _text(entry, "repository") == note.repository
        and _text(entry, "commit") == note.commit
        and _raw_text(entry, "path") == note.upstream_path
    )


def _source_entry_reasons(
    entry: dict[str, object], note: SourceNote, registry: EvidenceRegistry
) -> list[str]:
    """核验多来源登记条目的无作者结论与快照指纹。"""

    reasons = []
    if entry.get("author_declared") is not False:
        reasons.append(f"多来源登记未确认 {note.repository} 该固定版本未声明作者")
    digest = _text(entry, "sha256").lower()
    if not SHA256_PATTERN.match(digest):
        return reasons + [f"多来源登记缺少 {note.upstream_path} 的内容 SHA-256"]
    snapshot_reason, _ = _verify_upstream_snapshot(
        registry,
        repository=note.repository,
        commit=note.commit,
        upstream_path=note.upstream_path,
        expected_sha256=digest,
        file_url=_text(entry, "file_url"),
    )
    if snapshot_reason:
        reasons.append(snapshot_reason)
    return reasons


def _declared_author_sources(sources: list[dict[str, object]]) -> list[str]:
    """列出多来源登记中已声明作者的来源，供保留作者判断。"""

    return [
        f"{_text(entry, 'repository')} @ {_text(entry, 'commit')} {_text(entry, 'path')}"
        for entry in sources
        if entry.get("author_declared") is True
    ]


def _source_review_markers(javadoc: str) -> list[str]:
    """读取文件内来源说明的机读验收标注行。

    标注行在 JavaDoc 正文中独占一行：``来源验收：已验收`` 或 ``来源验收：尚未验收``。
    只识别完整取值；出现其他 ``来源验收：`` 取值时返回未知标注，由调用方拒绝。

    Args:
        javadoc: 完整 JavaDoc 文本。

    Returns:
        正文中出现的 ``来源验收：`` 标注行列表（按出现顺序）。
    """

    return [
        line.strip()
        for line in _javadoc_body_lines(javadoc)
        if line.strip().startswith(SOURCE_REVIEW_PREFIX)
    ]


def _signature_review_markers(javadoc: str) -> list[str]:
    """读取作者标签形态的就地署名验收标注行（裁决 D15 §128）。

    标注行在 JavaDoc 正文中独占一行：``署名验收：已验收`` 或 ``署名验收：尚未验收``。
    标注不能写进 ``@author`` 取值，只识别完整取值；其他取值返回未知标注由调用方拒绝。

    Args:
        javadoc: 完整 JavaDoc 文本。

    Returns:
        正文中出现的 ``署名验收：`` 标注行列表（按出现顺序）。
    """

    return [
        line.strip()
        for line in _javadoc_body_lines(javadoc)
        if line.strip().startswith(SIGNATURE_REVIEW_PREFIX)
    ]


def _acceptance_marker_reasons(
    javadoc: str, form: str, accepted: bool
) -> list[str]:
    """核验就地验收标注与索引状态相符（裁决 D15 §72/§128）。

    未验收来源说明必须在正文中具有且仅具有一条与索引相符的 ``来源验收：尚未验收``；
    作者标签形态使用独立的 ``署名验收：`` 标注。无标注、重复、冲突、未知取值或与索引
    状态不符（含自称已验收）一律硬失败——既不能进入维护完成态，也不能作为已验收通过。
    已验收来源说明沿用既有行为：标注可选，出现时必须是 ``来源验收：已验收``。

    Args:
        javadoc: 绑定该类型的完整 JavaDoc 文本。
        form: 标注形态，来源说明或作者标签。
        accepted: 索引判词是否已验收。

    Returns:
        逐项硬失败原因；为空表示标注满足与索引共同约束。
    """

    if form == ACCEPTANCE_FORM_SOURCE_NOTE:
        markers = _source_review_markers(javadoc)
        expected = (
            SOURCE_REVIEW_ACCEPTED_MARKER if accepted else SOURCE_REVIEW_UNACCEPTED_MARKER
        )
    else:
        markers = _signature_review_markers(javadoc)
        expected = (
            SIGNATURE_REVIEW_ACCEPTED_MARKER if accepted else SIGNATURE_REVIEW_UNACCEPTED_MARKER
        )
    if not markers:
        if accepted:
            # 已验收条目（含独立 A1 分支）沿用既有行为：标注可选；缺标注不等于未验收，
            # 但一旦写了标注就必须与索引状态相符，不能两处互相矛盾。
            return []
        return [
            f"文件内{form}缺少就地验收标注（应恰好一条“{expected}”）："
            "缺标注不能进入维护完成态，也不能作为已验收通过"
        ]
    if len(markers) > 1:
        return [f"文件内{form}的验收标注重复或冲突：{'、'.join(markers)}"]
    marker = markers[0]
    if marker not in (
        SOURCE_REVIEW_MARKERS if form == ACCEPTANCE_FORM_SOURCE_NOTE else SIGNATURE_REVIEW_MARKERS
    ):
        return [f"文件内{form}的验收标注取值不受支持：{marker!r}"]
    if marker != expected:
        return [
            f"文件内{form}的验收标注“{marker}”与索引验收状态不符（应为“{expected}”）"
        ]
    return []


def _index_verdict(record: dict[str, object]) -> str:
    """读取索引的验收判词；字段缺失或为空时返回空串。"""

    return _text(record, SOURCE_NOTE_VERDICT_FIELD)


def _registration_reasons(record: dict[str, object], subject: str) -> list[str]:
    """核验未验收记录的登记完整性，不要求补齐内容点（裁决 D15 §72）。

    裁决要求“索引、对象、保留文本、状态及最终版本必须能核对”，并且明确已经登记为
    未验收的记录不再要求补齐恰好缺失的内容点才能纳管。因此本函数只检查状态类字段、
    上游绑定与逐项复核记录是否完整，不重复判定证据是否充分——证据不足本身就是这条
    记录被登记为阻断的原因，不能用“未验收”让登记缺失或绑定失效一并消失。

    Args:
        record: 清单记录。
        subject: 被登记对象名，要求复核结论指向它。

    Returns:
        登记完整性硬失败原因；为空表示可以进入已登记阻断集合。
    """

    reasons: list[str] = []
    if not _text(record, SOURCE_NOTE_BLOCKER_FIELD):
        reasons.append(
            f"清单缺少 {SOURCE_NOTE_BLOCKER_FIELD} 阻断原因，未登记缺口不能算已登记阻断"
        )
    if not _text(record, "open_gap"):
        reasons.append("清单缺少 open_gap 缺口登记，未登记缺口不能算已登记阻断")
    if not COMMIT_PATTERN.match(_text(record, "upstream_commit")):
        reasons.append("清单缺少有效的上游固定提交，保留文本无法核对")
    if not SHA256_PATTERN.match(_text(record, "upstream_sha256").lower()):
        reasons.append("清单缺少有效的上游内容 SHA-256，保留文本无法核对")
    reasons.extend(_review_reasons(record, subject))
    return reasons


def _source_acceptance_reasons(
    record: dict[str, object], javadoc: str, registry: EvidenceRegistry
) -> list[str]:
    """消费索引的验收状态：未验收的记录不得在来源说明路径通过。

    裁决 D14 §120 要求已经写入的来源说明在补证期间标明尚未验收、不得进入“证据充分”的
    交付范围；§132 要求逐项判断落到记录；D15 §72 补充正文必须具有且仅具有一条与索引相符
    的 ``来源验收：尚未验收``，无标注、重复/冲突标注、未知值或自称已验收均硬失败。

    Args:
        record: 清单记录。
        javadoc: 绑定该类型的完整 JavaDoc 文本。
        registry: 受控证据清单。

    Returns:
        逐项拒绝原因；为空表示验收状态允许该来源说明通过。
    """

    if not registry.requires_acceptance_state:
        return []
    verdict = _index_verdict(record)
    if not verdict:
        return [
            f"清单索引缺少 {SOURCE_NOTE_VERDICT_FIELD} 验收状态，来源说明没有验收依据"
        ]
    accepted = verdict in SOURCE_NOTE_ACCEPTED_VERDICTS
    reasons = _acceptance_marker_reasons(javadoc, ACCEPTANCE_FORM_SOURCE_NOTE, accepted)
    if accepted:
        return reasons
    reason = (
        f"清单索引验收状态为“{verdict}”，尚未验收，来源说明不得作为证据充分通过"
    )
    blocker = _text(record, SOURCE_NOTE_BLOCKER_FIELD)
    if blocker:
        reason += f"（阻断原因：{blocker[:120]}）"
    reasons.append(reason)
    return reasons


def _type_object_binding_reasons(
    record: dict[str, object],
    declaration: TypeDeclaration,
    javadoc: str,
    qualified_name: str,
    enclosing_type: str | None,
) -> list[str]:
    """校验对象级绑定：限定名、嵌套关系与绑定 JavaDoc 指纹（裁决 D15 §72）。

    与来源说明路径的 ``_type_mapping_reasons`` 相比，本函数不要求“上游未声明作者”，
    因为作者标签形态（含 A1 分支）的上游版本可能确实声明了作者；对象与 JavaDoc 的
    绑定强度不变，任何未修改的清单或快照都不能让失效绑定通过。

    Args:
        record: 清单记录。
        declaration: 当前 public 类型声明。
        javadoc: 绑定该类型的完整 JavaDoc 文本。
        qualified_name: 含外层类型链的类型限定名。
        enclosing_type: 外层类型限定名；顶层类型为 ``None``。

    Returns:
        对象级硬失败原因；为空表示对象与 JavaDoc 绑定成立。
    """

    value, error = _type_evidence_value(record)
    if value is None:
        return [str(error)]
    entry = None
    for candidate in value["types"]:  # type: ignore[union-attr]
        if not isinstance(candidate, dict):
            continue
        if candidate.get("qualified_name") != qualified_name:
            continue
        if bool(candidate.get("nested")) != bool(enclosing_type):
            continue
        if candidate.get("simple_name") not in (None, declaration.name):
            continue
        if candidate.get("kind") not in (None, declaration.kind):
            continue
        entry = candidate
        break
    if entry is None:
        return [f"逐类型映射中没有 {qualified_name} 的条目，目标类型没有对象级授权"]
    reasons: list[str] = []
    recorded_javadoc = _text(entry, "javadoc_sha256").lower()
    if not SHA256_PATTERN.match(recorded_javadoc):
        reasons.append("逐类型映射缺少绑定 JavaDoc 的 SHA-256")
    elif recorded_javadoc != hashlib.sha256(javadoc.encode("utf-8")).hexdigest():
        reasons.append("绑定 JavaDoc 指纹不符，来源说明必须由清单绑定当前类型的 JavaDoc")
    if enclosing_type is not None and _text(entry, "enclosing_type") != enclosing_type:
        reasons.append(f"逐类型映射的外层类型不是 {enclosing_type}")
    if not _text(entry, "upstream_type"):
        reasons.append("逐类型映射缺少上游类型或片段")
    return reasons


def _final_version_reasons(record: dict[str, object], local_sha256: str | None) -> list[str]:
    """校验索引登记的本地最终指纹与当前对象原始字节一致（裁决 D15 §72）。"""

    recorded_local = _text(record, "local_sha256_after").lower()
    if not SHA256_PATTERN.match(recorded_local):
        return ["清单缺少有效的本地最终 SHA-256"]
    if local_sha256 is None:
        return ["当前对象没有可核验的原始字节指纹"]
    if recorded_local != local_sha256:
        return [f"本地最终指纹不符：清单 {recorded_local}，实测 {local_sha256}"]
    return []


def _registered_binding_reasons(
    path: str,
    record: dict[str, object],
    declaration: TypeDeclaration,
    javadoc: str,
    note: SourceNote | None,
    qualified_name: str,
    enclosing_type: str | None,
    registry: EvidenceRegistry,
    local_sha256: str | None,
) -> list[str]:
    """核验已登记阻断的对象、保留文本与最终版本绑定（裁决 D15 §72）。

    只有登记完整且对象、保留文本、状态、最终版本都能核对的条目才允许进入独立阻断集合；
    内容点是否足够不在本函数内判定——证据不足本身就是登记阻断的原因，登记缺失或绑定
    失效则不能借“未验收”一并豁免。

    Args:
        path: 仓库相对路径。
        record: 清单记录。
        declaration: 当前 public 类型声明。
        javadoc: 绑定该类型的完整 JavaDoc 文本。
        note: 来源说明；作者标签形态为 ``None``。
        qualified_name: 含外层类型链的类型限定名。
        enclosing_type: 外层类型限定名；顶层类型为 ``None``。
        registry: 受控证据清单。
        local_sha256: 当前对象原始字节的 SHA-256。

    Returns:
        绑定类硬失败原因；为空表示可以进入已登记阻断集合。
    """

    if path in registry.unparsable:
        return [f"清单记录字段数与表头不一致，无法逐项核验：{path}"]
    reasons = _final_version_reasons(record, local_sha256)
    if note is None:
        reasons.extend(
            _type_object_binding_reasons(
                record, declaration, javadoc, qualified_name, enclosing_type
            )
        )
        return reasons
    status = _text(record, "author_status")
    if status != AUTHOR_UNDECLARED_STATUS:
        reasons.append(f"清单状态是“{status or '空'}”，不是“{AUTHOR_UNDECLARED_STATUS}”")
    reasons.extend(
        _type_mapping_reasons(record, declaration, javadoc, qualified_name, enclosing_type)
    )
    reasons.extend(_history_reasons(record, note, registry))
    reasons.extend(_upstream_binding_reasons(record, note))
    reasons.extend(_local_modification_reasons(record, note))
    return reasons


def _acceptance_state(
    path: str,
    record: dict[str, object],
    declaration: TypeDeclaration,
    javadoc: str,
    notes: list[SourceNote],
    qualified_name: str,
    enclosing_type: str | None,
    registry: EvidenceRegistry,
    local_sha256: str | None,
    line: int,
    finding_reasons: list[str],
    local_source: str | None = None,
) -> AcceptanceState:
    """计算单条索引记录的逐项验收状态（裁决 D15 §65/§66/§72/§128）。

    来源说明形态与作者标签形态走同一入口：已验收、已登记阻断与硬失败分别落到
    ``classification``，因此 33 条只有 ``@author`` 的原阻断项不会再从汇总里消失。
    未验收条目只有在登记完整（阻断原因、缺口、复核、保留文本、最终版本、对象绑定）
    且就地标注与索引相符时才进入独立阻断集合；其余一律硬失败。

    Args:
        path: 仓库相对路径。
        record: 清单记录。
        declaration: 当前 public 类型声明。
        javadoc: 绑定该类型的完整 JavaDoc 文本。
        notes: 已解析的来源说明列表。
        qualified_name: 含外层类型链的类型限定名。
        enclosing_type: 外层类型限定名；顶层类型为 ``None``。
        registry: 受控证据清单。
        local_sha256: 当前对象原始字节的 SHA-256。
        line: 当前源码中的声明行号。
        finding_reasons: 该类型在既有消费者中已产生的拒绝原因。
        local_source: 当前对象原文；声明 ``E1-code-identity`` 时用于严格代码比较，
            省略时按规则实现所在仓库根读取工作树。

    Returns:
        该记录的逐项验收状态。
    """

    verdict = _index_verdict(record)
    form = ACCEPTANCE_FORM_SOURCE_NOTE if notes else ACCEPTANCE_FORM_AUTHOR_TAG
    accepted_verdicts = (
        SOURCE_NOTE_ACCEPTED_VERDICTS if notes else AUTHOR_TAG_ACCEPTED_VERDICTS
    )
    accepted = bool(verdict) and verdict in accepted_verdicts
    reasons: list[str] = []
    classification = ACCEPTANCE_STATE_HARD_FAILURE
    if not verdict:
        reasons.append(
            f"清单索引缺少 {SOURCE_NOTE_VERDICT_FIELD} 验收状态，验收状态不得省略"
        )
    elif accepted:
        reasons.extend(_acceptance_marker_reasons(javadoc, form, True))
        if notes:
            # 来源说明形态的已验收分支沿用来源说明路径的完整逐项核验结论。
            reasons.extend(finding_reasons)
        else:
            reasons.extend(_final_version_reasons(record, local_sha256))
            reasons.extend(
                _type_object_binding_reasons(
                    record, declaration, javadoc, qualified_name, enclosing_type
                )
            )
            # 作者标签形态的已验收结论必须有独立的版本化分支契约：只把判词写成
            # A1 而不给逐项比较证据，等于只认状态值，必须硬失败。
            branch, branch_error = _evidence_branch(record)
            if branch_error:
                reasons.append(branch_error)
            elif branch not in {EVIDENCE_BRANCH_AUTHOR_ONLY, EVIDENCE_BRANCH_CODE_IDENTITY}:
                reasons.append(
                    "作者标签形态的已验收记录必须显式声明 "
                    f"{EVIDENCE_BRANCH_AUTHOR_ONLY} 分支与比较契约"
                )
            elif branch == EVIDENCE_BRANCH_CODE_IDENTITY:
                # 裁决 D16 §86/§101：代码同一性不覆盖署名。作者标签形态仍须按
                # D10/D12 的作者条件独立验收，不能借代码相同放行未核实的署名。
                reasons.extend(
                    _code_identity_contract_reasons(
                        record,
                        path,
                        local_source,
                        local_sha256 or "",
                        registry,
                    )
                )
                reasons.append(
                    "代码同一性不覆盖作者与署名验收：作者标签形态仍须声明 "
                    f"{EVIDENCE_BRANCH_AUTHOR_ONLY} 分支并按 D10/D12 各自条件验收"
                )
            else:
                reasons.extend(
                    _author_only_contract_reasons(
                        record,
                        path,
                        _text(record, "local_sha256_after").lower(),
                        registry,
                    )
                )
        if not reasons:
            classification = ACCEPTANCE_STATE_ACCEPTED
    else:
        marker_reasons = _acceptance_marker_reasons(javadoc, form, False)
        registration_reasons = _registration_reasons(record, declaration.name)
        reasons.extend(marker_reasons)
        reasons.extend(registration_reasons)
        if not marker_reasons and not registration_reasons:
            binding_reasons = _registered_binding_reasons(
                path,
                record,
                declaration,
                javadoc,
                notes[0] if notes else None,
                qualified_name,
                enclosing_type,
                registry,
                local_sha256,
            )
            reasons.extend(binding_reasons)
            if not binding_reasons:
                classification = ACCEPTANCE_STATE_REGISTERED_BLOCKER
    return AcceptanceState(
        record_id=f"{path}#{qualified_name}",
        path=path,
        line=line,
        type_name=qualified_name,
        form=form,
        classification=classification,
        verdict=verdict,
        blocker_reason=_text(record, SOURCE_NOTE_BLOCKER_FIELD),
        open_gap=_text(record, "open_gap"),
        route=_text(record, "evidence_route"),
        branch=_text(record, EVIDENCE_BRANCH_FIELD),
        local_sha256=_text(record, "local_sha256_after").lower(),
        upstream_commit=_text(record, "upstream_commit"),
        upstream_sha256=_text(record, "upstream_sha256").lower(),
        review_by=_text(record, "review_by"),
        review_conclusion=_text(record, "review_conclusion"),
        reasons=tuple(reasons),
    )


def _correspondence_discrimination_reasons(record: dict[str, object]) -> list[str]:
    """核验 P1/P2 内容点的有区分力理由与语料/df 绑定（裁决 D14 §112）。

    只有已验收的记录才要求内容点带 ``discrimination_reason`` 与 ``corpus_binding``：
    被回退或需补证的记录按 §120 保留整改前文本，允许留空并另行登记。语料绑定必须指回
    记录的固定上游提交并给出频率口径，否则无法区分“本文件出现”与语料频次。

    Args:
        record: 清单记录。

    Returns:
        逐项拒绝原因；为空表示内容点登记满足 §112 的机械可核验部分。
    """

    raw = record.get("d12_correspondence_points")
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return ["清单缺少 d12_correspondence_points 内容点登记（D14 §112）"]
    if isinstance(raw, str):
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            return ["清单的 d12_correspondence_points 不是有效 JSON"]
    else:
        value = raw
    if not isinstance(value, list):
        return ["清单的 d12_correspondence_points 必须是结构化数组"]
    commit = _text(record, "upstream_commit").lower()
    content_points = [
        point
        for point in value
        if isinstance(point, dict)
        and str(point.get("kind", "")).startswith(CORRESPONDENCE_POINT_KIND_PREFIXES)
    ]
    if not content_points:
        return ["d12_correspondence_points 没有 P1/P2 内容点，无法核验有区分力与语料绑定"]
    reasons: list[str] = []
    for index, point in enumerate(content_points, 1):
        for field in CORRESPONDENCE_POINT_FIELDS:
            text = str(point.get(field) or "").strip()
            if len(text) < CORRESPONDENCE_POINT_MIN_REASON:
                reasons.append(f"第 {index} 个内容点缺少 {field}（D14 §112）")
        binding = str(point.get("corpus_binding") or "")
        if binding and commit and commit not in binding.lower():
            reasons.append(
                f"第 {index} 个内容点的 corpus_binding 没有绑定固定上游提交 {commit}"
            )
        if binding and CORRESPONDENCE_DF_MARKER not in binding:
            reasons.append(
                f"第 {index} 个内容点的 corpus_binding 缺少频率口径"
                f"（{CORRESPONDENCE_DF_MARKER}）"
            )
    return reasons


def _verify_single_note(
    path: str,
    record: dict[str, object],
    declaration: TypeDeclaration,
    javadoc: str,
    note: SourceNote,
    qualified_name: str,
    enclosing_type: str | None,
    registry: EvidenceRegistry,
    local_sha256: str,
    local_source: str | None = None,
) -> list[str]:
    """核验单条来源说明的逐项证据，返回全部拒绝原因。"""

    if path in registry.unparsable:
        return [f"清单记录字段数与表头不一致，无法逐项核验：{path}"]
    # 验收状态优先：记录未验收时该来源说明一律拒绝，诊断必须指向该状态。
    acceptance_reasons = _source_acceptance_reasons(record, javadoc, registry)
    if acceptance_reasons:
        return acceptance_reasons
    reasons = []
    status = _text(record, "author_status")
    if status != AUTHOR_UNDECLARED_STATUS:
        reasons.append(f"清单状态是“{status or '空'}”，不是“{AUTHOR_UNDECLARED_STATUS}”")
    recorded_local = _text(record, "local_sha256_after").lower()
    if not SHA256_PATTERN.match(recorded_local):
        reasons.append("清单缺少有效的本地最终 SHA-256")
    elif recorded_local != local_sha256:
        reasons.append(f"本地最终指纹不符：清单 {recorded_local}，实测 {local_sha256}")
    # 已验收记录必须逐点绑定有区分力理由与语料/df（D14 §112），否则机械消费者无法区分。
    if registry.requires_acceptance_state:
        reasons.extend(_correspondence_discrimination_reasons(record))
    # 先给对象级授权与复核结论，再给上游定位与内容核验，避免诊断被次要原因挤满。
    reasons.extend(
        _type_mapping_reasons(record, declaration, javadoc, qualified_name, enclosing_type)
    )
    reasons.extend(_review_reasons(record, declaration.name))
    reasons.extend(_route_reasons(record))
    if _text(record, EVIDENCE_BRANCH_FIELD) == EVIDENCE_BRANCH_AUTHOR_ONLY:
        # 声明了作者排除分支就必须能复算比较：输入、排除记录与一致结果都不得手填。
        reasons.extend(
            _author_only_contract_reasons(record, path, local_sha256, registry)
        )
    elif _text(record, EVIDENCE_BRANCH_FIELD) == EVIDENCE_BRANCH_CODE_IDENTITY:
        # 裁决 D16 §120：声明代码同一性分支就必须能按登记变换集复算严格比较；
        # 该分支只覆盖代码流，注释与署名仍按 D12/D15 各自规则核验。
        reasons.extend(
            _code_identity_contract_reasons(
                record, path, local_source, local_sha256, registry
            )
        )
    reasons.extend(_history_reasons(record, note, registry))
    sources, sources_error = _record_sources(record)
    if sources_error:
        reasons.append(sources_error)
    elif sources is None:
        reasons.extend(_upstream_binding_reasons(record, note))
        expected_upstream = _text(record, "upstream_sha256").lower()
        if not SHA256_PATTERN.match(expected_upstream):
            reasons.append("清单缺少有效的上游内容 SHA-256")
        else:
            snapshot_reason, _ = _verify_upstream_snapshot(
                registry,
                repository=note.repository,
                commit=note.commit,
                upstream_path=note.upstream_path,
                expected_sha256=expected_upstream,
                file_url=_text(record, "upstream_file_url"),
            )
            if snapshot_reason:
                reasons.append(snapshot_reason)
    else:
        matched = next(
            (entry for entry in sources if _source_entry_matches(entry, note)), None
        )
        if matched is None:
            reasons.append(
                "清单的多来源登记中没有 "
                f"{note.repository} @ {note.commit} {note.upstream_path} 的条目"
            )
        else:
            reasons.extend(_source_entry_reasons(matched, note, registry))
    reasons.extend(_local_modification_reasons(record, note))
    return reasons


def _verify_source_notes(
    path: str,
    declaration: TypeDeclaration,
    javadoc: str,
    notes: list[SourceNote],
    qualified_name: str,
    enclosing_type: str | None,
    registry: EvidenceRegistry | None,
    local_sha256: str | None,
    *,
    local_source: str | None = None,
) -> list[str]:
    """核验 public 类型全部来源说明的逐项证据。

    Args:
        path: 仓库相对路径。
        declaration: 待核验的 public 类型声明。
        javadoc: 该类型绑定的完整 JavaDoc 文本。
        notes: 已解析的来源说明列表，多来源逐条核验。
        qualified_name: 含外层类型链的类型限定名。
        enclosing_type: 外层类型限定名；顶层类型为 ``None``。
        registry: 受控证据清单；未配置时为 ``None``。
        local_sha256: 当前对象原始字节的 SHA-256。
        local_source: 当前对象原文；声明 ``E1-code-identity`` 时用于严格代码比较，
            省略时按规则实现所在仓库根读取工作树。

    Returns:
        逐条拒绝原因；为空表示该类型的来源例外成立。
    """

    if registry is None:
        return ["未提供受控证据清单，来源说明没有逐项依据"]
    if local_sha256 is None:
        return ["当前对象没有可核验的原始字节指纹"]
    if path in registry.unparsable:
        return [f"清单记录字段数与表头不一致，无法逐项核验：{path}"]
    record = registry.records.get(path)
    if record is None:
        return [f"清单中没有 {path} 的逐项记录，来源说明没有逐项依据"]
    reasons: list[str] = []
    for note in notes:
        reasons.extend(
            _verify_single_note(
                path,
                record,
                declaration,
                javadoc,
                note,
                qualified_name,
                enclosing_type,
                registry,
                local_sha256,
                local_source,
            )
        )
    if reasons:
        return reasons
    sources, _ = _record_sources(record)
    declared = (
        _declared_author_sources(sources)
        if sources is not None
        else ([_text(record, "upstream_author_lines")] if _text(record, "upstream_author_lines") else [])
    )
    if declared and not _has_actual_author(javadoc):
        return [
            "清单登记的其他来源存在作者声明，必须保留准确作者，"
            "不能用一个无作者来源覆盖其他来源："
            + "；".join(declared[:2])
        ]
    return reasons


def _package_name(masked: str) -> str:
    """读取源码的 package 声明，用于构造类型限定名。"""

    match = re.search(
        r"(?m)^[ \t]*package[ \t]+"
        r"([A-Za-z_$][\w$]*(?:[ \t]*\.[ \t]*[A-Za-z_$][\w$]*)*)[ \t]*;",
        masked,
    )
    return "" if match is None else re.sub(r"\s+", "", match.group(1))


def _qualified_type_names(
    declarations: list[TypeDeclaration], declaration: TypeDeclaration, package: str
) -> tuple[str | None, str]:
    """返回类型的外层类型限定名与自身限定名。

    Args:
        declarations: 全部类型声明。
        declaration: 待定位的类型声明。
        package: 源码的 package 名称；默认包为空串。

    Returns:
        ``(外层类型限定名或 None, 类型限定名)``；嵌套类型必须各有自己的映射条目。
    """

    chain = sorted(
        (
            item
            for item in declarations
            if item.open_brace < declaration.open_brace < item.close_brace
        ),
        key=lambda item: item.open_brace,
    )
    names = ([package] if package else []) + [item.name for item in chain]
    return (".".join(names) if chain else None), ".".join([*names, declaration.name])


def _scan_types(
    path: str,
    source: str,
    starts: list[int],
    added_lines: set[int],
    declarations: list[TypeDeclaration],
    *,
    evidence: EvidenceRegistry | None = None,
    local_sha256: str | None = None,
    acceptance: AcceptanceLedger | None = None,
    maintenance: bool = False,
) -> list[Finding]:
    """检查本次新增或修改的类型声明 JavaDoc，并逐项登记验收状态。

    Args:
        path: 仓库相对路径。
        source: 原始 Java 源码。
        starts: 行起始偏移列表。
        added_lines: 暂存差异中的新增行号。
        declarations: 已解析的类型声明。
        evidence: 受控来源证据清单；未配置时为 ``None``。
        local_sha256: 当前对象原始字节的 SHA-256。
        acceptance: 逐项验收状态收集器；为 ``None`` 时不登记状态。
        maintenance: 是否处于显式维护模式。只有显式维护模式才允许把已登记阻断
            与硬失败分开报告；未显式选择时既有验收入口保持严格拒绝。

    Returns:
        类型注释问题列表。主张来源证据的类型即使声明行未变也会被检查。已登记阻断
        在维护模式下进入 ``acceptance`` 的独立集合，不计入诊断，也不计为通过。
    """

    findings = []
    package = _package_name(_mask_java(source))
    indexed = evidence is not None and getattr(evidence, "requires_acceptance_state", False)
    for declaration in declarations:
        javadoc = _attached_javadoc(source, declaration.declaration_offset)
        span = _attached_javadoc_span(source, declaration.declaration_offset)
        claims = javadoc is not None and _claims_source_evidence(javadoc)
        touched = _intersects_added_lines(
            starts,
            declaration.declaration_offset,
            declaration.open_brace,
            added_lines,
        ) or (
            span is not None
            and _intersects_added_lines(starts, span[0], span[1], added_lines)
        )
        if not claims and not touched:
            continue
        line = _line_number(starts, declaration.name_offset)
        record = evidence.records.get(path) if indexed else None
        if javadoc is None:
            findings.append(
                Finding(
                    path,
                    line,
                    "type-javadoc",
                    f"类型 {declaration.name} 缺少职责 JavaDoc",
                )
            )
            _record_unindexable_state(
                acceptance, path, record, declaration, line, "类型缺少职责 JavaDoc"
            )
            continue
        if not declaration.public:
            continue
        notes, note_errors = _parse_source_notes(javadoc)
        note_errors.extend(_provenance_tag_errors(javadoc))
        if note_errors:
            detail = f"public 类型 {declaration.name} 的来源说明无效：{'；'.join(note_errors)}"
            findings.append(Finding(path, line, "type-author", detail, True))
            _record_unindexable_state(acceptance, path, record, declaration, line, detail)
            continue
        enclosing, qualified = _qualified_type_names(declarations, declaration, package)
        if notes:
            reasons = _verify_source_notes(
                path,
                declaration,
                javadoc,
                notes,
                qualified,
                enclosing,
                evidence,
                local_sha256,
                local_source=source,
            )
            state = (
                _acceptance_state(
                    path,
                    record,
                    declaration,
                    javadoc,
                    notes,
                    qualified,
                    enclosing,
                    evidence,
                    local_sha256,
                    line,
                    reasons,
                    local_source=source,
                )
                if record is not None
                else None
            )
            if acceptance is not None and state is not None:
                acceptance.add(state)
            if _state_blocks_finding(state, maintenance):
                continue
            if state is not None and state.classification != ACCEPTANCE_STATE_ACCEPTED:
                for reason in state.reasons:
                    if reason not in reasons:
                        reasons.append(reason)
            if reasons:
                findings.append(
                    Finding(
                        path,
                        line,
                        "type-author",
                        f"public 类型 {declaration.name} 的来源说明未被逐项证据支持："
                        f"{'；'.join(reasons[:3])}",
                        True,
                    )
                )
            continue
        if _has_actual_author(javadoc):
            # 作者标签形态与来源说明形态共用同一验收状态汇总（D15 §127/§128）：
            # 这 33 条必须逐项进入未验收署名集合，不能再从拒绝诊断里消失。
            state = (
                _acceptance_state(
                    path,
                    record,
                    declaration,
                    javadoc,
                    [],
                    qualified,
                    enclosing,
                    evidence,
                    local_sha256,
                    line,
                    [],
                    local_source=source,
                )
                if record is not None
                else None
            )
            if acceptance is not None and state is not None:
                acceptance.add(state)
            if state is not None and state.classification != ACCEPTANCE_STATE_ACCEPTED:
                if _state_blocks_finding(state, maintenance):
                    continue
                detail = (
                    f"public 类型 {declaration.name} 的署名未被独立验收："
                    f"{'；'.join(state.reasons[:3])}"
                )
                findings.append(Finding(path, line, "type-author", detail, True))
            continue
        detail = (
            f"public 类型 {declaration.name} 的 JavaDoc 缺少非占位的 @author "
            "实际作者，也没有本裁决格式的来源说明"
        )
        findings.append(Finding(path, line, "type-author", detail, claims))
        _record_unindexable_state(acceptance, path, record, declaration, line, detail)
    return findings


def _state_blocks_finding(state: AcceptanceState | None, maintenance: bool) -> bool:
    """判断该验收状态是否已经完整表达为“已登记阻断”，不再产生诊断。

    只有显式维护模式下的已登记阻断条目才允许不产生硬失败诊断；严格入口与未登记
    条目都必须保留真实拒绝。维护完成态不进入通过检查数。
    """

    return bool(
        maintenance
        and state is not None
        and state.classification == ACCEPTANCE_STATE_REGISTERED_BLOCKER
    )


def _record_unindexable_state(
    acceptance: AcceptanceLedger | None,
    path: str,
    record: dict[str, object] | None,
    declaration: TypeDeclaration,
    line: int,
    detail: str,
) -> None:
    """把无法计算完整状态的索引记录登记为硬失败，避免它从验收汇总里消失。"""

    if acceptance is None or record is None:
        return
    acceptance.add(
        AcceptanceState(
            record_id=f"{path}#{declaration.name}",
            path=path,
            line=line,
            type_name=declaration.name,
            form=ACCEPTANCE_FORM_AUTHOR_TAG,
            classification=ACCEPTANCE_STATE_HARD_FAILURE,
            verdict=_index_verdict(record),
            blocker_reason=_text(record, SOURCE_NOTE_BLOCKER_FIELD),
            open_gap=_text(record, "open_gap"),
            route=_text(record, "evidence_route"),
            branch=_text(record, EVIDENCE_BRANCH_FIELD),
            local_sha256=_text(record, "local_sha256_after").lower(),
            upstream_commit=_text(record, "upstream_commit"),
            upstream_sha256=_text(record, "upstream_sha256").lower(),
            review_by=_text(record, "review_by"),
            review_conclusion=_text(record, "review_conclusion"),
            reasons=(detail,),
        )
    )



def _method_end(masked: str, close_paren: int) -> int | None:
    """确认右括号之后是否构成方法或构造方法声明。

    Args:
        masked: 已屏蔽注释和字面量的源码。
        close_paren: 参数列表右括号偏移。

    Returns:
        声明结束的左大括号或分号偏移；不是方法声明时返回 ``None``。
    """

    tail = masked[close_paren + 1 :]
    match = re.match(
        r"\s*(?:\[\]\s*)*"
        r"(?:throws\s+[A-Za-z_$][A-Za-z0-9_$.,<>?\[\] @\s]*\s*)?"
        r"(?:default\s+[^;{}]+\s*)?"
        r"(?P<end>[;{])",
        tail,
    )
    if match is None:
        return None
    return close_paren + 1 + match.start("end")


def _enum_constants_end(
    declaration: TypeDeclaration, masked: str, brace_depths: list[int]
) -> int:
    """定位枚举常量区结束分号；没有分号时返回类型右大括号。

    Args:
        declaration: 枚举类型声明。
        masked: 已屏蔽注释和字面量的源码。
        brace_depths: 每个字符之前的大括号深度。

    Returns:
        枚举常量区结束偏移。
    """

    member_depth = declaration.outer_depth + 1
    for index in range(declaration.open_brace + 1, declaration.close_brace):
        if masked[index] == ";" and brace_depths[index] == member_depth:
            return index
    return declaration.close_brace


def _has_top_level_assignment(fragment: str) -> bool:
    """判断成员片段是否在参数括号之外包含赋值或 Lambda 箭头。

    Args:
        fragment: 待分析的成员片段。

    Returns:
        存在字段初始化或 Lambda 表达式特征时返回 ``True``。
    """

    depth = 0
    index = 0
    while index < len(fragment):
        char = fragment[index]
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(0, depth - 1)
        elif depth == 0 and char == "=":
            return True
        elif depth == 0 and fragment.startswith("->", index):
            return True
        index += 1
    return False


def _scan_methods(
    path: str,
    source: str,
    masked: str,
    starts: list[int],
    added_lines: set[int],
    brace_depths: list[int],
    paren_pairs: dict[int, int],
    declarations: list[TypeDeclaration],
) -> list[Finding]:
    """检查本次新增或修改的方法和构造方法 JavaDoc。

    Args:
        path: 仓库相对路径。
        source: 原始 Java 源码。
        masked: 已屏蔽注释和字面量的源码。
        starts: 行起始偏移列表。
        added_lines: 暂存差异中的新增行号。
        brace_depths: 每个字符之前的大括号深度。
        paren_pairs: 左右小括号偏移映射。
        declarations: 已解析的类型声明。

    Returns:
        方法和构造方法注释问题列表。
    """

    findings = []
    visited: set[tuple[int, int]] = set()
    for open_paren, close_paren in paren_pairs.items():
        enclosing = _enclosing_type(
            declarations, open_paren, brace_depths[open_paren]
        )
        if enclosing is None:
            continue
        if (
            enclosing.kind == "enum"
            and open_paren
            < _enum_constants_end(enclosing, masked, brace_depths)
        ):
            continue
        name_match = IDENTIFIER_BEFORE_PAREN_PATTERN.search(masked[:open_paren])
        if name_match is None:
            continue
        name = name_match.group("name")
        if name in CONTROL_KEYWORDS:
            continue
        name_offset = name_match.start("name")
        if name_offset > 0 and masked[name_offset - 1] in {".", "@"}:
            continue
        member_depth = enclosing.outer_depth + 1
        segment_start = _member_start(
            masked, brace_depths, name_offset, member_depth
        )
        declaration_offset = _first_code_offset(masked, segment_start, name_offset + 1)
        fragment = masked[declaration_offset:open_paren]
        stripped, _ = _strip_leading_annotations(fragment)
        core_before_paren = stripped.rstrip()
        if not core_before_paren or _has_top_level_assignment(core_before_paren):
            continue
        if re.search(r"\b(?:class|interface|enum|record|new|return|throw)\b", core_before_paren):
            continue
        core_name_match = IDENTIFIER_BEFORE_PAREN_PATTERN.search(core_before_paren)
        if core_name_match is None or core_name_match.group("name") != name:
            continue
        before_name = core_before_paren[: core_name_match.start("name")].rstrip()
        if name != enclosing.name and not before_name:
            continue
        end_offset = _method_end(masked, close_paren)
        if end_offset is None or brace_depths[end_offset] != member_depth:
            continue
        key = (name_offset, end_offset)
        if key in visited:
            continue
        visited.add(key)
        # JavaDoc 位于注解之前，因此关联判断仍使用包含首个注解的原始声明起点。
        if not _intersects_added_lines(
            starts, declaration_offset, end_offset, added_lines
        ):
            continue
        if _attached_javadoc(source, declaration_offset) is None:
            declaration_kind = "构造方法" if name == enclosing.name else "方法"
            findings.append(
                Finding(
                    path,
                    _line_number(starts, name_offset),
                    "method-javadoc",
                    f"{declaration_kind} {name} 缺少职责 JavaDoc",
                )
            )
    return findings


def _scan_compact_record_constructors(
    path: str,
    source: str,
    masked: str,
    starts: list[int],
    added_lines: set[int],
    brace_depths: list[int],
    declarations: list[TypeDeclaration],
) -> list[Finding]:
    """检查 record 的显式紧凑构造方法 JavaDoc。

    Args:
        path: 仓库相对路径。
        source: 原始 Java 源码。
        masked: 已屏蔽注释和字面量的源码。
        starts: 行起始偏移列表。
        added_lines: 暂存差异中的新增行号。
        brace_depths: 每个字符之前的大括号深度。
        declarations: 已解析的类型声明。

    Returns:
        紧凑构造方法注释问题列表。
    """

    findings = []
    for declaration in declarations:
        if declaration.kind != "record":
            continue
        member_depth = declaration.outer_depth + 1
        pattern = re.compile(
            rf"(?<![\w$])(?:(?:public|protected|private)\s+)?"
            rf"{re.escape(declaration.name)}\s*\{{"
        )
        for match in pattern.finditer(
            masked, declaration.open_brace + 1, declaration.close_brace
        ):
            open_brace = match.end() - 1
            if brace_depths[open_brace] != member_depth:
                continue
            segment_start = _member_start(
                masked, brace_depths, match.start(), member_depth
            )
            declaration_offset = _first_code_offset(
                masked, segment_start, match.start() + 1
            )
            if not _intersects_added_lines(
                starts, declaration_offset, open_brace, added_lines
            ):
                continue
            if _attached_javadoc(source, declaration_offset) is None:
                findings.append(
                    Finding(
                        path,
                        _line_number(starts, match.start()),
                        "method-javadoc",
                        f"紧凑构造方法 {declaration.name} 缺少职责 JavaDoc",
                    )
                )
    return findings


def _scan_do_vo_fields(
    path: str,
    source: str,
    masked: str,
    starts: list[int],
    added_lines: set[int],
    brace_depths: list[int],
    declarations: list[TypeDeclaration],
) -> list[Finding]:
    """检查 DO、VO 中本次新增或修改的成员变量 JavaDoc。

    Args:
        path: 仓库相对路径。
        source: 原始 Java 源码。
        masked: 已屏蔽注释和字面量的源码。
        starts: 行起始偏移列表。
        added_lines: 暂存差异中的新增行号。
        brace_depths: 每个字符之前的大括号深度。
        declarations: 已解析的类型声明。

    Returns:
        DO、VO 字段注释问题列表。
    """

    findings = []
    for semicolon, char in enumerate(masked):
        if char != ";":
            continue
        enclosing = _enclosing_type(
            declarations, semicolon, brace_depths[semicolon]
        )
        if enclosing is None or not enclosing.name.endswith(("DO", "VO")):
            continue
        member_depth = enclosing.outer_depth + 1
        segment_start = _member_start(
            masked, brace_depths, semicolon, member_depth
        )
        declaration_offset = _first_code_offset(masked, segment_start, semicolon)
        fragment = masked[declaration_offset:semicolon]
        stripped, _ = _strip_leading_annotations(fragment)
        core = stripped.strip()
        if not core or "(" in core or FIELD_PREFIX_PATTERN.match(core) is None:
            continue
        if not _intersects_added_lines(
            starts, declaration_offset, semicolon, added_lines
        ):
            continue
        field_name_match = re.search(
            r"(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*(?:=|,|$)", core
        )
        field_name = field_name_match.group("name") if field_name_match else "成员变量"
        if _attached_javadoc(source, declaration_offset) is None:
            findings.append(
                Finding(
                    path,
                    _line_number(starts, declaration_offset),
                    "do-vo-field-javadoc",
                    f"{enclosing.name} 字段 {field_name} 缺少职责 JavaDoc",
                )
            )
    return findings


def _record_component_boundaries(
    declaration: TypeDeclaration,
    masked: str,
    paren_depths: list[int],
    paren_pairs: dict[int, int],
) -> list[tuple[int, int]]:
    """切分 record 头部中的顶层组件声明。

    Args:
        declaration: record 类型声明。
        masked: 已屏蔽注释和字面量的源码。
        paren_depths: 每个字符之前的小括号深度。
        paren_pairs: 左右小括号偏移映射。

    Returns:
        每个 record 组件片段的起止偏移列表。
    """

    open_paren = masked.find(
        "(", declaration.name_offset + len(declaration.name), declaration.open_brace
    )
    if open_paren < 0 or open_paren not in paren_pairs:
        return []
    close_paren = paren_pairs[open_paren]
    if close_paren > declaration.open_brace:
        return []
    component_depth = paren_depths[open_paren] + 1
    boundaries = []
    component_start = open_paren + 1
    for index in range(component_start, close_paren):
        if masked[index] == "," and paren_depths[index] == component_depth:
            boundaries.append((component_start, index))
            component_start = index + 1
    boundaries.append((component_start, close_paren))
    return boundaries


def _record_component_param_documented(
    source: str, declaration: TypeDeclaration, component: str
) -> bool:
    """判断 record 头部 JavaDoc 是否以 ``@param`` 给出了该组件的职责说明。

    record 组件位置上的 ``/** */`` 在 PMD 里是悬空 JavaDoc（DanglingJavadoc 报违规），
    该位置的规范写法是 record 头部 JavaDoc 的 ``@param``。本函数提供这条等价通道，
    但说明正文仍必须非空，缺说明的 ``@param`` 不算通过。

    Args:
        source: 原始 Java 源码。
        declaration: record 类型声明。
        component: 组件名称。

    Returns:
        头部 JavaDoc 存在 ``@param <组件名> <非空说明>`` 时返回 ``True``。
    """

    javadoc = _attached_javadoc(source, declaration.declaration_offset)
    if javadoc is None:
        return False
    for line in _javadoc_body_lines(javadoc):
        match = RECORD_COMPONENT_PARAM_PATTERN.match(line.strip())
        if match is not None and match.group("name") == component:
            return True
    return False


def _scan_do_vo_record_components(
    path: str,
    source: str,
    masked: str,
    starts: list[int],
    added_lines: set[int],
    paren_depths: list[int],
    paren_pairs: dict[int, int],
    declarations: list[TypeDeclaration],
) -> list[Finding]:
    """检查 DO、VO record 中本次新增或修改的组件职责说明。

    组件说明可以写在组件上方的 JavaDoc，或写在 record 头部 JavaDoc 的 ``@param``；
    两者都没有时按 ``do-vo-field-javadoc`` 报违规。

    Args:
        path: 仓库相对路径。
        source: 原始 Java 源码。
        masked: 已屏蔽注释和字面量的源码。
        starts: 行起始偏移列表。
        added_lines: 暂存差异中的新增行号。
        paren_depths: 每个字符之前的小括号深度。
        paren_pairs: 左右小括号偏移映射。
        declarations: 已解析的类型声明。

    Returns:
        DO、VO record 组件注释问题列表。
    """

    findings = []
    for declaration in declarations:
        if declaration.kind != "record" or not declaration.name.endswith(("DO", "VO")):
            continue
        for component_start, component_end in _record_component_boundaries(
            declaration, masked, paren_depths, paren_pairs
        ):
            declaration_offset = _first_code_offset(
                masked, component_start, component_end
            )
            fragment = masked[declaration_offset:component_end]
            stripped, _ = _strip_leading_annotations(fragment)
            name_match = re.search(
                r"(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*$", stripped
            )
            if name_match is None:
                continue
            name = name_match.group("name")
            if not _intersects_added_lines(
                starts, declaration_offset, component_end, added_lines
            ):
                continue
            if _attached_javadoc(source, declaration_offset) is None and not (
                _record_component_param_documented(source, declaration, name)
            ):
                findings.append(
                    Finding(
                        path,
                        _line_number(starts, declaration_offset),
                        "do-vo-field-javadoc",
                        f"{declaration.name} record 组件 {name} 缺少职责说明"
                        "（组件上方 JavaDoc 或 record 头部 @param）",
                    )
                )
    return findings


def _enum_constant_boundaries(
    declaration: TypeDeclaration,
    masked: str,
    brace_depths: list[int],
    paren_depths: list[int],
) -> list[tuple[int, int]]:
    """切分枚举常量区中的顶层常量片段。

    Args:
        declaration: 枚举类型声明。
        masked: 已屏蔽注释和字面量的源码。
        brace_depths: 每个字符之前的大括号深度。
        paren_depths: 每个字符之前的小括号深度。

    Returns:
        每个枚举常量片段的起止偏移列表。
    """

    member_depth = declaration.outer_depth + 1
    start = declaration.open_brace + 1
    baseline_paren_depth = paren_depths[start] if start < len(paren_depths) else 0
    boundaries = []
    segment_start = start
    for index in range(start, declaration.close_brace):
        if brace_depths[index] != member_depth:
            continue
        char = masked[index]
        if char == ";" and paren_depths[index] == baseline_paren_depth:
            boundaries.append((segment_start, index))
            break
        if char == "," and paren_depths[index] == baseline_paren_depth:
            boundaries.append((segment_start, index))
            segment_start = index + 1
    else:
        boundaries.append((segment_start, declaration.close_brace))
    return boundaries


def _scan_enum_constants(
    path: str,
    source: str,
    masked: str,
    starts: list[int],
    added_lines: set[int],
    brace_depths: list[int],
    paren_depths: list[int],
    declarations: list[TypeDeclaration],
) -> list[Finding]:
    """检查本次新增或修改的枚举常量 JavaDoc。

    Args:
        path: 仓库相对路径。
        source: 原始 Java 源码。
        masked: 已屏蔽注释和字面量的源码。
        starts: 行起始偏移列表。
        added_lines: 暂存差异中的新增行号。
        brace_depths: 每个字符之前的大括号深度。
        paren_depths: 每个字符之前的小括号深度。
        declarations: 已解析的类型声明。

    Returns:
        枚举常量注释问题列表。
    """

    findings = []
    for declaration in declarations:
        if declaration.kind != "enum":
            continue
        for segment_start, segment_end in _enum_constant_boundaries(
            declaration, masked, brace_depths, paren_depths
        ):
            declaration_offset = _first_code_offset(
                masked, segment_start, segment_end
            )
            fragment = masked[declaration_offset:segment_end]
            stripped, _ = _strip_leading_annotations(fragment)
            name_match = re.match(r"\s*(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)", stripped)
            if name_match is None:
                continue
            name = name_match.group("name")
            if not _intersects_added_lines(
                starts, declaration_offset, segment_end, added_lines
            ):
                continue
            if _attached_javadoc(source, declaration_offset) is None:
                findings.append(
                    Finding(
                        path,
                        _line_number(starts, declaration_offset),
                        "enum-constant-javadoc",
                        f"枚举常量 {name} 缺少用途 JavaDoc",
                    )
                )
    return findings


def _scan_source(
    path: str,
    source: str,
    added_lines: set[int],
    *,
    evidence: EvidenceRegistry | None = None,
    local_sha256: str | None = None,
    acceptance: AcceptanceLedger | None = None,
    maintenance: bool = False,
) -> list[Finding]:
    """扫描单个暂存 Java 文件中的增量注释问题。

    Args:
        path: 仓库相对路径。
        source: 暂存版本 Java 源码。
        added_lines: 暂存差异中的新增行号。
        evidence: 受控来源证据清单；未配置时为 ``None``。
        local_sha256: 当前对象原始字节的 SHA-256。
        acceptance: 逐项验收状态收集器；为 ``None`` 时不登记状态。
        maintenance: 是否处于显式维护模式。

    Returns:
        当前文件的全部注释门禁问题；已登记阻断在维护模式下登记到 ``acceptance``。
    """

    if not added_lines:
        return []
    masked = _mask_java(source)
    starts = _line_starts(source)
    brace_depths = _depths(masked, "{", "}")
    paren_depths = _depths(masked, "(", ")")
    brace_pairs = _matching_delimiters(masked, "{", "}")
    paren_pairs = _matching_delimiters(masked, "(", ")")
    declarations = _type_declarations(masked, brace_depths, brace_pairs)
    findings = []
    findings.extend(
        _scan_types(
            path,
            source,
            starts,
            added_lines,
            declarations,
            evidence=evidence,
            local_sha256=local_sha256,
            acceptance=acceptance,
            maintenance=maintenance,
        )
    )
    findings.extend(
        _scan_methods(
            path,
            source,
            masked,
            starts,
            added_lines,
            brace_depths,
            paren_pairs,
            declarations,
        )
    )
    findings.extend(
        _scan_compact_record_constructors(
            path,
            source,
            masked,
            starts,
            added_lines,
            brace_depths,
            declarations,
        )
    )
    findings.extend(
        _scan_do_vo_fields(
            path,
            source,
            masked,
            starts,
            added_lines,
            brace_depths,
            declarations,
        )
    )
    findings.extend(
        _scan_do_vo_record_components(
            path,
            source,
            masked,
            starts,
            added_lines,
            paren_depths,
            paren_pairs,
            declarations,
        )
    )
    findings.extend(
        _scan_enum_constants(
            path,
            source,
            masked,
            starts,
            added_lines,
            brace_depths,
            paren_depths,
            declarations,
        )
    )
    return sorted(
        set(findings), key=lambda finding: (finding.path, finding.line, finding.rule)
    )


def _previous_source(path: str) -> str | None:
    """读取暂存差异的旧 blob，兼容删除注释及重命名中的旧路径。

    Args:
        path: 当前暂存版本的仓库相对路径。
    Returns:
        旧版本 UTF-8 源码；新增文件或没有内容差异时返回 None。
    Raises:
        RuntimeError: Git 读取失败或旧源码不是 UTF-8；不会写入索引。
    """
    diff = _run_git(
        ["diff", "--cached", "--full-index", "--no-ext-diff", "--no-textconv", "--", path]
    )
    assert isinstance(diff, str)
    match = re.search(r"^index ([0-9a-f]+)\.\.[0-9a-f]+", diff, re.MULTILINE)
    if match is None or not match.group(1).strip("0"):
        return None
    output = _run_git(["cat-file", "blob", match.group(1)], text=False)
    assert isinstance(output, bytes)
    try:
        return output.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise RuntimeError("旧 Java 源码不是有效 UTF-8，已停止注释检查") from error


def _new_documentation_findings(
    path: str,
    source: str,
    previous_source: str | None,
    *,
    evidence: EvidenceRegistry | None = None,
    local_sha256: str | None = None,
) -> list[Finding]:
    """识别注释删除或改坏后新出现的问题，不追查未修改的历史欠账。

    Args:
        path: 当前暂存文件路径。
        source: 当前暂存版本源码。
        previous_source: 差异对应的旧源码；新增文件传 None。
        evidence: 受控来源证据清单；未配置时为 ``None``。
        local_sha256: 当前对象原始字节的 SHA-256。
    Returns:
        旧版本同一声明行没有的注释问题；同名重载按行映射分别判断。
        来源证据主张类诊断按当前证据重新成立，不因旧版本同样失败而豁免。
    """
    if previous_source is None:
        return []
    current_lines = source.splitlines()
    previous_lines = previous_source.splitlines()
    current = _scan_source(
        path,
        source,
        set(range(1, len(current_lines) + 1)),
        evidence=evidence,
        local_sha256=local_sha256,
    )
    if not current:
        return []
    previous = {
        (finding.line, finding.rule, finding.detail)
        for finding in _scan_source(
            path,
            previous_source,
            set(range(1, len(previous_lines) + 1)),
            evidence=evidence,
            local_sha256=local_sha256,
        )
    }
    # 删除整个方法会让后续声明行号前移；映射未改文本而非标记删除邻接行，
    # 避免把下一方法的历史缺失误算为本次问题，也不按重载方法名合并。
    line_map = {
        block.b + offset + 1: block.a + offset + 1
        for block in difflib.SequenceMatcher(
            None, previous_lines, current_lines, autojunk=False
        ).get_matching_blocks()
        for offset in range(block.size)
    }
    return [
        finding
        for finding in current
        if finding.evidence_bound
        or (line_map.get(finding.line), finding.rule, finding.detail) not in previous
    ]


def scan_full_source(
    path: str,
    source: str,
    *,
    evidence: EvidenceRegistry | None = None,
    acceptance: AcceptanceLedger | None = None,
    maintenance: bool = False,
) -> list[Finding]:
    """检查单个 Java 源文件的全部声明，不受暂存差异范围限制。

    全量入口复用同一套规则，把每个文件的所有行都视为受影响范围，
    因此历史欠账不会再被“本次没有改动”掩盖。

    Args:
        path: 仓库相对路径。
        source: 当前 Java 源码。
        evidence: 受控来源证据清单；省略时读取环境变量配置，两者都没有则为 ``None``。
        acceptance: 逐项验收状态收集器；为 ``None`` 时不登记状态。
        maintenance: 是否处于显式维护模式。
    Returns:
        该文件全部声明的注释问题，行号以当前源码为基准。
    Raises:
        EvidenceError: 环境变量配置的证据输入不可读或结构不受支持。
    """

    registry = evidence if evidence is not None else _configured_evidence()
    return _scan_source(
        path,
        source,
        set(range(1, source.count("\n") + 2)),
        evidence=registry,
        local_sha256=hashlib.sha256(source.encode("utf-8")).hexdigest(),
        acceptance=acceptance,
        maintenance=maintenance,
    )


def _scan_staged_java_comments(
    paths: list[str] | None = None,
    *,
    evidence: EvidenceRegistry | None = None,
    acceptance: AcceptanceLedger | None = None,
    maintenance: bool = False,
) -> list[Finding]:
    """扫描全部暂存 Java 文件的增量注释问题。

    Args:
        paths: 已读取的增量范围；省略时从当前索引读取，空列表不扩大扫描。
        evidence: 受控来源证据清单；省略时不启用 A 例外核验。
        acceptance: 逐项验收状态收集器；为 ``None`` 时不登记状态。
        maintenance: 是否处于显式维护模式。
    Returns:
        本次提交中的全部注释门禁问题；已登记阻断在维护模式下进入 ``acceptance``。
    """

    findings = []
    for path in _staged_java_paths() if paths is None else paths:
        source = _staged_source(path)
        local_sha256 = hashlib.sha256(_staged_bytes(path)).hexdigest()
        findings.extend(
            _scan_source(
                path,
                source,
                _added_lines(path),
                evidence=evidence,
                local_sha256=local_sha256,
                acceptance=acceptance,
                maintenance=maintenance,
            )
        )
        findings.extend(
            _new_documentation_findings(
                path,
                source,
                _previous_source(path),
                evidence=evidence,
                local_sha256=local_sha256,
            )
        )
    return sorted(set(findings), key=lambda finding: (finding.path, finding.line, finding.rule))


def _rules(findings: list[Finding]) -> set[str]:
    """提取测试结果中的规则标识集合。

    Args:
        findings: 待归纳的问题列表。

    Returns:
        问题规则标识集合。
    """

    return {finding.rule for finding in findings}


def _validate_declared_branches(
    evidence: EvidenceRegistry,
    *,
    root: Path | None = None,
    transform_set_path: Path | None = None,
) -> tuple[int, list[str]]:
    """复算清单中所有显式声明证据分支的记录。

    记录的 ``evidence_branch`` 声明是版本化契约的启用开关：声明 ``E1-author-only``
    必须满足作者排除判据，声明 ``C2-independent-content`` 必须满足内容点独立门槛。
    D14 §45/§101 同时把分支绑定到固定路线（路线 2 / 路线 3），因此本入口先复算
    分支↔路线归属，再复算分支判据；归属不符即拒绝且不再重复报分支判据，
    与来源说明入口 ``_route_reasons`` 的早返回口径一致。未声明分支的记录不在此处判定
    （沿用既有路线校验），本入口不改判任何已有条目。

    Args:
        evidence: 已加载的受控证据清单。
        root: 读取本地对象与默认变换集的仓库根；默认取本规则实现所在仓库根。
        transform_set_path: 显式指定的代码同一性变换集清单路径。

    Returns:
        ``(检查的记录数, 拒绝原因列表)``。
    """

    checked = 0
    reasons: list[str] = []
    for path, record in sorted(evidence.records.items()):
        branch, branch_error = _evidence_branch(record)
        if branch is None and branch_error is None:
            continue
        checked += 1
        if branch_error:
            reasons.append(f"{path}：[{branch_error}]")
            continue
        route_reasons = _branch_route_reasons(record)
        for reason in route_reasons:
            reasons.append(f"{path}：[{reason}]")
        if route_reasons:
            # 路线归属不成立时与来源说明入口保持同一诊断，不再叠加分支判据。
            continue
        if branch == EVIDENCE_BRANCH_AUTHOR_ONLY:
            local_sha = _text(record, "local_sha256_after").lower()
            for reason in _author_only_contract_reasons(record, path, local_sha, evidence):
                reasons.append(f"{path}：[{reason}]")
        elif branch == EVIDENCE_BRANCH_CODE_IDENTITY:
            local_sha = _text(record, "local_sha256_after").lower()
            for reason in _code_identity_contract_reasons(
                record,
                path,
                None,
                local_sha,
                evidence,
                root=root,
                transform_set_path=transform_set_path,
            ):
                reasons.append(f"{path}：[{reason}]")
        else:
            for reason in _content_independent_reasons(record):
                reasons.append(f"{path}：[{reason}]")
    return checked, reasons


def _run_self_test() -> None:
    """使用内置 Java 样本验证放行、拦截和增量边界。"""

    if not _has_actual_author("/** @author&#x20;赵六 */"):
        raise AssertionError("HTML 空格分隔的实际作者未被识别")
    if _has_actual_author("/** @author TODO */"):
        raise AssertionError("英文占位作者未被拦截")
    for neutral in (
        "/** @author 未声明作者 */",
        "/** @author 来源：YunaiV/ruoyi-vue-pro @ "
        "ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者） */",
        "/** @author basic-framework */",
        "/** @author 来源不明 */",
    ):
        if _has_actual_author(neutral):
            raise AssertionError(f"中性文字被误判为实际作者：{neutral}")

    note = (
        " * 来源：YunaiV/ruoyi-vue-pro @ "
        "ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）\n"
        " * 上游文件：yudao-framework/yudao-common/src/main/java/Demo.java\n"
        f" * {SOURCE_BASIS_FIXED}\n"
        " * 本地修改：调整包名与类名。\n"
    )
    without_registry = (
        "/**\n * 职责说明。\n *\n" + note + " */\npublic class EvidenceDemo {\n}\n"
    )
    if "type-author" not in _rules(
        _scan_source(
            "后端代码/basic-framework-boot/test/EvidenceDemo.java",
            without_registry,
            set(range(1, without_registry.count("\n") + 2)),
        )
    ):
        raise AssertionError("没有受控清单时来源说明未被拦截")
    floating = without_registry.replace(
        "ac022b15a094cf9cf82903d429b9729e72309da5", "ac022b15"
    )
    if "type-author" not in _rules(
        _scan_source(
            "后端代码/basic-framework-boot/test/EvidenceDemo.java",
            floating,
            set(range(1, floating.count("\n") + 2)),
        )
    ):
        raise AssertionError("短 SHA 浮动引用未被拦截")
    after_tag = (
        "/**\n * 职责说明。\n *\n * @author 张三\n"
        + note
        + " */\npublic class LateNote {\n}\n"
    )
    if "type-author" not in _rules(
        _scan_source(
            "后端代码/basic-framework-boot/test/LateNote.java",
            after_tag,
            set(range(1, after_tag.count("\n") + 2)),
        )
    ):
        raise AssertionError("位于块标签之后的来源说明未被拦截")
    invented = (
        "/**\n * 职责说明。\n *\n"
        " * @source YunaiV/ruoyi-vue-pro @ "
        "ac022b15a094cf9cf82903d429b9729e72309da5\n"
        " */\npublic class InventedTag {\n}\n"
    )
    invented_findings = _scan_source(
        "后端代码/basic-framework-boot/test/InventedTag.java",
        invented,
        set(range(1, invented.count("\n") + 2)),
    )
    if "type-author" not in _rules(invented_findings):
        raise AssertionError("自造 @source 标签未被拦截")
    if not any("自造块标签" in finding.detail for finding in invented_findings):
        raise AssertionError("自造 @source 标签的诊断没有说明原因")
    if not _has_actual_author("/** @author 张三, 李四 */"):
        raise AssertionError("多作者形式未被识别")

    compliant_source = """/**
 * 合规数据对象。
 *
 * @author 张三
 */
public class GoodDO {
    /**
     * 主键。
     */
    @Deprecated
    private Long id;

    /**
     * 创建合规数据对象。
     */
    public GoodDO() {
    }

    /**
     * 执行业务操作。
     */
    @Override
    public String toString() {
        return "GoodDO";
    }

    /**
     * 验证 record 变量的模式匹配条件。
     *
     * @param record 待检查对象
     * @return 匹配到的数据对象；不匹配时返回原对象
     */
    public Object matchRecord(Object record) {
        if (record instanceof GoodDO value) {
            return value;
        }
        return record;
    }
}
"""
    all_compliant_lines = set(range(1, compliant_source.count("\n") + 2))
    if _scan_source("后端代码/basic-framework-boot/test/GoodDO.java", compliant_source, all_compliant_lines):
        raise AssertionError("合规 Java 样本被误报")

    missing_source = """public class MissingVO {
    @Deprecated
    private String name;

    private MissingVO() {
    }

    private void execute(
            String value) {
    }
}
"""
    all_missing_lines = set(range(1, missing_source.count("\n") + 2))
    missing_rules = _rules(
        _scan_source(
            "后端代码/basic-framework-boot/test/MissingVO.java",
            missing_source,
            all_missing_lines,
        )
    )
    expected_rules = {"type-javadoc", "do-vo-field-javadoc", "method-javadoc"}
    if not expected_rules.issubset(missing_rules):
        raise AssertionError(f"缺失注释样本未完整拦截：{missing_rules}")

    author_source = """/** 缺少作者。 */
public interface MissingAuthor {
}
"""
    author_findings = _scan_source(
        "后端代码/basic-framework-boot/test/MissingAuthor.java", author_source, {2}
    )
    if "type-author" not in _rules(author_findings):
        raise AssertionError("public 类型缺少作者的样本未被拦截")

    placeholder_author_source = """/**
 * 作者占位样本。
 *
 * @author 作者
 */
public interface PlaceholderAuthor {
}
"""
    placeholder_author_findings = _scan_source(
        "后端代码/basic-framework-boot/test/PlaceholderAuthor.java",
        placeholder_author_source,
        {6},
    )
    if "type-author" not in _rules(placeholder_author_findings):
        raise AssertionError("public 类型的占位作者未被拦截")

    enum_source = """/**
 * 状态枚举。
 *
 * @author 王五
 */
public enum StatusEnum {
    /** 成功。 */
    SUCCESS(0),
    FAILURE(1);

    private final int code;

    /**
     * 创建状态枚举。
     *
     * @param code 状态码
     */
    StatusEnum(int code) {
        this.code = code;
    }
}
"""
    enum_findings = _scan_source(
        "后端代码/basic-framework-boot/test/StatusEnum.java", enum_source, {9}
    )
    if "enum-constant-javadoc" not in _rules(enum_findings):
        raise AssertionError("枚举常量缺少注释的样本未被拦截")
    if "method-javadoc" in _rules(enum_findings):
        raise AssertionError("枚举常量构造参数被误判为方法")

    record_source = """/**
 * record 响应对象。
 *
 * @author 李杰
 */
public record ResultVO(
        /** 编号。 */ Long id,
        String name) {
    ResultVO {
    }
}
"""
    all_record_lines = set(range(1, record_source.count("\n") + 2))
    record_rules = _rules(
        _scan_source(
            "后端代码/basic-framework-boot/test/ResultVO.java",
            record_source,
            all_record_lines,
        )
    )
    if not {"do-vo-field-javadoc", "method-javadoc"}.issubset(record_rules):
        raise AssertionError(f"record 注释缺失样本未完整拦截：{record_rules}")

    incremental_source = """public class LegacyVO {
    private String legacyField;

    public void legacyMethod() {
        int changed = 1;
    }
}
"""
    if _scan_source(
        "后端代码/basic-framework-boot/test/LegacyVO.java", incremental_source, {5}
    ):
        raise AssertionError("仅修改方法体时不应追溯历史声明注释")
    print("Java 注释检查规则自检通过")


def _parse_args() -> argparse.Namespace:
    """解析命令行参数。

    Returns:
        包含自检开关、结构化输出与受控证据位置的参数对象。
    """

    parser = argparse.ArgumentParser(description="检查 Git 暂存区 Java 增量注释")
    parser.add_argument("--self-test", action="store_true", help="运行内置规则自检")
    parser.add_argument("--json", action="store_true", help="输出结构化计数与诊断")
    parser.add_argument(
        "--validate-evidence-branches",
        action="store_true",
        help=(
            "复算清单中所有显式声明证据分支"
            "（E1-author-only / C2-independent-content / E1-code-identity）的记录"
        ),
    )
    parser.add_argument(
        "--evidence-registry",
        type=Path,
        default=None,
        help=f"受控来源证据清单路径（TSV 或 JSON）；默认读取 {EVIDENCE_REGISTRY_ENV}",
    )
    parser.add_argument(
        "--evidence-snapshots",
        type=Path,
        default=None,
        help=f"受控上游快照根目录；默认读取 {EVIDENCE_SNAPSHOTS_ENV}",
    )
    parser.add_argument(
        "--code-identity-transform-set",
        type=Path,
        default=None,
        help=(
            "E1-code-identity 分支的受控变换集清单路径；"
            f"默认读取 {CODE_IDENTITY_TRANSFORM_SET_ENV}，再退回 {DEFAULT_CODE_IDENTITY_TRANSFORM_SET}"
        ),
    )
    parser.add_argument(
        "--code-identity-root",
        type=Path,
        default=None,
        help="E1-code-identity 分支读取本地对象与默认变换集的仓库根；默认取本规则实现所在仓库根",
    )
    parser.add_argument(
        "--maintenance",
        action="store_true",
        help=(
            "显式维护模式：完整消费未验收状态后，已登记阻断进入独立清单并以"
            " completed-with-registered-blockers 结束；不加此开关保持严格拒绝"
        ),
    )
    return parser.parse_args()


def maintenance_requested(args: argparse.Namespace) -> bool:
    """判断本次是否显式选择维护模式（命令行开关或等价环境变量）。"""

    if getattr(args, "maintenance", False):
        return True
    return os.environ.get(ACCEPTANCE_MODE_ENV, "").strip() == ACCEPTANCE_MODE_MAINTENANCE


def _acceptance_payload(
    name: str,
    checked: int,
    findings: list[Finding],
    evidence: EvidenceRegistry | None,
    ledger: AcceptanceLedger | None,
    maintenance: bool,
    uncovered: list[dict[str, object]] | None = None,
    scope: list[str] | None = None,
) -> dict[str, object]:
    """生成区分 passed / 已登记阻断 / 失败的版本化报告（裁决 D15 §61/§65/§74）。

    v1 协议只有通过/失败两个状态，无法表达“执行完成、存在已登记阻断”。本函数输出
    v2 协议：``findings`` 只放硬失败诊断，独立阻断清单单独成列，维护完成态使用
    ``completed-with-registered-blockers``，绝不写成 ``passed``，也不计入已验收对象数。

    Args:
        name: 检查器身份。
        checked: 实际扫描对象数量。
        findings: 本入口真实产生的硬失败诊断（已登记阻断不在其中）。
        evidence: 受控证据清单；未配置时为 ``None``。
        ledger: 本次扫描收集的逐项验收状态；为 ``None`` 时按空集合处理。
        maintenance: 是否显式选择维护模式。
        uncovered: 扫描范围内存在非验收索引记录但没有产出逐项状态的漏项。
        scope: 本次实际扫描的仓库相对路径；消费者按该范围复算，不要求增量入口覆盖全库。

    Returns:
        可序列化的 v2 结果，含计数、逐项清单与本次真实退出码。
    """

    states = ledger if ledger is not None else AcceptanceLedger()
    accepted = states.accepted()
    blockers = states.registered_blockers()
    hard = states.hard_failures()
    if findings:
        status = CHECK_STATUS_FAILED
    elif not checked:
        status = "not-applicable"
    elif blockers:
        status = CHECK_STATUS_MAINTENANCE
    else:
        status = CHECK_STATUS_PASSED
    uncovered = list(uncovered or [])
    if uncovered and status == CHECK_STATUS_PASSED:
        # 范围漏项不能静默：声明了非验收记录却没有逐项状态，等同于消费者漏看。
        status = CHECK_STATUS_FAILED
    # 维护完成态退出 0 但状态不是 passed；硬失败、范围漏项与未知状态都以非零结束。
    exit_code = 1 if findings or uncovered else 0
    result: dict[str, object] = {
        "protocol": ACCEPTANCE_PROTOCOL,
        "check": name,
        "checked": checked,
        "findings": [asdict(item) for item in findings],
        "status": status,
        "executed": True,
        "process_exit_code": exit_code,
        # 未配置证据时也显式报告 null，消费者不能把“没有指纹”当成“已验证”。
        "evidence": evidence.describe() if evidence is not None else None,
        "acceptance": {
            "schema": ACCEPTANCE_REPORT_SCHEMA,
            "mode": "maintenance" if maintenance else "strict",
            "scanned_files": checked,
            "scope": {"files": list(scope or []), "count": len(scope or [])},
            "counts": {
                "scanned_files": checked,
                "accepted": len(accepted),
                "registered_blockers": len(blockers),
                "hard_failures": len(hard),
                "findings": len(findings),
                "uncovered_records": len(uncovered),
            },
            # 已验收来源与独立 A1 分支结果分列：来源说明形态（含 C2 内容点分支）与
            # 作者标签形态（E1-author-only）分别统计，A1 不属于来源 accepted 集合。
            "accepted": [state.summary() for state in accepted],
            "accepted_source_notes": [
                state.summary()
                for state in accepted
                if state.form == ACCEPTANCE_FORM_SOURCE_NOTE
            ],
            "accepted_author_branch": [
                state.summary()
                for state in accepted
                if state.form == ACCEPTANCE_FORM_AUTHOR_TAG
            ],
            "registered_blockers": [state.summary() for state in blockers],
            "hard_failures": [state.summary() for state in hard],
            "uncovered_records": uncovered,
        },
    }
    return result


def _emit(
    name: str,
    checked: int,
    findings: list[Finding],
    evidence: EvidenceRegistry | None,
    ledger: AcceptanceLedger | None = None,
    maintenance: bool = False,
    uncovered: list[dict[str, object]] | None = None,
    scope: list[str] | None = None,
) -> int:
    """输出结构化结果，并附上本次采用的证据输入指纹。

    Args:
        name: 检查器身份。
        checked: 实际消费对象数量。
        findings: 注释门禁问题列表。
        evidence: 受控证据清单；未配置时为 ``None``。
        ledger: 逐项验收状态收集器。
        maintenance: 是否处于显式维护模式。
        uncovered: 扫描范围内的索引漏项。
        scope: 本次实际扫描的仓库相对路径。
    Returns:
        存在硬失败或范围漏项时为 1，否则为 0；维护完成态返回 0 但不是 ``passed``。
    """

    result = _acceptance_payload(
        name, checked, findings, evidence, ledger, maintenance, uncovered, scope
    )
    print(json.dumps(result, ensure_ascii=False))
    return int(result["process_exit_code"])


def uncovered_acceptance_records(
    registry: EvidenceRegistry | None,
    scanned: set[str],
    ledger: AcceptanceLedger | None,
) -> list[dict[str, object]]:
    """列出扫描范围内有非验收索引记录但没有逐项状态的漏项（裁决 D15 §68/§69）。

    消费者的“范围漏项”指的是：索引声明了某对象尚未验收，本次扫描又确实覆盖了该文件，
    但报告里既没有它的已验收条目，也没有阻断或硬失败条目。这类漏项不能按默认 0、
    空集合或旧账本降级。

    Args:
        registry: 受控证据清单。
        scanned: 本次实际扫描的仓库相对路径集合。
        ledger: 本次收集的逐项验收状态。

    Returns:
        漏项摘要列表（含记录标识与判词）；没有漏项时为空。
    """

    if registry is None or not registry.requires_acceptance_state:
        return []
    covered: set[str] = set()
    if ledger is not None:
        for state in ledger.states:
            covered.add(state.record_id)
            covered.add(f"{state.path}#{state.type_name}")
    uncovered: list[dict[str, object]] = []
    for path, record in sorted(registry.records.items()):
        if path not in scanned:
            continue
        verdict = _index_verdict(record)
        if verdict in (*SOURCE_NOTE_ACCEPTED_VERDICTS, *AUTHOR_TAG_ACCEPTED_VERDICTS):
            continue
        if any(record_id.startswith(f"{path}#") for record_id in covered):
            continue
        uncovered.append(
            {
                "record_id": path,
                "path": path,
                "verdict": verdict,
                "blocker_reason": _text(record, SOURCE_NOTE_BLOCKER_FIELD),
                "open_gap": _text(record, "open_gap"),
            }
        )
    return uncovered



def _describe_evidence(evidence: EvidenceRegistry | None) -> str:
    """生成证据输入指纹的可读说明，未配置时说明不会启用 A 例外。"""

    if evidence is None:
        return "Java 注释检查证据输入：未配置受控清单与快照，来源说明一律按无逐项依据拒绝。"
    snapshots = "未配置" if evidence.snapshots is None else str(evidence.snapshots)
    manifest = evidence.snapshot_manifest
    detail = "" if manifest is None else (
        f"；快照哈希清单已复算通过（{manifest['files']} 个文件、{manifest['bytes']} 字节、"
        f"{manifest['licenses']} 个许可证条目，SHA-256 {manifest['manifest_sha256']}）"
    )
    return (
        f"Java 注释检查证据输入：清单 {evidence.path}"
        f"（SHA-256 {evidence.sha256}，{len(evidence.records)} 条记录）；受控快照 {snapshots}"
        f"{detail}"
    )


# 其它入口（全量检查、提交路径与 CI 调度）复用同一证据解析与报告实现，
# 保证暂存、工作区、全量与 CI 消费者采用同一契约。
resolve_evidence = _resolve_evidence
describe_evidence = _describe_evidence
configured_evidence = _configured_evidence
acceptance_payload = _acceptance_payload


def _repository_root() -> Path:
    """定位当前 Git 工作区根目录，用于解析仓库内受控默认索引。

    在仓库子目录中运行时仍以工作区根目录为准；不是 Git 工作区时退回当前目录，
    此时仓库内默认索引不会命中，行为等同于仅使用显式配置。
    """

    try:
        output = _run_git(["rev-parse", "--show-toplevel"])
    except RuntimeError:
        return Path.cwd()
    return Path(output.strip()) if isinstance(output, str) and output.strip() else Path.cwd()


def main() -> int:
    """执行自检或暂存区 Java 注释检查。

    Returns:
        检查通过返回 0；发现问题返回 1；检查器执行失败返回 2。
    """

    args = _parse_args()
    maintenance = maintenance_requested(args)
    if args.self_test:
        _run_self_test()
        return 0
    if args.validate_evidence_branches:
        try:
            evidence = _resolve_evidence(
                args.evidence_registry, args.evidence_snapshots, _repository_root()
            )
        except EvidenceError as error:
            print(f"Java 注释证据分支复核失败：{error}", file=sys.stderr)
            return 2
        if evidence is None:
            print(
                "Java 注释证据分支复核失败：未配置受控来源清单，无法复算已声明分支",
                file=sys.stderr,
            )
            return 2
        checked, reasons = _validate_declared_branches(
            evidence,
            root=args.code_identity_root,
            transform_set_path=args.code_identity_transform_set,
        )
        report = {
            "check": "Java 注释证据分支",
            "checked": checked,
            "findings": reasons,
            "status": "failed" if reasons else "passed",
            "evidence": evidence.describe(),
        }
        print(json.dumps(report, ensure_ascii=False))
        return 1 if reasons else 0
    try:
        evidence = _resolve_evidence(
            args.evidence_registry, args.evidence_snapshots, _repository_root()
        )
        if not args.json:
            print(_describe_evidence(evidence))
        paths = _staged_java_paths()
        if not paths:
            if args.json:
                return _emit("Java 注释", 0, [], evidence)
            print(f"Java 注释检查：不适用，暂存差异中没有 {JAVA_SOURCE_ROOT} 下的手写 Java 文件；未验证 Java 声明。")
            return 0
        if not args.json:
            print(f"Java 注释检查范围：{len(paths)} 个暂存文件，根目录 {JAVA_SOURCE_ROOT}，仅检查受影响声明。")
        ledger = AcceptanceLedger()
        findings = _scan_staged_java_comments(
            paths,
            evidence=evidence,
            acceptance=ledger,
            maintenance=maintenance,
        )
        uncovered = uncovered_acceptance_records(evidence, set(paths), ledger)
    except RuntimeError as error:
        print(f"Java 注释检查失败：{error}", file=sys.stderr)
        return 2
    if args.json:
        return _emit(
            "Java 注释",
            len(paths),
            findings,
            evidence,
            ledger,
            maintenance,
            uncovered,
            sorted(paths),
        )
    if not findings:
        if maintenance and ledger.registered_blockers():
            print(
                "Java 注释检查完成（维护模式）：执行完成，存在已登记阻断 "
                f"{len(ledger.registered_blockers())} 项，来源尚未验收；"
                "不计为通过。"
            )
            return 0
        print("Java 注释检查通过：暂存区新增或修改的声明符合要求")
        return 0
    print("检测到 Java 注释问题，已阻止提交：", file=sys.stderr)
    for finding in findings:
        print(
            f"- {finding.path}:{finding.line} [{finding.rule}] {finding.detail}",
            file=sys.stderr,
        )
    print("请补充准确的中文 JavaDoc 后重新提交。", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
