package com.basicframework.framework.security.config;

import jakarta.annotation.security.PermitAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.http.HttpMethod;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.util.Collection;

import com.google.common.collect.Multimap;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证安全链从 {@code @PermitAll} 注解推导免登录 URL 的真实规则。
 *
 * <p>该方法是免登录白名单的唯一来源：注解写在方法上或控制器上都必须生效；未写 {@code method}
 * 属性的 {@code @RequestMapping} 视为全部请求方法都免登录；写了具体方法时只放行对应方法，
 * 漏掉 OPTIONS 会让跨域预检被拦截，漏掉 PATCH/HEAD/DELETE 会让对应接口在免登录场景下 401。
 * 没有 {@code @PermitAll} 的接口绝不能进入白名单，否则等于把受保护接口开放给匿名访问。</p>
 *
 * <p>用例用真实 {@link RequestMappingHandlerMapping} 扫描真实控制器，并同时覆盖使用
 * {@code PathPatternParser} 与回退到 Ant 风格匹配器（{@code getPatternsCondition()} 非空）
 * 两种装配形态，确保两条取路径的代码都按预期收集 URL。</p>
 *
 * @author shady2713
 */
class BasicFrameworkWebSecurityConfigurerAdapterPermitAllTest {

    /** 被测适配器，仅用于调用私有白名单推导方法。 */
    private final BasicFrameworkWebSecurityConfigurerAdapter adapter = new BasicFrameworkWebSecurityConfigurerAdapter();

    /** 测试创建的上下文，负责在用例结束后关闭。 */
    private GenericApplicationContext context;

    /** 关闭测试上下文，避免容器资源残留。 */
    @AfterEach
    void closeContext() {
        if (context != null) {
            context.close();
            context = null;
        }
    }

    /** 方法级注解按声明的请求方法放行，未声明方法时放行全部方法。 */
    @Test
    void methodLevelPermitAllCollectsDeclaredRequestMethods() {
        Multimap<HttpMethod, String> permitAllUrls = permitAllUrls(false);

        assertThat(permitAllUrls.get(HttpMethod.GET)).contains("/test/permit-all/get-only");
        assertThat(permitAllUrls.get(HttpMethod.OPTIONS)).contains("/test/permit-all/options-only");
        assertThat(permitAllUrls.get(HttpMethod.POST)).contains("/test/permit-all/post-only");
        assertThat(permitAllUrls.get(HttpMethod.PUT)).contains("/test/permit-all/put-only");
        assertThat(permitAllUrls.get(HttpMethod.DELETE)).contains("/test/permit-all/delete-only");
        assertThat(permitAllUrls.get(HttpMethod.HEAD)).contains("/test/permit-all/head-only");
        assertThat(permitAllUrls.get(HttpMethod.PATCH)).contains("/test/permit-all/patch-only");

        Collection<String> allMethodsUrl = permitAllUrls.get(HttpMethod.GET);
        assertThat(allMethodsUrl).contains("/test/permit-all/any-method");
        assertThat(permitAllUrls.get(HttpMethod.POST)).contains("/test/permit-all/any-method");
        assertThat(permitAllUrls.get(HttpMethod.PUT)).contains("/test/permit-all/any-method");
        assertThat(permitAllUrls.get(HttpMethod.DELETE)).contains("/test/permit-all/any-method");
        assertThat(permitAllUrls.get(HttpMethod.HEAD)).contains("/test/permit-all/any-method");
        assertThat(permitAllUrls.get(HttpMethod.PATCH)).contains("/test/permit-all/any-method");
    }

    /** 控制器级注解对其所有接口生效，未加注解的接口绝不进入白名单。 */
    @Test
    void classLevelPermitAllAppliesToEveryHandlerAndUnannotatedIsExcluded() {
        Multimap<HttpMethod, String> permitAllUrls = permitAllUrls(false);

        assertThat(permitAllUrls.get(HttpMethod.GET)).contains("/test/class-level/list");
        assertThat(permitAllUrls.get(HttpMethod.POST)).contains("/test/class-level/create");
        assertThat(permitAllUrls.values()).as("未加 @PermitAll 的接口必须保持受保护")
                .doesNotContain("/test/permit-all/protected");
    }

    /**
     * 没有路径的免登录接口按空串模式收集，且不得影响其它 URL 的收集。
     *
     * <p>实测真实注册的处理器方法至少带一个模式：无路径时该模式是空串，因此
     * “收集到的 URL 集合为空”这一分支不会被真实注册触发。这里锁定空串模式这一可观察结果，
     * 便于后续评估是否需要在安全链上过滤掉无意义模式。</p>
     */
    @Test
    void pathlessPermitAllHandlerCollectsEmptyPatternWithoutBreakingOthers() {
        Multimap<HttpMethod, String> permitAllUrls = permitAllUrls(false);

        assertThat(permitAllUrls.get(HttpMethod.GET)).contains("/test/permit-all/get-only").contains("");
    }

