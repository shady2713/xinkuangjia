"""验证接口契约检查器：合法契约被接受，越界模型与无授权端点被拒绝。

所有写入只发生在 pytest 临时目录构造的最小后端工程内，不修改真实仓库。
用例覆盖模型边界、响应协议、授权契约与敏感字段输出范围四条规则的两侧。

@author DeepSeek
"""

from __future__ import annotations

from pathlib import Path

import pytest
from scripts.code.java import verify_api_contracts as contracts
from scripts.common.quality_common import DEFAULT_ROOT, CheckError

BACKEND = contracts.BACKEND
# 真实登记表快照；最小工程用例会先清空登记，真实仓库用例再原样恢复。
ORIGINAL_AUTHENTICATED_ENDPOINTS = contracts.AUTHENTICATED_ENDPOINTS
ORIGINAL_IDENTITY_SCOPED_ENDPOINTS = contracts.IDENTITY_SCOPED_ENDPOINTS
ORIGINAL_ISSUING_RESPONSE_MODELS = contracts.ISSUING_RESPONSE_MODELS


@pytest.fixture(autouse=True)
def isolate_registries(monkeypatch: pytest.MonkeyPatch) -> None:
    """在最小工程用例中清空授权与敏感字段登记，避免 fixture 缺少真实机制时误报。

    真实登记表的约束由两个仓库用例与各登记项用例自行恢复后覆盖。

    Args:
        monkeypatch: pytest 提供的属性替换入口。
    """
    monkeypatch.setattr(contracts, "AUTHENTICATED_ENDPOINTS", ())
    monkeypatch.setattr(contracts, "IDENTITY_SCOPED_ENDPOINTS", ())
    monkeypatch.setattr(contracts, "ISSUING_RESPONSE_MODELS", frozenset())


def restore_registries(monkeypatch: pytest.MonkeyPatch) -> None:
    """恢复真实登记表，供仓库级用例核对当前生效的契约。

    Args:
        monkeypatch: pytest 提供的属性替换入口。
    """
    monkeypatch.setattr(contracts, "AUTHENTICATED_ENDPOINTS", ORIGINAL_AUTHENTICATED_ENDPOINTS)
    monkeypatch.setattr(contracts, "IDENTITY_SCOPED_ENDPOINTS", ORIGINAL_IDENTITY_SCOPED_ENDPOINTS)
    monkeypatch.setattr(contracts, "ISSUING_RESPONSE_MODELS", ORIGINAL_ISSUING_RESPONSE_MODELS)


def write(root: Path, relative: str, content: str) -> Path:
    """在临时工程内写入 UTF-8 文件，返回真实路径供检查器读取。

    Args:
        root: 临时工程根目录。
        relative: 相对根目录的 POSIX 路径。
        content: 完整文件内容。
    Returns:
        已写入文件的绝对路径。
    """
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


def build_project(root: Path) -> None:
    """构造一套合法的最小契约面：统一响应模型、权限表达式与响应 VO。

    该骨架对应真实仓库的合法消费方：分页与详情接口返回 `CommonResult`，
    写接口声明 `@PreAuthorize`，响应模型只承载非秘密字段。

    Args:
        root: 临时工程根目录。
    """
    write(
        root,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/framework/common/pojo/CommonResult.java",
        "package com.basicframework.framework.common.pojo;\n\npublic class CommonResult<T> {\n}\n",
    )
    write(
        root,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/framework/common/pojo/PageResult.java",
        "package com.basicframework.framework.common.pojo;\n\npublic class PageResult<T> {\n}\n",
    )
    write(
        root,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/dal/dataobject/demo/DemoDO.java",
        "package com.basicframework.module.system.dal.dataobject.demo;\n\n"
        "public class DemoDO {\n    private Long id;\n}\n",
    )
    write(
        root,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/controller/admin/demo/vo/DemoRespVO.java",
        "package com.basicframework.module.system.controller.admin.demo.vo;\n\n"
        "public class DemoRespVO {\n    private Long id;\n    private String name;\n}\n",
    )
    write(
        root,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/controller/admin/demo/DemoController.java",
        "package com.basicframework.module.system.controller.admin.demo;\n\n"
        "import com.basicframework.framework.common.pojo.CommonResult;\n"
        "import com.basicframework.framework.common.pojo.PageResult;\n"
        "import com.basicframework.module.system.controller.admin.demo.vo.DemoRespVO;\n"
        "import org.springframework.security.access.prepost.PreAuthorize;\n\n"
        "public class DemoController {\n\n"
        "    @GetMapping(\"/get\")\n"
        "    @PreAuthorize(\"@ss.hasPermission('system:demo:query')\")\n"
        "    public CommonResult<DemoRespVO> getDemo(Long id) {\n        return null;\n    }\n\n"
        "    @GetMapping(\"/page\")\n"
        "    @PreAuthorize(\"@ss.hasPermission('system:demo:query')\")\n"
        "    public CommonResult<PageResult<DemoRespVO>> getDemoPage() {\n        return null;\n    }\n"
        "}\n",
    )


