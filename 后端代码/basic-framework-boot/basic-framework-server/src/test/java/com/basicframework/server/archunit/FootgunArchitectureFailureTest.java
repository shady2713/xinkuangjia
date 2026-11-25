package com.basicframework.server.archunit;

import com.basicframework.framework.footgun.ForbiddenCoreModuleDependency;
import com.basicframework.module.infra.service.footgun.ForbiddenClassLevelTxService;
import com.basicframework.module.infra.service.footgun.ForbiddenCrossModuleAndUnqualifiedTxService;
import com.basicframework.module.system.controller.admin.footgun.ForbiddenDoExposureController;
import com.basicframework.module.system.controller.admin.footgun.ForbiddenMapperAccessController;
import com.basicframework.module.system.controller.admin.footgun.ForbiddenPublicEndpointController;
import com.basicframework.module.system.controller.admin.footgun.ForbiddenUnprotectedEndpointController;
import com.basicframework.module.system.dal.dataobject.footgun.ForbiddenFootgunDO;
import com.basicframework.module.system.dal.mysql.footgun.ForbiddenFootgunMapper;
import com.basicframework.module.system.service.footgun.ForbiddenGenericExceptionAndJulUsage;
import com.basicframework.module.system.service.footgun.ForbiddenStandardStreamUsage;
import com.basicframework.module.system.web.footgun.ForbiddenNonControllerPkgEndpoint;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.lang.EvaluationResult;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 反向证明：夹具中的违规架构样本必须被对应 ArchUnit 规则判定为失败。
 *
 * @author shady
 */
class FootgunArchitectureFailureTest {

    /** 导入指定夹具类供单条规则评估。 */
    private static JavaClasses importFixtures(Class<?>... classes) {
        return new ClassFileImporter().importClasses(classes);
    }

    /** 断言评估产生违规且失败报告命中目标夹具名。 */
    private static void assertViolated(EvaluationResult result, String marker) {
        String report = result.getFailureReport().toString();
        assertTrue(result.hasViolation(), "规则应判定夹具失败，实际报告：" + report);
        assertTrue(report.contains(marker), "失败报告应包含夹具标识 " + marker + "，实际：" + report);
    }

    /** 名单外的 @PermitAll 端点必须失败。 */
    @Test
    void newPermitAllOutsideAllowlistFails() {
        EvaluationResult result = FootgunRules.permitAllMustBeAllowlisted()
                .evaluate(importFixtures(ForbiddenPublicEndpointController.class));
        assertViolated(result, "ForbiddenPublicEndpointController");
    }

    /** 漏写 @PreAuthorize 与 @PermitAll 的控制器端点必须失败。 */
    @Test
    void unprotectedControllerEndpointFails() {
        EvaluationResult result = FootgunRules.controllerEndpointsMustDeclareAuthorization()
                .evaluate(importFixtures(ForbiddenUnprotectedEndpointController.class));
        assertViolated(result, "ForbiddenUnprotectedEndpointController");
    }

    /** 控制器直接依赖 mapper 包必须失败。 */
    @Test
    void controllerDependingOnMapperFails() {
        EvaluationResult result = FootgunRules.controllersMustNotDependOnPersistence()
                .evaluate(importFixtures(
                        ForbiddenMapperAccessController.class, ForbiddenFootgunMapper.class));
        assertViolated(result, "ForbiddenMapperAccessController");
    }

    /** 产品代码使用 System.out 必须失败。 */
    @Test
    void standardStreamUsageFails() {
        JavaClasses classes = importFixtures(ForbiddenStandardStreamUsage.class);
        assertViolated(FootgunRules.noStandardStreams().evaluate(classes), "ForbiddenStandardStreamUsage");
    }

    /** 产品代码调用 printStackTrace 必须失败。 */
    @Test
    void printStackTraceUsageFails() {
        JavaClasses classes = importFixtures(ForbiddenStandardStreamUsage.class);
        assertViolated(FootgunRules.noPrintStackTrace().evaluate(classes), "ForbiddenStandardStreamUsage");
    }

