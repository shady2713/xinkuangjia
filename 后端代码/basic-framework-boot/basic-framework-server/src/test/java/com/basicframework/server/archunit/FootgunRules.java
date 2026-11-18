package com.basicframework.server.archunit;

import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaMethod;
import com.tngtech.archunit.core.domain.JavaMethodCall;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import com.tngtech.archunit.library.GeneralCodingRules;
import jakarta.annotation.security.PermitAll;
import org.springframework.web.bind.annotation.RequestMapping;

import java.util.Set;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.methods;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

/**
 * 后端脚枪门禁规则，供质量门禁测试与反向失败夹具复用。
 */
final class FootgunRules {

    /**
     * 当前 main 已盘点的公开端点允许名单，格式为「全限定类名#方法名」。
     * 覆盖登录、注册、验证码、短信回调、文件内容下载和开放令牌入口。
     */
    static final Set<String> PERMIT_ALL_ALLOWLIST = Set.of(
            "com.basicframework.module.system.controller.admin.auth.AuthController#getSm2PublicKey",
            "com.basicframework.module.system.controller.admin.auth.AuthController#login",
            "com.basicframework.module.system.controller.admin.auth.AuthController#superAdminLogin",
            "com.basicframework.module.system.controller.admin.auth.AuthController#logout",
            "com.basicframework.module.system.controller.admin.auth.AuthController#refreshToken",
            "com.basicframework.module.system.controller.admin.auth.AuthController#register",
            "com.basicframework.module.system.controller.admin.auth.AuthController#smsLogin",
            "com.basicframework.module.system.controller.admin.auth.AuthController#sendLoginSmsCode",
            "com.basicframework.module.system.controller.admin.auth.AuthController#resetPassword",
            "com.basicframework.module.system.controller.admin.captcha.CaptchaController#get",
            "com.basicframework.module.system.controller.admin.captcha.CaptchaController#check",
            "com.basicframework.module.system.controller.open.oauth2.OAuth2OpenController#token",
            "com.basicframework.module.infra.controller.admin.file.FileController#getFileContent",
            "com.basicframework.module.system.controller.admin.sms.SmsCallbackController#receiveAliyunSmsStatus",
            "com.basicframework.module.system.controller.admin.sms.SmsCallbackController#receiveTencentSmsStatus"
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
     * 控制器不得直接依赖 mapper / dal.mysql / dal.redis 持久化包。
     * 不限制 dal.dataobject，因为当前主树仍有多处控制器引用数据对象。
     *
     * @return 分层规则
     */
    static ArchRule controllersMustNotDependOnPersistence() {
        return noClasses()
                .that().resideInAPackage("..controller..")
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
     * 仅导入单个产品类时，JDK 类型可能是没有继承信息的桩，因此同时按类型名识别。
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
     * 判断方法是否声明了 Spring MVC 路由映射注解（含 {@code @GetMapping} 等派生注解）。
     *
     * @return 路由端点方法谓词
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
     * 允许控制器在方法内部引用 DO 完成 VO 转换，兼顾存量实现与对外契约边界。
     *
     * @return HTTP 契约与持久化对象隔离规则
     */
    static ArchRule controllerEndpointsMustNotExposeDataObjects() {
        return methods()
                .that().areDeclaredInClassesThat().resideInAPackage("..controller..")
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
     * 业务模块禁止直接抛出未分类的裸 {@code RuntimeException}、{@code Exception}、{@code Throwable} 或 {@code Error}。
     * 底层 core 组件包装受检异常的边界保持豁免。
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
     * 产品代码统一通过 SLF4J 记录日志，禁止直接依赖 JUL、Commons Logging 或 Log4j 实现包。
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