def test_legal_contract_passes(tmp_path: Path) -> None:
    """合法契约全部被接受：统一响应模型、权限表达式与非秘密响应字段。"""
    build_project(tmp_path)
    checked, findings = contracts.verify(tmp_path)
    assert checked > 0
    assert findings == []


def test_dataobject_in_return_type_is_rejected(tmp_path: Path) -> None:
    """响应泛型实参为持久化对象时被拒绝，并定位到映射注解行。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/controller/admin/demo/LeakController.java",
        "package com.basicframework.module.system.controller.admin.demo;\n\n"
        "import com.basicframework.framework.common.pojo.CommonResult;\n"
        "import com.basicframework.module.system.dal.dataobject.demo.DemoDO;\n"
        "import org.springframework.security.access.prepost.PreAuthorize;\n\n"
        "public class LeakController {\n\n"
        "    @GetMapping(\"/get\")\n"
        "    @PreAuthorize(\"@ss.hasPermission('system:demo:query')\")\n"
        "    public CommonResult<DemoDO> getDemo(Long id) {\n        return null;\n    }\n"
        "}\n",
    )
    _, findings = contracts.verify(tmp_path)
    rules = [item.rule for item in findings]
    assert rules == ["do-in-http-contract"]
    assert findings[0].path.endswith("LeakController.java")
    assert findings[0].line == 9


def test_dataobject_in_request_parameter_is_rejected(tmp_path: Path) -> None:
    """请求参数直接使用持久化对象时被拒绝。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/controller/admin/demo/LeakController.java",
        "package com.basicframework.module.system.controller.admin.demo;\n\n"
        "import com.basicframework.framework.common.pojo.CommonResult;\n"
        "import com.basicframework.module.system.dal.dataobject.demo.DemoDO;\n"
        "import org.springframework.security.access.prepost.PreAuthorize;\n\n"
        "public class LeakController {\n\n"
        "    @PostMapping(\"/create\")\n"
        "    @PreAuthorize(\"@ss.hasPermission('system:demo:create')\")\n"
        "    public CommonResult<Long> createDemo(DemoDO reqVO) {\n        return null;\n    }\n"
        "}\n",
    )
    _, findings = contracts.verify(tmp_path)
    assert [item.rule for item in findings] == ["do-in-http-contract"]


def test_return_type_outside_response_contract_is_rejected(tmp_path: Path) -> None:
    """返回裸字符串等非统一响应模型时被拒绝。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/controller/admin/demo/LeakController.java",
        "package com.basicframework.module.system.controller.admin.demo;\n\n"
        "import org.springframework.security.access.prepost.PreAuthorize;\n\n"
        "public class LeakController {\n\n"
        "    @GetMapping(\"/name\")\n"
        "    @PreAuthorize(\"@ss.hasPermission('system:demo:query')\")\n"
        "    public String getName(Long id) {\n        return null;\n    }\n"
        "}\n",
    )
    _, findings = contracts.verify(tmp_path)
    assert [item.rule for item in findings] == ["response-contract-missing"]


def test_void_export_with_response_parameter_is_accepted(tmp_path: Path) -> None:
    """写入 HttpServletResponse 的导出方法属于合法协议出口，必须被接受。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/controller/admin/demo/ExportController.java",
        "package com.basicframework.module.system.controller.admin.demo;\n\n"
        "import jakarta.servlet.http.HttpServletResponse;\n"
        "import org.springframework.security.access.prepost.PreAuthorize;\n\n"
        "public class ExportController {\n\n"
        "    @GetMapping(\"/export\")\n"
        "    @PreAuthorize(\"@ss.hasPermission('system:demo:export')\")\n"
        "    public void export(HttpServletResponse response) {\n    }\n"
        "}\n",
    )
    _, findings = contracts.verify(tmp_path)
    assert findings == []


