package com.basicframework.module.system.controller.admin.auth;

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.web.core.handler.GlobalExceptionHandler;
import com.basicframework.module.system.controller.admin.auth.vo.AuthLoginReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthLoginRespVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthRegisterReqVO;
import com.basicframework.module.system.service.auth.AdminAuthService;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
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
 * 运行期实测登录入参 {@link AuthLoginReqVO} 的密码长度约束在真实认证入口上的行为。
 *
 * <p>本类回答一个只能靠运行期回答的问题：**一至三位的密码是否真的能通过参数校验并进入认证流程**。
 * 为此它走完整链路：真实 {@link AuthController}、真实 {@code GlobalExceptionHandler}（生产异常契约）、
 * 真实 {@code LocalValidatorFactoryBean}（Hibernate Validator，Spring MVC 对 {@code @Valid @RequestBody}
 * 使用的同一校验器）、真实 Jackson 报文转换，唯一的替身是下游 {@link AdminAuthService}——把它换成替身
 * 正是为了观察「请求有没有进入认证流程」，而不是让数据库噪声掩盖边界判定。</p>
 *
 * <p>判别性由同文件内的**契约违反变体** {@link UpstreamShapedAuthController} 提供：它复刻固定上游
 * 版本 {@code ruoyi-vue-pro@ac022b15} 的密码约束 {@code @Length(min = 4, max = 16)} 与账号约束
 * {@code @Length(4,30) + @Pattern}，在同一探针下对同样的报文给出不同判定，从而证明本类读到的
 * 「接受 / 拒绝」确实来自生产入参类的真实约束面，而不是探针恒真。变体不参与任何生产路径。</p>
 *
 * <p>本类不改动任何生产代码，也不对「本地删除密码长度约束是否符合目标契约」下结论：该判断属于有权者
 * 处置范围，这里只固定当前实现的运行期读数与差异面。</p>
 *
 * @author 证据与契约方向执行代理
 */
class AuthLoginReqVOPasswordBoundaryRuntimeTest {

    /** 真实登录入口路径。 */
    private static final String LOGIN_PATH = "/system/auth/login";

    /** 真实超级管理员登录入口路径，与登录入口共用同一个入参类。 */
    private static final String SUPER_ADMIN_LOGIN_PATH = "/system/auth/super-admin-login";

    /** 真实注册入口路径，用于对比接口面强度。 */
    private static final String REGISTER_PATH = "/system/auth/register";

    /** 上游形状变体的登录入口路径，仅供负对照使用。 */
    private static final String UPSTREAM_SHAPED_LOGIN_PATH = "/upstream-shaped/auth/login";

    /** 生产异常契约中参数错误的业务码，与 HTTP 状态码区分。 */
    private static final int PARAM_ERROR_CODE = 400;

    /** 被测的生产形状：真实控制器、真实异常处理、真实校验器。 */
    private MockMvc productionMvc;

    /** 契约违反变体形状：上游约束的控制器。 */
    private MockMvc upstreamShapedMvc;

    /** 认证服务替身，用于观察请求是否进入认证流程。 */
    private AdminAuthService authService;

    /** 真实登录入口收到的入参副本。 */
    private final List<AuthLoginReqVO> loginRequests = new ArrayList<>();

    /** 真实超级管理员登录入口收到的入参副本。 */
    private final List<AuthLoginReqVO> superAdminLoginRequests = new ArrayList<>();

    /** 真实注册入口收到的入参副本。 */
    private final List<AuthRegisterReqVO> registerRequests = new ArrayList<>();

    /** 契约违反变体收到的入参副本。 */
    private final List<UpstreamShapedAuthLoginReqVO> upstreamShapedRequests = new ArrayList<>();

