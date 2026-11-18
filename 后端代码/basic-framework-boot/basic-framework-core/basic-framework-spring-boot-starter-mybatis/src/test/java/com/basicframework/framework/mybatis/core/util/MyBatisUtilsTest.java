package com.basicframework.framework.mybatis.core.util;

import com.basicframework.framework.common.pojo.PageParam;
import com.basicframework.framework.common.pojo.SortingField;
import com.baomidou.mybatisplus.core.metadata.OrderItem;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证分页排序只接受白名单字段，并转换成下划线列名。
 *
 * @author shady2713
 */
class MyBatisUtilsTest {

    /**
     * 验证合法排序字段会进入分页对象，驼峰列名转为下划线。
     */
    @Test
    void buildPageAppliesWhitelistedSortingField() {
        PageParam pageParam = new PageParam();
        pageParam.setPageNo(2);
        pageParam.setPageSize(20);

        Page<Object> page = MyBatisUtils.buildPage(pageParam,
                List.of(new SortingField("createTime", SortingField.ORDER_ASC)));

        assertThat(page.getCurrent()).isEqualTo(2);
        assertThat(page.getSize()).isEqualTo(20);
        assertThat(page.orders()).hasSize(1);
        OrderItem orderItem = page.orders().get(0);
        assertThat(orderItem.getColumn()).isEqualTo("create_time");
        assertThat(orderItem.isAsc()).isTrue();
    }

    /**
     * 验证未传排序时不追加排序项，保持原查询顺序。
     */
    @Test
    void buildPageKeepsOriginalOrderWhenSortingAbsent() {
        Page<Object> page = MyBatisUtils.buildPage(new PageParam(), null);

        assertThat(page.orders()).isEmpty();
    }

    /**
     * 验证字段名含注入片段时直接拒绝，不能进入 SQL 排序。
     */
    @Test
    void buildPageRejectsSortingFieldOutsideWhitelist() {
        assertThatThrownBy(() -> MyBatisUtils.buildPage(new PageParam(),
                List.of(new SortingField("createTime;drop", SortingField.ORDER_DESC))))
                .isInstanceOf(IllegalArgumentException.class);
    }

}
