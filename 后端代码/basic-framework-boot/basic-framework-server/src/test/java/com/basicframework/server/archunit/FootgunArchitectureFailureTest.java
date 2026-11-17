package com.basicframework.server.archunit;

import com.basicframework.module.system.controller.admin.footgun.ForbiddenMapperAccessController;
import com.basicframework.module.system.controller.admin.footgun.ForbiddenPublicEndpointController;
import com.basicframework.module.system.dal.mysql.footgun.ForbiddenFootgunMapper;
import com.basicframework.module.system.service.footgun.ForbiddenStandardStreamUsage;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.lang.EvaluationResult;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 反向证明：夹具中的脚枪样本必须被对应 ArchUnit 规则判定为失败。
 */
class FootgunArchitectureFailureTest {

    /**
     * 导入指定夹具类，供单条规则评估。
     *
     * @param classes 夹具类
     * @return 仅包含这些类的导入结果
     */
    private static JavaClasses importFixtures(Class<?>... classes) {
        return new ClassFileImporter().importClasses(classes);
    }

    /**
     * 判断规则评估是否产生失败，并带上失败报告便于诊断。
     *
     * @param result 规则评估结果
     * @param marker 失败报告中应出现的夹具标识
     */
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
}
