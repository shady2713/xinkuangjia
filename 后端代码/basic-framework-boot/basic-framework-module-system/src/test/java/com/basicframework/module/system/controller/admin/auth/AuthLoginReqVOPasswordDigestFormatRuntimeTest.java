package com.basicframework.module.system.controller.admin.auth;

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.web.core.handler.GlobalExceptionHandler;
import com.basicframework.module.system.controller.admin.auth.vo.AuthLoginReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthLoginRespVO;
import com.basicframework.module.system.service.auth.AdminAuthService;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import lombok.Data;
import org.hibernate.validator.constraints.Length;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 运行期锁定登录入参 {@link AuthLoginReqVO} 的口令**协议格式契约**：报文里的 {@code password}
 * 必须是 32 位十六进制摘要。
 *
 * <p>本类走完整真实链路：真实 {@link AuthController}、真实 {@code GlobalExceptionHandler}（生产异常契约）、
 * 真实 {@code LocalValidatorFactoryBean}（Spring MVC 对 {@code @Valid @RequestBody} 使用的同一校验器）、
 * 真实 Jackson 报文转换；唯一替身是下游 {@link AdminAuthService}，用来观察「请求有没有进入认证流程」。</p>
 *
 * <p>判别性由同文件内的**契约违反变体** {@link UpstreamLengthBoundAuthController} 提供：它复刻固定上游
 * 版本 {@code ruoyi-vue-pro@ac022b15} 的 {@code @Length(min = 4, max = 16)}，在同一探针下对同一份
 * 32 位摘要报文给出相反判定，从而证明本类读到的「接受 / 拒绝」确实来自生产入参类的真实约束面。</p>
 *
 * <p>覆盖的契约结论：合法登录报文不受影响（协议值恒为 {@code CryptoJS.MD5(...).toString()} 产出的
 * 32 位小写十六进制）；非摘要形态在参数校验阶段被拒绝；拒绝的表达方式是 HTTP 200 + 业务码 400，
 * 与本仓库既有参数错误契约一致。</p>
 *
 * @author 证据与契约方向执行代理
 */
class AuthLoginReqVOPasswordDigestFormatRuntimeTest {

    /** 真实登录入口路径。 */
    private static final String LOGIN_PATH = "/system/auth/login";

    /** 真实超级管理员登录入口路径，与登录入口共用同一个入参类。 */
    private static final String SUPER_ADMIN_LOGIN_PATH = "/system/auth/super-admin-login";

    /** 上游长度边界变体的登录入口路径，仅供负对照使用。 */
    private static final String UPSTREAM_BOUND_LOGIN_PATH = "/upstream-length-bound/auth/login";

    /** 生产异常契约中参数错误的业务码，与 HTTP 状态码区分。 */
    private static final int PARAM_ERROR_CODE = 400;

    /** 生产异常契约中参数错误的 HTTP 状态码：本仓库统一返回 200。 */
    private static final int PARAM_ERROR_HTTP_STATUS = 200;

    /** 摘要格式约束的提示文案。 */
    private static final String DIGEST_FORMAT_MESSAGE = "密码摘要必须为 32 位十六进制字符串";

    /** 非空约束的提示文案。 */
    private static final String NOT_EMPTY_MESSAGE = "密码不能为空";

    /** 被测的生产形状：真实控制器、真实异常处理、真实校验器。 */
    private MockMvc productionMvc;

    /** 契约违反变体形状：上游长度边界的控制器。 */
    private MockMvc upstreamBoundMvc;

    /** 认证服务替身，用于观察请求是否进入认证流程。 */
    private AdminAuthService authService;

    /** 真实登录入口收到的入参副本。 */
    private final List<AuthLoginReqVO> loginRequests = new ArrayList<>();

    /** 真实超级管理员登录入口收到的入参副本。 */
    private final List<AuthLoginReqVO> superAdminLoginRequests = new ArrayList<>();

    /** 契约违反变体收到的入参副本。 */
    private final List<UpstreamLengthBoundAuthLoginReqVO> upstreamBoundRequests = new ArrayList<>();