def test_void_without_response_parameter_is_rejected(tmp_path: Path) -> None:
    """没有响应输出参数的 void 端点无法表达真实返回内容，被拒绝。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/controller/admin/demo/LeakController.java",
        "package com.basicframework.module.system.controller.admin.demo;\n\n"
        "import org.springframework.security.access.prepost.PreAuthorize;\n\n"
        "public class LeakController {\n\n"
        "    @GetMapping(\"/sync\")\n"
        "    @PreAuthorize(\"@ss.hasPermission('system:demo:update')\")\n"
        "    public void sync() {\n    }\n"
        "}\n",
    )
    _, findings = contracts.verify(tmp_path)
    assert [item.rule for item in findings] == ["response-contract-missing"]


def test_endpoint_without_authorization_is_rejected(tmp_path: Path) -> None:
    """既无权限表达式也未登记的端点被拒绝，这是越权风险必须红的一侧。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/controller/admin/demo/LeakController.java",
        "package com.basicframework.module.system.controller.admin.demo;\n\n"
        "import com.basicframework.framework.common.pojo.CommonResult;\n\n"
        "import jakarta.annotation.security.PermitAll;\n\n"
        "public class LeakController {\n\n"
        "    @GetMapping(\"/secret\")\n"
        "    public CommonResult<Long> getSecret(Long id) {\n        return null;\n    }\n\n"
        "    @GetMapping(\"/open\")\n"
        "    @PermitAll\n"
        "    public CommonResult<Long> getOpen() {\n        return null;\n    }\n"
        "}\n",
    )
    _, findings = contracts.verify(tmp_path)
    assert [item.rule for item in findings] == ["endpoint-authorization-missing"]
    assert findings[0].line == 9


def test_comment_quoted_mapping_annotation_is_not_an_endpoint(tmp_path: Path) -> None:
    """注释里引用的映射注解不是真实契约面，不得产生幽灵端点或挪走真实注解窗口。

    来源说明会逐字引用被改写或移除的上游映射注解；若参与端点解析，会多出一条幽灵
    端点，并把紧随其后的真实方法的注解窗口挪空，使真实授权声明读不出来。
    """
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/controller/admin/demo/QuotedController.java",
        "package com.basicframework.module.system.controller.admin.demo;\n\n"
        "import com.basicframework.framework.common.pojo.CommonResult;\n"
        "import jakarta.annotation.security.PermitAll;\n\n"
        "/**\n"
        " * 演示控制器。\n"
        " *\n"
        " * 本地修改：上游代码在本地被移除或改写，例如 "
        "@PostMapping(\"/super-admin-login\")；\n"
        " */\n"
        "public class QuotedController {\n\n"
        "    @PostMapping(\"/login\")\n"
        "    @PermitAll\n"
        "    public CommonResult<Long> login(Long id) {\n        return null;\n    }\n"
        "}\n",
    )
    endpoints = [
        item
        for item in contracts.collect_endpoints(tmp_path)
        if item.path.endswith("QuotedController.java")
    ]
    assert [(item.method, item.line, item.permit_all) for item in endpoints] == [
        ("login", 13, True)
    ]
    _, findings = contracts.verify(tmp_path)
    assert findings == []


