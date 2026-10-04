package com.basicframework.framework.security.core.util;

import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.security.core.LoginUser;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证 {@link SecurityFrameworkUtils} 的令牌提取、登录上下文写入与读取边界。
 *
 * <p>重点是上下文生命周期：异常路径与嵌套调用后不得残留或串用身份，
 * 否则线程池复用时会把上一个请求的用户带到下一个请求。</p>
 *
 * @author shady2713
 */
class SecurityFrameworkUtilsTest {

    /** 认证头名称，与生产默认值一致。 */
    private static final String TOKEN_HEADER = "Authorization";
    /** 令牌参数名称，与生产默认值一致。 */
    private static final String TOKEN_PARAMETER = "token";

    /** 每例从空上下文开始，避免用例之间通过静态上下文互相污染。 */
    @BeforeEach
    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    /** 认证头中的标准令牌前缀。 */
    private static String bearer(String token) {
        return SecurityFrameworkUtils.AUTHORIZATION_BEARER + " " + token;
    }

    /** 无任何凭据时必须返回 null，交由后续链路按未登录处理。 */
    @Test
    void obtainAuthorizationReturnsNullWithoutCredential() {
        assertThat(SecurityFrameworkUtils.obtainAuthorization(
                new MockHttpServletRequest("GET", "/admin-api/user/list"), TOKEN_HEADER, TOKEN_PARAMETER))
                .isNull();
    }

