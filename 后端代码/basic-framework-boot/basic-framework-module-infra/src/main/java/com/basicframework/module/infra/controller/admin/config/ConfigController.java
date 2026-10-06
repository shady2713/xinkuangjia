package com.basicframework.module.infra.controller.admin.config;

import com.basicframework.framework.apilog.core.annotation.ApiAccessLog;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.excel.core.util.ExcelUtils;
import com.basicframework.module.infra.controller.admin.config.vo.ConfigPageReqVO;
import com.basicframework.module.infra.controller.admin.config.vo.ConfigRespVO;
import com.basicframework.module.infra.controller.admin.config.vo.ConfigSaveReqVO;
import com.basicframework.module.infra.convert.config.ConfigConvert;
import com.basicframework.module.infra.dal.dataobject.config.ConfigDO;
import com.basicframework.module.infra.service.config.ConfigService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.List;

import static com.basicframework.framework.apilog.core.enums.OperateTypeEnum.EXPORT;
import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.framework.common.pojo.CommonResult.success;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.EXPORT_SIZE_EXCEEDED;

/**
 * 管理后台参数配置 API。
 *
 * 提供参数配置的维护、查询、配置值读取和 Excel 导出能力。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-infra/src/main/java/cn/iocoder/yudao/module/infra/controller/admin/config/ConfigController.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 18 行，移除或改写上游 13 行；import 新增 7 行、移除 5 行；补充注释 62 行。
 * 来源验收：尚未验收
 */
@Tag(name = "管理后台 - 参数配置")
@RestController
@RequestMapping("/infra/config")
@Validated
public class ConfigController {

    /** 管理端单次批量删除上限。 */
    private static final int MAX_BATCH_DELETE_SIZE = 100;
    /** 参数键最大长度，与保存请求约束保持一致。 */
    private static final int MAX_CONFIG_KEY_LENGTH = 100;
    /** 单次 Excel 导出上限，避免无边界加载全部配置。 */
    private static final int MAX_EXPORT_SIZE = 10_000;

    /** 参数配置服务。 */
    @Resource
    private ConfigService configService;

    /**
     * 创建参数配置。
     *
     * @param createReqVO 创建请求
     * @return 参数配置编号
     */
    @PostMapping("/create")
    @Operation(summary = "创建参数配置")
    @PreAuthorize("@ss.hasPermission('infra:config:create')")
    public CommonResult<Long> createConfig(@Valid @RequestBody ConfigSaveReqVO createReqVO) {
        return success(configService.createConfig(createReqVO));
    }

    /**
     * 修改参数配置。
     *
     * @param updateReqVO 更新请求
     * @return 是否修改成功
     */
    @PutMapping("/update")
    @Operation(summary = "修改参数配置")
    @PreAuthorize("@ss.hasPermission('infra:config:update')")
    public CommonResult<Boolean> updateConfig(@Valid @RequestBody ConfigSaveReqVO updateReqVO) {
        configService.updateConfig(updateReqVO);
        return success(true);
    }

    /**
     * 删除参数配置。
     *
     * @param id 参数配置编号
     * @return 是否删除成功
     */
    @DeleteMapping("/delete")
    @Operation(summary = "删除参数配置")
    @Parameter(name = "id", description = "编号", required = true, example = "1024")
    @PreAuthorize("@ss.hasPermission('infra:config:delete')")
    public CommonResult<Boolean> deleteConfig(@RequestParam("id") Long id) {
        configService.deleteConfig(id);
        return success(true);
    }

    /**
     * 批量删除参数配置。
     *
     * @param ids 参数配置编号列表
     * @return 是否删除成功
     */
    @DeleteMapping("/delete-list")
    @Operation(summary = "批量删除参数配置")
    @Parameter(name = "ids", description = "编号列表", required = true)
    @PreAuthorize("@ss.hasPermission('infra:config:delete')")
    public CommonResult<Boolean> deleteConfigList(
            @RequestParam("ids") @NotEmpty(message = "参数配置编号列表不能为空")
            @Size(max = MAX_BATCH_DELETE_SIZE, message = "单次最多删除 100 个参数配置") List<Long> ids) {
        configService.deleteConfigList(ids);
        return success(true);
    }

    /**
     * 获取参数配置详情。
     *
     * @param id 参数配置编号
     * @return 参数配置详情
     */
    @GetMapping(value = "/get")
    @Operation(summary = "获得参数配置")
    @Parameter(name = "id", description = "编号", required = true, example = "1024")
    @PreAuthorize("@ss.hasPermission('infra:config:query')")
    public CommonResult<ConfigRespVO> getConfig(@RequestParam("id") Long id) {
        return success(ConfigConvert.INSTANCE.convert(configService.getConfig(id)));
    }

    /**
     * 根据参数键获取可见参数值。
     *
     * <p>不可见配置属于后端内部配置，不允许返回给前端。</p>
     *
     * @param key 参数键
     * @return 参数值；配置不存在时返回 null
     */
    @GetMapping(value = "/get-value-by-key")
    @Operation(summary = "根据参数键名查询参数值", description = "不可见的配置，不允许返回给前端")
    @Parameter(name = "key", description = "参数键", required = true, example = "")
    @PreAuthorize("@ss.hasPermission('infra:config:query')")
    public CommonResult<String> getConfigKey(
            @RequestParam("key") @NotBlank(message = "参数键不能为空")
            @Size(max = MAX_CONFIG_KEY_LENGTH, message = "参数键长度不能超过 100 个字符") String key) {
        return success(configService.getVisibleConfigValueByKey(key));
    }

    /**
     * 分页查询参数配置。
     *
     * @param pageReqVO 分页查询条件
     * @return 参数配置分页结果
     */
    @GetMapping("/page")
    @Operation(summary = "获取参数配置分页")
    @PreAuthorize("@ss.hasPermission('infra:config:query')")
    public CommonResult<PageResult<ConfigRespVO>> getConfigPage(@Valid ConfigPageReqVO pageReqVO) {
        PageResult<ConfigDO> page = configService.getConfigPage(pageReqVO);
        return success(ConfigConvert.INSTANCE.convertPage(page));
    }

    /**
     * 导出参数配置 Excel。
     *
     * @param exportReqVO 导出查询条件
     * @param response HTTP 响应
     * @throws IOException Excel 写出失败时抛出
     */
    @GetMapping("/export-excel")
    @Operation(summary = "导出参数配置")
    @PreAuthorize("@ss.hasPermission('infra:config:export')")
    @ApiAccessLog(operateType = EXPORT)
    public void exportConfig(@Valid ConfigPageReqVO exportReqVO,
                             HttpServletResponse response) throws IOException {
        exportReqVO.setPageNo(1);
        exportReqVO.setPageSize(MAX_EXPORT_SIZE);
        PageResult<ConfigDO> page = configService.getConfigPage(exportReqVO);
        if (page.getTotal() > MAX_EXPORT_SIZE) {
            throw exception(EXPORT_SIZE_EXCEEDED);
        }
        // 输出
        ExcelUtils.write(response, "参数配置.xls", "数据", ConfigRespVO.class,
                ConfigConvert.INSTANCE.convertList(page.getList()));
    }

}
