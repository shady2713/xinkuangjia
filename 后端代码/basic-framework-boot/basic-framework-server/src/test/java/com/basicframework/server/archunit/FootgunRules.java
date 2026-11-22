package com.basicframework.server.archunit;

import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.Dependency;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaMethod;
import com.tngtech.archunit.core.domain.JavaMethodCall;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import com.tngtech.archunit.library.GeneralCodingRules;
import jakarta.annotation.security.PermitAll;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Controller;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Set;
import java.util.regex.Pattern;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.methods;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

/**
 * 后端确定性架构门禁规则，供质量门禁测试与反向失败夹具复用。
 *
 * @author shady2713
 */
final class FootgunRules {

    /**
     * 公开端点允许名单，格式为「全限定类名#方法名」。
     */
    static final Set<String> PERMIT_ALL_ALLOWLIST = Set.of(
            "com.basicframework.module.system.controller.admin.auth.AuthController#getSm2PublicKey",
            "com.basicframework.module.system.controller.admin.auth.AuthController#login",
            "com.basicframework.module.system.controller.admin.auth.AuthController#superAdminLogin",
            "com.basicframework.module.system.controller.admin.auth.AuthController#logout",
            "com.basicframework.module.system.controller.admin.auth.AuthController#refreshToken",
            "com.basicframework.module.system.controller.admin.auth.AuthController#smsLogin",
            "com.basicframework.module.system.controller.admin.auth.AuthController#sendLoginSmsCode",
            "com.basicframework.module.system.controller.admin.auth.AuthController#resetPassword",
            "com.basicframework.module.system.controller.admin.captcha.CaptchaController#get",
            "com.basicframework.module.system.controller.admin.captcha.CaptchaController#check",
            "com.basicframework.module.system.controller.open.oauth2.OAuth2OpenController#token",
            "com.basicframework.module.infra.controller.admin.file.FileController#getFileContent"
    );

    /** 匹配试图通过 {@code @PreAuthorize} 放行全部请求的绕过表达式。 */
    private static final Pattern PRE_AUTHORIZE_BYPASS_PATTERN = Pattern.compile(
            "(?is).*\\bpermitAll\\s*\\(.*|^\\s*true\\s*$");

    /** 跨模块严禁直接访问的对方模块内部包名段。 */
    private static final Set<String> MODULE_INTERNAL_SEGMENTS = Set.of(
            "controller", "service", "dal", "convert", "framework", "mq", "job"
    );

    /** 工具类，禁止实例化。 */
    private FootgunRules() {
    }

    /**
     * 标识一个带 {@code @PermitAll} 的方法。
     *
     * @param method 待标识方法
     * @return 全限定类名与方法名组成的允许名单键
     */
    static String permitAllKey(JavaMethod method) {
        return method.getOwner().getName() + "#" + method.getName();
    }

    /**
     * 判断类是否位于 {@code ..controller..} 包或标注了 {@code @Controller} / {@code @RestController}。
     *
     * @return Spring 控制器类匹配谓词
     */
    private static DescribedPredicate<JavaClass> isSpringControllerClass() {
        DescribedPredicate<JavaClass> inControllerPackage =
                JavaClass.Predicates.resideInAPackage("..controller..");
        return new DescribedPredicate<JavaClass>("位于 controller 包或标注 @Controller/@RestController") {
            @Override
            public boolean test(JavaClass javaClass) {
                return inControllerPackage.test(javaClass)
                        || javaClass.isAnnotatedWith(Controller.class)
                        || javaClass.isMetaAnnotatedWith(Controller.class)
                        || javaClass.isAnnotatedWith(RestController.class);
            }
        };
    }

    /**
     * 控制器不得直接依赖 mapper / dal.mysql / dal.redis 持久化包。
     *
     * @return 分层规则
     */
    static ArchRule controllersMustNotDependOnPersistence() {
        return noClasses()
                .that(isSpringControllerClass())
                .should().dependOnClassesThat()
                .resideInAnyPackage("..dal.mysql..", "..dal.redis..", "..mybatis.core.mapper..")
                .because("控制器不得直接依赖 mapper 或 dal 持久化包，应经过 service 层");
    }

