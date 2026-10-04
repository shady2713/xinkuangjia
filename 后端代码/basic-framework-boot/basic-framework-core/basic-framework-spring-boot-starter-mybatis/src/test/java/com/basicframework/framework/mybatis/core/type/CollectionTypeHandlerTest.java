package com.basicframework.framework.mybatis.core.type;

import org.apache.ibatis.type.JdbcType;
import org.junit.jupiter.api.Test;

import java.sql.CallableStatement;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证四个集合类型处理器在 JDBC 三个读取入口与写入入口上的真实契约。
 *
 * <p>这些处理器把 {@code varchar} 列里的逗号分隔文本与业务集合互相转换，是任务编号、
 * 岗位编号、标签一类字段的唯一通道，因此需要锁定四条约定：写入时按逗号连接且不额外加空格；
 * 空集合写成空串、null 集合按 SQL NULL 写入（两者在库中含义不同，不能互相顶替）；
 * 三个读取入口（按列名、按列序号、存储过程出参）必须得到同一结果；
 * 列值为 null 时返回 null 集合而不是空集合，避免把“未配置”与“配置为空”混为一谈。</p>
 *
 * <p>另外锁定两种容器的差异：{@code LongSetTypeHandler} 去重，{@code StringListTypeHandler}
 * 保留文本值并去掉元素两侧空白（数值型处理器由共享解析工具按数值解析）。</p>
 *
 * @author shady2713
 */
class CollectionTypeHandlerTest {

    /** 被测整数列表处理器，无状态，可跨用例复用。 */
    private static final IntegerListTypeHandler INTEGER_LIST = new IntegerListTypeHandler();
    /** 被测长整数列表处理器，无状态，可跨用例复用。 */
    private static final LongListTypeHandler LONG_LIST = new LongListTypeHandler();
    /** 被测长整数集合处理器，无状态，可跨用例复用。 */
    private static final LongSetTypeHandler LONG_SET = new LongSetTypeHandler();
    /** 被测字符串列表处理器，无状态，可跨用例复用。 */
    private static final StringListTypeHandler STRING_LIST = new StringListTypeHandler();

    /** 写入时必须按逗号连接元素，顺序与集合一致。 */
    @Test
    void setParameterWritesCommaSeparatedText() throws Exception {
        PreparedStatement statement = mock(PreparedStatement.class);

        INTEGER_LIST.setParameter(statement, 1, Arrays.asList(3, 1, 2), JdbcType.VARCHAR);
        LONG_LIST.setParameter(statement, 2, Arrays.asList(3L, 1L, 2L), JdbcType.VARCHAR);
        LONG_SET.setParameter(statement, 3, Set.of(7L), JdbcType.VARCHAR);
        STRING_LIST.setParameter(statement, 4, Arrays.asList("张三", "李四"), JdbcType.VARCHAR);

        verify(statement).setString(1, "3,1,2");
        verify(statement).setString(2, "3,1,2");
        verify(statement).setString(3, "7");
        verify(statement).setString(4, "张三,李四");
    }

    /** 空集合写成空串，null 集合按 SQL NULL 写入，两者在库中语义不同。 */
    @Test
    void setParameterDistinguishesEmptyCollectionFromNull() throws Exception {
        PreparedStatement statement = mock(PreparedStatement.class);

        INTEGER_LIST.setParameter(statement, 1, new ArrayList<>(), JdbcType.VARCHAR);
        LONG_LIST.setParameter(statement, 2, null, JdbcType.VARCHAR);
        LONG_SET.setParameter(statement, 3, null, JdbcType.VARCHAR);
        STRING_LIST.setParameter(statement, 4, new ArrayList<>(), JdbcType.VARCHAR);

        verify(statement).setString(1, "");
        verify(statement).setString(2, null);
        verify(statement).setString(3, null);
        verify(statement).setString(4, "");
    }

    /** 按列名读取：文本按各处理器的元素类型解析。 */
    @Test
    void getResultByColumnNameParsesEachElementType() throws Exception {
        ResultSet resultSet = mock(ResultSet.class);
        when(resultSet.getString("tags")).thenReturn("1,2,3");

        assertThat(INTEGER_LIST.getResult(resultSet, "tags")).containsExactly(1, 2, 3);
        assertThat(LONG_LIST.getResult(resultSet, "tags")).containsExactly(1L, 2L, 3L);
        assertThat(LONG_SET.getResult(resultSet, "tags")).containsExactlyInAnyOrder(1L, 2L, 3L);
        assertThat(STRING_LIST.getResult(resultSet, "tags")).as("字符串处理器保留文本形态").containsExactly("1", "2", "3");
    }

