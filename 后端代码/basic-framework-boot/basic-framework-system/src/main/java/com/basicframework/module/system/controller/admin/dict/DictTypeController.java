package com.basicframework.module.system.controller.admin.dict;

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.module.system.controller.admin.dict.vo.type.DictTypePageReqVO;
import com.basicframework.module.system.controller.admin.dict.vo.type.DictTypeRespVO;
import com.basicframework.module.system.controller.admin.dict.vo.type.DictTypeSaveReqVO;
import com.basicframework.module.system.controller.admin.dict.vo.type.DictTypeSimpleRespVO;
import com.basicframework.module.system.dal.dataobject.dict.DictTypeDO;
import com.basicframework.module.system.service.dict.DictTypeService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.NotEmpty;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;

import static com.basicframework.framework.common.pojo.CommonResult.success;

/**
 * DictTypeController HTTP 接口，负责请求校验和响应组装。
 *
 * @author 李杰
 */
@Tag(name = "管理后台 - 字典类型")
@RestController
@RequestMapping("/system/dict-type")
@Validated
public class DictTypeController {

    @Resource
    private DictTypeService dictTypeService;

    /**
     * 创建字典类型。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param createReqVO 请求参数
     * @return 创建结果
     */
    @PostMapping("/create")
    @Operation(summary = "创建字典类型")
    @PreAuthorize("@ss.hasPermission('system:dict:create')")
    public CommonResult<Long> createDictType(@Valid @RequestBody DictTypeSaveReqVO createReqVO) {
        Long dictTypeId = dictTypeService.createDictType(createReqVO);
        return success(dictTypeId);
    }

    /**
     * 更新字典类型。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param updateReqVO 请求参数
     * @return 操作结果
     */
    @PutMapping("/update")
    @Operation(summary = "修改字典类型")
    @PreAuthorize("@ss.hasPermission('system:dict:update')")
    public CommonResult<Boolean> updateDictType(@Valid @RequestBody DictTypeSaveReqVO updateReqVO) {
        dictTypeService.updateDictType(updateReqVO);
        return success(true);
    }

    /**
     * 删除字典类型。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param id 主键编号
     * @return 操作结果
     */
    @DeleteMapping("/delete")
    @Operation(summary = "删除字典类型")
    @Parameter(name = "id", description = "编号", required = true, example = "1024")
    @PreAuthorize("@ss.hasPermission('system:dict:delete')")
    public CommonResult<Boolean> deleteDictType(@RequestParam("id") Long id) {
        dictTypeService.deleteDictType(id);
        return success(true);
    }

    /**
     * 删除字典类型列表。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param ids 编号集合
     * @return 操作结果
     */
    @DeleteMapping("/delete-list")
    @Operation(summary = "批量删除字典类型")
    @Parameter(name = "ids", description = "编号列表", required = true)
    @PreAuthorize("@ss.hasPermission('system:dict:delete')")
    public CommonResult<Boolean> deleteDictTypeList(@RequestParam("ids") @NotEmpty(message = "编号列表不能为空") @Size(max = 100, message = "单次最多删除 100 条记录") List<Long> ids) {
        dictTypeService.deleteDictTypeList(ids);
        return success(true);
    }

    /**
     * 完成 pageDictTypes 对应的业务处理。
     *
     * @param pageReqVO 请求参数
     * @return 方法处理结果
     */
    @GetMapping("/page")
    @Operation(summary = "获得字典类型的分页列表")
    @PreAuthorize("@ss.hasPermission('system:dict:query')")
    public CommonResult<PageResult<DictTypeRespVO>> pageDictTypes(@Valid DictTypePageReqVO pageReqVO) {
        PageResult<DictTypeDO> pageResult = dictTypeService.getDictTypePage(pageReqVO);
        return success(BeanUtils.toBean(pageResult, DictTypeRespVO.class));
    }

    /**
     * 获取字典类型。
     *
     * @param id 主键编号
     * @return 查询结果
     */
    @Operation(summary = "/查询字典类型详细")
    @Parameter(name = "id", description = "编号", required = true, example = "1024")
    @GetMapping(value = "/get")
    @PreAuthorize("@ss.hasPermission('system:dict:query')")
    public CommonResult<DictTypeRespVO> getDictType(@RequestParam("id") Long id) {
        DictTypeDO dictType = dictTypeService.getDictType(id);
        return success(BeanUtils.toBean(dictType, DictTypeRespVO.class));
    }

    /**
     * 返回全部字典类型摘要列表，供管理端筛选器与字典选择器绑定。
     *
     * @return 字典类型的编号、编码与名称列表
     */
    @GetMapping("/simple-list")
    @Operation(summary = "获得全部字典类型列表", description = "包括开启与禁用的字典类型，供已认证管理端使用")
    @PreAuthorize("isAuthenticated()")
    public CommonResult<List<DictTypeSimpleRespVO>> getSimpleDictTypeList() {
        List<DictTypeDO> list = dictTypeService.getDictTypeList();
        return success(BeanUtils.toBean(list, DictTypeSimpleRespVO.class));
    }

}