def test_comment_quoted_authorization_is_not_authorization(tmp_path: Path) -> None:
    """注释里引用的 `@PreAuthorize`/`@PermitAll` 不是授权声明，端点必须仍被拒绝。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/controller/admin/demo/CommentAuthController.java",
        "package com.basicframework.module.system.controller.admin.demo;\n\n"
        "import com.basicframework.framework.common.pojo.CommonResult;\n\n"
        "/**\n"
        " * 演示控制器。\n"
        " *\n"
        " * 本地修改：上游代码例如 "
        "@PreAuthorize(\"@ss.hasPermission('system:demo:query')\") 与 @PermitAll。\n"
        " */\n"
        "public class CommentAuthController {\n\n"
        "    @GetMapping(\"/secret\")\n"
        "    public CommonResult<Long> getSecret(Long id) {\n        return null;\n    }\n"
        "}\n",
    )
    _, findings = contracts.verify(tmp_path)
    assert [item.rule for item in findings] == ["endpoint-authorization-missing"]
    assert findings[0].line == 12


def test_literal_content_is_not_parsed_as_annotation(tmp_path: Path) -> None:
    """字符串与文本块里的注解文本不是契约面，真实注解与表达式仍必须被读出。

    这条同时是“剥离不能把真实注解一起剥掉”的负对照：字面量里的 `@PreAuthorize` 与
    `@PostMapping` 都不得授权或生成端点；字符串里的 ``//`` 不得把同一行其后的真实
    `@PreAuthorize` 一起剥掉；真实表达式必须完整读出。文本块里的引号无需转义，因此
    它也是“只按注释窗口判断注解是否存在”这一层的必要对照。
    """
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/controller/admin/demo/LiteralController.java",
        "package com.basicframework.module.system.controller.admin.demo;\n\n"
        "import com.basicframework.framework.common.pojo.CommonResult;\n\n"
        "public class LiteralController {\n\n"
        "    private static final String TEMPLATE = \"@PostMapping(\\\"/ghost\\\")\";\n\n"
        "    private static final String DOC = \"\"\"\n"
        "            本地修改：上游代码例如 @PostMapping(\"/text-block-ghost\") 与\n"
        "            @PreAuthorize(\"@ss.hasPermission('system:demo:query')\")\n"
        "            \"\"\";\n\n"
        "    @GetMapping(\"/ghost\")\n"
        "    public CommonResult<Long> ghost(Long id) {\n        return null;\n    }\n\n"
        "    @GetMapping(\"/real\")\n"
        "    @Operation(summary = \"见 https://example.com/docs\") "
        "@PreAuthorize(\"@ss.hasPermission('system:demo:query')\")\n"
        "    public CommonResult<Long> real(Long id) {\n        return null;\n    }\n"
        "}\n",
    )
    endpoints = [
        item
        for item in contracts.collect_endpoints(tmp_path)
        if item.path.endswith("LiteralController.java")
    ]
    assert [item.method for item in endpoints] == ["ghost", "real"]
    assert endpoints[0].pre_authorize is None
    assert endpoints[0].permit_all is False
    assert endpoints[1].pre_authorize == "@ss.hasPermission('system:demo:query')"
    _, findings = contracts.verify(tmp_path)
    assert [item.rule for item in findings] == ["endpoint-authorization-missing"]


def test_class_level_pre_authorize_is_still_read(tmp_path: Path) -> None:
    """类级 `@PreAuthorize` 是授权声明：字面量被屏蔽后表达式仍必须读出并落到端点上。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/controller/admin/demo/ClassScopedController.java",
        "package com.basicframework.module.system.controller.admin.demo;\n\n"
        "import com.basicframework.framework.common.pojo.CommonResult;\n\n"
        "@RestController\n"
        "@PreAuthorize(\"@ss.hasPermission('system:demo:query')\")\n"
        "public class ClassScopedController {\n\n"
        "    @GetMapping(\"/first\")\n"
        "    @PreAuthorize(\"@ss.hasPermission('system:demo:query')\")\n"
        "    public CommonResult<Long> first(Long id) {\n        return null;\n    }\n\n"
        "    @GetMapping(\"/second\")\n"
        "    public CommonResult<Long> second(Long id) {\n        return null;\n    }\n"
        "}\n",
    )
    endpoints = [
        item
        for item in contracts.collect_endpoints(tmp_path)
        if item.path.endswith("ClassScopedController.java")
    ]
    assert [item.pre_authorize for item in endpoints] == ["@ss.hasPermission('system:demo:query')"] * 2
    _, findings = contracts.verify(tmp_path)
    assert findings == []


