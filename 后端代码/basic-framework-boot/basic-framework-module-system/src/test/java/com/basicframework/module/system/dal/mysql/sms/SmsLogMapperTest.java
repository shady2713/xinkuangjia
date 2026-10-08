package com.basicframework.module.system.dal.mysql.sms;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.system.dal.dataobject.sms.SmsLogDO;
import com.basicframework.module.system.enums.sms.SmsReceiveStatusEnum;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Answers.CALLS_REAL_METHODS;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 验证短信日志回执回调的关联条件与终态写入条件。
 *
 * <p>回执入口只带着供应商的渠道编码、流水号与手机号，缺少任一项都无法唯一定位一条发送日志：
 * 不同供应商的流水号可能相同，渠道编码是防止串写的必要条件。三个标识里任意一个为空都必须直接拒绝，
 * 而不是退化成"只按剩下的条件查"——那会把回执写到别的供应商的记录上。</p>
 *
 * <p>终态写入必须把"关联标识 + 接收状态仍为初始"一起交给数据库判断。只按编号更新会让迟到的重复回执
 * 覆盖已经确认的终态；少了状态条件，并发回执之间的先后关系就由应用层的执行顺序决定，不再有确定性。</p>
 *
 * @author shady2713
 */
class SmsLogMapperTest {

