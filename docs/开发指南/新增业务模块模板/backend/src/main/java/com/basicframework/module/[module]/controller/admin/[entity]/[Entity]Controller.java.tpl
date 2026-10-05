package com.basicframework.module.[module].controller.admin.[entity];

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.module.[module].controller.admin.[entity].vo.[Entity]PageReqVO;
import com.basicframework.module.[module].controller.admin.[entity].vo.[Entity]RespVO;
import com.basicframework.module.[module].controller.admin.[entity].vo.[Entity]SaveReqVO;
import com.basicframework.module.[module].dal.dataobject.[entity].[Entity]DO;
import com.basicframework.module.[module].service.[entity].[Entity]Service;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import static com.basicframework.framework.common.pojo.CommonResult.success;

/**
 * [entity-title] HTTP 接口。
 *
 * <p>控制器只做三件事：声明权限串、触发请求校验、把服务结果转换成响应对象。业务校验与状态
 * 判断留在 Service，避免同一规则出现两份实现。每个端点都必须是统一响应模型
 * （CommonResult），并且必须带真实权限表达式，否则边界与接口契约检查会直接报告问题。</p>
 *
 * <p>占位符：[module]、[entity]、[Entity]、[entity-name]、[entity-title]、[permission]
 * （权限前缀，形如 system:post）。</p>
 *
 * @author [author]
 */
@Tag(name = "管理后台 - [entity-title]")
@RestController
@RequestMapping("/[module]/[entity]")
@Validated
public class [Entity]Controller {

    /** [entity-name]服务。 */
    @Resource
    private [Entity]Service [entity]Service;

    /**
     * 创建[entity-name]。
     *
     * @param createReqVO 创建请求
     * @return 新记录编号
     */
    @PostMapping("/create")
    @Operation(summary = "创建[entity-name]")
    @PreAuthorize("@ss.hasPermission('[permission]:create')")
    public CommonResult<Long> create[Entity](@Valid @RequestBody [Entity]SaveReqVO createReqVO) {
        return success([entity]Service.create[Entity](createReqVO));
    }

    /**
     * 修改[entity-name]。
     *
     * @param updateReqVO 修改请求
     * @return 是否成功
     */
    @PutMapping("/update")
    @Operation(summary = "修改[entity-name]")
    @PreAuthorize("@ss.hasPermission('[permission]:update')")
    public CommonResult<Boolean> update[Entity](@Valid @RequestBody [Entity]SaveReqVO updateReqVO) {
        [entity]Service.update[Entity](updateReqVO);
        return success(true);
    }

    /**
     * 删除[entity-name]。
     *
     * @param id 目标记录编号
     * @return 是否成功
     */
    @DeleteMapping("/delete")
    @Operation(summary = "删除[entity-name]")
    @Parameter(name = "id", description = "编号", required = true, example = "1024")
    @PreAuthorize("@ss.hasPermission('[permission]:delete')")
    public CommonResult<Boolean> delete[Entity](@RequestParam("id") Long id) {
        [entity]Service.delete[Entity](id);
        return success(true);
    }

    /**
     * 查询[entity-name]详情。
     *
     * @param id 目标记录编号
     * @return 记录；不存在时 data 为空对象
     */
    @GetMapping("/get")
    @Operation(summary = "获得[entity-name]")
    @Parameter(name = "id", description = "编号", required = true, example = "1024")
    @PreAuthorize("@ss.hasPermission('[permission]:query')")
    public CommonResult<[Entity]RespVO> get[Entity](@RequestParam("id") Long id) {
        [Entity]DO [entity] = [entity]Service.get[Entity](id);
        return success(BeanUtils.toBean([entity], [Entity]RespVO.class));
    }

    /**
     * 分页查询[entity-name]。
     *
     * @param pageReqVO 分页与筛选条件
     * @return 分页结果
     */
    @GetMapping("/page")
    @Operation(summary = "获得[entity-name]分页列表")
    @PreAuthorize("@ss.hasPermission('[permission]:query')")
    public CommonResult<PageResult<[Entity]RespVO>> get[Entity]Page(@Valid [Entity]PageReqVO pageReqVO) {
        PageResult<[Entity]DO> pageResult = [entity]Service.get[Entity]Page(pageReqVO);
        return success(BeanUtils.toBean(pageResult, [Entity]RespVO.class));
    }

}
