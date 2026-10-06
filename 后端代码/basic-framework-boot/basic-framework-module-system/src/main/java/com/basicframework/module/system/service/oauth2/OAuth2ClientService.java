package com.basicframework.module.system.service.oauth2;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.controller.admin.oauth2.vo.client.OAuth2ClientPageReqVO;
import com.basicframework.module.system.controller.admin.oauth2.vo.client.OAuth2ClientSaveReqVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2ClientDO;
import jakarta.validation.Valid;

import java.util.Collection;
import java.util.List;

/**
 * OAuth2 客户端服务接口。
 * <p>
 * 提供客户端配置维护、分页查询和授权参数校验能力。
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
public interface OAuth2ClientService {

    /**
     * 创建 OAuth2 客户端。
     *
     * @param createReqVO 客户端创建参数
     * @return 客户端编号
     */
    Long createOAuth2Client(@Valid OAuth2ClientSaveReqVO createReqVO);

    /**
     * 更新 OAuth2 客户端。
     *
     * @param updateReqVO 客户端更新参数
     */
    void updateOAuth2Client(@Valid OAuth2ClientSaveReqVO updateReqVO);

    /**
     * 删除 OAuth2 客户端。
     *
     * @param id 客户端编号
     */
    void deleteOAuth2Client(Long id);

    /**
     * 批量删除 OAuth2 客户端。
     *
     * @param ids 客户端编号列表
     */
    void deleteOAuth2ClientList(List<Long> ids);

    /**
     * 获取 OAuth2 客户端。
     *
     * @param id 客户端编号
     * @return 客户端信息
     */
    OAuth2ClientDO getOAuth2Client(Long id);

    /**
     * 从缓存获取 OAuth2 客户端。
     *
     * @param clientId 客户端标识
     * @return 客户端信息
     */
    OAuth2ClientDO getOAuth2ClientFromCache(String clientId);

    /**
     * 分页查询 OAuth2 客户端。
     *
     * @param pageReqVO 分页查询参数
     * @return 客户端分页结果
     */
    PageResult<OAuth2ClientDO> getOAuth2ClientPage(OAuth2ClientPageReqVO pageReqVO);

    /**
     * 新增或更新开放接口使用的客户端，密钥参数必须已经完成安全哈希。
     *
     * @param clientId 客户端编号
     * @param encodedSecret 已哈希的客户端密钥
     * @param status 客户端状态
     */
    void upsertEncodedOpenClient(String clientId, String encodedSecret, Integer status);

    /**
     * 更新开放接口客户端状态。
     *
     * @param clientId 客户端编号
     * @param status 客户端状态
     */
    void updateOpenClientStatus(String clientId, Integer status);

    /**
     * 停用开放接口客户端并清理授权缓存。
     *
     * @param clientId 客户端编号
     */
    void disableOpenClient(String clientId);

    /**
     * 从缓存中校验客户端是否可用。
     *
     * @param clientId 客户端标识
     * @return 校验通过的客户端
     */
    default OAuth2ClientDO validOAuthClientFromCache(String clientId) {
        return validOAuthClientFromCache(clientId, null, null, null, null);
    }

    /**
     * 从缓存中校验客户端授权参数是否合法。
     * <p>
     * 传入参数非空时会逐项校验客户端密钥、授权方式、授权范围和回调地址。
     *
     * @param clientId            客户端标识
     * @param clientSecret        客户端密钥
     * @param authorizedGrantType 授权类型
     * @param scopes              授权范围
     * @param redirectUri         回调地址
     * @return 校验通过的客户端
     */
    OAuth2ClientDO validOAuthClientFromCache(String clientId, String clientSecret, String authorizedGrantType,
                                             Collection<String> scopes, String redirectUri);

}