    /** 报文序列化器，保证探针报文与真实客户端形态一致。 */
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 装配两条真实链路：生产控制器与上游长度边界变体控制器。
     *
     * <p>校验器只创建一次并同时交给两条链路，保证两侧面对完全相同的校验实现，差异只可能来自入参类
     * 自身的约束面。</p>
     *
     * @throws Exception 校验器初始化失败时向上抛出
     */
    @BeforeEach
    void setUp() throws Exception {
        authService = mock(AdminAuthService.class);
        when(authService.login(any(AuthLoginReqVO.class))).thenAnswer(invocation -> {
            AuthLoginReqVO reqVO = invocation.getArgument(0);
            loginRequests.add(reqVO);
            return loginResp();
        });
        when(authService.superAdminLogin(any(AuthLoginReqVO.class))).thenAnswer(invocation -> {
            AuthLoginReqVO reqVO = invocation.getArgument(0);
            superAdminLoginRequests.add(reqVO);
            return loginResp();
        });

        LocalValidatorFactoryBean validator = new LocalValidatorFactoryBean();
        validator.afterPropertiesSet();

        AuthController controller = new AuthController();
        ReflectionTestUtils.setField(controller, "authService", authService);
        productionMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new GlobalExceptionHandler("basic-framework", null))
                .setValidator(validator)
                .build();

