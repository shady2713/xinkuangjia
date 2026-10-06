package com.basicframework.module.system.controller.admin.sms;

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.module.system.controller.admin.sms.vo.channel.SmsChannelPageReqVO;
import com.basicframework.module.system.controller.admin.sms.vo.channel.SmsChannelRespVO;
import com.basicframework.module.system.controller.admin.sms.vo.channel.SmsChannelSaveReqVO;
import com.basicframework.module.system.controller.admin.sms.vo.channel.SmsChannelSimpleRespVO;
import com.basicframework.module.system.dal.dataobject.sms.SmsChannelDO;
import com.basicframework.module.system.service.sms.SmsChannelService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.Comparator;
import java.util.List;

import static com.basicframework.framework.common.pojo.CommonResult.success;

/**
 * SmsChannelController HTTP 接口，负责请求校验和响应组装。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/sms/SmsChannelController.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地补充注释 49 行。
 * 来源验收：尚未验收
 */
@Tag(name = "管理后台 - 短信渠道")
@RestController
@RequestMapping("system/sms-channel")
public class SmsChannelController {

    @Resource
    private SmsChannelService smsChannelService;

    /**
     * 创建短信渠道。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param createReqVO 请求参数
     * @return 创建结果
     */
    @PostMapping("/create")
    @Operation(summary = "创建短信渠道")
    @PreAuthorize("@ss.hasPermission('system:sms-channel:create')")
    public CommonResult<Long> createSmsChannel(@Valid @RequestBody SmsChannelSaveReqVO createReqVO) {
        return success(smsChannelService.createSmsChannel(createReqVO));
    }

    /**
     * 更新短信渠道。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param updateReqVO 请求参数
     * @return 操作结果
     */
    @PutMapping("/update")
    @Operation(summary = "更新短信渠道")
    @PreAuthorize("@ss.hasPermission('system:sms-channel:update')")
    public CommonResult<Boolean> updateSmsChannel(@Valid @RequestBody SmsChannelSaveReqVO updateReqVO) {
        smsChannelService.updateSmsChannel(updateReqVO);
        return success(true);
    }

    /**
     * 删除短信渠道。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param id 主键编号
     * @return 操作结果
     */
    @DeleteMapping("/delete")
    @Operation(summary = "删除短信渠道")
    @Parameter(name = "id", description = "编号", required = true)
    @PreAuthorize("@ss.hasPermission('system:sms-channel:delete')")
    public CommonResult<Boolean> deleteSmsChannel(@RequestParam("id") Long id) {
        smsChannelService.deleteSmsChannel(id);
        return success(true);
    }

    /**
     * 删除短信渠道列表。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param ids 编号集合
     * @return 操作结果
     */
    @DeleteMapping("/delete-list")
    @Parameter(name = "ids", description = "编号列表", required = true)
    @Operation(summary = "批量删除短信渠道")
    @PreAuthorize("@ss.hasPermission('system:sms-channel:delete')")
    public CommonResult<Boolean> deleteSmsChannelList(@RequestParam("ids") List<Long> ids) {
        smsChannelService.deleteSmsChannelList(ids);
        return success(true);
    }

    /**
     * 获取短信渠道。
     *
     * @param id 主键编号
     * @return 查询结果
     */
    @GetMapping("/get")
    @Operation(summary = "获得短信渠道")
    @Parameter(name = "id", description = "编号", required = true, example = "1024")
    @PreAuthorize("@ss.hasPermission('system:sms-channel:query')")
    public CommonResult<SmsChannelRespVO> getSmsChannel(@RequestParam("id") Long id) {
        SmsChannelDO channel = smsChannelService.getSmsChannel(id);
        return success(BeanUtils.toBean(channel, SmsChannelRespVO.class));
    }

    /**
     * 获取短信渠道分页数据。
     *
     * @param pageVO 分页数据VO参数
     * @return 查询结果
     */
    @GetMapping("/page")
    @Operation(summary = "获得短信渠道分页")
    @PreAuthorize("@ss.hasPermission('system:sms-channel:query')")
    public CommonResult<PageResult<SmsChannelRespVO>> getSmsChannelPage(@Valid SmsChannelPageReqVO pageVO) {
        PageResult<SmsChannelDO> pageResult = smsChannelService.getSmsChannelPage(pageVO);
        return success(BeanUtils.toBean(pageResult, SmsChannelRespVO.class));
    }

    /**
     * 获取精简数据短信渠道列表。
     *
     * @return 查询结果
     */
    @GetMapping({"/list-all-simple", "/simple-list"})
    @Operation(summary = "获得短信渠道精简列表", description = "包含被禁用的短信渠道")
    public CommonResult<List<SmsChannelSimpleRespVO>> getSimpleSmsChannelList() {
        List<SmsChannelDO> list = smsChannelService.getSmsChannelList();
        list.sort(Comparator.comparing(SmsChannelDO::getId));
        return success(BeanUtils.toBean(list, SmsChannelSimpleRespVO.class));
    }

}