    /**
     * 产品代码不得访问标准输入输出流。
     *
     * @return 标准流访问规则
     */
    static ArchRule noStandardStreams() {
        return noClasses()
                .that().resideInAPackage("com.basicframework..")
                .should(GeneralCodingRules.ACCESS_STANDARD_STREAMS)
                .because("产品代码禁止使用 System.out / System.err / System.in");
    }

    /**
     * 判断一次方法调用是否为 {@code Throwable.printStackTrace} 或其子类上的同名调用。
     *
     * @param call 待检查的方法调用
     * @return 若调用属于打印堆栈则返回 true
     */
    static boolean isPrintStackTraceCall(JavaMethodCall call) {
        if (!"printStackTrace".equals(call.getName())) {
            return false;
        }
        JavaClass owner = call.getTargetOwner();
        if (owner.isAssignableTo(Throwable.class)) {
            return true;
        }
        String name = owner.getName();
        return "java.lang.Throwable".equals(name)
                || name.endsWith("Exception")
                || name.endsWith("Error");
    }

    /**
     * 产品代码不得调用 {@code printStackTrace}。
     *
     * @return 异常堆栈打印规则
     */
    static ArchRule noPrintStackTrace() {
        return noClasses()
                .that().resideInAPackage("com.basicframework..")
                .should().callMethodWhere(new DescribedPredicate<JavaMethodCall>("调用 Throwable.printStackTrace") {
                    @Override
                    public boolean test(JavaMethodCall call) {
                        return isPrintStackTraceCall(call);
                    }
                })
                .because("产品代码禁止调用 printStackTrace，应使用日志记录异常");
    }

    /**
     * 类上不得使用 {@code @PermitAll}，避免整类接口被意外公开。
     *
     * @return 类级公开注解规则
     */
    static ArchRule noClassLevelPermitAll() {
        return noClasses()
                .that().resideInAPackage("com.basicframework..")
                .should().beAnnotatedWith(PermitAll.class)
                .because("禁止在类上使用 @PermitAll，公开端点必须逐方法列入允许名单");
    }

    /**
     * 方法上的 {@code @PermitAll} 必须位于显式允许名单。
     *
     * @return 公开端点允许名单规则
     */
    static ArchRule permitAllMustBeAllowlisted() {
        return methods()
                .that().areAnnotatedWith(PermitAll.class)
                .should(new ArchCondition<JavaMethod>("位于 @PermitAll 允许名单") {
                    @Override
                    public void check(JavaMethod method, ConditionEvents events) {
                        String key = permitAllKey(method);
                        if (!PERMIT_ALL_ALLOWLIST.contains(key)) {
                            events.add(SimpleConditionEvent.violated(
                                    method,
                                    "公开端点不在允许名单：" + key));
                        }
                    }
                })
                .because("名单外新增 @PermitAll 端点必须失败，防止意外公开接口");
    }

    /**
     * 控制器中的每一个 HTTP 路由端点都必须显式标注 {@code @PreAuthorize} 或 {@code @PermitAll}，封死漏鉴权与表达式绕过盲区。
     *
     * @return 端点显式授权声明规则
     */
    static ArchRule controllerEndpointsMustDeclareAuthorization() {
        return methods()
                .that().areDeclaredInClassesThat().resideInAPackage("com.basicframework..")
                .and(isRequestMappingEndpoint())
                .should(new ArchCondition<JavaMethod>("显式标注非绕过的 @PreAuthorize 或 @PermitAll") {
                    @Override
                    public void check(JavaMethod method, ConditionEvents events) {
                        String methodPreAuth = method.tryGetAnnotationOfType(PreAuthorize.class)
                                .map(PreAuthorize::value)
                                .orElse(null);
                        String ownerPreAuth = method.getOwner().tryGetAnnotationOfType(PreAuthorize.class)
                                .map(PreAuthorize::value)
                                .orElse(null);
                        boolean hasPreAuthorize = methodPreAuth != null || ownerPreAuth != null;
                        boolean hasPermitAll = method.isAnnotatedWith(PermitAll.class);
                        if (!hasPreAuthorize && !hasPermitAll) {
                            events.add(SimpleConditionEvent.violated(
                                    method,
                                    "HTTP 端点未显式声明 @PreAuthorize 或 @PermitAll：" + method.getFullName()));
                            return;
                        }
                        if ((methodPreAuth != null && PRE_AUTHORIZE_BYPASS_PATTERN.matcher(methodPreAuth).matches())
                                || (ownerPreAuth != null && PRE_AUTHORIZE_BYPASS_PATTERN.matcher(ownerPreAuth).matches())) {
                            events.add(SimpleConditionEvent.violated(
                                    method,
                                    "@PreAuthorize 禁止使用 permitAll() 或恒真表达式绕过公开端点白名单："
                                            + method.getFullName()));
                        }
                    }
                })
                .because("所有 HTTP 端点必须显式声明有效 @PreAuthorize 或受审 @PermitAll，禁止位置躲避或 SpEL 恒真绕过");
    }

