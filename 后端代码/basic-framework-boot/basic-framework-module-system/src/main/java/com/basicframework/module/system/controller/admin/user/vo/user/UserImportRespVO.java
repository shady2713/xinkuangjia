package com.basicframework.module.system.controller.admin.user.vo.user;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Builder;
import lombok.Data;

import java.util.List;
import java.util.Map;

/**
 * UserImportRespVO 响应对象，承载接口输出数据。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
 * 上游文件续：system/controller/admin/user/vo/user/UserImportRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地补充注释 9 行。
 */
@Schema(description = "管理后台 - 用户导入 Response VO")
@Data
@Builder
public class UserImportRespVO {

    /**
     * 创建成功的用户名数组。
     */
    @Schema(description = "创建成功的用户名数组", requiredMode = Schema.RequiredMode.REQUIRED)
    private List<String> createUsernames;

    /**
     * 更新成功的用户名数组。
     */
    @Schema(description = "更新成功的用户名数组", requiredMode = Schema.RequiredMode.REQUIRED)
    private List<String> updateUsernames;

    /**
     * 导入失败的用户集合，key 为用户名，value 为失败原因。
     */
    @Schema(description = "导入失败的用户集合，key 为用户名，value 为失败原因", requiredMode = Schema.RequiredMode.REQUIRED)
    private Map<String, String> failureUsernames;

}
