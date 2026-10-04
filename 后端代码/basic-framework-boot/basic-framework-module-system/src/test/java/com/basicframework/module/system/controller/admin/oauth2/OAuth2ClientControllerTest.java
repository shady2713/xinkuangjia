package com.basicframework.module.system.controller.admin.oauth2;

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.basicframework.module.system.controller.admin.oauth2.vo.client.OAuth2ClientPageReqVO;
import com.basicframework.module.system.controller.admin.oauth2.vo.client.OAuth2ClientRespVO;
import com.basicframework.module.system.controller.admin.oauth2.vo.client.OAuth2ClientSaveReqVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2ClientDO;
import com.basicframework.module.system.service.oauth2.OAuth2ClientService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证 OAuth2 客户端管理入口的委派、映射与批量删除契约。
 *
 * <p>客户端配置决定谁能签发令牌，管理端入口必须把请求对象原样交给服务（服务负责校验与落库），
 * 不能自行裁剪字段；查询入口必须返回脱敏后的响应模型而不是含密钥的持久化对象；
 * 批量删除必须整批交给服务，由服务在事务中处理，控制器逐个调用会留下部分删除状态。</p>
 *
 * @author shady2713
 */
class OAuth2ClientControllerTest {

    /** 被测控制器。 */
    private final OAuth2ClientController controller = new OAuth2ClientController();

    /** 客户端服务替身。 */
    private final OAuth2ClientService clientService = mock(OAuth2ClientService.class);

    /** 清理安全上下文，避免登录用户状态跨用例残留。 */
    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    /** 创建入口返回服务生成的编号，并把请求原样交给服务。 */
    @Test
    void createClientReturnsGeneratedId() {
        injectDependencies();
        OAuth2ClientSaveReqVO reqVO = new OAuth2ClientSaveReqVO();
        reqVO.setClientId("client-alpha");
        when(clientService.createOAuth2Client(reqVO)).thenReturn(1024L);

        CommonResult<Long> result = controller.createOAuth2Client(reqVO);

        assertThat(result.getData()).isEqualTo(1024L);
        verify(clientService).createOAuth2Client(reqVO);
    }

    /** 更新入口委派服务并返回成功。 */
    @Test
    void updateClientDelegatesAndReturnsSuccess() {
        injectDependencies();
        OAuth2ClientSaveReqVO reqVO = new OAuth2ClientSaveReqVO();
        reqVO.setId(1024L);
        reqVO.setClientId("client-alpha");

        assertThat(controller.updateOAuth2Client(reqVO).getData()).isTrue();
        verify(clientService).updateOAuth2Client(reqVO);
    }

    /** 单个删除与批量删除必须分别委派对应服务方法。 */
    @Test
    void deleteEntriesDelegateToService() {
        injectDependencies();

        assertThat(controller.deleteOAuth2Client(1024L).getData()).isTrue();
        verify(clientService).deleteOAuth2Client(1024L);

        assertThat(controller.deleteOAuth2ClientList(List.of(1024L, 2048L)).getData()).isTrue();
        verify(clientService).deleteOAuth2ClientList(List.of(1024L, 2048L));
    }

    /** 查询入口把持久化对象映射为响应模型，且不返回密钥字段。 */
    @Test
    void getClientMapsWithoutSecret() {
        injectDependencies();
        OAuth2ClientDO client = client();
        when(clientService.getOAuth2Client(1024L)).thenReturn(client);

        CommonResult<OAuth2ClientRespVO> result = controller.getOAuth2Client(1024L);

        assertThat(result.getData().getClientId()).isEqualTo("client-alpha");
        assertThat(result.getData().getName()).isEqualTo("Alpha 应用");
        assertThat(result.getData().getAuthorizedGrantTypes()).containsExactly("authorization_code");
        assertThat(OAuth2ClientRespVO.class.getDeclaredFields())
                .as("响应模型不得包含客户端密钥字段").noneMatch(field -> field.getName().equals("secret"));
    }

    /** 分页入口把 DO 分页映射为响应分页并保留总数。 */
    @Test
    void clientPageMapsFieldsAndTotal() {
        injectDependencies();
        OAuth2ClientPageReqVO reqVO = new OAuth2ClientPageReqVO();
        reqVO.setName("Alpha");
        when(clientService.getOAuth2ClientPage(reqVO)).thenReturn(new PageResult<>(List.of(client()), 3L));

        CommonResult<PageResult<OAuth2ClientRespVO>> result = controller.getOAuth2ClientPage(reqVO);

        assertThat(result.getData().getTotal()).isEqualTo(3L);
        assertThat(result.getData().getList().get(0).getClientId()).isEqualTo("client-alpha");
        verify(clientService).getOAuth2ClientPage(reqVO);
    }

    /** 注入服务替身并登记登录用户，保证入口只访问受控边界。 */
    private void injectDependencies() {
        ReflectionTestUtils.setField(controller, "oAuth2ClientService", clientService);
        SecurityFrameworkUtils.setLoginUser(new LoginUser().setId(1L).setUserType(1),
                new MockHttpServletRequest());
    }

    /**
     * 构造客户端记录。
     *
     * @return 客户端记录
     */
    private static OAuth2ClientDO client() {
        OAuth2ClientDO client = new OAuth2ClientDO();
        client.setId(1024L);
        client.setClientId("client-alpha");
        client.setName("Alpha 应用");
        client.setSecret("DUMMY-CLIENT-SECRET");
        client.setStatus(0);
        client.setAccessTokenValiditySeconds(1800);
        client.setRefreshTokenValiditySeconds(2592000);
        client.setAuthorizedGrantTypes(List.of("authorization_code"));
        client.setScopes(List.of("user.read"));
        client.setRedirectUris(List.of("https://client.example.test/callback"));
        return client;
    }

}