    /** 按列序号读取：与按列名读取得到同一结果，两个入口不能各自演化。 */
    @Test
    void getResultByColumnIndexMatchesColumnNameEntry() throws Exception {
        ResultSet resultSet = mock(ResultSet.class);
        when(resultSet.getString(2)).thenReturn("1,2,3");

        assertThat(INTEGER_LIST.getResult(resultSet, 2)).containsExactly(1, 2, 3);
        assertThat(LONG_LIST.getResult(resultSet, 2)).containsExactly(1L, 2L, 3L);
        assertThat(LONG_SET.getResult(resultSet, 2)).containsExactlyInAnyOrder(1L, 2L, 3L);
        assertThat(STRING_LIST.getResult(resultSet, 2)).containsExactly("1", "2", "3");
    }

    /** 存储过程出参读取：同样按各处理器的元素类型解析。 */
    @Test
    void getResultFromCallableStatementParsesEachElementType() throws Exception {
        CallableStatement statement = mock(CallableStatement.class);
        when(statement.getString(3)).thenReturn("1,2,3");

        assertThat(INTEGER_LIST.getResult(statement, 3)).containsExactly(1, 2, 3);
        assertThat(LONG_LIST.getResult(statement, 3)).containsExactly(1L, 2L, 3L);
        assertThat(LONG_SET.getResult(statement, 3)).containsExactlyInAnyOrder(1L, 2L, 3L);
        assertThat(STRING_LIST.getResult(statement, 3)).containsExactly("1", "2", "3");
    }

    /** 列值为 null 时返回 null 集合，表示“未配置”，不能与空集合混淆。 */
    @Test
    void nullColumnValueYieldsNullCollection() throws Exception {
        ResultSet resultSet = mock(ResultSet.class);
        when(resultSet.getString("tags")).thenReturn(null);
        when(resultSet.getString(1)).thenReturn(null);
        CallableStatement statement = mock(CallableStatement.class);
        when(statement.getString(1)).thenReturn(null);

        assertThat(INTEGER_LIST.getResult(resultSet, "tags")).isNull();
        assertThat(LONG_LIST.getResult(resultSet, 1)).isNull();
        assertThat(LONG_SET.getResult(resultSet, 1)).isNull();
        assertThat(STRING_LIST.getResult(statement, 1)).isNull();
    }

    /** 空文本解析为空集合，读取不会因空串而空指针。 */
    @Test
    void emptyColumnValueYieldsEmptyCollection() throws Exception {
        ResultSet resultSet = mock(ResultSet.class);
        when(resultSet.getString("tags")).thenReturn("");

        assertThat(INTEGER_LIST.getResult(resultSet, "tags")).isEmpty();
        assertThat(LONG_LIST.getResult(resultSet, "tags")).isEmpty();
        assertThat(LONG_SET.getResult(resultSet, "tags")).isEmpty();
        assertThat(STRING_LIST.getResult(resultSet, "tags")).isEmpty();
    }

    /** 长整数集合按集合语义去重，重复编号不得重复参与后续计算。 */
    @Test
    void longSetCollapsesDuplicateElements() throws Exception {
        ResultSet resultSet = mock(ResultSet.class);
        when(resultSet.getString("tags")).thenReturn("5,5,7");

        assertThat(LONG_SET.getResult(resultSet, "tags")).containsExactlyInAnyOrder(5L, 7L);
        assertThat(LONG_LIST.getResult(resultSet, "tags")).as("列表处理器必须保留重复项").containsExactly(5L, 5L, 7L);
    }

    /** 字符串处理器保留文本值并去掉元素两侧空白，不把数字文本转成数值。 */
    @Test
    void stringListTrimsElementsAndKeepsTextValues() throws Exception {
        ResultSet resultSet = mock(ResultSet.class);
        when(resultSet.getString("tags")).thenReturn(" 张三 , 李四 ,007 ");

        List<String> values = STRING_LIST.getResult(resultSet, "tags");

        assertThat(values).containsExactly("张三", "李四", "007");
        assertThat(values.get(2)).as("前导零必须保留，说明未按数值解析").isEqualTo("007");
    }

}
