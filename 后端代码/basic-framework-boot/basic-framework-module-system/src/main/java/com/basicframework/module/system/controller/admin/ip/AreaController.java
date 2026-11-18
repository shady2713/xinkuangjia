package com.basicframework.module.system.controller.admin.ip;

import cn.hutool.core.lang.Assert;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.ip.core.Area;
import com.basicframework.framework.ip.core.utils.AreaUtils;
import com.basicframework.framework.ip.core.utils.IPUtils;
import com.basicframework.module.system.controller.admin.ip.vo.AreaNodeRespVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

import static com.basicframework.framework.common.pojo.CommonResult.success;

/**
 * 地区 Controller，提供行政区划树形结构与 IP 归属地查询能力。
 *
 * @author 李杰
 */
@Tag(name = "管理后台 - 地区")
@RestController
@RequestMapping("/system/area")
@Validated
public class AreaController {

    /**
     * 获取中国行政区划树。
     *
     * @return 地区树列表
     */
    @GetMapping("/tree")
    @PreAuthorize("isAuthenticated()")
    @Operation(summary = "获得地区树")
    public CommonResult<List<AreaNodeRespVO>> getAreaTree() {
        Area area = AreaUtils.getArea(Area.ID_CHINA);
        Assert.notNull(area, "获取不到中国");
        return success(BeanUtils.toBean(area.getChildren(), AreaNodeRespVO.class));
    }

    /**
     * 根据 IP 查询归属地区名称。
     *
     * @param ip IPv4 地址字符串
     * @return 格式化后的省市地区名；无法识别时返回“未知”
     */
    @GetMapping("/get-by-ip")
    @PreAuthorize("isAuthenticated()")
    @Operation(summary = "获得 IP 对应的地区名")
    @Parameter(name = "ip", description = "IP", required = true)
    public CommonResult<String> getAreaByIp(
            @RequestParam("ip") @NotBlank(message = "IP 不能为空")
            @Size(max = 64, message = "IP 长度不能超过 64 个字符") String ip) {
        Area area = IPUtils.getArea(ip);
        if (area == null) {
            return success("未知");
        }
        return success(AreaUtils.format(area.getId()));
    }

}