def test_registered_identity_scoped_endpoint_is_accepted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """登记为只作用于当前登录身份、且实现确实读取认证上下文的端点被接受。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/controller/admin/demo/ProfileController.java",
        "package com.basicframework.module.system.controller.admin.demo;\n\n"
        "import com.basicframework.framework.common.pojo.CommonResult;\n\n"
        "public class ProfileController {\n\n"
        "    @GetMapping(\"/get\")\n"
        "    public CommonResult<Long> getProfile() {\n"
        "        return success(getLoginUserId());\n    }\n"
        "}\n",
    )
    monkeypatch.setattr(
        contracts,
        "IDENTITY_SCOPED_ENDPOINTS",
        (("ProfileController", "getProfile", "只读取当前登录用户本人资料", "getLoginUserId"),),
    )
    _, findings = contracts.verify(tmp_path)
    assert findings == []


def test_registered_endpoint_without_evidence_is_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """登记项声称的认证上下文取值未出现在实现中时被拒绝，登记不能没有依据。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/controller/admin/demo/ProfileController.java",
        "package com.basicframework.module.system.controller.admin.demo;\n\n"
        "import com.basicframework.framework.common.pojo.CommonResult;\n\n"
        "public class ProfileController {\n\n"
        "    @GetMapping(\"/get\")\n"
        "    public CommonResult<Long> getProfile(Long userId) {\n        return null;\n    }\n"
        "}\n",
    )
    monkeypatch.setattr(
        contracts,
        "IDENTITY_SCOPED_ENDPOINTS",
        (("ProfileController", "getProfile", "只读取当前登录用户本人资料", "getLoginUserId"),),
    )
    _, findings = contracts.verify(tmp_path)
    rules = {item.rule for item in findings}
    assert "authorization-evidence-missing" in rules


def test_authenticated_registry_evidence_must_exist(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """安全链登记项指向不存在的判定类型时被拒绝。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/controller/admin/demo/OpenController.java",
        "package com.basicframework.module.system.controller.admin.demo;\n\n"
        "import com.basicframework.framework.common.pojo.CommonResult;\n\n"
        "public class OpenController {\n\n"
        "    @GetMapping(\"/get\")\n"
        "    public CommonResult<Long> getOpen() {\n        return null;\n    }\n"
        "}\n",
    )
    monkeypatch.setattr(
        contracts,
        "AUTHENTICATED_ENDPOINTS",
        (("OpenController", "getOpen", "只要求真实用户主体", "MissingAuthorizationManager"),),
    )
    _, findings = contracts.verify(tmp_path)
    assert [item.rule for item in findings] == ["authorization-evidence-missing"]


def test_registry_entry_for_enforced_endpoint_is_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """把已有显式授权的端点又登记一遍时被拒绝，登记表不能与真实声明重复。"""
    build_project(tmp_path)
    monkeypatch.setattr(
        contracts,
        "IDENTITY_SCOPED_ENDPOINTS",
        (("DemoController", "getDemo", "重复登记", "getLoginUserId"),),
    )
    _, findings = contracts.verify(tmp_path)
    rules = {item.rule for item in findings}
    assert "authorization-registry-redundant" in rules
    redundant = [item for item in findings if item.rule == "authorization-registry-redundant"]
    assert redundant[0].path.endswith("DemoController.java")


def test_registry_entry_for_unknown_endpoint_is_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """登记表中出现并不存在的端点时被拒绝，登记不能长期漂移。"""
    build_project(tmp_path)
    monkeypatch.setattr(
        contracts,
        "AUTHENTICATED_ENDPOINTS",
        (("DemoController", "removedEndpoint", "已删除的端点", "RealUserRequiredAuthorizationManager"),),
    )
    _, findings = contracts.verify(tmp_path)
    rules = {item.rule for item in findings}
    assert "authorization-registry-unknown" in rules


def test_credential_field_in_response_model_is_rejected(tmp_path: Path) -> None:
    """响应模型声明凭据字段时被拒绝，这是敏感字段泄露必须红的一侧。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/controller/admin/demo/vo/SecretRespVO.java",
        "package com.basicframework.module.system.controller.admin.demo.vo;\n\n"
        "public class SecretRespVO {\n    private Long id;\n    private String apiSecret;\n}\n",
    )
    _, findings = contracts.verify(tmp_path)
    assert [item.rule for item in findings] == ["sensitive-field-in-response"]
    assert findings[0].line == 5
    assert "apiSecret" in findings[0].message


def test_registered_token_issuing_response_is_accepted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """登记在册的令牌签发响应继续下发令牌，必须被接受。"""
    build_project(tmp_path)
    monkeypatch.setattr(contracts, "ISSUING_RESPONSE_MODELS", frozenset({"AuthLoginRespVO"}))
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/controller/admin/demo/vo/AuthLoginRespVO.java",
        "package com.basicframework.module.system.controller.admin.demo.vo;\n\n"
        "public class AuthLoginRespVO {\n    private String accessToken;\n"
        "    private String refreshToken;\n}\n",
    )
    _, findings = contracts.verify(tmp_path)
    assert findings == []


