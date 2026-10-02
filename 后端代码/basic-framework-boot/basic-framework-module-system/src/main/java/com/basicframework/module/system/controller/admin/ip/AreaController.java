package com.basicframework.module.system.controller.admin.ip;

import static com.basicframework.framework.common.pojo.CommonResult.success;

import java.util.List;

import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.ip.core.Area;
import com.basicframework.framework.ip.core.utils.AreaUtils;
import com.basicframework.framework.ip.core.utils.IPUtils;
import com.basicframework.module.system.controller.admin.ip.vo.AreaNodeRespVO;

import cn.hutool.core.lang.Assert;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;

/**
 * 地区 Controller，提供地区树形结构查询能力
 *
 * @author 李杰
 */
@Tag(name = "管理后台 - 地区")
@RestController
@RequestMapping("/system/area")
@Validated
public class AreaController {

    /**
     * 获取地区树。
     *
     * @return 查询结果
     */
    @GetMapping("/tree")
    @Operation(summary = "获得地区树")
    public CommonResult<List<AreaNodeRespVO>> getAreaTree() {
        Area area = AreaUtils.getArea(Area.ID_CHINA);
        Assert.notNull(area, "获取不到中国");
        return success(BeanUtils.toBean(area.getChildren(), AreaNodeRespVO.class));
    }

    /**
     * 获取地区ByIp。
     *
     * @param ip ip参数
     * @return 查询结果
     */
    @GetMapping("/get-by-ip")
    @Operation(summary = "获得 IP 对应的地区名")
    @Parameter(name = "ip", description = "IP", required = true)
    public CommonResult<String> getAreaByIp(@RequestParam("ip") String ip) {
        // 获得城市
        Area area = IPUtils.getArea(ip);
        if (area == null) {
            return success("未知");
        }
        // 格式化返回
        return success(AreaUtils.format(area.getId()));
    }

}
