package com.basicframework.module.infra.controller.admin.file;

import com.basicframework.framework.common.biz.infra.logger.ApiErrorLogCommonApi;
import com.basicframework.framework.common.biz.system.oauth2.OAuth2TokenCommonApi;
import com.basicframework.framework.common.biz.system.oauth2.dto.OAuth2AccessTokenCheckRespDTO;
import com.basicframework.framework.common.biz.system.oauth2.dto.OAuth2AccessTokenCreateReqDTO;
import com.basicframework.framework.common.biz.system.oauth2.dto.OAuth2AccessTokenRespDTO;
import com.basicframework.framework.common.biz.system.permission.PermissionCommonApi;
import com.basicframework.framework.common.biz.system.permission.dto.DeptDataPermissionRespDTO;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.framework.security.config.BasicFrameworkSecurityAutoConfiguration;
import com.basicframework.framework.security.config.BasicFrameworkWebSecurityConfigurerAdapter;
import com.basicframework.framework.web.config.WebProperties;
import com.basicframework.framework.web.core.handler.GlobalExceptionHandler;
import com.basicframework.framework.web.core.util.WebFrameworkUtils;
import com.basicframework.module.infra.controller.admin.file.vo.file.FileCreateReqVO;
import com.basicframework.module.infra.controller.admin.file.vo.file.FilePageReqVO;
import com.basicframework.module.infra.framework.file.config.FileUploadProperties;
import com.basicframework.module.infra.framework.security.config.SecurityConfiguration;
import com.basicframework.module.infra.service.file.FileService;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.Filter;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.MapPropertySource;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import org.springframework.web.servlet.config.annotation.PathMatchConfigurer;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 用生产 Spring Security 过滤链与真实 {@link FileController} 验证两类管理端文件入口的服务端拒绝。
 *
 * <p>第一类是机器主体隔离：client_credentials 的占位用户（userId=0、userType=ADMIN）不能写入管理端
 * 文件入口。后端上传、预签名预约和完成登记都只要求认证、没有权限表达式，机器令牌曾可以管理端用户
 * 身份进入这些入口并产生对象存储写入与元数据登记。这里断言安全链在控制器之前按无权限拒绝，并核实
 * 文件服务完全没有被调用；同时用真实用户令牌、匿名请求与公开读取入口作为对照，避免把“整条链路失效”
 * 当成隔离成功。</p>
 *
 * <p>第二类是权限码拒绝：查询、详情、单个删除和批量删除都由
 * {@code @PreAuthorize("@ss.hasPermission(...)")} 保护，缺少权限码的真实用户必须在进入业务层之前被
 * 拒绝，不能只靠前端隐藏按钮。每条拒绝断言都配一条放行断言，用记录到的权限串证明端点确实声明了该
 * 权限码，而不是“任何请求都被拒”。</p>
 *
 * <p>令牌校验用真实 DTO 契约的替身注入：infra 模块不依赖 system 模块，无法在本模块内签发真实机器
 * 令牌。安全过滤链、URL 放行规则、方法级鉴权、控制器与拒绝处理器都是生产实现；机器令牌的端到端签发
 * 与校验由 module-system 的 {@code OAuth2MachinePrincipalHttpMySqlIT} 覆盖。</p>
 *
 * @author shady2713
 */
class FileMachinePrincipalSecurityTest {

    /** 代表有效机器令牌的请求值，由令牌校验替身映射为占位用户。 */
    private static final String MACHINE_TOKEN = "machine-principal-token";

    /** 代表有效真实用户令牌的请求值，由令牌校验替身映射为普通管理员。 */
    private static final String REAL_USER_TOKEN = "real-user-token";

    /** 被测文件服务替身；入口被拒绝时不允许出现任何交互。 */
    private static FileService fileService;

    /** 权限判定替身，按权限码放行并记录每次被请求的权限串。 */
    private static PermissionApiStub permissionApi;

    /** 生产安全链 + 真实控制器的 MockMvc。 */
    private static MockMvc mvc;

