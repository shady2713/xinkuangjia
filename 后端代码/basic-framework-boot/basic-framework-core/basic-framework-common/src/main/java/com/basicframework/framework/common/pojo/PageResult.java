package com.basicframework.framework.common.pojo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;

/**
 * 分页查询结果。
 *
 * @param <T> 数据项类型
 * @author 李杰
 */
@Schema(description = "分页结果")
@Data
public final class PageResult<T> implements Serializable {

    @Schema(description = "总量", requiredMode = Schema.RequiredMode.REQUIRED)
    private Long total;

    @Schema(description = "数据", requiredMode = Schema.RequiredMode.REQUIRED)
    private List<T> list;

    /**
     * 创建空分页结果。
     */
    public PageResult() {
    }

    /**
     * 根据列表和总量创建分页结果。
     *
     * @param list 数据列表
     * @param total 总量
     */
    public PageResult(List<T> list, Long total) {
        this.list = list;
        this.total = total;
    }

    /**
     * 根据总量创建空列表分页结果。
     *
     * @param total 总量
     */
    public PageResult(Long total) {
        this.list = new ArrayList<>();
        this.total = total;
    }

    /**
     * 构建总数为 0 的空分页结果。
     *
     * @param <T> 数据项类型
     * @return 空分页结果
     */
    public static <T> PageResult<T> empty() {
        return new PageResult<>(0L);
    }

    /**
     * 构建指定总数、空数据列表的分页结果。
     *
     * @param total 总数
     * @param <T> 数据项类型
     * @return 空分页结果
     */
    public static <T> PageResult<T> empty(Long total) {
        return new PageResult<>(total);
    }

}
