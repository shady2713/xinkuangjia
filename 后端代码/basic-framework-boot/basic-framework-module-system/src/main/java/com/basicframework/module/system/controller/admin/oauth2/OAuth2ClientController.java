package com.basicframework.module.system.controller.admin.oauth2;

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.module.system.controller.admin.oauth2.vo.client.OAuth2ClientPageReqVO;
import com.basicframework.module.system.controller.admin.oauth2.vo.client.OAuth2ClientRespVO;
import com.basicframework.module.system.controller.admin.oauth2.vo.client.OAuth2ClientSaveReqVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2ClientDO;
import com.basicframework.module.system.service.oauth2.OAuth2ClientService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;

import static com.basicframework.framework.common.pojo.CommonResult.success;

/**
 * OAuth2ClientController HTTP 接口，负责请求校验和响应组装。
 *
 * @author 李杰
 */
@Tag(name = "管理后台 - OAuth2 客户端")
@RestController
@RequestMapping("/system/oauth2-client")
@Validated
public class OAuth2ClientController {

    @Resource
    private OAuth2ClientService oAuth2ClientService;

    /**
     * 创建OAuth2客户端。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param createReqVO 请求参数
     * @return 创建结果
     */
    @PostMapping("/create")
    @Operation(summary = "创建 OAuth2 客户端")
    @PreAuthorize("@ss.hasPermission('system:oauth2-client:create')")
    public CommonResult<Long> createOAuth2Client(@Valid @RequestBody OAuth2ClientSaveReqVO createReqVO) {
        return success(oAuth2ClientService.createOAuth2Client(createReqVO));
    }

    /**
     * 更新OAuth2客户端。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param updateReqVO 请求参数
     * @return 操作结果
     */
    @PutMapping("/update")
    @Operation(summary = "更新 OAuth2 客户端")
    @PreAuthorize("@ss.hasPermission('system:oauth2-client:update')")
    public CommonResult<Boolean> updateOAuth2Client(@Valid @RequestBody OAuth2ClientSaveReqVO updateReqVO) {
        oAuth2ClientService.updateOAuth2Client(updateReqVO);
        return success(true);
    }

    /**
     * 删除OAuth2客户端。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param id 主键编号
     * @return 操作结果
     */
    @DeleteMapping("/delete")
    @Operation(summary = "删除 OAuth2 客户端")
    @Parameter(name = "id", description = "编号", required = true)
    @PreAuthorize("@ss.hasPermission('system:oauth2-client:delete')")
    public CommonResult<Boolean> deleteOAuth2Client(@RequestParam("id") Long id) {
        oAuth2ClientService.deleteOAuth2Client(id);
        return success(true);
    }

    /**
     * 删除OAuth2客户端列表。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param ids 编号集合
     * @return 操作结果
     */
    @DeleteMapping("/delete-list")
    @Parameter(name = "ids", description = "编号列表", required = true)
    @Operation(summary = "批量删除 OAuth2 客户端")
    @PreAuthorize("@ss.hasPermission('system:oauth2-client:delete')")
    public CommonResult<Boolean> deleteOAuth2ClientList(@RequestParam("ids") List<Long> ids) {
        oAuth2ClientService.deleteOAuth2ClientList(ids);
        return success(true);
    }

    /**
     * 获取OAuth2客户端。
     *
     * @param id 主键编号
     * @return 查询结果
     */
    @GetMapping("/get")
    @Operation(summary = "获得 OAuth2 客户端")
    @Parameter(name = "id", description = "编号", required = true, example = "1024")
    @PreAuthorize("@ss.hasPermission('system:oauth2-client:query')")
    public CommonResult<OAuth2ClientRespVO> getOAuth2Client(@RequestParam("id") Long id) {
        OAuth2ClientDO client = oAuth2ClientService.getOAuth2Client(id);
        return success(BeanUtils.toBean(client, OAuth2ClientRespVO.class));
    }

    /**
     * 获取OAuth2客户端分页数据。
     *
     * @param pageVO 分页数据VO参数
     * @return 查询结果
     */
    @GetMapping("/page")
    @Operation(summary = "获得 OAuth2 客户端分页")
    @PreAuthorize("@ss.hasPermission('system:oauth2-client:query')")
    public CommonResult<PageResult<OAuth2ClientRespVO>> getOAuth2ClientPage(@Valid OAuth2ClientPageReqVO pageVO) {
        PageResult<OAuth2ClientDO> pageResult = oAuth2ClientService.getOAuth2ClientPage(pageVO);
        return success(BeanUtils.toBean(pageResult, OAuth2ClientRespVO.class));
    }

}