        UpstreamLengthBoundAuthController variantController = new UpstreamLengthBoundAuthController();
        ReflectionTestUtils.setField(variantController, "upstreamBoundRequests", upstreamBoundRequests);
        upstreamBoundMvc = MockMvcBuilders.standaloneSetup(variantController)
                .setControllerAdvice(new GlobalExceptionHandler("basic-framework", null))
                .setValidator(validator)
                .build();
    }

    /**
     * 协议值（小写十六进制 32 位摘要）在两个真实登录入口上都必须通过校验并原样进入认证流程。
     *
     * <p>这是「合法登录未被破坏」的核心读数：前端 {@code md5(...)} 产出的小写十六进制摘要必须逐字符
     * 原样到达认证层，既不被截断也不被改写为大写。</p>
     *
     * @throws Exception 报文读写失败时向上抛出
     */
    @Test
    void protocolDigestPassesBothRealLoginEntriesUnchanged() throws Exception {
        List<String> digests = List.of(
                "21232f297a57a5a743894a0e4a801fc3",
                "d41d8cd98f00b204e9800998ecf8427e",
                "00000000000000000000000000000000",
                "ffffffffffffffffffffffffffffffff");

        for (String digest : digests) {
            MvcResult result = post(productionMvc, LOGIN_PATH, loginBody("admin", digest));

            assertThat(bodyCode(result)).as("协议摘要 %s 必须通过参数校验", digest).isZero();
            assertThat(result.getResponse().getStatus()).as("合法请求的 HTTP 状态").isEqualTo(200);
        }

        assertThat(loginRequests).as("四次请求都进入认证流程").hasSize(digests.size());
        assertThat(loginRequests).extracting(AuthLoginReqVO::getPassword)
                .as("进入认证流程的摘要必须与报文逐字符一致，未被截断或改写")
                .containsExactlyElementsOf(digests);

        MvcResult superAdmin = post(productionMvc, SUPER_ADMIN_LOGIN_PATH,
                loginBody("admin", digests.get(0)));
        assertThat(bodyCode(superAdmin)).as("第二个真实入口同样接受协议摘要").isZero();
        assertThat(superAdminLoginRequests).extracting(AuthLoginReqVO::getPassword)
                .containsExactly(digests.get(0));
    }

    /**
     * 大写十六进制摘要同样合法：MD5 的十六进制表示大小写等价，存储值由 BCrypt 摘要比对而非字面比较。
     *
     * @throws Exception 报文读写失败时向上抛出
     */
    @Test
    void upperCaseHexDigestIsAlsoAccepted() throws Exception {
        String upperCase = "21232F297A57A5A743894A0E4A801FC3";

        MvcResult result = post(productionMvc, LOGIN_PATH, loginBody("admin", upperCase));

        assertThat(bodyCode(result)).as("大写十六进制摘要必须通过").isZero();
        assertThat(loginRequests).extracting(AuthLoginReqVO::getPassword).containsExactly(upperCase);
    }

    /**
     * 长度为 32 但不是十六进制的值必须被拒绝，且不进入认证流程。
     *
     * <p>探针覆盖字母表外的字符与常见脏数据形态，确保拒绝来自「非十六进制」而不是长度。</p>
     *
     * @throws Exception 报文读写失败时向上抛出
     */
    @Test
    void nonHexadecimalThirtyTwoCharacterValueIsRejected() throws Exception {
        List<String> candidates = List.of(
                "z".repeat(32),
                "21232f297a57a5a743894a0e4a801fcg",
                "21232f297a57a5a743894a0e4a801fc-",
                " ".repeat(32),
                "21232f297a57a5a743894a0e4a801fc3!");

        for (String candidate : candidates) {
            MvcResult result = post(productionMvc, LOGIN_PATH, loginBody("admin", candidate));

            assertThat(bodyCode(result)).as("非十六进制的 32 位值 %s 必须被拒绝", candidate)
                    .isEqualTo(PARAM_ERROR_CODE);
            assertThat(bodyMessage(result)).as("拒绝原因必须是摘要格式约束").isEqualTo(DIGEST_FORMAT_MESSAGE);
        }

        assertThat(loginRequests).as("被拒绝的请求不得进入认证流程").isEmpty();
    }

    /**
     * 长度不是 32 的值一律拒绝，覆盖短于、略长于与远长于协议值三侧。
     *
     * @throws Exception 报文读写失败时向上抛出
     */
    @Test
    void lengthOtherThanThirtyTwoIsRejected() throws Exception {
        List<String> candidates = List.of(
                "a".repeat(31),
                "a".repeat(33),
                "1",
                "Abcd1234",
                "a".repeat(64),
                "a".repeat(1024));

        for (String candidate : candidates) {
            MvcResult result = post(productionMvc, LOGIN_PATH, loginBody("admin", candidate));

            assertThat(bodyCode(result)).as("长度 %d 的值必须被拒绝", candidate.length())
                    .isEqualTo(PARAM_ERROR_CODE);
            assertThat(bodyMessage(result)).as("拒绝原因必须是摘要格式约束").isEqualTo(DIGEST_FORMAT_MESSAGE);
        }

        assertThat(loginRequests).as("被拒绝的请求不得进入认证流程").isEmpty();
    }

    /**
     * 参数错误的真实传输契约：HTTP 状态仍是 200，错误由业务码 400 表达。
     *
     * <p>本仓库的 {@code GlobalExceptionHandler} 对 {@code MethodArgumentNotValidException} 不设
     * {@code @ResponseStatus}，因此摘要格式错误不得被实现成 HTTP 400。</p>
     *
     * @throws Exception 报文读写失败时向上抛出
     */
    @Test
    void parameterErrorIsHttp200WithBusinessCode400() throws Exception {
        MvcResult result = post(productionMvc, LOGIN_PATH, loginBody("admin", "1"));

        assertThat(result.getResponse().getStatus())
                .as("参数错误的 HTTP 状态必须保持 200").isEqualTo(PARAM_ERROR_HTTP_STATUS);
        assertThat(bodyCode(result)).as("参数错误的业务码").isEqualTo(PARAM_ERROR_CODE);
        assertThat(bodyMessage(result)).isEqualTo(DIGEST_FORMAT_MESSAGE);
    }

    /**
     * 空串与缺省口令仍由既有的非空约束处理，不被摘要格式约束取代。
     *
     * <p>两条约束对两种空值的覆盖面不同：缺省口令为 {@code null}，只触发 {@code @NotEmpty}
     * （{@code @Pattern} 按规范把 {@code null} 视为通过）；空串为非 {@code null}，同时触发两条约束，
     * 而生产异常契约只回传首条字段错误，因此断言其取值落在两条约束的提示集合内。</p>
     *
     * @throws Exception 报文读写失败时向上抛出
     */
    @Test
    void emptyAndMissingPasswordRemainRejectedByNotEmpty() throws Exception {
        MvcResult empty = post(productionMvc, LOGIN_PATH, loginBody("admin", ""));
        MvcResult missing = post(productionMvc, LOGIN_PATH, loginBodyWithoutPassword("admin"));

        assertThat(bodyCode(empty)).as("空口令被拒绝").isEqualTo(PARAM_ERROR_CODE);
        assertThat(bodyCode(missing)).as("缺省口令被拒绝").isEqualTo(PARAM_ERROR_CODE);
        assertThat(bodyMessage(missing))
                .as("缺省口令只触发非空约束，提示必须唯一").isEqualTo(NOT_EMPTY_MESSAGE);
        assertThat(bodyMessage(empty))
                .as("空串同时触发两条约束，响应只回传首条字段错误")
                .isIn(NOT_EMPTY_MESSAGE, DIGEST_FORMAT_MESSAGE);
        assertThat(loginRequests).as("空口令不得进入认证流程").isEmpty();
    }

    /**
     * 负对照：上游长度边界会拒绝现行协议的合法报文，本契约不会。
     *
     * <p>两侧对同一份 32 位摘要报文必须给出不同判定，且变体侧请求不得进入控制器方法体。这条断言是本类
     * 判别性的来源——若生产约束不存在，两侧会同时放行，用例立即失败。</p>
     *
     * @throws Exception 报文读写失败时向上抛出
     */
    @Test
    void upstreamLengthBoundWouldRejectTheRealProtocolValue() throws Exception {
        String digest = "21232f297a57a5a743894a0e4a801fc3";

        assertThat(bodyCode(post(upstreamBoundMvc, UPSTREAM_BOUND_LOGIN_PATH, loginBody("admin", digest))))
                .as("上游 @Length(4,16) 必须拒绝 32 位协议摘要")
                .isEqualTo(PARAM_ERROR_CODE);
        assertThat(bodyMessage(post(upstreamBoundMvc, UPSTREAM_BOUND_LOGIN_PATH, loginBody("admin", digest))))
                .isEqualTo("密码长度为 4-16 位");
        assertThat(upstreamBoundRequests).as("被上游边界拒绝的请求不得进入控制器方法体").isEmpty();

        assertThat(bodyCode(post(productionMvc, LOGIN_PATH, loginBody("admin", digest))))
                .as("同一报文在现行契约下必须通过").isZero();
        assertThat(loginRequests).extracting(AuthLoginReqVO::getPassword).containsExactly(digest);
    }

    /**
     * 提交一次登录请求。
     *
     * @param mockMvc 目标链路
     * @param path 请求路径
     * @param body 请求报文
     * @return 真实 MVC 结果
     * @throws Exception 报文读写失败时向上抛出
     */
    private static MvcResult post(MockMvc mockMvc, String path, String body) throws Exception {
        return mockMvc.perform(MockMvcRequestBuilders.post(path)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn();
    }

    /**
     * 构造登录报文。
     *
     * @param username 登录账号
     * @param password 登录口令
     * @return 序列化后的报文
     * @throws Exception 序列化失败时向上抛出
     */
    private String loginBody(String username, String password) throws Exception {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("username", username);
        payload.put("password", password);
        return objectMapper.writeValueAsString(payload);
    }

    /**
     * 构造缺省口令的登录报文。
     *
     * @param username 登录账号
     * @return 序列化后的报文
     * @throws Exception 序列化失败时向上抛出
     */
    private String loginBodyWithoutPassword(String username) throws Exception {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("username", username);
        return objectMapper.writeValueAsString(payload);
    }

    /**
     * 读取响应中的业务码。
     *
     * @param result MVC 结果
     * @return 业务码
     * @throws Exception 解析失败时向上抛出
     */
    private int bodyCode(MvcResult result) throws Exception {
        return objectMapper.readTree(responseBody(result)).get("code").asInt();
    }

    /**
     * 读取响应中的业务提示。
     *
     * @param result MVC 结果
     * @return 业务提示
     * @throws Exception 解析失败时向上抛出
     */
    private String bodyMessage(MvcResult result) throws Exception {
        return objectMapper.readTree(responseBody(result)).get("msg").asText();
    }

    /**
     * 按 UTF-8 读取响应报文。
     *
     * @param result MVC 结果
     * @return 响应报文
     */
    private static String responseBody(MvcResult result) {
        return new String(result.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    /**
     * 构造一次成功登录的真实响应体。
     *
     * @return 带令牌的登录响应
     */
    private static AuthLoginRespVO loginResp() {
        AuthLoginRespVO respVO = new AuthLoginRespVO();
        respVO.setUserId(1024L);
        respVO.setAccessToken("probe-access-token");
        respVO.setRefreshToken("probe-refresh-token");
        respVO.setExpiresTime(LocalDateTime.of(2026, 1, 1, 0, 0));
        return respVO;
    }

    /**
     * 契约违反变体控制器：复刻固定上游版本的登录入口路径。
     *
     * <p>变体只用于负对照，不参与任何生产路径。</p>
     */
    @RestController
    @RequestMapping("/upstream-length-bound/auth")
    static class UpstreamLengthBoundAuthController {

        /** 变体收到的入参副本，由外层用例断言。 */
        private List<UpstreamLengthBoundAuthLoginReqVO> upstreamBoundRequests;

        /**
         * 使用账号密码登录，与上游入口路径一致。
         *
         * @param reqVO 登录请求
         * @return 成功响应
         */
        @PostMapping("/login")
        public CommonResult<AuthLoginRespVO> login(@RequestBody @Valid UpstreamLengthBoundAuthLoginReqVO reqVO) {
            upstreamBoundRequests.add(reqVO);
            return CommonResult.success(loginResp());
        }
    }

    /**
     * 契约违反变体入参：字段名与类型对齐固定上游版本，密码约束复刻上游的明文长度边界。
     *
     * <p>该类只用于负对照，不参与任何生产路径，也不被生产代码引用。</p>
     */
    @Data
    static class UpstreamLengthBoundAuthLoginReqVO {

        /** 账号。 */
        @NotEmpty(message = "登录账号不能为空")
        private String username;

        /** 明文密码。 */
        @NotEmpty(message = "密码不能为空")
        @Length(min = 4, max = 16, message = "密码长度为 4-16 位")
        private String password;
    }

}