    /**
     * 公共基础层 core 不得反向依赖业务模块或启动装配模块。
     *
     * @return 模块单向依赖规则
     */
    static ArchRule coreMustNotDependOnModulesOrServer() {
        return noClasses()
                .that().resideInAPackage("com.basicframework.framework..")
                .should().dependOnClassesThat()
                .resideInAnyPackage("com.basicframework.module..", "com.basicframework.server..")
                .because("basic-framework-core 必须保持业务无关，不得依赖 module 或 server");
    }

    /**
     * 业务模块之间严禁跨模块直接依赖对方的 controller/service/dal/convert/framework 内部实现，仅允许依赖 api 或 enums。
     *
     * @return 业务模块水平隔离规则
     */
    static ArchRule businessModulesMustNotCrossDependOnInternals() {
        return classes()
                .that().resideInAPackage("com.basicframework.module..")
                .should(new ArchCondition<JavaClass>("不跨业务模块访问内部实现包") {
                    @Override
                    public void check(JavaClass origin, ConditionEvents events) {
                        String originModule = extractModuleName(origin.getPackageName());
                        if (originModule == null) {
                            return;
                        }
                        for (Dependency dep : origin.getDirectDependenciesFromSelf()) {
                            JavaClass target = dep.getTargetClass();
                            String targetPkg = target.getPackageName();
                            String targetModule = extractModuleName(targetPkg);
                            if (targetModule == null || originModule.equals(targetModule)) {
                                continue;
                            }
                            String subSegment = extractModuleSubSegment(targetPkg, targetModule);
                            if (subSegment != null && MODULE_INTERNAL_SEGMENTS.contains(subSegment)) {
                                events.add(SimpleConditionEvent.violated(
                                        origin,
                                        "跨模块违规依赖内部实现（仅允许依赖 api/enums）："
                                                + origin.getName() + " -> " + target.getName()));
                            }
                        }
                    }
                })
                .because("业务模块之间只能通过 api 与 enums 包通信，禁止穿透访问其他模块的内部实现");
    }

    /**
     * 提取 {@code com.basicframework.module.<name>} 中的模块名。
     */
    private static String extractModuleName(String packageName) {
        String prefix = "com.basicframework.module.";
        if (!packageName.startsWith(prefix)) {
            return null;
        }
        String rest = packageName.substring(prefix.length());
        int dot = rest.indexOf('.');
        return dot >= 0 ? rest.substring(0, dot) : rest;
    }

    /**
     * 提取模块下第一级子包名（如 {@code api}、{@code service}、{@code dal}）。
     */
    private static String extractModuleSubSegment(String packageName, String moduleName) {
        String prefix = "com.basicframework.module." + moduleName + ".";
        if (!packageName.startsWith(prefix)) {
            return null;
        }
        String rest = packageName.substring(prefix.length());
        int dot = rest.indexOf('.');
        return dot >= 0 ? rest.substring(0, dot) : rest;
    }

    /**
     * 所有方法级 {@code @Transactional} 声明都必须显式指定非空的 {@code rollbackFor}，防止受检异常默认不回滚。
     *
     * @return 事务回滚异常显式声明规则
     */
    static ArchRule transactionalMustDeclareRollbackFor() {
        return methods()
                .that().areDeclaredInClassesThat().resideInAPackage("com.basicframework..")
                .and().areAnnotatedWith(Transactional.class)
                .should(new ArchCondition<JavaMethod>("在 @Transactional 中显式指定 rollbackFor") {
                    @Override
                    public void check(JavaMethod method, ConditionEvents events) {
                        Transactional tx = method.getAnnotationOfType(Transactional.class);
                        if (tx.rollbackFor().length == 0 && tx.rollbackForClassName().length == 0) {
                            events.add(SimpleConditionEvent.violated(
                                    method,
                                    "@Transactional 未显式声明 rollbackFor = Exception.class：" + method.getFullName()));
                        }
                    }
                })
                .because("所有 @Transactional 方法必须显式声明 rollbackFor，避免受检异常提交半成品数据");
    }

