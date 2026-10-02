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
 * @author 李杰
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
