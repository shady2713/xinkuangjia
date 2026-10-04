package com.basicframework.framework.common.pojo;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证分页结果的三种构造方式与空结果工厂的真实契约。
 *
 * <p>分页结果同时被列表接口与导出接口消费，{@code total} 与 {@code list} 的
 * 空值语义直接影响前端分页器：总量单独构造时必须给出可写的空列表，否则调用方
 * 在空页上追加数据会抛空指针；{@code empty()} 必须返回彼此独立的列表实例，
 * 避免多个空结果共享同一个可变列表而互相污染。</p>
 *
 * @author shady2713
 */
class PageResultTest {

    /** 默认构造保留未赋值状态，用于反序列化等由框架填充字段的场景。 */
    @Test
    void defaultConstructorLeavesTotalAndListUnset() {
        PageResult<String> result = new PageResult<>();

        assertThat(result.getTotal()).isNull();
        assertThat(result.getList()).isNull();
    }

    /** 列表构造直接持有调用方列表引用，不复制、不重排，总量原样保留。 */
    @Test
    void listConstructorKeepsListIdentityAndTotal() {
        List<String> list = new ArrayList<>(Arrays.asList("b", "a"));

        PageResult<String> result = new PageResult<>(list, 2L);

        assertThat(result.getList()).isSameAs(list);
        assertThat(result.getList()).containsExactly("b", "a");
        assertThat(result.getTotal()).isEqualTo(2L);
    }

    /** 仅给总量的构造必须产出可写的空列表，且各实例的列表互不共享。 */
    @Test
    void totalOnlyConstructorBuildsIndependentEmptyList() {
        PageResult<String> first = new PageResult<>(7L);
        PageResult<String> second = new PageResult<>(7L);

        assertThat(first.getTotal()).isEqualTo(7L);
        assertThat(first.getList()).isEmpty();
        assertThat(first.getList()).isNotSameAs(second.getList());

        first.getList().add("新增项");
        assertThat(second.getList()).as("向一个空结果追加数据不得影响另一个空结果").isEmpty();
    }

    /** 空结果工厂：无参工厂总量固定为 0，带参工厂保留传入总量且列表为空。 */
    @Test
    void emptyFactoriesReturnEmptyListWithExpectedTotal() {
        PageResult<String> zero = PageResult.empty();
        PageResult<String> total = PageResult.empty(42L);

        assertThat(zero.getTotal()).isEqualTo(0L);
        assertThat(zero.getList()).isEmpty();
        assertThat(total.getTotal()).isEqualTo(42L);
        assertThat(total.getList()).isEmpty();
        assertThat(zero.getList()).as("两次空结果不得共享同一个列表实例")
                .isNotSameAs(total.getList());
    }

}
