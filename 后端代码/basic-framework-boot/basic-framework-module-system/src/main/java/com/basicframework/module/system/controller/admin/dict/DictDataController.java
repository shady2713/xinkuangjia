package com.basicframework.module.system.controller.admin.dict;

import com.basicframework.framework.apilog.core.annotation.ApiAccessLog;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.excel.core.util.ExcelUtils;
import com.basicframework.module.system.controller.admin.dict.vo.data.DictDataPageReqVO;
import com.basicframework.module.system.controller.admin.dict.vo.data.DictDataRespVO;
import com.basicframework.module.system.controller.admin.dict.vo.data.DictDataSaveReqVO;
import com.basicframework.module.system.controller.admin.dict.vo.data.DictDataSimpleRespVO;
import com.basicframework.module.system.dal.dataobject.dict.DictDataDO;
import com.basicframework.module.system.service.dict.DictDataService;
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
 * DictDataController HTTP 接口，负责请求校验和响应组装。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/dict/DictDataController.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 7 行，移除或改写上游 2 行；import 新增 5 行、移除 4 行；补充注释 64 行。
 */
@Tag(name = "管理后台 - 字典数据")
@RestController
@RequestMapping("/system/dict-data")
@Validated
public class DictDataController {

    /** 单次 Excel 导出上限，避免无边界加载全部字典数据。 */
    private static final int MAX_EXPORT_SIZE = 10_000;

    @Resource
    private DictDataService dictDataService;

    /**
     * 创建字典数据。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param createReqVO 请求参数
     * @return 创建结果
     */
    @PostMapping("/create")
    @Operation(summary = "新增字典数据")
    @PreAuthorize("@ss.hasPermission('system:dict:create')")
    public CommonResult<Long> createDictData(@Valid @RequestBody DictDataSaveReqVO createReqVO) {
        Long dictDataId = dictDataService.createDictData(createReqVO);
        return success(dictDataId);
    }

    /**
     * 更新字典数据。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param updateReqVO 请求参数
     * @return 操作结果
     */
    @PutMapping("/update")
    @Operation(summary = "修改字典数据")
    @PreAuthorize("@ss.hasPermission('system:dict:update')")
    public CommonResult<Boolean> updateDictData(@Valid @RequestBody DictDataSaveReqVO updateReqVO) {
        dictDataService.updateDictData(updateReqVO);
        return success(true);
    }

    /**
     * 删除字典数据。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param id 主键编号
     * @return 操作结果
     */
    @DeleteMapping("/delete")
    @Operation(summary = "删除字典数据")
    @Parameter(name = "id", description = "编号", required = true, example = "1024")
    @PreAuthorize("@ss.hasPermission('system:dict:delete')")
    public CommonResult<Boolean> deleteDictData(@RequestParam("id") Long id) {
        dictDataService.deleteDictData(id);
        return success(true);
    }

    /**
     * 删除字典数据列表。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param ids 编号集合
     * @return 操作结果
     */
    @DeleteMapping("/delete-list")
    @Operation(summary = "批量删除字典数据")
    @Parameter(name = "ids", description = "编号列表", required = true)
    @PreAuthorize("@ss.hasPermission('system:dict:delete')")
    public CommonResult<Boolean> deleteDictDataList(@RequestParam("ids") List<Long> ids) {
        dictDataService.deleteDictDataList(ids);
        return success(true);
    }

    /**
     * 获取精简数据字典数据列表。
     *
     * @return 查询结果
     */
    @GetMapping(value = {"/list-all-simple", "simple-list"})
    @Operation(summary = "获得全部字典数据列表", description = "一般用于管理后台缓存字典数据在本地")
    // 无需添加权限认证，因为前端全局都需要
    public CommonResult<List<DictDataSimpleRespVO>> getSimpleDictDataList() {
        List<DictDataDO> list = dictDataService.getDictDataList(
                CommonStatusEnum.ENABLE.getStatus(), null);
        return success(BeanUtils.toBean(list, DictDataSimpleRespVO.class));
    }

    /**
     * 获取字典类型分页数据。
     *
     * @param pageReqVO 请求参数
     * @return 查询结果
     */
    @GetMapping("/page")
    @Operation(summary = "获得字典类型的分页")
    @PreAuthorize("@ss.hasPermission('system:dict:query')")
    public CommonResult<PageResult<DictDataRespVO>> getDictTypePage(@Valid DictDataPageReqVO pageReqVO) {
        PageResult<DictDataDO> pageResult = dictDataService.getDictDataPage(pageReqVO);
        return success(BeanUtils.toBean(pageResult, DictDataRespVO.class));
    }

    /**
     * 获取字典数据。
     *
     * @param id 主键编号
     * @return 查询结果
     */
    @GetMapping(value = "/get")
    @Operation(summary = "/查询字典数据详细")
    @Parameter(name = "id", description = "编号", required = true, example = "1024")
    @PreAuthorize("@ss.hasPermission('system:dict:query')")
    public CommonResult<DictDataRespVO> getDictData(@RequestParam("id") Long id) {
        DictDataDO dictData = dictDataService.getDictData(id);
        return success(BeanUtils.toBean(dictData, DictDataRespVO.class));
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
    @GetMapping("/export-excel")
    @Operation(summary = "导出字典数据")
    @PreAuthorize("@ss.hasPermission('system:dict:export')")
    @ApiAccessLog(operateType = EXPORT)
    public void export(HttpServletResponse response, @Valid DictDataPageReqVO exportReqVO) throws IOException {
        exportReqVO.setPageNo(1);
        exportReqVO.setPageSize(MAX_EXPORT_SIZE);
        PageResult<DictDataDO> page = dictDataService.getDictDataPage(exportReqVO);
        if (page.getTotal() > MAX_EXPORT_SIZE) {
            throw exception(SYSTEM_EXPORT_SIZE_EXCEEDED);
        }
        List<DictDataDO> list = page.getList();
        // 输出
        ExcelUtils.write(response, "字典数据.xls", "数据", DictDataRespVO.class,
                BeanUtils.toBean(list, DictDataRespVO.class));
    }

}
