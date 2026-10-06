package com.basicframework.module.system.controller.admin.user.vo.profile;

import com.basicframework.framework.common.validation.EmailEx;
import com.basicframework.framework.common.validation.Mobile;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;
import lombok.Data;
import org.hibernate.validator.constraints.URL;

/**
 * 管理后台用户个人资料更新请求。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/
 * 上游文件续：controller/admin/user/vo/profile/UserProfileUpdateReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 7 行，移除或改写上游 6 行；import 新增 3 行、移除 3 行；补充注释 20 行。
 */
@Schema(description = "管理后台 - 用户个人信息更新 Request VO")
@Data
public class UserProfileUpdateReqVO {

    /**
     * 用户昵称。
     */
    @Schema(description = "用户昵称", example = "basicframework")
    @Size(max = 30, message = "用户昵称长度不能超过 30 个字符")
    private String nickname;

    /**
     * 用户邮箱。
     */
    @Schema(description = "用户邮箱", example = "basicframework@example.com")
    @EmailEx
    @Size(max = 50, message = "邮箱长度不能超过 50 个字符")
    private String email;

    /**
     * 手机号。
     */
    @Schema(description = "手机号", example = "")
    @Mobile
    private String mobile;

    /**
     * 用户性别，参见 SexEnum 枚举类。
     */
    @Schema(description = "用户性别，参见 SexEnum 枚举类", example = "1")
    private Integer sex;

    /**
     * 角色头像。
     */
    @Schema(description = "角色头像", example = "https://www.example.com/1.png")
    @URL(message = "头像地址格式不正确")
    @Size(max = 512, message = "头像地址长度不能超过 512 个字符")
    private String avatar;

}
