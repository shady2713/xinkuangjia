package com.basicframework.module.system.controller.admin.dict;

import com.basicframework.framework.apilog.core.annotation.ApiAccessLog;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.excel.core.util.ExcelUtils;
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
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.List;

import static com.basicframework.framework.apilog.core.enums.OperateTypeEnum.EXPORT;
import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.framework.common.pojo.CommonResult.success;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SYSTEM_EXPORT_SIZE_EXCEEDED;

/**
 * DictTypeController HTTP 接口，负责请求校验和响应组装。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/dict/DictTypeController.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 8 行，移除或改写上游 3 行；import 新增 5 行、移除 4 行；补充注释 64 行。
 * 来源验收：尚未验收
 */
@Tag(name = "管理后台 - 字典类型")
@RestController
@RequestMapping("/system/dict-type")
@Validated
public class DictTypeController {

    /** 单次 Excel 导出上限，避免无边界加载全部字典类型。 */
    private static final int MAX_EXPORT_SIZE = 10_000;

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
    public CommonResult<Boolean> deleteDictType(Long id) {
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
    public CommonResult<Boolean> deleteDictTypeList(@RequestParam("ids") List<Long> ids) {
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
     * 获取精简数据字典类型列表。
     *
     * @return 查询结果
     */
    @GetMapping(value = {"/list-all-simple", "simple-list"})
    @Operation(summary = "获得全部字典类型列表", description = "包括开启 + 禁用的字典类型，主要用于前端的下拉选项")
    // 无需添加权限认证，因为前端全局都需要
    public CommonResult<List<DictTypeSimpleRespVO>> getSimpleDictTypeList() {
        List<DictTypeDO> list = dictTypeService.getDictTypeList();
        return success(BeanUtils.toBean(list, DictTypeSimpleRespVO.class));
    }

    /**
     * 导出指定数据。
     *
     * <p>单次最多导出 10,000 条；超过上限时拒绝生成文件，调用方需要缩小筛选范围。</p>
     *
     * @param response HTTP 响应
     * @param exportReqVO 请求参数
     * @throws IOException 执行失败时抛出
     */
    @Operation(summary = "导出数据类型")
    @GetMapping("/export-excel")
    @PreAuthorize("@ss.hasPermission('system:dict:query')")
    @ApiAccessLog(operateType = EXPORT)
    public void export(HttpServletResponse response, @Valid DictTypePageReqVO exportReqVO) throws IOException {
        exportReqVO.setPageNo(1);
        exportReqVO.setPageSize(MAX_EXPORT_SIZE);
        PageResult<DictTypeDO> page = dictTypeService.getDictTypePage(exportReqVO);
        if (page.getTotal() > MAX_EXPORT_SIZE) {
            throw exception(SYSTEM_EXPORT_SIZE_EXCEEDED);
        }
        List<DictTypeDO> list = page.getList();
        // 导出
        ExcelUtils.write(response, "字典类型.xls", "数据", DictTypeRespVO.class,
                BeanUtils.toBean(list, DictTypeRespVO.class));
    }

}
