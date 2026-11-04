package com.basicframework.module.system.controller.admin.auth.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 管理后台 SM2 公钥响应。
 *
 * @author shady2713
 */
@Schema(description = "管理后台 - SM2 密码传输公钥 Response VO")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Sm2PublicKeyRespVO {

    /**
     * 带 04 前缀的未压缩 SM2 公钥，前端 sm-crypto 直接使用。
     */
    @Schema(description = "SM2 公钥（04 前缀十六进制）", requiredMode = Schema.RequiredMode.REQUIRED)
    private String publicKey;

    /**
     * 密文模式，1 表示 C1C3C2。
     */
    @Schema(description = "密文模式，1=C1C3C2", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    private Integer cipherMode;
}