    /** 认证头存在但为空白时不构成凭据；空白若被接受会触发一次无意义的令牌查询。 */
    @Test
    void obtainAuthorizationRejectsBlankHeader() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/user/list");
        request.addHeader(TOKEN_HEADER, "   ");
        assertThat(SecurityFrameworkUtils.obtainAuthorization(request, TOKEN_HEADER, TOKEN_PARAMETER)).isNull();
    }

    /** 认证头中的 Bearer 前缀必须被剥离，残留前缀会导致令牌校验必然失败。 */
    @Test
    void obtainAuthorizationStripsBearerPrefix() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/user/list");
        request.addHeader(TOKEN_HEADER, bearer("valid-token"));
        assertThat(SecurityFrameworkUtils.obtainAuthorization(request, TOKEN_HEADER, TOKEN_PARAMETER))
                .isEqualTo("valid-token");
    }

    /** 不带前缀的原始令牌必须原样返回，兼容直接传递凭据的客户端。 */
    @Test
    void obtainAuthorizationKeepsRawToken() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/user/list");
        request.addHeader(TOKEN_HEADER, "raw-token");
        assertThat(SecurityFrameworkUtils.obtainAuthorization(request, TOKEN_HEADER, TOKEN_PARAMETER))
                .isEqualTo("raw-token");
    }

    /** 前缀之后的空白必须被清理，否则尾部空白会让令牌比较失败。 */
    @Test
    void obtainAuthorizationTrimsTokenAfterPrefix() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/user/list");
        request.addHeader(TOKEN_HEADER, bearer("  spaced-token  "));
        assertThat(SecurityFrameworkUtils.obtainAuthorization(request, TOKEN_HEADER, TOKEN_PARAMETER))
                .isEqualTo("spaced-token");
    }

    /** 查询参数中的令牌必须可用，覆盖无法设置请求头的场景。 */
    @Test
    void obtainAuthorizationFallsBackToParameter() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/user/list");
        request.setParameter(TOKEN_PARAMETER, "parameter-token");
        assertThat(SecurityFrameworkUtils.obtainAuthorization(request, TOKEN_HEADER, TOKEN_PARAMETER))
                .isEqualTo("parameter-token");
    }

    /** 认证头优先于查询参数，避免凭据被低优先级来源覆盖。 */
    @Test
    void headerTokenWinsOverParameter() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/user/list");
        request.addHeader(TOKEN_HEADER, bearer("header-token"));
        request.setParameter(TOKEN_PARAMETER, "parameter-token");
        assertThat(SecurityFrameworkUtils.obtainAuthorization(request, TOKEN_HEADER, TOKEN_PARAMETER))
                .isEqualTo("header-token");
    }

    /** 写入登录用户后必须能从上下文读回同一身份。 */
    @Test
    void setLoginUserMakesIdentityReadable() {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(7L);
        loginUser.setUserType(UserTypeEnum.ADMIN.getValue());
        SecurityFrameworkUtils.setLoginUser(loginUser, new MockHttpServletRequest());

        assertThat(SecurityFrameworkUtils.getLoginUserId()).isEqualTo(7L);
        assertThat(SecurityFrameworkUtils.getLoginUser()).isSameAs(loginUser);
    }

    /** 用户编号与用户类型必须同时写入请求属性，供访问日志在上下文消失后仍能取到操作人。 */
    @Test
    void setLoginUserAlsoWritesRequestAttributes() {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(8L);
        loginUser.setUserType(UserTypeEnum.ADMIN.getValue());
        MockHttpServletRequest request = new MockHttpServletRequest();

        SecurityFrameworkUtils.setLoginUser(loginUser, request);

        assertThat(request.getAttribute("login_user_id")).isEqualTo(8L);
        assertThat(request.getAttribute("login_user_type")).isEqualTo(UserTypeEnum.ADMIN.getValue());
    }

    /**
     * 记录请求为 null 时的真实行为：抛出空指针。
     *
     * <p>{@code setLoginUser} 内层对 request 做了判空后仍会先经
     * {@code WebAuthenticationDetailsSource#buildDetails} 访问请求地址，
     * 因此判空分支实际不可达，null 请求并不被支持。此处锁定该事实，
     * 避免调用方误以为可以传入 null。</p>
     */
    @Test
    void setLoginUserRejectsNullRequest() {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(9L);
        loginUser.setUserType(UserTypeEnum.ADMIN.getValue());

        assertThatThrownBy(() -> SecurityFrameworkUtils.setLoginUser(loginUser, null))
                .isInstanceOf(NullPointerException.class);
        assertThat(SecurityFrameworkUtils.getLoginUserId())
                .as("失败写入不得留下半成品身份").isNull();
    }

    /** 空上下文下所有读取接口必须返回 null，而不是抛出空指针。 */
    @Test
    void readsReturnNullWithoutLoginUser() {
        assertThat(SecurityFrameworkUtils.getAuthentication()).isNull();
        assertThat(SecurityFrameworkUtils.getLoginUser()).isNull();
        assertThat(SecurityFrameworkUtils.getLoginUserId()).isNull();
        assertThat(SecurityFrameworkUtils.getLoginUserNickname()).isNull();
        assertThat(SecurityFrameworkUtils.getLoginUserDeptId()).isNull();
    }

    /** 匿名认证的主体不是登录用户，读取用户信息必须返回 null。 */
    @Test
    void anonymousAuthenticationIsNotTreatedAsLoginUser() {
        SecurityContextHolder.getContext().setAuthentication(new AnonymousAuthenticationToken(
                "key", "anonymous", AuthorityUtils.createAuthorityList("ROLE_ANONYMOUS")));

        assertThat(SecurityFrameworkUtils.getLoginUser()).isNull();
        assertThat(SecurityFrameworkUtils.getLoginUserId()).isNull();
    }

    /** 昵称与部门编号必须从用户信息中按约定键读取，键名错误会静默丢失操作人维度。 */
    @Test
    void nicknameAndDeptIdAreReadFromInfoByContractedKeys() {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(10L);
        loginUser.setInfo(Map.of(LoginUser.INFO_KEY_NICKNAME, "李四", LoginUser.INFO_KEY_DEPT_ID, "99"));
        SecurityFrameworkUtils.setLoginUser(loginUser, new MockHttpServletRequest());

        assertThat(SecurityFrameworkUtils.getLoginUserNickname()).isEqualTo("李四");
        assertThat(SecurityFrameworkUtils.getLoginUserDeptId()).isEqualTo(99L);
    }

    /** 缺少约定键时返回 null，不得让访问日志因取值失败而中断。 */
    @Test
    void missingInfoKeysYieldNull() {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(11L);
        loginUser.setInfo(Collections.emptyMap());
        SecurityFrameworkUtils.setLoginUser(loginUser, new MockHttpServletRequest());

        assertThat(SecurityFrameworkUtils.getLoginUserNickname()).isNull();
        assertThat(SecurityFrameworkUtils.getLoginUserDeptId()).isNull();
    }

    /**
     * 记录身份切换的隔离要求：必须保存并恢复 {@link Authentication}，保存上下文对象无效。
     *
     * <p>{@code setLoginUser} 会在同一个 {@link SecurityContext} 实例上就地覆盖认证信息，
     * 因此先前保存的上下文引用指向的仍是被改写后的对象。误用“保存上下文再恢复”的写法，
     * 会让下游逻辑带着内层身份继续执行授权。</p>
     */
    @Test
    void savingContextReferenceDoesNotRestoreIdentity() {
        SecurityFrameworkUtils.setLoginUser(loginUser(20L), new MockHttpServletRequest());
        SecurityContext savedContext = SecurityContextHolder.getContext();

        SecurityFrameworkUtils.setLoginUser(loginUser(21L), new MockHttpServletRequest());

        assertThat(SecurityFrameworkUtils.getLoginUserId()).isEqualTo(21L);
        assertThat(savedContext.getAuthentication().getPrincipal())
                .as("上下文对象被就地改写，恢复它并不能还原外层身份")
                .isSameAs(SecurityFrameworkUtils.getLoginUser());
    }

    /** 按正确方式保存并恢复认证信息后，必须回到外层身份。 */
    @Test
    void restoringAuthenticationReturnsOuterIdentity() {
        SecurityFrameworkUtils.setLoginUser(loginUser(22L), new MockHttpServletRequest());
        Authentication outer = SecurityContextHolder.getContext().getAuthentication();
        try {
            SecurityFrameworkUtils.setLoginUser(loginUser(23L), new MockHttpServletRequest());
            assertThat(SecurityFrameworkUtils.getLoginUserId()).isEqualTo(23L);
        } finally {
            SecurityContextHolder.getContext().setAuthentication(outer);
        }

        assertThat(SecurityFrameworkUtils.getLoginUserId()).isEqualTo(22L);
    }

    /**
     * 业务逻辑抛出异常后，上下文保持调用前的身份。
     * 异常路径若留下半写入的上下文，线程复用会把错误身份带入下一个请求。
     */
    @Test
    void contextSurvivesBusinessException() {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(30L);
        SecurityFrameworkUtils.setLoginUser(loginUser, new MockHttpServletRequest());

        assertThatThrownBy(() -> {
            SecurityFrameworkUtils.getLoginUserId();
            throw new IllegalStateException("模拟业务异常");
        }).isInstanceOf(IllegalStateException.class);

        assertThat(SecurityFrameworkUtils.getLoginUserId()).isEqualTo(30L);
    }

    /** 显式清空上下文后必须读不到任何身份，验证清理动作真实生效。 */
    @Test
    void clearedContextHasNoIdentity() {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(40L);
        SecurityFrameworkUtils.setLoginUser(loginUser, new MockHttpServletRequest());

        SecurityContextHolder.clearContext();

        assertThat(SecurityFrameworkUtils.getLoginUserId()).isNull();
    }

    /**
     * 登录用户上下文容器必须按写入值返回，并支持类型转换。
     * 缓存被误用会让数据权限按过期范围过滤。
     */
    @Test
    void loginUserContextCacheReturnsStoredValue() {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(50L);
        loginUser.setContext("deptScope", List.of(1L, 2L));

        assertThat(loginUser.getContext("deptScope", List.class)).containsExactly(1L, 2L);
        assertThat(loginUser.getContext("absent", String.class)).isNull();
    }

    /** 上下文容器首次写入时自动创建，业务代码无需判空。 */
    @Test
    void loginUserContextCacheIsCreatedOnFirstWrite() {
        LoginUser loginUser = new LoginUser();
        loginUser.setContext("key", "value");
        loginUser.setContext("key", "updated");

        assertThat(loginUser.getContext("key", String.class)).isEqualTo("updated");
    }

    /**
     * 权限跳过开关当前固定为 false。
     * 该开关一旦被打开，所有功能权限与数据权限都会失效，因此必须锁定当前值。
     */
    @Test
    void skipPermissionCheckIsAlwaysFalse() {
        assertThat(SecurityFrameworkUtils.skipPermissionCheck()).isFalse();
        LoginUser loginUser = new LoginUser();
        loginUser.setId(60L);
        SecurityFrameworkUtils.setLoginUser(loginUser, new MockHttpServletRequest());
        assertThat(SecurityFrameworkUtils.skipPermissionCheck())
                .as("登录状态下也必须保持关闭").isFalse();
    }

    /** 同一上下文对象被重复替换时，读取必须指向最后一次写入的身份。 */
    @Test
    void replacedAuthenticationWins() {
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        AtomicReference<Authentication> holder = new AtomicReference<>();
        holder.set(new UsernamePasswordAuthenticationToken(loginUser(70L), null, List.of()));
        context.setAuthentication(holder.get());
        SecurityContextHolder.setContext(context);

        LoginUser replacement = loginUser(71L);
        SecurityFrameworkUtils.setLoginUser(replacement, new MockHttpServletRequest());

        assertThat(SecurityFrameworkUtils.getLoginUserId()).isEqualTo(71L);
        assertThat(SecurityFrameworkUtils.getAuthentication().isAuthenticated()).isTrue();
    }

    /**
     * 未认证时不得判定为机器主体。
     *
     * <p>该判定用于把机器令牌挡在管理端与用户端之外；把“没有认证信息”也判成机器主体，
     * 会让匿名请求得到与机器令牌相同的处理路径，掩盖真实的未认证状态。</p>
     */
    @Test
    void unauthenticatedRequestIsNotMachinePrincipal() {
        assertThat(SecurityFrameworkUtils.isMachinePrincipal((Authentication) null)).isFalse();
    }

    /**
     * 主体不是 {@link LoginUser} 的认证（如匿名令牌）不得判定为机器主体。
     *
     * <p>只有框架自己写入的登录用户才带占位编号语义；其它主体类型属于未知身份，
     * 误判会改变其授权结论。</p>
     */
    @Test
    void nonLoginUserPrincipalIsNotMachinePrincipal() {
        Authentication anonymous = new AnonymousAuthenticationToken(
                "key", "anonymous", AuthorityUtils.createAuthorityList("ROLE_ANONYMOUS"));

        assertThat(SecurityFrameworkUtils.isMachinePrincipal(anonymous)).isFalse();
    }

    /**
     * 占位编号的登录用户必须判定为机器主体，真实用户不得被误判。
     *
     * <p>OAuth2 客户端凭据模式以 {@code userId<=0} 落库，因此 0、负数与缺少编号都表示
     * “不对应任何真实账号”；真实用户编号恒为正数。</p>
     */
    @Test
    void placeholderUserIdsAreMachinePrincipals() {
        assertThat(SecurityFrameworkUtils.isMachinePrincipal(authenticationOf(loginUser(0L))))
                .as("0 号占位用户必须被识别为机器主体").isTrue();
        assertThat(SecurityFrameworkUtils.isMachinePrincipal(authenticationOf(loginUser(-1L))))
                .as("负数编号同样不对应真实账号").isTrue();
        assertThat(SecurityFrameworkUtils.isMachinePrincipal(authenticationOf(new LoginUser())))
                .as("缺少编号表示凭据不代表真实账号").isTrue();

        assertThat(SecurityFrameworkUtils.isMachinePrincipal(authenticationOf(loginUser(80L))))
                .as("真实用户编号恒为正数，不得判为机器主体").isFalse();
    }

    /**
     * 直接用登录用户判定时，null 表示“没有身份”而不是机器主体。
     *
     * <p>该重载被过滤器用于判定当前身份；把 null 判成机器主体会让未登录请求被当作机器令牌拒绝，
     * 返回错误的失败语义。</p>
     */
    @Test
    void nullLoginUserIsNotMachinePrincipal() {
        assertThat(SecurityFrameworkUtils.isMachinePrincipal((LoginUser) null)).isFalse();
    }

    /**
     * 构造携带指定登录用户的认证对象。
     *
     * @param loginUser 登录用户
     * @return 认证对象
     */
    private static Authentication authenticationOf(LoginUser loginUser) {
        return new UsernamePasswordAuthenticationToken(loginUser, null, List.of());
    }

    /** 构造仅含编号与管理员类型的登录用户。 */
    private static LoginUser loginUser(Long id) {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(id);
        loginUser.setUserType(UserTypeEnum.ADMIN.getValue());
        return loginUser;
    }
}