def test_validity_seconds_is_not_a_credential(tmp_path: Path) -> None:
    """带有效期后缀的配置数值不是凭据，不能误报为敏感字段泄露。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/controller/admin/demo/vo/ClientRespVO.java",
        "package com.basicframework.module.system.controller.admin.demo.vo;\n\n"
        "public class ClientRespVO {\n    private Integer accessTokenValiditySeconds;\n"
        "    private Integer refreshTokenValiditySeconds;\n}\n",
    )
    _, findings = contracts.verify(tmp_path)
    assert findings == []


def test_empty_project_is_not_a_pass(tmp_path: Path) -> None:
    """没有找到任何 Controller 时返回零对象，由调用方按不适用处理。"""
    checked, findings = contracts.verify(tmp_path)
    assert (checked, findings) == (0, [])


def test_unbalanced_parenthesis_is_rejected(tmp_path: Path) -> None:
    """方法签名括号不配对时检查不能给出可信结论，直接报未完成。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/controller/admin/demo/BrokenController.java",
        "package com.basicframework.module.system.controller.admin.demo;\n\n"
        "public class BrokenController {\n\n"
        "    @GetMapping(\"/broken\")\n"
        "    public CommonResult<Long> broken(Long id {\n        return null;\n    }\n"
        "}\n",
    )
    with pytest.raises(CheckError, match="括号不配对"):
        contracts.verify(tmp_path)


def test_repository_api_contracts_pass(monkeypatch: pytest.MonkeyPatch) -> None:
    """真实仓库的接口契约全部被接受，且检查对象覆盖全部端点与响应模型。"""
    # 检查目录被改错时零对象会被检查器当成“不适用”放行，这里必须以失败暴露，不能退化成跳过。
    assert (DEFAULT_ROOT / BACKEND).is_dir(), "对象范围缺失：检查目录被改错或后端工程未随仓库提供"
    restore_registries(monkeypatch)
    checked, findings = contracts.verify(DEFAULT_ROOT)
    assert findings == []
    endpoints = contracts.collect_endpoints(DEFAULT_ROOT)
    assert len(endpoints) == 145
    # 端点提取必须真正读出权限表达式，不能把带注解的端点算成无授权。
    assert sum(1 for item in endpoints if item.pre_authorize) == 112
    assert {endpoint.http_method for endpoint in endpoints} == {"Get", "Post", "Put", "Delete"}
    assert checked > len(endpoints)


def test_repository_endpoints_and_models_are_actually_read(monkeypatch: pytest.MonkeyPatch) -> None:
    """真实仓库必须真的读到方法签名与响应模型，避免空扫描伪装成通过。"""
    # 零对象不是通过路径；目录被改错时必须失败，避免跳过掩盖空扫描。
    assert (DEFAULT_ROOT / BACKEND).is_dir(), "对象范围缺失：检查目录被改错或后端工程未随仓库提供"
    restore_registries(monkeypatch)
    endpoints = contracts.collect_endpoints(DEFAULT_ROOT)
    assert all(endpoint.return_type for endpoint in endpoints)
    assert all(endpoint.parameters is not None for endpoint in endpoints)
    authorized = [item for item in endpoints if item.pre_authorize]
    permitted = [item for item in endpoints if item.permit_all]
    neither = [item for item in endpoints if not item.pre_authorize and not item.permit_all]
    assert len(authorized) == 112
    assert len(permitted) == 15
    # 其余端点必须逐条登记在授权登记表内，登记表本身由 check_authorization 核对。
    registered = {(item[0], item[1]) for item in ORIGINAL_AUTHENTICATED_ENDPOINTS} | {
        (item[0], item[1]) for item in ORIGINAL_IDENTITY_SCOPED_ENDPOINTS
    }
    assert {(item.controller, item.method) for item in neither} == registered
    assert contracts.dataobject_names(DEFAULT_ROOT) >= {"AdminUserDO", "SmsChannelDO"}
    models = {model.name for model in contracts.collect_response_models(DEFAULT_ROOT)}
    assert "SmsChannelRespVO" not in models
    assert "OAuth2AccessTokenRespVO" in models
