package com.basicframework.module.infra.framework.file.config;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.validation.annotation.Validated;

/**
 * 文件上传的单次大小和按 UTC 日累计预约预算，失败预约也消耗预算以限制重复滥用。
 *
 * @author shady2713
 */
@Component
@ConfigurationProperties(prefix = "basic-framework.file.upload")
@Validated
@Getter
@Setter
public class FileUploadProperties {

    /** 单个文件最大字节数；内存校验路径硬上限为 32 MiB。 */
    @Min(1)
    @Max(33_554_432)
    private int maxBytes = 10 * 1024 * 1024;

    /** 每个身份每日累计预约字节预算，包含失败或未完成的预约。 */
    @Min(1)
    private long dailyBytes = 200L * 1024 * 1024;

    /** 每个身份每日最大预约次数，防止用大量小文件消耗存储和记录空间。 */
    @Min(1)
    private int dailyRequests = 100;
}
