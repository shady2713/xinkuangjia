package com.basicframework.module.[module].controller.admin.[entity];

import com.basicframework.framework.common.biz.infra.logger.ApiErrorLogCommonApi;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.web.core.handler.GlobalExceptionHandler;
import com.basicframework.module.[module].controller.admin.[entity].vo.[Entity]PageReqVO;
import com.basicframework.module.[module].controller.admin.[entity].vo.[Entity]SaveReqVO;
import com.basicframework.module.[module].dal.dataobject.[entity].[Entity]DO;
import com.basicframework.module.[module].service.[entity].[Entity]Service;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.mockito.ArgumentCaptor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.validation.Validator;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 用真实 Spring MVC、真实 Bean Validation、真实方法级鉴权与真实全局异常处理验证
 * [entity-name]接口契约。
 *
 * <p>这层用例锁定三类无法由 Service 测试发现的风险：权限串写错会让已授权用户被拒或越权用户被
 * 放行；参数校验失效会让空名称、缺状态直接进入业务；统一响应契约漂移会让前端把业务错误码
 * 当成成功。拒绝与非法输入都断言真实响应体中的业务码，而不是只看 HTTP 状态。</p>
 *
 * <p>持久化与业务规则由 Service 承担，这里用替身隔离，只观察 Controller 的委派、校验、
 * 鉴权与响应组装。</p>
 *
 * <p>占位符：[module]、[entity]、[Entity]、[entity-name]、[entity-title]、[permission]。</p>
 *
 * @author [author]
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class [Entity]ControllerWebTest {

    /** 业务成功码，与 CommonResult.success 契约一致。 */
    private static final int SUCCESS = 0;

    /** 参数非法码，非法输入必须落在该码而不是 500。 */
    private static final int BAD_REQUEST = 400;

    /** 权限不足码，与 GlobalExceptionHandler 的 FORBIDDEN 契约一致。 */
    private static final int FORBIDDEN = 403;

    /** 被测 Service 替身；配置类在容器 refresh 前必须能拿到同一实例。 */
    private static [Entity]Service [entity]Service;

    private AnnotationConfigWebApplicationContext context;

    private MockMvc mvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private PermissionGate permissionGate;

    /** 装配真实 MVC、真实校验器、真实方法级鉴权与真实全局异常处理。 */
    @BeforeAll
    void startWebContext() {
        [entity]Service = mock([Entity]Service.class);
        context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.register(WebTestConfiguration.class);
        context.refresh();
        permissionGate = context.getBean(PermissionGate.class);
        mvc = MockMvcBuilders.webAppContextSetup(context).build();
    }

    /** 每例复位替身与鉴权记录，避免“未被调用”类断言被上一例污染。 */
    @BeforeEach
    void resetFixture() {
        reset([entity]Service);
        permissionGate.reset();
    }

    /** 创建接口必须返回新编号、原样下传校验后的请求体，并声明 create 权限。 */
    @Test
    void create[Entity]ReturnsIdAndForwardsValidatedBody() throws Exception {
        when([entity]Service.create[Entity](any())).thenReturn(1024L);

        JsonNode body = readBody(mvc.perform(post("/[module]/[entity]/create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"示例名称\",\"status\":0,\"remark\":\"备注\"}"))
                .andExpect(status().isOk())
                .andReturn());

        assertThat(body.get("code").asInt()).isEqualTo(SUCCESS);
        assertThat(body.get("data").asLong()).isEqualTo(1024L);
        ArgumentCaptor<[Entity]SaveReqVO> captor = ArgumentCaptor.forClass([Entity]SaveReqVO.class);
        verify([entity]Service).create[Entity](captor.capture());
        assertThat(captor.getValue().getName()).isEqualTo("示例名称");
        assertThat(captor.getValue().getStatus()).isZero();
        assertThat(captor.getValue().getRemark()).isEqualTo("备注");
        assertThat(permissionGate.requested()).containsExactly("[permission]:create");
    }

    /** 名称为空必须在进入业务前被拒绝，不能产生半写入的记录。 */
    @Test
    void create[Entity]RejectsBlankNameBeforeBusinessCall() throws Exception {
        JsonNode body = readBody(mvc.perform(post("/[module]/[entity]/create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"\",\"status\":0}"))
                .andExpect(status().isOk())
                .andReturn());

        assertThat(body.get("code").asInt()).isEqualTo(BAD_REQUEST);
        assertThat(body.get("msg").asText()).contains("名称不能为空");
        verifyNoInteractions([entity]Service);
    }

    /** 状态缺失同样属于契约内非法输入，必须给出字段级提示。 */
    @Test
    void create[Entity]RejectsMissingStatusBeforeBusinessCall() throws Exception {
        JsonNode body = readBody(mvc.perform(post("/[module]/[entity]/create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"示例名称\"}"))
                .andExpect(status().isOk())
                .andReturn());

        assertThat(body.get("code").asInt()).isEqualTo(BAD_REQUEST);
        assertThat(body.get("msg").asText()).contains("状态不能为空");
        verifyNoInteractions([entity]Service);
    }

    /** 权限被拒时必须在业务调用之前中断，返回契约内 403 而不是 500。 */
    @Test
    void create[Entity]DeniedWithoutPermission() throws Exception {
        permissionGate.deny("[permission]:create");

        JsonNode body = readBody(mvc.perform(post("/[module]/[entity]/create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"示例名称\",\"status\":0}"))
                .andExpect(status().isOk())
                .andReturn());

        assertThat(body.get("code").asInt()).isEqualTo(FORBIDDEN);
        verifyNoInteractions([entity]Service);
    }

    /** 修改接口必须把编号与字段一起下传，并声明 update 权限。 */
    @Test
    void update[Entity]ForwardsIdAndFields() throws Exception {
        JsonNode body = readBody(mvc.perform(put("/[module]/[entity]/update")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":2048,\"name\":\"改名后\",\"status\":1}"))
                .andExpect(status().isOk())
                .andReturn());

        assertThat(body.get("code").asInt()).isEqualTo(SUCCESS);
        assertThat(body.get("data").asBoolean()).isTrue();
        ArgumentCaptor<[Entity]SaveReqVO> captor = ArgumentCaptor.forClass([Entity]SaveReqVO.class);
        verify([entity]Service).update[Entity](captor.capture());
        assertThat(captor.getValue().getId()).isEqualTo(2048L);
        assertThat(captor.getValue().getName()).isEqualTo("改名后");
        assertThat(permissionGate.requested()).containsExactly("[permission]:update");
    }

    /** 修改同样必须走真实参数校验，空名称不得触达业务层。 */
    @Test
    void update[Entity]RejectsBlankNameBeforeBusinessCall() throws Exception {
        JsonNode body = readBody(mvc.perform(put("/[module]/[entity]/update")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":2048,\"name\":\"\",\"status\":1}"))
                .andExpect(status().isOk())
                .andReturn());

        assertThat(body.get("code").asInt()).isEqualTo(BAD_REQUEST);
        assertThat(body.get("msg").asText()).contains("名称不能为空");
        verifyNoInteractions([entity]Service);
    }

    /** 修改接口同样必须受 update 权限保护。 */
    @Test
    void update[Entity]DeniedWithoutPermission() throws Exception {
        permissionGate.deny("[permission]:update");

        JsonNode body = readBody(mvc.perform(put("/[module]/[entity]/update")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":2048,\"name\":\"改名后\",\"status\":1}"))
                .andExpect(status().isOk())
                .andReturn());

        assertThat(body.get("code").asInt()).isEqualTo(FORBIDDEN);
        verifyNoInteractions([entity]Service);
    }

    /** 删除接口必须按编号下传并声明 delete 权限。 */
    @Test
    void delete[Entity]ForwardsId() throws Exception {
        JsonNode body = readBody(mvc.perform(delete("/[module]/[entity]/delete").param("id", "2048"))
                .andExpect(status().isOk())
                .andReturn());

        assertThat(body.get("code").asInt()).isEqualTo(SUCCESS);
        assertThat(body.get("data").asBoolean()).isTrue();
        verify([entity]Service).delete[Entity](2048L);
        assertThat(permissionGate.requested()).containsExactly("[permission]:delete");
    }

    /** 缺少编号必须按契约返回参数缺失，不得删除任意记录。 */
    @Test
    void delete[Entity]RequiresIdParameter() throws Exception {
        JsonNode body = readBody(mvc.perform(delete("/[module]/[entity]/delete"))
                .andExpect(status().isOk())
                .andReturn());

        assertThat(body.get("code").asInt()).isEqualTo(BAD_REQUEST);
        assertThat(body.get("msg").asText()).contains("请求参数缺失");
        verifyNoInteractions([entity]Service);
    }

    /** 删除接口同样必须受 delete 权限保护。 */
    @Test
    void delete[Entity]DeniedWithoutPermission() throws Exception {
        permissionGate.deny("[permission]:delete");

        JsonNode body = readBody(mvc.perform(delete("/[module]/[entity]/delete").param("id", "2048"))
                .andExpect(status().isOk())
                .andReturn());

        assertThat(body.get("code").asInt()).isEqualTo(FORBIDDEN);
        verifyNoInteractions([entity]Service);
    }

    /** 详情接口必须返回转换后的响应字段，并声明 query 权限。 */
    @Test
    void get[Entity]ReturnsMappedDetail() throws Exception {
        when([entity]Service.get[Entity](1024L)).thenReturn(build[Entity](1024L, "示例名称", 0));

        JsonNode body = readBody(mvc.perform(get("/[module]/[entity]/get").param("id", "1024"))
                .andExpect(status().isOk())
                .andReturn());

        assertThat(body.get("code").asInt()).isEqualTo(SUCCESS);
        assertThat(body.get("data").get("id").asLong()).isEqualTo(1024L);
        assertThat(body.get("data").get("name").asText()).isEqualTo("示例名称");
        assertThat(body.get("data").get("status").asInt()).isZero();
        assertThat(body.get("data").has("deleted")).as("DO 的持久化字段不得进入响应契约").isFalse();
        assertThat(permissionGate.requested()).containsExactly("[permission]:query");
    }

    /** 记录不存在时详情返回空数据而不是 500，由前端按空数据渲染。 */
    @Test
    void get[Entity]ReturnsEmptyDataWhenMissing() throws Exception {
        when([entity]Service.get[Entity](1024L)).thenReturn(null);

        JsonNode body = readBody(mvc.perform(get("/[module]/[entity]/get").param("id", "1024"))
                .andExpect(status().isOk())
                .andReturn());

        assertThat(body.get("code").asInt()).isEqualTo(SUCCESS);
        assertThat(body.get("data").isNull()).isTrue();
    }

    /** 详情接口同样必须受 query 权限保护。 */
    @Test
    void get[Entity]DeniedWithoutPermission() throws Exception {
        permissionGate.deny("[permission]:query");

        JsonNode body = readBody(mvc.perform(get("/[module]/[entity]/get").param("id", "1024"))
                .andExpect(status().isOk())
                .andReturn());

        assertThat(body.get("code").asInt()).isEqualTo(FORBIDDEN);
        verifyNoInteractions([entity]Service);
    }

    /** 分页接口必须原样接收分页与筛选参数，并返回转换后的分页结构。 */
    @Test
    void get[Entity]PageForwardsFiltersAndConvertsResult() throws Exception {
        PageResult<[Entity]DO> page = new PageResult<>(
                List.of(build[Entity](1024L, "示例名称", 0)), 1L);
        when([entity]Service.get[Entity]Page(any())).thenReturn(page);

        JsonNode body = readBody(mvc.perform(get("/[module]/[entity]/page")
                        .param("pageNo", "2").param("pageSize", "10")
                        .param("name", "示例").param("status", "0"))
                .andExpect(status().isOk())
                .andReturn());

        assertThat(body.get("code").asInt()).isEqualTo(SUCCESS);
        assertThat(body.get("data").get("total").asLong()).isEqualTo(1L);
        assertThat(body.get("data").get("list").get(0).get("name").asText()).isEqualTo("示例名称");
        ArgumentCaptor<[Entity]PageReqVO> captor = ArgumentCaptor.forClass([Entity]PageReqVO.class);
        verify([entity]Service).get[Entity]Page(captor.capture());
        assertThat(captor.getValue().getPageNo()).isEqualTo(2);
        assertThat(captor.getValue().getPageSize()).isEqualTo(10);
        assertThat(captor.getValue().getName()).isEqualTo("示例");
        assertThat(captor.getValue().getStatus()).isZero();
        assertThat(permissionGate.requested()).containsExactly("[permission]:query");
    }

    /** 分页接口同样必须受 query 权限保护。 */
    @Test
    void get[Entity]PageDeniedWithoutPermission() throws Exception {
        permissionGate.deny("[permission]:query");

        JsonNode body = readBody(mvc.perform(get("/[module]/[entity]/page")
                        .param("pageNo", "1").param("pageSize", "10"))
                .andExpect(status().isOk())
                .andReturn());

        assertThat(body.get("code").asInt()).isEqualTo(FORBIDDEN);
        verifyNoInteractions([entity]Service);
    }

    /** 按 UTF-8 解析响应体，避免中文提示被按默认字符集读成乱码。 */
    private JsonNode readBody(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    /** 构造带真实审计字段的测试记录，用于核对响应字段映射。 */
    private [Entity]DO build[Entity](Long id, String name, Integer status) {
        [Entity]DO [entity] = new [Entity]DO();
        [entity].setId(id);
        [entity].setName(name);
        [entity].setStatus(status);
        [entity].setRemark("备注");
        [entity].setCreateTime(LocalDateTime.of(2026, 1, 1, 0, 0));
        return [entity];
    }

    /**
     * 真实 MVC、真实校验、真实方法级鉴权与真实全局异常处理的最小装配。
     *
     * <p>不引入 Security 过滤链：权限拒绝由方法级 {@code @PreAuthorize} 决定，全局异常处理器
     * 负责把它翻译成生产同款 403 响应体，两者合起来才能证明契约而不是只证明抛异常。</p>
     */
    @Configuration(proxyBeanMethods = false)
    @EnableWebMvc
    @EnableMethodSecurity
    static class WebTestConfiguration {

        /** 使用真实 Bean Validation，非法请求才会被真正拦下。 */
        @Bean
        public Validator mvcValidator() {
            return new LocalValidatorFactoryBean();
        }

        /** {@code @ss} 表达式引用的权限判定替身。 */
        @Bean
        public PermissionGate ss() {
            return new PermissionGate();
        }

        /** 生产全局异常处理器：把业务异常与权限异常翻译成统一响应体。 */
        @Bean
        public GlobalExceptionHandler globalExceptionHandler() {
            return new GlobalExceptionHandler("module-[module]-test", mock(ApiErrorLogCommonApi.class));
        }

        /** 按 @Resource 的字段名注册，保留生产按名注入的装配方式。 */
        @Bean
        public [Entity]Service [entity]Service() {
            return [entity]Service;
        }

        /** 注册被测 Controller，走生产按名注入装配。 */
        @Bean
        public [Entity]Controller [entity]Controller() {
            return new [Entity]Controller();
        }
    }

    /**
     * 可编程的权限判定替身。
     *
     * <p>保留生产 {@code @ss.hasPermission(String)} 的调用契约，只把“当前用户有哪些权限”
     * 换成测试可控的开关，并记录每次被请求的权限串用于逐端点断言。</p>
     */
    static class PermissionGate {

        /** 被显式拒绝的权限串；为空表示全部放行。 */
        private String denied;

        /** 按调用顺序记录被请求的权限串。 */
        private final List<String> requested = new ArrayList<>();

        /**
         * 判定当前请求是否具备该权限。
         *
         * @param permission 端点声明的权限串
         * @return 是否放行
         */
        public boolean hasPermission(String permission) {
            requested.add(permission);
            return !permission.equals(denied);
        }

        /** 拒绝指定权限。 */
        void deny(String permission) {
            this.denied = permission;
        }

        /** 返回本用例内被请求过的权限串。 */
        List<String> requested() {
            return requested;
        }

        /** 复位开关与记录。 */
        void reset() {
            this.denied = null;
            this.requested.clear();
        }
    }
}