    /** 回退到 Ant 风格匹配器时，通过 legacy 模式条件同样能收集到 URL。 */
    @Test
    void legacyPatternConditionAlsoCollectsUrls() {
        Multimap<HttpMethod, String> permitAllUrls = permitAllUrls(true);

        assertThat(permitAllUrls.get(HttpMethod.GET)).contains("/test/permit-all/get-only");
        assertThat(permitAllUrls.get(HttpMethod.POST)).contains("/test/permit-all/any-method");
    }

    /**
     * 构建上下文并调用被测私有方法。
     *
     * @param legacyPatternMatching 是否关闭 PathPatternParser 以走 Ant 风格匹配分支
     * @return 免登录 URL 集合，按请求方法分组
     */
    @SuppressWarnings("unchecked")
    private Multimap<HttpMethod, String> permitAllUrls(boolean legacyPatternMatching) {
        context = new GenericApplicationContext();
        context.registerBean("requestMappingHandlerMapping", RequestMappingHandlerMapping.class, () -> {
            RequestMappingHandlerMapping mapping = new RequestMappingHandlerMapping();
            if (legacyPatternMatching) {
                mapping.setPatternParser(null);
            }
            return mapping;
        });
        context.registerBean(PermitAllTestController.class);
        context.registerBean(ClassLevelPermitAllController.class);
        context.registerBean(PathlessPermitAllController.class);
        context.refresh();
        ReflectionTestUtils.setField(adapter, "applicationContext", context);

        return ReflectionTestUtils.invokeMethod(adapter, "getPermitAllUrlsFromAnnotations");
    }

    /**
     * 方法级 {@code @PermitAll} 控制器夹具，覆盖全部请求方法与未注解接口。
     *
     * @author shady2713
     */
    @RestController
    @RequestMapping("/test/permit-all")
    public static class PermitAllTestController {

        /**
         * 免登录的 GET 接口。
         *
         * @return 固定响应
         */
        @PermitAll
        @RequestMapping(value = "/get-only", method = RequestMethod.GET)
        public String getOnly() {
            return "ok";
        }

        /**
         * 免登录的 OPTIONS 接口，用于验证跨域预检放行。
         *
         * @return 固定响应
         */
        @PermitAll
        @RequestMapping(value = "/options-only", method = RequestMethod.OPTIONS)
        public String optionsOnly() {
            return "ok";
        }

        /**
         * 免登录的 POST 接口。
         *
         * @return 固定响应
         */
        @PermitAll
        @RequestMapping(value = "/post-only", method = RequestMethod.POST)
        public String postOnly() {
            return "ok";
        }

        /**
         * 免登录的 PUT 接口。
         *
         * @return 固定响应
         */
        @PermitAll
        @RequestMapping(value = "/put-only", method = RequestMethod.PUT)
        public String putOnly() {
            return "ok";
        }

        /**
         * 免登录的 DELETE 接口。
         *
         * @return 固定响应
         */
        @PermitAll
        @RequestMapping(value = "/delete-only", method = RequestMethod.DELETE)
        public String deleteOnly() {
            return "ok";
        }

        /**
         * 免登录的 HEAD 接口。
         *
         * @return 固定响应
         */
        @PermitAll
        @RequestMapping(value = "/head-only", method = RequestMethod.HEAD)
        public String headOnly() {
            return "ok";
        }

        /**
         * 免登录的 PATCH 接口。
         *
         * @return 固定响应
         */
        @PermitAll
        @RequestMapping(value = "/patch-only", method = RequestMethod.PATCH)
        public String patchOnly() {
            return "ok";
        }

        /**
         * 未声明请求方法的免登录接口，全部方法都应放行。
         *
         * @return 固定响应
         */
        @PermitAll
        @RequestMapping("/any-method")
        public String anyMethod() {
            return "ok";
        }

        /**
         * 未加 {@code @PermitAll} 的接口，必须保持受保护。
         *
         * @return 固定响应
         */
        @RequestMapping("/protected")
        public String protectedEndpoint() {
            return "ok";
        }
    }

    /**
     * 无类级路径映射的 {@code @PermitAll} 夹具，用于验证无路径接口的收集结果。
     *
     * @author shady2713
     */
    @RestController
    public static class PathlessPermitAllController {

        /**
         * 没有路径的免登录接口。
         *
         * @return 固定响应
         */
        @PermitAll
        @RequestMapping
        public String pathless() {
            return "ok";
        }
    }

    /**
     * 控制器级 {@code @PermitAll} 夹具。
     *
     * @author shady2713
     */
    @PermitAll
    @RestController
    @RequestMapping("/test/class-level")
    public static class ClassLevelPermitAllController {

        /**
         * 控制器级免登录的查询接口。
         *
         * @return 固定响应
         */
        @RequestMapping(value = "/list", method = RequestMethod.GET)
        public String list() {
            return "ok";
        }

        /**
         * 控制器级免登录的创建接口。
         *
         * @return 固定响应
         */
        @RequestMapping(value = "/create", method = RequestMethod.POST)
        public String create() {
            return "ok";
        }
    }

}
