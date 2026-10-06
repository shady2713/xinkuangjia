package com.basicframework.module.system.controller.admin.user.vo.user;

import cn.idev.excel.annotation.ExcelProperty;
import com.basicframework.framework.excel.core.annotations.DictFormat;
import com.basicframework.framework.excel.core.convert.DictConvert;
import com.basicframework.module.system.enums.DictTypeConstants;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 用户 Excel 导入 VO
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
 * 上游文件续：system/controller/admin/user/vo/user/UserImportExcelVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 2 行，移除或改写上游 2 行；补充注释 8 行。
 * 来源验收：尚未验收
 */
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class UserImportExcelVO {

    /**
     * 登录名称。
     */
    @ExcelProperty("登录名称")
    private String username;

    /**
     * 用户名称。
     */
    @ExcelProperty("用户名称")
    private String nickname;

    /**
     * 部门名称。
     */
    @ExcelProperty("部门名称")
    private String deptName;

    /**
     * 用户邮箱。
     */
    @ExcelProperty("用户邮箱")
    private String email;

    /**
     * 手机号码。
     */
    @ExcelProperty("手机号码")
    private String mobile;

    /**
     * 用户性别。
     */
    @ExcelProperty(value = "用户性别", converter = DictConvert.class)
    @DictFormat(DictTypeConstants.USER_SEX)
    private Integer sex;

    /**
     * 账号状态。
     */
    @ExcelProperty(value = "账号状态", converter = DictConvert.class)
    @DictFormat(DictTypeConstants.COMMON_STATUS)
    private Integer status;

}