    /** 记录分页查询交给持久化层的条件对象。 */
    private AbstractWrapper<SmsLogDO, ?, ?> selectWrapper;
    /** 记录终态更新交给持久化层的条件对象。 */
    private AbstractWrapper<SmsLogDO, ?, ?> updateWrapper;
    /** 记录终态更新携带的实体。 */
    private SmsLogDO updateEntity;
    /** 分页查询要返回的记录；为空列表用于表达"条件齐全但未匹配"。 */
    private List<SmsLogDO> pageRecords;
    /** 终态更新要返回的影响行数。 */
    private int updateRows;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象方法只记录参数。 */
    private SmsLogMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), SmsLogDO.class);
    }

    /** 为每个用例创建独立替身，并让抽象分页查询与抽象更新按用例设定的方式回放真实副作用。 */
    @BeforeEach
    void setUp() {
        selectWrapper = null;
        updateWrapper = null;
        updateEntity = null;
        pageRecords = List.of(new SmsLogDO());
        updateRows = 1;
        mapper = mock(SmsLogMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            selectWrapper = invocation.getArgument(1);
            IPage<SmsLogDO> page = invocation.getArgument(0);
            page.setRecords(pageRecords);
            page.setTotal((long) pageRecords.size());
            return page;
        }).when(mapper).selectPage(any(IPage.class), any(Wrapper.class));
        doAnswer(invocation -> {
            updateEntity = invocation.getArgument(0);
            updateWrapper = invocation.getArgument(1);
            return updateRows;
        }).when(mapper).update(any(SmsLogDO.class), any(Wrapper.class));
    }

    /** 三个关联标识齐全时按渠道编码、流水号、手机号三条等值条件定位，并按编号倒序取最新一条。 */
    @Test
    void receiveCallbackQueryRequiresAllThreeIdentifiers() {
        SmsLogDO found = mapper.selectByReceiveCallback("ALIYUN", 42L, "SN-1", "13800000000");

        assertThat(found).as("条件齐全且命中时返回该条日志").isNotNull();
        assertThat(selectWrapper.getTargetSql())
                .contains("id =").contains("channel_code =").contains("api_serial_no =").contains("mobile =")
                .contains("ORDER BY id DESC");
        assertThat(selectWrapper.getParamNameValuePairs().values())
                .contains(42L, "ALIYUN", "SN-1", "13800000000");
    }

    /** 内部日志编号可为空：渠道侧不提供编号时只按另外三条标识定位，不能因此查不到。 */
    @Test
    void receiveCallbackQueryWorksWithoutInternalId() {
        mapper.selectByReceiveCallback("ALIYUN", null, "SN-1", "13800000000");

        assertThat(selectWrapper.getTargetSql())
                .as("编号缺省时不得拼出 id 条件").doesNotContain("id =")
                .contains("channel_code =").contains("api_serial_no =").contains("mobile =");
        assertThat(selectWrapper.getParamNameValuePairs().values())
                .doesNotContainNull().contains("ALIYUN", "SN-1", "13800000000");
    }

    /** 三个关联标识任意一个为空都必须直接拒绝，且完全不查库，避免按残缺条件匹配到他人记录。 */
    @Test
    void receiveCallbackQueryRejectsIncompleteIdentifiersWithoutQuerying() {
        assertThat(mapper.selectByReceiveCallback(null, 42L, "SN-1", "13800000000")).isNull();
        assertThat(mapper.selectByReceiveCallback("", 42L, "SN-1", "13800000000")).isNull();
        assertThat(mapper.selectByReceiveCallback("ALIYUN", 42L, "  ", "13800000000")).isNull();
        assertThat(mapper.selectByReceiveCallback("ALIYUN", 42L, "SN-1", null)).isNull();
        assertThat(mapper.selectByReceiveCallback("ALIYUN", 42L, "SN-1", "")).isNull();

        verify(mapper, never()).selectPage(any(IPage.class), any(Wrapper.class));
        assertThat(selectWrapper).as("拒绝路径不得拼出任何查询条件").isNull();
    }

    /** 查询命中但分页结果为空时返回 null，回执入口据此继续走"未匹配"分支而不是收到空对象。 */
    @Test
    void receiveCallbackQueryReturnsNullWhenNothingMatches() {
        pageRecords = List.of();

        assertThat(mapper.selectByReceiveCallback("ALIYUN", 42L, "SN-1", "13800000000")).isNull();
        // MyBatis-Plus 在渲染 SQL 时才把条件值写入参数表，必须先取 SQL 再核对参数。
        assertThat(selectWrapper.getTargetSql()).contains("channel_code =").contains("mobile =");
        assertThat(selectWrapper.getParamNameValuePairs().values()).contains("ALIYUN", "SN-1", "13800000000");
    }

    /** 终态写入必须同时带上四条关联等值条件与"接收状态仍为初始"，并原样下发调用方给的终态实体。 */
    @Test
    void receiveResultUpdateCarriesIdentifiersAndInitialStateGuard() {
        SmsLogDO update = new SmsLogDO();
        update.setReceiveStatus(SmsReceiveStatusEnum.SUCCESS.getStatus());

        int updated = mapper.updateReceiveResultIfInitial(42L, "ALIYUN", "SN-1", "13800000000", update);

        assertThat(updated).as("命中初始状态时写入一行").isEqualTo(1);
        assertThat(updateEntity).as("终态实体原样下发，保留逻辑删除与审计字段填充").isSameAs(update);
        assertThat(updateEntity.getReceiveStatus()).isEqualTo(SmsReceiveStatusEnum.SUCCESS.getStatus());
        assertThat(updateWrapper.getTargetSql())
                .contains("id =").contains("channel_code =").contains("api_serial_no =").contains("mobile =")
                .contains("receive_status =");
        assertThat(updateWrapper.getParamNameValuePairs().values())
                .contains(42L, "ALIYUN", "SN-1", "13800000000", SmsReceiveStatusEnum.INIT.getStatus())
                .doesNotContain(SmsReceiveStatusEnum.FAILURE.getStatus());
    }

    /** 编号或任一关联标识缺失时直接返回 0 且不写库，避免把回执落到无法确认归属的记录上。 */
    @Test
    void receiveResultUpdateRejectsIncompleteIdentifiersWithoutWriting() {
        SmsLogDO update = new SmsLogDO();
        update.setReceiveStatus(SmsReceiveStatusEnum.FAILURE.getStatus());

        assertThat(mapper.updateReceiveResultIfInitial(null, "ALIYUN", "SN-1", "13800000000", update)).isZero();
        assertThat(mapper.updateReceiveResultIfInitial(42L, null, "SN-1", "13800000000", update)).isZero();
        assertThat(mapper.updateReceiveResultIfInitial(42L, "ALIYUN", "", "13800000000", update)).isZero();
        assertThat(mapper.updateReceiveResultIfInitial(42L, "ALIYUN", "SN-1", null, update)).isZero();

        verify(mapper, never()).update(any(SmsLogDO.class), any(Wrapper.class));
        verify(mapper, never()).update(isNull(), any(Wrapper.class));
        assertThat(updateWrapper).as("拒绝路径不得拼出任何更新条件").isNull();
    }

    /** 终态已被其它回执确认时数据库影响行数为 0，方法把该值原样返回，由调用方按合法重复投递处理。 */
    @Test
    void receiveResultUpdateReturnsZeroWhenTerminalStateAlreadyReached() {
        updateRows = 0;
        SmsLogDO update = new SmsLogDO();
        update.setReceiveStatus(SmsReceiveStatusEnum.SUCCESS.getStatus());

        assertThat(mapper.updateReceiveResultIfInitial(42L, "ALIYUN", "SN-1", "13800000000", update)).isZero();
        assertThat(updateWrapper.getTargetSql()).contains("receive_status =");
        assertThat(updateWrapper.getParamNameValuePairs().values()).contains(SmsReceiveStatusEnum.INIT.getStatus());
    }
}