    /**
     * 所有类级 {@code @Transactional} 声明同样必须显式指定非空的 {@code rollbackFor}。
     *
     * @return 类级事务回滚异常显式声明规则
     */
    static ArchRule classLevelTransactionalMustDeclareRollbackFor() {
        return classes()
                .that().resideInAPackage("com.basicframework..")
                .and().areAnnotatedWith(Transactional.class)
                .should(new ArchCondition<JavaClass>("在类级 @Transactional 中显式指定 rollbackFor") {
                    @Override
                    public void check(JavaClass javaClass, ConditionEvents events) {
                        Transactional tx = javaClass.getAnnotationOfType(Transactional.class);
                        if (tx.rollbackFor().length == 0 && tx.rollbackForClassName().length == 0) {
                            events.add(SimpleConditionEvent.violated(
                                    javaClass,
                                    "类级 @Transactional 未显式声明 rollbackFor = Exception.class：" + javaClass.getName()));
                        }
                    }
                })
                .allowEmptyShould(true)
                .because("所有类级 @Transactional 必须显式声明 rollbackFor，避免受检异常提交半成品数据");
    }

    /**
     * 判断方法是否声明了 Spring MVC 路由映射注解。
     */
    private static DescribedPredicate<JavaMethod> isRequestMappingEndpoint() {
        return new DescribedPredicate<JavaMethod>("声明 Spring MVC 路由映射注解") {
            @Override
            public boolean test(JavaMethod method) {
                return method.isAnnotatedWith(RequestMapping.class)
                        || method.isMetaAnnotatedWith(RequestMapping.class);
            }
        };
    }

    /**
     * 控制器 HTTP 端点的入参和返回值（含泛型类型实参）不得直接暴露持久化 DO。
     *
     * @return HTTP 契约与持久化对象隔离规则
     */
    static ArchRule controllerEndpointsMustNotExposeDataObjects() {
        return methods()
                .that().areDeclaredInClassesThat().resideInAPackage("com.basicframework..")
                .and(isRequestMappingEndpoint())
                .should(new ArchCondition<JavaMethod>("不在 HTTP 参数或返回类型中暴露 dal.dataobject 类型") {
                    @Override
                    public void check(JavaMethod method, ConditionEvents events) {
                        for (JavaClass involved : method.getAllInvolvedRawTypes()) {
                            if (involved.getPackageName().contains(".dal.dataobject")) {
                                events.add(SimpleConditionEvent.violated(
                                        method,
                                        "HTTP 端点签名直接暴露持久化对象 " + involved.getName()
                                                + "：" + method.getFullName()));
                            }
                        }
                    }
                })
                .because("HTTP 请求和响应契约必须使用 VO/DTO，禁止直接暴露持久化 DO");
    }

    /**
     * 业务模块禁止直接抛出未分类的裸通用异常。
     *
     * @return 业务异常规范规则
     */
    static ArchRule businessModulesMustNotThrowGenericExceptions() {
        return noClasses()
                .that().resideInAPackage("com.basicframework.module..")
                .should(GeneralCodingRules.THROW_GENERIC_EXCEPTIONS)
                .because("业务模块应抛出 ServiceException 或明确定义的领域异常，禁止直接抛裸通用异常");
    }

    /**
     * 产品代码统一通过 SLF4J 记录日志，禁止直接依赖旧日志 API。
     *
     * @return 日志门面统一规则
     */
    static ArchRule noLegacyLoggingApis() {
        return noClasses()
                .that().resideInAPackage("com.basicframework..")
                .should().dependOnClassesThat()
                .resideInAnyPackage(
                        "java.util.logging..",
                        "org.apache.commons.logging..",
                        "org.apache.logging.log4j..")
                .because("产品代码统一使用 SLF4J 日志门面，禁止混用旧日志 API");
    }
}