    /** 公共基础层 core 依赖业务 module 必须失败。 */
    @Test
    void coreDependingOnBusinessModuleFails() {
        JavaClasses classes = importFixtures(
                ForbiddenCoreModuleDependency.class, ForbiddenFootgunMapper.class);
        assertViolated(
                FootgunRules.coreMustNotDependOnModulesOrServer().evaluate(classes),
                "ForbiddenCoreModuleDependency");
    }

    /** 跨业务模块直接依赖兄弟模块内部包必须失败。 */
    @Test
    void crossModuleInternalDependencyFails() {
        JavaClasses classes = importFixtures(
                ForbiddenCrossModuleAndUnqualifiedTxService.class, ForbiddenFootgunMapper.class);
        assertViolated(
                FootgunRules.businessModulesMustNotCrossDependOnInternals().evaluate(classes),
                "ForbiddenCrossModuleAndUnqualifiedTxService");
    }

    /** 未显式声明 rollbackFor 的 @Transactional 方法必须失败。 */
    @Test
    void unqualifiedTransactionalMethodFails() {
        JavaClasses classes = importFixtures(ForbiddenCrossModuleAndUnqualifiedTxService.class);
        assertViolated(
                FootgunRules.transactionalMustDeclareRollbackFor().evaluate(classes),
                "ForbiddenCrossModuleAndUnqualifiedTxService");
    }

    /** 控制器 HTTP 端点在泛型返回类型中暴露持久化 DO 必须失败。 */
    @Test
    void controllerExposingDoInEndpointSignatureFails() {
        JavaClasses classes = importFixtures(
                ForbiddenDoExposureController.class, ForbiddenFootgunDO.class);
        assertViolated(
                FootgunRules.controllerEndpointsMustNotExposeDataObjects().evaluate(classes),
                "ForbiddenDoExposureController");
    }

    /** 业务模块直接抛出裸 RuntimeException 必须失败。 */
    @Test
    void businessModuleThrowingGenericExceptionFails() {
        JavaClasses classes = importFixtures(ForbiddenGenericExceptionAndJulUsage.class);
        assertViolated(
                FootgunRules.businessModulesMustNotThrowGenericExceptions().evaluate(classes),
                "ForbiddenGenericExceptionAndJulUsage");
    }

    /** 产品代码使用 java.util.logging 必须失败。 */
    @Test
    void legacyJulLoggingFails() {
        JavaClasses classes = importFixtures(ForbiddenGenericExceptionAndJulUsage.class);
        assertViolated(
                FootgunRules.noLegacyLoggingApis().evaluate(classes),
                "ForbiddenGenericExceptionAndJulUsage");
    }

    /** 放在 ..controller.. 包之外的 @RestController 未声明权限必须失败。 */
    @Test
    void nonControllerPackageEndpointWithoutAuthFails() {
        JavaClasses classes = importFixtures(ForbiddenNonControllerPkgEndpoint.class);
        assertViolated(
                FootgunRules.controllerEndpointsMustDeclareAuthorization().evaluate(classes),
                "hiddenUnprotected");
    }

    /** 在 @PreAuthorize 中使用 permitAll() 表达式绕过白名单必须失败。 */
    @Test
    void preAuthorizePermitAllBypassFails() {
        JavaClasses classes = importFixtures(ForbiddenNonControllerPkgEndpoint.class);
        assertViolated(
                FootgunRules.controllerEndpointsMustDeclareAuthorization().evaluate(classes),
                "preAuthBypass");
    }

    /** 类级 @Transactional 省略 rollbackFor 必须失败。 */
    @Test
    void classLevelUnqualifiedTransactionalFails() {
        JavaClasses classes = importFixtures(ForbiddenClassLevelTxService.class);
        assertViolated(
                FootgunRules.classLevelTransactionalMustDeclareRollbackFor().evaluate(classes),
                "ForbiddenClassLevelTxService");
    }
}
