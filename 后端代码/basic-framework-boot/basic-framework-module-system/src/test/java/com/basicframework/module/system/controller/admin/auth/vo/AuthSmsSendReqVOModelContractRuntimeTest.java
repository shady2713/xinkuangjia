package com.basicframework.module.system.controller.admin.auth.vo;

import lombok.Data;
import lombok.EqualsAndHashCode;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 运行期锁定发送短信验证码请求模型的真实 {@code equals}/{@code hashCode} 行为。
 *
 * <p>被测对象是生产 {@link AuthSmsSendReqVO} 的真实实例：断言读的是 Lombok 在运行期生成的方法
 * 行为，不是注解文本。固定上游版本只有 {@code @Data}，没有显式的
 * {@code @EqualsAndHashCode(callSuper = false)}；本地版本显式声明了该注解，语义是「相等只看本类
 * 字段，不看父类验证码字段」。本类把这条真实行为固定下来。</p>
 *
 * <p>判别性由同文件内的**契约违反变体** {@link SuperFieldAwareSendReq} 提供：它字段一一对应，只把
 * {@code callSuper} 改成 {@code true}。同一条「父类字段不参与相等」的断言作用到变体上必须失败，
 * 从而证明断言读的是真实的父类参与形态。</p>
 *
 * <p>Lombok 注解是源码期保留，运行期读不到，因此「父类不参与相等」只能通过实例行为观察；本类
 * 全部断言都基于真实实例方法调用，不去读注解文本冒充运行期证据。</p>
 *
 * <p>本类只锁定当前实现行为，不对「是否应该忽略父类字段」下结论。</p>
 *
 * @author 证据与契约方向执行代理
 */
class AuthSmsSendReqVOModelContractRuntimeTest {

    /** 相同手机号与场景的两个实例必须相等，模型是值语义而不是身份语义。 */
    @Test
    void equalFieldValuesProduceEqualInstances() {
        AuthSmsSendReqVO left = sendReq("13100000000", 30);
        AuthSmsSendReqVO right = sendReq("13100000000", 30);

        assertEqualIgnoringSuperFields(left, right);
        assertThat(left.hashCode()).as("相等实例的哈希值必须相同").isEqualTo(right.hashCode());
    }

    /**
     * 父类验证码字段不参与相等判定。
     *
     * <p>这是 {@code callSuper = false} 的直接可观测后果：两个实例只在父类字段上不同，仍必须相等。
     * 该行为会影响把请求对象放进集合或做键比较的调用方，因此固定下来。</p>
     */
    @Test
    void superclassFieldIsExcludedFromEquality() {
        AuthSmsSendReqVO left = sendReq("13100000000", 30);
        AuthSmsSendReqVO right = sendReq("13100000000", 30);
        right.setCaptchaVerification("PfcH6mgr8tpXuMWFjvW6YVaqrswIuwmWI5dsVZSg7sGpWtDCUbHuDEXl3cFB1+VvCC/rAkSwK8Fad52FSuncVg==");

        assertThat(left.getCaptchaVerification()).as("父类字段确实不同").isNotEqualTo(right.getCaptchaVerification());
        assertEqualIgnoringSuperFields(left, right);
    }

    /** 契约违反变体把父类字段纳入相等判定，同一条断言作用在它上面必须失败。 */
    @Test
    void superFieldAwareVariantBreaksTheAssertionSoItDiscriminates() {
        SuperFieldAwareSendReq variant = new SuperFieldAwareSendReq();
        variant.setMobile("13100000000");
        variant.setScene(30);
        variant.setCaptchaVerification("另一个验证码");

        assertThat(variant).isNotEqualTo(sendReq("13100000000", 30));
        assertThatThrownBy(() -> assertEqualIgnoringSuperFields(variant, sendReq("13100000000", 30)))
                .as("同一条「父类字段不参与相等」断言作用在契约违反变体上必须失败")
                .isInstanceOf(AssertionError.class);
    }

    /** 手机号或场景任一不同都必须不相等，避免值语义退化为「只要有一个字段相同就相等」。 */
    @Test
    void anyFieldDifferenceBreaksEquality() {
        AuthSmsSendReqVO base = sendReq("13100000000", 30);

        assertThat(base).as("手机号不同").isNotEqualTo(sendReq("13100000001", 30));
        assertThat(base).as("场景不同").isNotEqualTo(sendReq("13100000000", 31));
    }

    /** 构造方式与无参构造仍然可用，避免下游反序列化或测试装配失败。 */
    @Test
    void builderAndNoArgsConstructorRemainAvailable() {
        AuthSmsSendReqVO built = AuthSmsSendReqVO.builder()
                .mobile("13100000000").scene(30).build();
        AuthSmsSendReqVO empty = new AuthSmsSendReqVO();

        assertThat(built.getMobile()).isEqualTo("13100000000");
        assertThat(empty.getMobile()).isNull();
        assertEqualIgnoringSuperFields(empty, new AuthSmsSendReqVO());
    }

    /**
     * 生产契约的断言入口：两个实例相等，且相等关系不依赖父类字段。
     *
     * @param left 左侧实例，生产对象与契约违反变体共用该断言
     * @param right 右侧实例
     */
    private static void assertEqualIgnoringSuperFields(Object left, Object right) {
        assertThat(left).as("本地契约：父类验证码字段不参与相等判定").isEqualTo(right);
    }

    /** 构造只填充本类字段的请求对象。 */
    private static AuthSmsSendReqVO sendReq(String mobile, Integer scene) {
        AuthSmsSendReqVO request = new AuthSmsSendReqVO();
        request.setMobile(mobile);
        request.setScene(scene);
        return request;
    }

    /**
     * 契约违反变体：本类字段一一对应，只把父类参与相等判定打开。
     *
     * <p>它只用于负对照，不参与任何生产路径。</p>
     */
    @Data
    @EqualsAndHashCode(callSuper = true)
    static class SuperFieldAwareSendReq extends CaptchaVerificationReqVO {

        /** 手机号。 */
        private String mobile;

        /** 短信场景。 */
        private Integer scene;
    }

}