    /** 真实 Web 上下文，关闭时释放安全链资源。 */
    private static AnnotationConfigWebApplicationContext context;

    /** 建立生产安全链、真实 FileController 与隔离的令牌校验替身。 */
    @BeforeAll
    static void createEnvironment() {
        fileService = mock(FileService.class);
        permissionApi = new PermissionApiStub();
        context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("file-machine-principal",
                Map.of("basic-framework.web.admin-ui.url", "http://localhost:5175")));
        context.register(MvcConfiguration.class, WebSecurityTestConfiguration.class,
                BasicFrameworkSecurityAutoConfiguration.class, BasicFrameworkWebSecurityConfigurerAdapter.class,
                SecurityConfiguration.class, TestBeans.class);
        context.refresh();
        // springSecurityFilterChain 是生产 FilterChainProxy，对每个请求执行真实授权判定。
        Filter securityFilterChain = context.getBean("springSecurityFilterChain", Filter.class);
        mvc = MockMvcBuilders.webAppContextSetup(context).addFilters(securityFilterChain).build();
    }

    /** 关闭上下文，避免安全链与线程上下文在用例之间泄漏。 */
    @AfterAll
    static void closeEnvironment() {
        if (context != null) {
            context.close();
        }
    }

    /**
     * 清空替身交互与打桩记录，使每个用例只观察自己触发的文件服务行为。
     *
     * <p>正例用例会为上传打桩返回值；若保留到机器主体用例，就会把“未被拒绝”伪装成一次成功上传，
     * 让拒绝断言失去意义。权限替身同样复位，避免上一例授予的权限码让下一例的拒绝断言失效。</p>
     */
    @BeforeEach
    void resetServiceInteractions() {
        reset(fileService);
        permissionApi.reset();
    }

    /**
     * 机器主体访问后端上传入口必须被拒绝，且不产生任何文件服务调用。
     *
     * @throws Exception HTTP 测试执行或响应解析失败时抛出
     */
    @Test
    void machinePrincipalDeniedOnUploadEndpoint() throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", "machine.txt", "text/plain",
                "机器主体内容".getBytes(StandardCharsets.UTF_8));
        MvcResult result = mvc.perform(MockMvcRequestBuilders.multipart("/admin-api/infra/file/upload")
                        .file(file)
                        .param("directory", "machine")
                        .header("Authorization", "Bearer " + MACHINE_TOKEN))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(readBody(result).get("code").asInt()).as("真实响应=%s", readBody(result)).isEqualTo(403);
        verify(fileService, never()).createFile(any(byte[].class), any(), any(), any());
    }

    /**
     * 机器主体访问预签名预约入口必须被拒绝，不能为其签发任何上传地址。
     *
     * @throws Exception HTTP 测试执行或响应解析失败时抛出
     */
    @Test
    void machinePrincipalDeniedOnPresignEndpoint() throws Exception {
        MvcResult result = mvc.perform(MockMvcRequestBuilders.get("/admin-api/infra/file/presigned-url")
                        .param("name", "machine.txt")
                        .param("size", "3")
                        .header("Authorization", "Bearer " + MACHINE_TOKEN))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(readBody(result).get("code").asInt()).as("真实响应=%s", readBody(result)).isEqualTo(403);
        verify(fileService, never()).presignPutUrl(any(), any(), anyLong());
    }

    /**
     * 机器主体访问完成登记入口必须被拒绝，不能把对象登记成文件元数据。
     *
     * @throws Exception HTTP 测试执行或响应解析失败时抛出
     */
    @Test
    void machinePrincipalDeniedOnCreateEndpoint() throws Exception {
        MvcResult result = mvc.perform(MockMvcRequestBuilders.post("/admin-api/infra/file/create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"path\":\"machine/machine.txt\",\"name\":\"machine.txt\",\"url\":\"https://files.example.invalid/machine/machine.txt\",\"size\":3}")
                        .header("Authorization", "Bearer " + MACHINE_TOKEN))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(readBody(result).get("code").asInt()).as("真实响应=%s", readBody(result)).isEqualTo(403);
        verify(fileService, never()).createFile(any(FileCreateReqVO.class));
    }

    /**
     * 真实用户令牌必须仍然可以调用上传入口，证明隔离只作用于机器主体。
     *
     * @throws Exception HTTP 测试执行或响应解析失败时抛出
     */
    @Test
    void realUserTokenStillReachesUploadEndpoint() throws Exception {
        when(fileService.createFile(any(byte[].class), any(), any(), any())).thenReturn("/file/result");
        MockMultipartFile file = new MockMultipartFile("file", "user.txt", "text/plain",
                "真实用户内容".getBytes(StandardCharsets.UTF_8));
        MvcResult result = mvc.perform(MockMvcRequestBuilders.multipart("/admin-api/infra/file/upload")
                        .file(file)
                        .header("Authorization", "Bearer " + REAL_USER_TOKEN))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(readBody(result).get("code").asInt()).as("真实响应=%s", readBody(result)).isZero();
        assertThat(readBody(result).get("data").asText()).isEqualTo("/file/result");
        verify(fileService).createFile(any(byte[].class), any(), any(), any());
    }

    /**
     * 无令牌访问上传入口必须返回未授权，说明机器主体的 403 不是链路整体失效。
     *
     * @throws Exception HTTP 测试执行或响应解析失败时抛出
     */
    @Test
    void anonymousDeniedOnUploadEndpoint() throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", "anonymous.txt", "text/plain", new byte[] {1});
        MvcResult result = mvc.perform(MockMvcRequestBuilders.multipart("/admin-api/infra/file/upload")
                        .file(file))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(readBody(result).get("code").asInt()).as("真实响应=%s", readBody(result)).isEqualTo(401);
        verify(fileService, never()).createFile(any(byte[].class), any(), any(), any());
    }

    /**
     * 公开读取入口继续按匿名放行，证明机器主体的拒绝规则没有破坏既有公开读取契约。
     *
     * @throws Exception HTTP 测试执行或响应解析失败时抛出
     */
    @Test
    void publicFileContentStaysAnonymous() throws Exception {
        when(fileService.getFileContent(any())).thenReturn("public".getBytes(StandardCharsets.UTF_8));
        MvcResult result = mvc.perform(MockMvcRequestBuilders.get("/admin-api/infra/file/content/2026/01/a.txt"))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(result.getResponse().getContentAsString(StandardCharsets.UTF_8)).isEqualTo("public");
    }

    /**
     * 解析真实响应体，避免断言依赖日志输出。
     *
     * @param result MockMvc 执行结果
     * @return 解析后的 JSON 响应体
     * @throws Exception 响应体读取或 JSON 解析失败时抛出
     */
    private static JsonNode readBody(MvcResult result) throws Exception {
        return JsonUtils.parseObject(result.getResponse().getContentAsString(), JsonNode.class);
    }

    /**
     * 缺少查询权限码的真实用户不能在文件分页入口获得任何数据。
     *
     * <p>页面隐藏按钮不构成授权；直接构造请求时必须在进入业务层之前被拒绝，返回统一错误体且文件服务
     * 零交互。断言同时记录端点真正声明的权限串，避免“拒绝”来自其他原因。</p>
     *
     * @throws Exception HTTP 测试执行或响应解析失败时抛出
     */
    @Test
    void userWithoutQueryPermissionDeniedOnFilePage() throws Exception {
        MvcResult result = mvc.perform(MockMvcRequestBuilders.get("/admin-api/infra/file/page")
                        .param("pageNo", "1").param("pageSize", "10")
                        .header("Authorization", "Bearer " + REAL_USER_TOKEN))
                .andExpect(status().isOk())
                .andReturn();

        assertThat(readBody(result).get("code").asInt()).as("真实响应=%s", readBody(result)).isEqualTo(403);
        assertThat(readBody(result).get("data").isNull()).isTrue();
        verify(fileService, never()).getFilePage(any());
        assertThat(permissionApi.requestedPermissions()).containsExactly("infra:file:query");
    }

    /**
     * 缺少查询权限码的真实用户不能读取文件详情，且不触达业务层。
     *
     * <p>详情是列表之外的替代入口，单独验证可避免只保护分页而漏掉按编号直读。</p>
     *
     * @throws Exception HTTP 测试执行或响应解析失败时抛出
     */
    @Test
    void userWithoutQueryPermissionDeniedOnFileDetail() throws Exception {
        MvcResult result = mvc.perform(MockMvcRequestBuilders.get("/admin-api/infra/file/get")
                        .param("id", "5")
                        .header("Authorization", "Bearer " + REAL_USER_TOKEN))
                .andExpect(status().isOk())
                .andReturn();

        assertThat(readBody(result).get("code").asInt()).as("真实响应=%s", readBody(result)).isEqualTo(403);
        verify(fileService, never()).getFile(any());
        assertThat(permissionApi.requestedPermissions()).containsExactly("infra:file:query");
    }

    /**
     * 授予查询权限码后同一端点必须真实返回数据，证明拒绝断言不是“整条链路失效”。
     *
     * @throws Exception HTTP 测试执行或响应解析失败时抛出
     */
    @Test
    void userWithQueryPermissionReachesFilePage() throws Exception {
        permissionApi.grant("infra:file:query");
        when(fileService.getFilePage(any(FilePageReqVO.class))).thenReturn(new PageResult<>(List.of(), 0L));

        MvcResult result = mvc.perform(MockMvcRequestBuilders.get("/admin-api/infra/file/page")
                        .param("pageNo", "1").param("pageSize", "10")
                        .header("Authorization", "Bearer " + REAL_USER_TOKEN))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode body = readBody(result);
        assertThat(body.get("code").asInt()).as("真实响应=%s", body).isZero();
        assertThat(body.get("data").get("total").asLong()).isZero();
        verify(fileService).getFilePage(any(FilePageReqVO.class));
        assertThat(permissionApi.requestedPermissions()).containsExactly("infra:file:query");
    }

    /**
     * 缺少删除权限码的真实用户不能删除单个文件，对象与元数据都不会被触碰。
     *
     * @throws Exception HTTP 测试执行或响应解析失败时抛出
     */
    @Test
    void userWithoutDeletePermissionCannotDeleteFile() throws Exception {
        MvcResult result = mvc.perform(MockMvcRequestBuilders.delete("/admin-api/infra/file/delete")
                        .param("id", "5")
                        .header("Authorization", "Bearer " + REAL_USER_TOKEN))
                .andExpect(status().isOk())
                .andReturn();

        assertThat(readBody(result).get("code").asInt()).as("真实响应=%s", readBody(result)).isEqualTo(403);
        verify(fileService, never()).deleteFile(any());
        assertThat(permissionApi.requestedPermissions()).containsExactly("infra:file:delete");
    }

    /**
     * 批量删除与单个删除共用删除权限码，缺少权限时必须在参数展开前整体拒绝。
     *
     * @throws Exception HTTP 测试执行或响应解析失败时抛出
     */
    @Test
    void userWithoutDeletePermissionCannotBatchDeleteFiles() throws Exception {
        MvcResult result = mvc.perform(MockMvcRequestBuilders.delete("/admin-api/infra/file/delete-list")
                        .param("ids", "5", "6")
                        .header("Authorization", "Bearer " + REAL_USER_TOKEN))
                .andExpect(status().isOk())
                .andReturn();

        assertThat(readBody(result).get("code").asInt()).as("真实响应=%s", readBody(result)).isEqualTo(403);
        verify(fileService, never()).deleteFileList(any());
        assertThat(permissionApi.requestedPermissions()).containsExactly("infra:file:delete");
    }

    /**
     * 可编程权限判定替身。
     *
     * <p>保留生产 {@code @ss.hasPermission(String)} 的调用契约，只把“当前用户有哪些权限码”换成测试
     * 可控的集合，并记录每次被请求的权限串，用于证明端点确实声明了预期权限码而不是被其他原因拒绝。</p>
     */
    static class PermissionApiStub implements PermissionCommonApi {

        /** 当前放行的权限码；为空表示任何权限码都不放行。 */
        private final Set<String> granted = new HashSet<>();

        /** 按调用顺序记录被请求的权限码。 */
        private final List<String> requested = new ArrayList<>();

        /**
         * 判断任一权限码是否放行。
         *
         * @param userId 登录用户编号，本用例不区分账号
         * @param permissions 端点声明的权限码
         * @return 存在任一已放行权限码时为真
         */
        @Override
        public boolean hasAnyPermissions(Long userId, String... permissions) {
            requested.addAll(List.of(permissions));
            return Arrays.stream(permissions).anyMatch(granted::contains);
        }

        /**
         * 本用例只验证权限码判定，角色判定一律不放行。
         *
         * @param userId 登录用户编号
         * @param roles 角色编码
         * @return 恒为假
         */
        @Override
        public boolean hasAnyRoles(Long userId, String... roles) {
            return false;
        }

        /**
         * 本用例不涉及部门数据权限，被调用返回空结果而不是伪造范围。
         *
         * @param userId 登录用户编号
         * @return 恒为空
         */
        @Override
        public DeptDataPermissionRespDTO getDeptDataPermission(Long userId) {
            return null;
        }

        /**
         * 放行指定权限码。
         *
         * @param permission 需要放行的权限码
         */
        void grant(String permission) {
            granted.add(permission);
        }

        /**
         * 读取按顺序记录的权限码请求。
         *
         * @return 被请求的权限码列表
         */
        List<String> requestedPermissions() {
            return List.copyOf(requested);
        }

        /** 复位放行集合与记录，避免用例之间互相污染。 */
        void reset() {
            granted.clear();
            requested.clear();
        }
    }

    /** 复现生产 WebMvc 装配：只有 controller.admin 下的 RestController 带 /admin-api 前缀。 */
    @Configuration(proxyBeanMethods = false)
    @EnableWebMvc
    static class MvcConfiguration implements WebMvcConfigurer {

        /** 与 BasicFrameworkWebAutoConfiguration 一致地声明管理后台前缀。 */
        @Override
        public void configurePathMatch(PathMatchConfigurer configurer) {
            AntPathMatcher matcher = new AntPathMatcher(".");
            configurer.addPathPrefix("/admin-api",
                    clazz -> clazz.isAnnotationPresent(RestController.class)
                            && matcher.match("**.controller.admin.**", clazz.getPackage().getName()));
        }
    }

    /** 补齐 Spring Boot WebSecurity 自动配置在生产中提供的开关。 */
    @Configuration(proxyBeanMethods = false)
    @EnableWebSecurity
    static class WebSecurityTestConfiguration {
    }

    /** 装配真实控制器与前置依赖，只有文件服务和令牌校验使用受控替身。 */
    @Configuration(proxyBeanMethods = false)
    static class TestBeans {

        /** 生产 Web 前缀配置，驱动用户类型识别与模块放行规则。 */
        @Bean
        WebProperties webProperties() {
            return new WebProperties();
        }

        /** 初始化静态请求工具持有的前缀配置。 */
        @Bean
        WebFrameworkUtils webFrameworkUtils(WebProperties properties) {
            return new WebFrameworkUtils(properties);
        }

        /** 生产全局异常处理，未授权与无权限响应体与生产一致。 */
        @Bean
        GlobalExceptionHandler globalExceptionHandler() {
            return new GlobalExceptionHandler("file-machine-principal-test", mock(ApiErrorLogCommonApi.class));
        }

        /**
         * 权限服务替身：文件写入入口没有权限表达式，查询与删除入口按声明的权限码判定。
         *
         * @return 可编程并记录请求的权限判定替身
         */
        @Bean
        PermissionCommonApi permissionCommonApi() {
            return permissionApi;
        }

        /** 上传大小限制使用生产默认值，避免装配期缺依赖。 */
        @Bean
        FileUploadProperties fileUploadProperties() {
            return new FileUploadProperties();
        }

        /** 文件服务替身，作为 Bean 注入控制器并供用例断言“入口被拒绝时没有任何交互”。 */
        @Bean
        FileService fileService() {
            return fileService;
        }

        /** 真实文件接口控制器，服务依赖与上传限制由容器按 @Resource 注入。 */
        @Bean
        FileController fileController() {
            return new FileController();
        }

        /** 令牌校验替身，只按请求令牌映射为机器主体、真实用户或无效凭据。 */
        @Bean
        OAuth2TokenCommonApi oauth2TokenCommonApi() {
            return new TokenApiStub();
        }
    }

    /**
     * 令牌校验替身：返回生产 {@link OAuth2AccessTokenCheckRespDTO} 契约对象。
     *
     * <p>过滤链仍按真实规则校验用户类型、构建登录用户并执行授权，因此这里替换的只是令牌存储，
     * 不是安全链本身。除校验外的令牌操作不属于本用例范围，被调用时直接失败而不是返回假结果。</p>
     */
    private static final class TokenApiStub implements OAuth2TokenCommonApi {

        /**
         * 按请求令牌返回固定主体。
         *
         * @param accessToken 请求携带的访问令牌
         * @return 机器主体、真实用户或无效凭据（{@code null}）
         */
        @Override
        public OAuth2AccessTokenCheckRespDTO checkAccessToken(String accessToken) {
            if (MACHINE_TOKEN.equals(accessToken)) {
                return token(0L, List.of());
            }
            if (REAL_USER_TOKEN.equals(accessToken)) {
                return token(1L, List.of("user.read"));
            }
            return null;
        }

        /**
         * 本用例不签发令牌，被调用即说明装配范围被意外扩大。
         *
         * @param reqDTO 访问令牌的创建信息
         * @return 不会返回
         * @throws UnsupportedOperationException 始终抛出，避免用假结果掩盖越界调用
         */
        @Override
        public OAuth2AccessTokenRespDTO createAccessToken(OAuth2AccessTokenCreateReqDTO reqDTO) {
            throw new UnsupportedOperationException("文件安全链用例不签发令牌");
        }

        /**
         * 本用例不移除令牌，被调用即说明装配范围被意外扩大。
         *
         * @param accessToken 访问令牌
         * @return 不会返回
         * @throws UnsupportedOperationException 始终抛出，避免用假结果掩盖越界调用
         */
        @Override
        public OAuth2AccessTokenRespDTO removeAccessToken(String accessToken) {
            throw new UnsupportedOperationException("文件安全链用例不移除令牌");
        }

        /**
         * 本用例不刷新令牌，被调用即说明装配范围被意外扩大。
         *
         * @param refreshToken 刷新令牌
         * @param clientId 客户端编号
         * @return 不会返回
         * @throws UnsupportedOperationException 始终抛出，避免用假结果掩盖越界调用
         */
        @Override
        public OAuth2AccessTokenRespDTO refreshAccessToken(String refreshToken, String clientId) {
            throw new UnsupportedOperationException("文件安全链用例不刷新令牌");
        }

        /**
         * 构造生产契约的令牌校验结果。
         *
         * @param userId 用户编号，机器主体使用占位零
         * @param scopes 授权范围
         * @return 令牌校验响应
         */
        private OAuth2AccessTokenCheckRespDTO token(Long userId, List<String> scopes) {
            OAuth2AccessTokenCheckRespDTO result = new OAuth2AccessTokenCheckRespDTO();
            result.setUserId(userId);
            result.setUserType(UserTypeEnum.ADMIN.getValue());
            result.setUserInfo(Map.of());
            result.setClientId("file-security-client");
            result.setScopes(scopes);
            result.setExpiresTime(LocalDateTime.now().plusMinutes(10));
            return result;
        }
    }
}
