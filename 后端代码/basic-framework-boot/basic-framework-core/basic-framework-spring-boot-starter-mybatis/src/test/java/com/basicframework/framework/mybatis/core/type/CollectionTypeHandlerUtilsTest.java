package com.basicframework.framework.mybatis.core.type;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证集合类型处理器共用的分隔文本解析契约。
 *
 * <p>解析结果直接作为业务集合使用：任务编号、岗位编号等字段在数据库中以逗号分隔的 varchar 存储，
 * 读取时的顺序、去重和空值语义都会传到上层业务判断。三个方法分别服务列表与集合两种容器，
 * 因此需要同时锁定“列表保序”“集合去重”和“空文本得到空容器而不是 null”，
 * 后者尤其重要——返回 null 会让调用方的 for-each 直接空指针。</p>
 *
 * <p>分隔符由各 TypeHandler 固定传入逗号；此处按真实调用方式使用逗号，并额外确认空白容忍行为。</p>
 *
 * @author shady2713
 */
class CollectionTypeHandlerUtilsTest {

    /** 与各 TypeHandler 实际使用的分隔符保持一致。 */
    private static final String COMMA = ",";

    /** 长整数列表必须保持数据库中的原始顺序，顺序变化会改变业务展示与优先级判断。 */
    @Test
    void parseLongListKeepsOriginalOrder() {
        assertThat(CollectionTypeHandlerUtils.parseLongList("3,1,2", COMMA)).containsExactly(3L, 1L, 2L);
        assertThat(CollectionTypeHandlerUtils.parseLongList("1024", COMMA)).containsExactly(1024L);
        assertThat(CollectionTypeHandlerUtils.parseLongList("1,2,", COMMA)).as("结尾分隔符不产生空元素")
                .containsExactly(1L, 2L);
        assertThat(CollectionTypeHandlerUtils.parseLongList("1, 2 ,3", COMMA)).as("元素两侧空白被忽略")
                .containsExactly(1L, 2L, 3L);
    }

    /** 长整数列表保留重复项，去重属于集合语义而非列表语义。 */
    @Test
    void parseLongListKeepsDuplicates() {
        assertThat(CollectionTypeHandlerUtils.parseLongList("5,5,7", COMMA)).containsExactly(5L, 5L, 7L);
    }

    /** 长整数集合必须去重，重复编号会让权限或关联计算重复计数。 */
    @Test
    void parseLongSetRemovesDuplicates() {
        Set<Long> values = CollectionTypeHandlerUtils.parseLongSet("5,5,7", COMMA);

        assertThat(values).containsExactlyInAnyOrder(5L, 7L);
    }

    /** 整数列表同样保持顺序，并正确解析负数与零。 */
    @Test
    void parseIntegerListKeepsOriginalOrder() {
        assertThat(CollectionTypeHandlerUtils.parseIntegerList("3,1,2", COMMA)).containsExactly(3, 1, 2);
        assertThat(CollectionTypeHandlerUtils.parseIntegerList("0,-1,10", COMMA)).containsExactly(0, -1, 10);
    }

    /**
     * 空文本解析为空容器而不是 null。
     *
     * <p>数据库列允许为空串时，若返回 null，调用方按集合遍历会直接空指针；
     * 返回空容器让“没有配置任何编号”和“解析失败”保持可区分的正常路径。</p>
     */
    @Test
    void blankTextYieldsEmptyContainers() {
        assertThat(CollectionTypeHandlerUtils.parseLongList(null, COMMA)).isEmpty();
        assertThat(CollectionTypeHandlerUtils.parseLongList("", COMMA)).isEmpty();
        assertThat(CollectionTypeHandlerUtils.parseLongList("   ", COMMA)).isEmpty();
        assertThat(CollectionTypeHandlerUtils.parseLongSet(null, COMMA)).isEmpty();
        assertThat(CollectionTypeHandlerUtils.parseLongSet("", COMMA)).isEmpty();
        assertThat(CollectionTypeHandlerUtils.parseIntegerList(null, COMMA)).isEmpty();
        assertThat(CollectionTypeHandlerUtils.parseIntegerList("", COMMA)).isEmpty();
        assertThat(CollectionTypeHandlerUtils.parseIntegerList("   ", COMMA)).isEmpty();
    }

    /**
     * 无法解析的元素必须显式失败，不能静默丢弃或当成 0。
     *
     * <p>脏数据被忽略会让“配置了编号但未生效”难以排查，因此解析异常向外传播，
     * 由调用方决定如何处理。</p>
     */
    @Test
    void unparseableElementFailsInsteadOfBeingDropped() {
        assertThatThrownBy(() -> CollectionTypeHandlerUtils.parseLongList("1,x,3", COMMA))
                .isInstanceOf(NumberFormatException.class);
        assertThatThrownBy(() -> CollectionTypeHandlerUtils.parseLongSet("1,x", COMMA))
                .isInstanceOf(NumberFormatException.class);
        assertThatThrownBy(() -> CollectionTypeHandlerUtils.parseIntegerList("1,x", COMMA))
                .isInstanceOf(NumberFormatException.class);
    }

    /** 空分隔符无法切分文本，必须显式失败而不是返回整段文本或空容器。 */
    @Test
    void blankSeparatorIsRejected() {
        assertThatThrownBy(() -> CollectionTypeHandlerUtils.parseLongList("1,2", ""))
                .isInstanceOf(IllegalArgumentException.class);
    }

    /**
     * 结果容器必须可继续写入，避免调用方拿到不可变集合后在累加处失败。
     *
     * <p>列表结果按可变列表返回，集合结果按可变集合返回；此处只断言新增元素成功，
     * 不锁定具体实现类型。</p>
     */
    @Test
    void parsedContainersAreWritable() {
        List<Long> list = CollectionTypeHandlerUtils.parseLongList("1", COMMA);
        Set<Long> set = CollectionTypeHandlerUtils.parseLongSet("1", COMMA);
        List<Integer> integers = CollectionTypeHandlerUtils.parseIntegerList("1", COMMA);

        list.add(2L);
        set.add(2L);
        integers.add(2);

        assertThat(list).containsExactly(1L, 2L);
        assertThat(set).containsExactlyInAnyOrder(1L, 2L);
        assertThat(integers).containsExactly(1, 2);
    }
}
