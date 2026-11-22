package com.basicframework.server.archunit;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.domain.JavaMethod;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 在质量门禁中执行全量后端架构规则：分层、授权完备性、模块隔离、事务边界与编码禁令。
 *
 * @author shady2713
 */
@AnalyzeClasses(packages = "com.basicframework", importOptions = ImportOption.DoNotIncludeTests.class)
class FootgunArchitectureTest {

    /** 控制器不得直接依赖 mapper / dal 持久化包。 */
    @ArchTest
    static final ArchRule controllersMustNotDependOnPersistence =
            FootgunRules.controllersMustNotDependOnPersistence();

    /** 产品代码不得访问 System.out / System.err / System.in。 */
    @ArchTest
    static final ArchRule noStandardStreams = FootgunRules.noStandardStreams();

    /** 产品代码不得调用 printStackTrace。 */
    @ArchTest
    static final ArchRule noPrintStackTrace = FootgunRules.noPrintStackTrace();

    /** 禁止在类上声明 @PermitAll。 */
    @ArchTest
    static final ArchRule noClassLevelPermitAll = FootgunRules.noClassLevelPermitAll();

    /** @PermitAll 方法必须位于显式允许名单。 */
    @ArchTest
    static final ArchRule permitAllMustBeAllowlisted = FootgunRules.permitAllMustBeAllowlisted();

    /** 所有控制器路由端点必须显式声明 @PreAuthorize 或 @PermitAll。 */
    @ArchTest
    static final ArchRule controllerEndpointsMustDeclareAuthorization =
            FootgunRules.controllerEndpointsMustDeclareAuthorization();

    /** 公共 core 模块不得反向依赖业务 module 或 server。 */
    @ArchTest
    static final ArchRule coreMustNotDependOnModulesOrServer =
            FootgunRules.coreMustNotDependOnModulesOrServer();

    /** 业务模块间不得跨模块访问对方内部实现包。 */
    @ArchTest
    static final ArchRule businessModulesMustNotCrossDependOnInternals =
            FootgunRules.businessModulesMustNotCrossDependOnInternals();

    /** 所有方法级 @Transactional 必须显式声明 rollbackFor。 */
    @ArchTest
    static final ArchRule transactionalMustDeclareRollbackFor =
            FootgunRules.transactionalMustDeclareRollbackFor();

    /** 所有类级 @Transactional 必须显式声明 rollbackFor。 */
    @ArchTest
    static final ArchRule classLevelTransactionalMustDeclareRollbackFor =
            FootgunRules.classLevelTransactionalMustDeclareRollbackFor();

    /** 控制器 HTTP 端点签名不得直接暴露持久化 DO。 */
    @ArchTest
    static final ArchRule controllerEndpointsMustNotExposeDataObjects =
            FootgunRules.controllerEndpointsMustNotExposeDataObjects();

    /** 业务模块不得直接抛出未分类的裸通用异常。 */
    @ArchTest
    static final ArchRule businessModulesMustNotThrowGenericExceptions =
            FootgunRules.businessModulesMustNotThrowGenericExceptions();

    /** 产品代码统一使用 SLF4J，不得依赖旧日志 API。 */
    @ArchTest
    static final ArchRule noLegacyLoggingApis = FootgunRules.noLegacyLoggingApis();

    /**
     * 允许名单中的每一个端点都必须仍然存在于当前产品代码中，避免名单在端点被删除后仍看似有效。
     *
     * @param classes 已导入的产品类
     */
    @ArchTest
    static void allowlistEntriesExist(JavaClasses classes) {
        for (String key : FootgunRules.PERMIT_ALL_ALLOWLIST) {
            int split = key.indexOf('#');
            String className = key.substring(0, split);
            String methodName = key.substring(split + 1);
            assertTrue(classes.contain(className), "允许名单中的类不存在：" + className);
            JavaClass javaClass = classes.get(className);
            boolean found = false;
            for (JavaMethod method : javaClass.getMethods()) {
                if (methodName.equals(method.getName())) {
                    found = true;
                    break;
                }
            }
            assertTrue(found, "允许名单中的方法不存在：" + key);
        }
        assertFalse(FootgunRules.PERMIT_ALL_ALLOWLIST.isEmpty(), "允许名单不得为空");
    }
}