    /** 报文序列化器，保证探针报文与真实客户端形态一致。 */
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 装配两套真实链路：生产控制器与上游形状变体控制器。
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
        when(authService.register(any(AuthRegisterReqVO.class))).thenAnswer(invocation -> {
            AuthRegisterReqVO reqVO = invocation.getArgument(0);
            registerRequests.add(reqVO);
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

        UpstreamShapedAuthController variantController = new UpstreamShapedAuthController();
        ReflectionTestUtils.setField(variantController, "upstreamShapedRequests", upstreamShapedRequests);
        upstreamShapedMvc = MockMvcBuilders.standaloneSetup(variantController)
                .setControllerAdvice(new GlobalExceptionHandler("basic-framework", null))
                .setValidator(validator)
                .build();
    }

    /**
     * 一至三位密码通过真实登录入口的参数校验，并原样进入认证流程。
     *
     * <p>断言三件事同时成立：响应业务码为成功、认证服务被调用、进入服务的密码字符串与报文里完全一致
     * （中间没有任何截断或补齐）。空串与缺省值不在本用例内，它们由 {@code @NotEmpty} 单独覆盖。</p>
     *
     * @throws Exception 报文读写失败时向上抛出
     */
    @Test
    void oneToThreeCharacterPasswordPassesValidationAndReachesAuthService() throws Exception {
        for (String password : List.of("1", "ab", "abc")) {
            MvcResult result = post(productionMvc, LOGIN_PATH, loginBody("admin", password));

            assertThat(bodyCode(result)).as("短密码 %s 必须通过参数校验", password).isZero();
            assertThat(loginRequests).as("短密码 %s 必须真的进入认证流程", password)
                    .extracting(AuthLoginReqVO::getPassword).contains(password);
        }

        assertThat(loginRequests).as("三次请求都进入认证流程").hasSize(3);
        assertThat(loginRequests).extracting(AuthLoginReqVO::getPassword)
                .as("进入认证流程的密码必须与报文逐字符一致").containsExactly("1", "ab", "abc");
    }

    /**
     * 同一入参类还服务于超级管理员登录入口，该入口的短密码行为必须与普通登录一致。
     *
     * @throws Exception 报文读写失败时向上抛出
     */
    @Test
    void superAdminLoginEntryAcceptsTheSameShortPassword() throws Exception {
        MvcResult result = post(productionMvc, SUPER_ADMIN_LOGIN_PATH, loginBody("admin", "1"));

        assertThat(bodyCode(result)).isZero();
        assertThat(superAdminLoginRequests).as("第二个真实入口同样放行短密码")
                .extracting(AuthLoginReqVO::getPassword).containsExactly("1");
    }

    /**
     * 超过上游上限的密码同样通过参数校验并进入认证流程。
     *
     * <p>长度覆盖上游上限 16 之上的若干档位，包括 32 位摘要长度与更长输入，用于回答「删除的约束里
     * 上限一侧是否也有实际影响」。</p>
     *
     * @throws Exception 报文读写失败时向上抛出
     */
    @Test
    void passwordLongerThanUpstreamMaximumAlsoReachesAuthService() throws Exception {
        for (String password : List.of("a".repeat(17), "a".repeat(32), "a".repeat(64), "a".repeat(1024))) {
            MvcResult result = post(productionMvc, LOGIN_PATH, loginBody("admin", password));

            assertThat(bodyCode(result)).as("长度 %d 的密码必须通过参数校验", password.length()).isZero();
        }

        assertThat(loginRequests).as("四次请求都进入认证流程").hasSize(4);
        assertThat(loginRequests).as("超长密码原样进入认证流程，未被截断")
                .allSatisfy(reqVO -> assertThat(reqVO.getPassword()).hasSizeGreaterThan(16));
    }

    /**
     * 负对照：同样的探针报文在上游形状约束下被拒绝，说明本类读到的放行确实来自生产约束面。
     *
     * <p>变体被拒绝时其入参副本必须保持为空，这同时证明拒绝发生在参数校验阶段而不是控制器内部。</p>
     *
     * @throws Exception 报文读写失败时向上抛出
     */
    @Test
    void upstreamShapedBoundRejectsTheSameRequestsSoAssertionDiscriminates() throws Exception {
        List<String> rejectedPasswords = List.of("" + "1", "a" + "b", "a" + "bc", "a".repeat(17), "a".repeat(32),
                "a".repeat(1024));
        for (String candidate : rejectedPasswords) {
            MvcResult result = post(upstreamShapedMvc, UPSTREAM_SHAPED_LOGIN_PATH, loginBody("admin", candidate));

            assertThat(bodyCode(result)).as("上游形状必须拒绝长度 %d 的密码", candidate.length())
                    .isEqualTo(PARAM_ERROR_CODE);
            assertThat(bodyMessage(result)).isEqualTo("密码长度为 4-16 位");
        }

        assertThat(upstreamShapedRequests).as("被拒绝的请求不得进入控制器方法体").isEmpty();
    }

    /**
     * 兼容性关键读数：现行协议真正使用的 32 位摘要通过本地校验，却会被上游边界全部拒绝。
     *
     * <p>本用例只比较两条链路的判定，不解释协议来源；它固定的事实是「把上游边界原样补回，会让当前
     * 协议下的合法登录报文被拒绝」。</p>
     *
     * @throws Exception 报文读写失败时向上抛出
     */
    @Test
    void thirtyTwoCharacterDigestPassesLocallyButFailsUpstreamBound() throws Exception {
        String digest = "21232f297a57a5a743894a0e4a801fc3";

        assertThat(bodyCode(post(productionMvc, LOGIN_PATH, loginBody("admin", digest))))
                .as("32 位摘要在本地链路必须通过").isZero();
        assertThat(loginRequests).extracting(AuthLoginReqVO::getPassword).containsExactly(digest);

        assertThat(bodyCode(post(upstreamShapedMvc, UPSTREAM_SHAPED_LOGIN_PATH, loginBody("admin", digest))))
                .as("同一报文在上游边界下必须被拒绝").isEqualTo(PARAM_ERROR_CODE);
        assertThat(bodyMessage(post(upstreamShapedMvc, UPSTREAM_SHAPED_LOGIN_PATH, loginBody("admin", digest))))
                .isEqualTo("密码长度为 4-16 位");
    }

    /**
     * 账号侧的判定与上游完全一致，说明净放松只发生在密码字段。
     *
     * <p>账号矩阵同时覆盖长度上下界与字符集两侧；两侧链路必须给出逐档相同的判定，否则「账号侧没有
     * 实际收紧」这一说法就不成立。</p>
     *
     * @throws Exception 报文读写失败时向上抛出
     */
    @Test
    void usernameSideHasNoNetTightening() throws Exception {
        List<String> usernames = List.of("abc", "abcd", "admin", "a".repeat(30), "a".repeat(31),
                "user_name", "user-name", "用户名", "admin ");

        for (String username : usernames) {
            int productionCode = bodyCode(post(productionMvc, LOGIN_PATH, loginBody(username, "Abcd1234")));
            int upstreamCode = bodyCode(post(upstreamShapedMvc, UPSTREAM_SHAPED_LOGIN_PATH,
                    loginBody(username, "Abcd1234")));

            assertThat(productionCode).as("账号 %s 的两侧判定必须一致", username).isEqualTo(upstreamCode);
        }
    }

    /**
     * 非空约束仍然生效：空串与缺省值在参数校验阶段被拒绝，且不进入认证流程。
     *
     * <p>该用例界定残留风险的真实边界：删除长度约束之后，密码字段**不是**完全无约束。</p>
     *
     * @throws Exception 报文读写失败时向上抛出
     */
    @Test
    void emptyPasswordIsStillRejectedAndNeverReachesAuthService() throws Exception {
        assertThat(bodyCode(post(productionMvc, LOGIN_PATH, loginBody("admin", ""))))
                .isEqualTo(PARAM_ERROR_CODE);
        assertThat(bodyMessage(post(productionMvc, LOGIN_PATH, loginBody("admin", "")))).isEqualTo("密码不能为空");

        assertThat(bodyCode(post(productionMvc, LOGIN_PATH, loginBodyWithoutPassword("admin"))))
                .isEqualTo(PARAM_ERROR_CODE);
        assertThat(loginRequests).as("被拒绝的请求不得进入认证流程").isEmpty();
    }

    /**
     * 负对照：账号非法时链路确实会拒绝，证明本类的放行读数不是恒真。
     *
     * @throws Exception 报文读写失败时向上抛出
     */
    @Test
    void invalidUsernameIsRejectedSoAcceptReadingsAreNotAlwaysPass() throws Exception {
        MvcResult result = post(productionMvc, LOGIN_PATH, loginBody("ab", "Abcd1234"));

        assertThat(bodyCode(result)).isEqualTo(PARAM_ERROR_CODE);
        assertThat(loginRequests).as("账号非法时不得进入认证流程").isEmpty();
    }

    /**
     * 接口面不一致的实测：登录接受的一至三位密码，在注册入口被同一条链路直接拒绝。
     *
     * <p>同时测出注册侧约束在现行协议下的可满足性：32 位摘要同样被拒绝，只有明文强密码能通过。</p>
     *
     * @throws Exception 报文读写失败时向上抛出
     */
    @Test
    void registerSideRejectsWhatLoginSideAcceptsSoInterfaceSurfaceIsInconsistent() throws Exception {
        MvcResult shortPassword = postRegister("1");
        assertThat(bodyCode(shortPassword)).as("注册侧拒绝一至三位密码").isEqualTo(PARAM_ERROR_CODE);
        assertThat(bodyMessage(shortPassword))
                .isEqualTo("密码必须为 6-16 位，且同时包含大写字母、小写字母和数字");

        MvcResult digest = postRegister("21232f297a57a5a743894a0e4a801fc3");
        assertThat(bodyCode(digest)).as("32 位摘要在注册侧同样被拒绝").isEqualTo(PARAM_ERROR_CODE);

        MvcResult strongPlaintext = postRegister("Abcd1234");
        assertThat(bodyCode(strongPlaintext)).as("只有明文强密码能通过注册侧").isZero();
        assertThat(registerRequests).extracting(AuthRegisterReqVO::getPassword).containsExactly("Abcd1234");
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
     * 提交一次注册请求。
     *
     * @param password 注册密码
     * @return 真实 MVC 结果
     * @throws Exception 报文读写失败时向上抛出
     */
    private MvcResult postRegister(String password) throws Exception {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("username", "basicframework");
        payload.put("nickname", "basicframework");
        payload.put("password", password);
        return post(productionMvc, REGISTER_PATH, objectMapper.writeValueAsString(payload));
    }

    /**
     * 构造登录报文。
     *
     * @param username 登录账号
     * @param password 登录密码
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
     * 构造缺省密码的登录报文。
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
     * 契约违反变体控制器：复刻固定上游版本的登录入口与入参约束。
     *
     * <p>只复刻与密码/账号边界判定相关的部分：上游的社交登录字段与两个 {@code @AssertTrue} 方法与本
     * 议题无关，不在复刻范围内，缺失它们不影响任何一条探针的判定。</p>
     */
    @RestController
    @RequestMapping("/upstream-shaped/auth")
    static class UpstreamShapedAuthController {

        /** 变体收到的入参副本，由外层用例断言。 */
        private List<UpstreamShapedAuthLoginReqVO> upstreamShapedRequests;

        /**
         * 使用账号密码登录，与上游入口路径和入参形状一致。
         *
         * @param reqVO 登录请求
         * @return 成功响应
         */
        @PostMapping("/login")
        public CommonResult<AuthLoginRespVO> login(@RequestBody @Valid UpstreamShapedAuthLoginReqVO reqVO) {
            upstreamShapedRequests.add(reqVO);
            return CommonResult.success(loginResp());
        }
    }

    /**
     * 契约违反变体入参：字段名、类型与约束全部对齐固定上游版本。
     *
     * <p>该类只用于负对照，不参与任何生产路径，也不被生产代码引用。</p>
     */
    @Schema(description = "管理后台 - 账号密码登录 Request VO（上游形状变体）")
    @Data
    static class UpstreamShapedAuthLoginReqVO {

        /** 账号。 */
        @NotEmpty(message = "登录账号不能为空")
        @Length(min = 4, max = 30, message = "账号长度为 4-30 位")
        @Pattern(regexp = "^[a-zA-Z0-9]{4,30}$", message = "账号格式为数字以及字母")
        private String username;

        /** 密码。 */
        @NotEmpty(message = "密码不能为空")
        @Length(min = 4, max = 16, message = "密码长度为 4-16 位")
        private String password;
    }

}
