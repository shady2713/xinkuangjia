#!/usr/bin/env python3
"""核实后端接口契约与数据模型边界，拒绝 DO 出边界、敏感字段外泄与无授权端点。

检查对象是 `后端代码/basic-framework-boot` 下全部 `*Controller.java` 的真实 HTTP 契约面，
以及 `controller/**/vo` 下的请求/响应模型：

1. **模型边界**：Controller 方法签名（含 `CommonResult`、`PageResult` 泛型实参）不得出现
   `dal/dataobject` 下的持久化对象，HTTP 契约必须使用明确的请求/响应模型。
2. **响应协议**：端点返回类型必须是统一响应模型 `CommonResult`、已登记的对外协议类型
   `ResponseEntity`/第三方验证码 `ResponseModel`，或带 `HttpServletResponse` 参数的导出方法。
3. **授权契约**：非 `@PermitAll` 的端点方法必须声明 `@PreAuthorize` 权限表达式；只作用于
   当前登录身份、无对象级授权的端点必须在 `IDENTITY_SCOPED_ENDPOINTS` 登记并写明理由。
4. **敏感字段输出范围**：响应模型不得声明密码、密钥、客户端密钥等凭据字段；确实需要下发
   令牌的签发响应必须在 `ISSUING_RESPONSE_MODELS` 登记并写明理由。

零对象不构成本检查的通过路径：没有找到任何 Controller 时按不适用报告。

用法：
    python -B -X utf8 scripts/code/java/verify_api_contracts.py [--root 仓库根] [--json]

@author DeepSeek
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scripts.common.quality_common import (
    DEFAULT_ROOT,
    CheckError,
    Finding,
    entry,
    read_text,
    report,
)

CHECK_NAME = "api-contracts"
# 后端工程根；契约检查只覆盖实际参与构建的模块。
BACKEND = Path("后端代码") / "basic-framework-boot"
# 生成物与依赖不作为检查对象。
SKIPPED_DIRECTORIES = frozenset({"target", "generated-sources", "generated-test-sources"})
# 端点方法级别的 HTTP 映射注解，按出现顺序提取。
MAPPING_PATTERN = re.compile(r"@(Get|Post|Put|Delete|Patch)Mapping\b")
# 统一响应模型：所有管理端与开放端点的默认返回包装。
RESULT_TYPE = "CommonResult"
# 已登记的对外协议返回类型；每一类都必须对应真实的外部协议，不是通用返回包装。
PROTOCOL_RETURN_TYPES = {
    "ResponseEntity": "短信供应商回执要求按供应商协议自定义 HTTP 状态与响应体",
    "ResponseModel": "第三方图形验证码库的固定响应结构，无法改为 CommonResult",
}
# 凭据类字段名；带有效期、超时等后缀的字段是配置数值而非凭据，不参与判定。
CREDENTIAL_FIELD_PATTERN = re.compile(
    r"^(password|passwd|secret|clientSecret|apiSecret|privateKey|accessToken|refreshToken|credential)$"
)
# 允许在响应中下发访问与刷新凭据的签发响应模型。
# 每个名称都必须对应真实存在的响应 VO，并在注释中说明为什么必须下发。
ISSUING_RESPONSE_MODELS: frozenset[str] = frozenset(
    {
        # 登录成功后必须把本次会话的访问与刷新令牌下发给调用方。
        "AuthLoginRespVO",
        # 令牌签发与查询接口的返回内容就是令牌本身。
        "OAuth2AccessTokenRespVO",
    }
)
# 由安全链兜底判定、只要求“已认证真实用户”的端点。
# evidence 必须真实存在于后端手写源码中，登记不能指向不存在的机制。
AUTHENTICATED_ENDPOINTS: tuple[tuple[str, str, str, str], ...] = (
    ("FileController", "uploadFile", "管理端文件入口只要求真实用户主体，机器主体由安全链拒绝", "RealUserRequiredAuthorizationManager"),
    ("FileController", "getFilePresignedUrl", "直传预约只要求真实用户主体，机器主体由安全链拒绝", "RealUserRequiredAuthorizationManager"),
    ("FileController", "createFile", "完成登记只要求真实用户主体，机器主体由安全链拒绝", "RealUserRequiredAuthorizationManager"),
    ("AreaController", "getAreaTree", "行政区划只读参考数据，登录身份即可访问，无对象级授权需求", "RealUserRequiredAuthorizationManager"),
    ("AreaController", "getAreaByIp", "按请求 IP 返回归属地，只读且不含用户数据", "RealUserRequiredAuthorizationManager"),
    ("DeptController", "getSimpleDeptList", "管理端部门下拉数据，只读且不构成对象级授权", "RealUserRequiredAuthorizationManager"),
    ("PostController", "getSimplePostList", "管理端岗位下拉数据，只读且不构成对象级授权", "RealUserRequiredAuthorizationManager"),
    ("DictDataController", "getSimpleDictDataList", "管理端字典下拉数据，只读且不构成对象级授权", "RealUserRequiredAuthorizationManager"),
    ("DictTypeController", "getSimpleDictTypeList", "管理端字典类型下拉数据，只读且不构成对象级授权", "RealUserRequiredAuthorizationManager"),
    ("MenuController", "getSimpleMenuList", "当前用户可见菜单下拉数据，按登录身份过滤", "RealUserRequiredAuthorizationManager"),
    ("RoleController", "getSimpleRoleList", "管理端角色下拉数据，只读且不构成对象级授权", "RealUserRequiredAuthorizationManager"),
    ("SmsChannelController", "getSimpleSmsChannelList", "管理端短信渠道下拉数据，只返回编号、签名与渠道编码", "RealUserRequiredAuthorizationManager"),
    ("UserController", "getSimpleUserList", "管理端用户下拉数据，按登录用户平台类型过滤且只含启用账号", "RealUserRequiredAuthorizationManager"),
    ("UserController", "importTemplate", "下载固定的空导入模板，不读取任何业务数据", "RealUserRequiredAuthorizationManager"),
)
# 只作用于当前登录身份的端点；evidence 必须出现在该 Controller 自己的源码中，
# 证明实现确实从认证上下文取用户，而不是接收请求里的用户编号。
IDENTITY_SCOPED_ENDPOINTS: tuple[tuple[str, str, str, str], ...] = (
    ("UserProfileController", "getUserProfile", "只读取当前登录用户本人资料", "getLoginUserId"),
    ("UserProfileController", "updateUserProfile", "只更新当前登录用户本人资料，不接收目标用户编号", "getLoginUserId"),
    ("UserProfileController", "updateUserProfilePassword", "只修改当前登录用户本人密码并校验原密码", "getLoginUserId"),
    ("AuthController", "getPermissionInfo", "只返回当前登录用户的资料、角色与菜单", "getLoginUserId"),
)
# 持久化对象所在包路径片段，用于识别 HTTP 契约中的 DO。
DATAOBJECT_SEGMENT = "dal/dataobject"
# 请求与响应模型所在包路径片段。
VO_SEGMENT = "controller"


@dataclass(frozen=True)
class Endpoint:
    """记录一个端点方法的真实 HTTP 契约信息。

    Attributes:
        path: 相对仓库根的 POSIX 源码路径。
        line: 映射注解所在的一基行号。
        controller: Controller 简单类名。
        method: Java 方法名。
        http_method: HTTP 方法名（Get/Post/...）。
        return_type: 源码中的返回类型文本。
        parameters: 方法参数列表原文。
        pre_authorize: 方法或类上的 `@PreAuthorize` 表达式；没有时为 None。
        permit_all: 方法或类上是否声明 `@PermitAll`。
    """

    path: str
    line: int
    controller: str
    method: str
    http_method: str
    return_type: str
    parameters: str
    pre_authorize: str | None
    permit_all: bool


@dataclass(frozen=True)
class ResponseModel:
    """记录一个响应模型类及其凭据字段。

    Attributes:
        path: 相对仓库根的 POSIX 源码路径。
        line: 类别名字段声明所在的一基行号；取文件中首个字段行。
        name: 类简单名。
        credential_fields: `(行号, 字段名)` 列表，只包含凭据类字段。
    """

    path: str
    line: int
    name: str
    credential_fields: tuple[tuple[int, str], ...]


def relative(root: Path, path: Path) -> str:
    """把仓库内路径表示为仓库相对 POSIX 路径。

    Args:
        root: 仓库根目录。
        path: 仓库内路径。
    Returns:
        相对根目录的 POSIX 路径。
    Raises:
        CheckError: 路径越过仓库边界。
    """
    resolved = path.resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise CheckError(f"路径越过仓库边界：{path}")
    return resolved.relative_to(root.resolve()).as_posix()


def java_sources(root: Path, suffix: str) -> list[Path]:
    """发现后端工程内指定后缀的手写生产源码。

    Args:
        root: 仓库根目录。
        suffix: 文件名后缀，例如 `Controller.java`。
        Returns:
        按路径排序的源码文件列表；后端工程不存在时返回空列表。
    """
    backend = root / BACKEND
    if not backend.is_dir():
        return []
    found: list[Path] = []
    for path in sorted(backend.rglob(f"*{suffix}")):
        parts = path.relative_to(backend).parts
        if any(part in SKIPPED_DIRECTORIES for part in parts):
            continue
        if "src" not in parts or "main" not in parts:
            continue
        found.append(path)
    return found


def matching_parenthesis(text: str, opening: int) -> int:
    """找到与指定左括号配对的右括号位置，跳过字符串与字符字面量。

    Args:
        text: 完整源码文本。
        opening: 左括号的下标。
        Returns:
        配对右括号的下标。
    Raises:
        CheckError: 括号不配对，源码不完整。
    """
    depth = 0
    index = opening
    in_string: str | None = None
    while index < len(text):
        character = text[index]
        if in_string is not None:
            if character == "\\":
                index += 2
                continue
            if character == in_string:
                in_string = None
            index += 1
            continue
        if character in {'"', "'"}:
            in_string = character
        elif character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
            if depth == 0:
                return index
        index += 1
    raise CheckError("Java 源码括号不配对，无法解析方法签名")


def read_class_name(text: str) -> str:
    """从源码中读取顶层类名。

    Args:
        text: 完整源码文本。
        Returns:
        类简单名。
    Raises:
        CheckError: 找不到类声明，源码不完整。
    """
    match = re.search(r"\b(?:class|interface|enum)\s+(\w+)", text)
    if match is None:
        raise CheckError("Java 源码缺少类声明")
    return match.group(1)


def class_annotations(text: str) -> str:
    """截取类声明之前的注解文本，用于识别类级授权声明。

    Args:
        text: 完整源码文本。
        Returns:
        包声明之后、类声明之前的文本；找不到类声明时返回空串。
    """
    match = re.search(r"\b(?:class|interface|enum)\s+\w+", text)
    return text[: match.start()] if match is not None else ""


def collect_endpoints(root: Path) -> list[Endpoint]:
    """解析全部 Controller，提取端点方法的真实契约信息。

    Args:
        root: 仓库根目录。
        Returns:
        按文件与行号排序的端点列表。
    Raises:
        CheckError: 方法签名或类声明无法解析。
    """
    endpoints: list[Endpoint] = []
    for path in java_sources(root, "Controller.java"):
        text = read_text(path)
        controller = read_class_name(text)
        header = class_annotations(text)
        class_pre = search_pre_authorize(header)
        class_permit = "@PermitAll" in header
        previous_end = 0
        for mapping in MAPPING_PATTERN.finditer(text):
            # 注解可能写在映射注解之前或之后，因此取“上一个方法签名结束”到本方法签名
            # 之间的完整片段；起点必须越过上一个方法的注解，否则会继承它的权限声明。
            signature = find_signature(text, mapping.end())
            if signature is None:
                continue
            return_type, method, parameters, method_start = signature
            annotations = text[previous_end:method_start]
            previous_end = method_start
            endpoints.append(
                Endpoint(
                    path=relative(root, path),
                    line=text[: mapping.start()].count("\n") + 1,
                    controller=controller,
                    method=method,
                    http_method=mapping.group(1),
                    return_type=return_type,
                    parameters=parameters,
                    pre_authorize=search_pre_authorize(annotations) or class_pre,
                    permit_all=class_permit or "@PermitAll" in annotations,
                )
            )
    endpoints.sort(key=lambda item: (item.path, item.line))
    return endpoints


def find_signature(text: str, start: int) -> tuple[str, str, str, int] | None:
    """在映射注解之后定位方法签名。

    Args:
        text: 完整源码文本。
        start: 映射注解结束位置。
        Returns:
        `(返回类型, 方法名, 参数列表, 签名起始下标)`；找不到方法时返回 None。
    Raises:
        CheckError: 括号不配对。
    """
    match = re.compile(r"\bpublic\s+([\w$.<>,\[\]\s?]+?)\s+(\w+)\s*\(").search(text, start, start + 4000)
    if match is None:
        return None
    opening = text.index("(", match.end() - 1)
    closing = matching_parenthesis(text, opening)
    return match.group(1).strip(), match.group(2), text[opening + 1 : closing], match.start()


def search_pre_authorize(text: str) -> str | None:
    """提取 `@PreAuthorize` 的权限表达式。

    Args:
        text: 可能包含注解的文本片段。
        Returns:
        表达式原文；没有该注解时返回 None。
    """
    match = re.search(r"@PreAuthorize\(\s*\"([^\"]*)\"", text)
    return match.group(1) if match is not None else None


def dataobject_names(root: Path) -> set[str]:
    """收集持久化对象简单名，用于识别 HTTP 契约中的 DO。

    Args:
        root: 仓库根目录。
        Returns:
        `dal/dataobject` 下全部 `*DO.java` 的简单类名集合。
    """
    names: set[str] = set()
    for path in java_sources(root, "DO.java"):
        if DATAOBJECT_SEGMENT in path.as_posix():
            names.add(path.stem)
    return names


def check_model_boundary(endpoints: list[Endpoint], dataobjects: set[str]) -> list[Finding]:
    """拒绝把持久化对象放进 HTTP 请求或响应契约。

    Args:
        endpoints: 已解析的端点列表。
        dataobjects: 持久化对象简单名集合。
        Returns:
        契约越界诊断。
    """
    findings: list[Finding] = []
    for endpoint in endpoints:
        exposed = sorted(
            name
            for name in dataobjects
            if re.search(rf"\b{re.escape(name)}\b", f"{endpoint.return_type} {endpoint.parameters}")
        )
        if exposed:
            findings.append(
                Finding(
                    path=endpoint.path,
                    line=endpoint.line,
                    rule="do-in-http-contract",
                    message=(
                        f"{endpoint.controller}#{endpoint.method} 的 HTTP 契约直接使用持久化对象 "
                        f"{'、'.join(exposed)}；请改用明确的请求/响应模型"
                    ),
                )
            )
    return findings


def check_response_contract(endpoints: list[Endpoint]) -> list[Finding]:
    """核对端点返回类型是否落在统一响应模型或已登记协议类型内。

    Args:
        endpoints: 已解析的端点列表。
        Returns:
        响应协议诊断。
    """
    findings: list[Finding] = []
    for endpoint in endpoints:
        returned = endpoint.return_type.strip()
        simple = returned.split("<", 1)[0].strip()
        if simple == RESULT_TYPE:
            continue
        if simple in PROTOCOL_RETURN_TYPES:
            continue
        if simple == "void" and "HttpServletResponse" in endpoint.parameters:
            continue
        findings.append(
            Finding(
                path=endpoint.path,
                line=endpoint.line,
                rule="response-contract-missing",
                message=(
                    f"{endpoint.controller}#{endpoint.method} 返回类型为 {returned}，"
                    f"既不是 {RESULT_TYPE}，也不属于已登记协议类型或带 HttpServletResponse 的导出方法"
                ),
            )
        )
    return findings


def check_authorization(
    endpoints: list[Endpoint], root: Path, sources: list[Path]
) -> list[Finding]:
    """拒绝既未声明权限表达式、也未按已核实机制登记的端点。

    登记项必须给出真实存在的判定机制或认证上下文取值符号；符号在后端手写源码中
    找不到时另行报告，避免登记表退化为无依据的豁免清单。

    Args:
        endpoints: 已解析的端点列表。
        root: 仓库根目录。
        sources: 后端全部手写生产源码路径，用于核对登记依据。
        Returns:
        授权契约诊断。
    """
    authenticated = {(item[0], item[1]): item for item in AUTHENTICATED_ENDPOINTS}
    identity = {(item[0], item[1]): item for item in IDENTITY_SCOPED_ENDPOINTS}
    all_symbols = {path.stem for path in sources}
    findings: list[Finding] = []
    for entry in AUTHENTICATED_ENDPOINTS:
        if entry[3] not in all_symbols:
            findings.append(
                Finding(
                    path=BACKEND.as_posix(),
                    line=1,
                    rule="authorization-evidence-missing",
                    message=f"登记依据 {entry[3]} 在后端手写源码中不存在：{entry[0]}#{entry[1]}",
                )
            )
    by_controller: dict[str, str] = {}
    for endpoint in endpoints:
        by_controller.setdefault(endpoint.controller, endpoint.path)
    for controller, method, _, evidence in IDENTITY_SCOPED_ENDPOINTS:
        path = by_controller.get(controller)
        if path is None or evidence not in read_text(root / path):
            findings.append(
                Finding(
                    path=path or BACKEND.as_posix(),
                    line=1,
                    rule="authorization-evidence-missing",
                    message=f"登记依据 {evidence} 未出现在 {controller} 源码中：{controller}#{method}",
                )
            )
    known = {(endpoint.controller, endpoint.method) for endpoint in endpoints}
    for controller, method, _, _ in AUTHENTICATED_ENDPOINTS + IDENTITY_SCOPED_ENDPOINTS:
        if (controller, method) not in known:
            findings.append(
                Finding(
                    path=BACKEND.as_posix(),
                    line=1,
                    rule="authorization-registry-unknown",
                    message=f"授权登记表中的 {controller}#{method} 不是真实存在的端点",
                )
            )
    for endpoint in endpoints:
        key = (endpoint.controller, endpoint.method)
        if endpoint.permit_all or endpoint.pre_authorize:
            if key in authenticated or key in identity:
                findings.append(
                    Finding(
                        path=endpoint.path,
                        line=endpoint.line,
                        rule="authorization-registry-redundant",
                        message=(
                            f"{endpoint.controller}#{endpoint.method} 已有显式授权声明，"
                            f"不应重复登记在授权登记表中"
                        ),
                    )
                )
            continue
        if key in authenticated or key in identity:
            continue
        findings.append(
            Finding(
                path=endpoint.path,
                line=endpoint.line,
                rule="endpoint-authorization-missing",
                message=(
                    f"{endpoint.controller}#{endpoint.method} 既没有 @PreAuthorize，"
                    f"也没有登记为已核实授权机制的端点"
                ),
            )
        )
    return findings


def collect_response_models(root: Path) -> list[ResponseModel]:
    """收集响应模型中声明的凭据类字段。

    Args:
        root: 仓库根目录。
        Returns:
        按路径排序的响应模型列表，只包含声明了凭据字段的类。
    Raises:
        CheckError: 类声明无法解析。
    """
    models: list[ResponseModel] = []
    for path in java_sources(root, "VO.java"):
        relative_path = relative(root, path)
        if VO_SEGMENT not in relative_path:
            continue
        if not path.stem.endswith("RespVO"):
            continue
        text = read_text(path)
        fields: list[tuple[int, str]] = []
        for number, line in enumerate(text.splitlines(), start=1):
            match = re.search(r"^\s*private\s+[\w<>,\.\[\]]+\s+(\w+)\s*;", line)
            if match is not None and CREDENTIAL_FIELD_PATTERN.match(match.group(1)):
                fields.append((number, match.group(1)))
        if fields:
            models.append(
                ResponseModel(
                    path=relative_path,
                    line=fields[0][0],
                    name=path.stem,
                    credential_fields=tuple(fields),
                )
            )
    return models


def check_sensitive_output(models: list[ResponseModel]) -> list[Finding]:
    """核对响应模型是否越界输出凭据字段。

    Args:
        models: 已收集的响应模型列表。
        Returns:
        敏感字段输出范围诊断。
    """
    findings: list[Finding] = []
    for model in models:
        if model.name in ISSUING_RESPONSE_MODELS:
            continue
        for line, field in model.credential_fields:
            findings.append(
                Finding(
                    path=model.path,
                    line=line,
                    rule="sensitive-field-in-response",
                    message=(
                        f"响应模型 {model.name} 输出凭据字段 {field}；"
                        f"确需下发令牌的签发响应请在登记表中说明理由"
                    ),
                )
            )
    return findings


def verify(root: Path) -> tuple[int, list[Finding]]:
    """执行全部接口契约规则并返回检查对象数与诊断。

    Args:
        root: 仓库根目录。
        Returns:
        `(检查对象数, 诊断列表)`；对象数为端点、响应模型与登记项之和。
    Raises:
        CheckError: Controller 或 VO 无法解析，检查不能给出可信结论。
    """
    endpoints = collect_endpoints(root)
    if not endpoints:
        return 0, []
    dataobjects = dataobject_names(root)
    models = collect_response_models(root)
    findings: list[Finding] = []
    findings.extend(check_model_boundary(endpoints, dataobjects))
    findings.extend(check_response_contract(endpoints))
    findings.extend(check_authorization(endpoints, root, java_sources(root, ".java")))
    findings.extend(check_sensitive_output(models))
    findings.sort(key=lambda item: (item.path, item.line, item.rule))
    return len(endpoints) + len(models) + len(ISSUING_RESPONSE_MODELS) + len(
        AUTHENTICATED_ENDPOINTS
    ) + len(IDENTITY_SCOPED_ENDPOINTS), findings


def main() -> int:
    """解析参数并输出接口契约检查结果。

    Returns:
        存在违规时为 1，无违规为 0，环境或输入错误为 2。
    """
    description = "核实后端接口契约与数据模型边界"
    command = argparse.ArgumentParser(description=description)
    command.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="待检查仓库根目录")
    command.add_argument("--json", action="store_true", help="输出结构化 JSON")

    def action() -> int:
        """执行检查并按诊断数量决定退出码。"""
        arguments = command.parse_args()
        checked, findings = verify(arguments.root.resolve())
        return report(CHECK_NAME, checked, findings, as_json=arguments.json)

    return entry(action)


if __name__ == "__main__":
    raise SystemExit(main())
