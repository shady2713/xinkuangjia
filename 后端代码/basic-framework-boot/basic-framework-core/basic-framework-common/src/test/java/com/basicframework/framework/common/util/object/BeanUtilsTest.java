package com.basicframework.framework.common.util.object;

import com.basicframework.framework.common.pojo.PageResult;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证 Bean 转换工具的真实字段映射、类型转换与空值语义。
 *
 * <p>该工具是 VO/DTO/DO 之间转换的公共入口：转换结果被直接写库或返回给前端，
 * 字段映射错误会让业务字段静默丢失，空值处理不一致会抛错或写入错误默认值。
 * 因此用例断言转换后的真实字段值、列表与分页结果的元素类型，以及 null 输入的实际返回。</p>
 *
 * @author shady2713
 */
class BeanUtilsTest {

    /** 对象转目标类型必须完成同名字段的取值与字符串到数字的类型转换。 */
    @Test
    void toBeanConvertsSingleObjectWithTypeConversion() {
        Source source = new Source();
        source.setId("42");
        source.setName("张三");

        Target target = BeanUtils.toBean(source, Target.class);

        assertThat(target.getId()).as("字符串编号必须转换为目标字段的数字类型").isEqualTo(42L);
        assertThat(target.getName()).isEqualTo("张三");
    }

    /** 单对象转换后的自定义处理必须在返回前执行，且对象为 null 时不得调用处理逻辑。 */
    @Test
    void toBeanAppliesConsumerOnlyWhenTargetPresent() {
        List<String> visited = new ArrayList<>();
        Source source = new Source();
        source.setName("张三");

        Target target = BeanUtils.toBean(source, Target.class, bean -> visited.add(bean.getName()));

        assertThat(target).isNotNull();
        assertThat(visited).containsExactly("张三");
    }

    /** 列表转换必须逐元素转换并保持顺序，源列表为 null 时返回 null。 */
    @Test
    void toBeanConvertsListKeepingOrderAndNullSemantics() {
        Source first = new Source();
        first.setId("1");
        Source second = new Source();
        second.setId("2");

        List<Target> targets = BeanUtils.toBean(List.of(first, second), Target.class);

        assertThat(targets).extracting(Target::getId).containsExactly(1L, 2L);
        assertThat(BeanUtils.toBean((List<Source>) null, Target.class)).as("null 列表必须原样返回 null").isNull();
    }

    /** 列表转换的逐元素处理必须对每个元素生效，null 列表不得触发处理逻辑。 */
    @Test
    void toBeanAppliesConsumerForEveryListElement() {
        Source first = new Source();
        first.setName("A");
        Source second = new Source();
        second.setName("B");

        List<Target> targets = BeanUtils.toBean(List.of(first, second), Target.class,
                bean -> bean.setName(bean.getName() + "-VISITED"));

        assertThat(targets).extracting(Target::getName).containsExactly("A-VISITED", "B-VISITED");
    }

    /** 分页结果转换必须保留总数并转换列表元素，null 分页结果返回 null。 */
    @Test
    void toBeanConvertsPageResultKeepingTotal() {
        Source source = new Source();
        source.setId("7");
        PageResult<Source> page = new PageResult<>(List.of(source), 99L);

        PageResult<Target> converted = BeanUtils.toBean(page, Target.class);

        assertThat(converted.getTotal()).as("总数必须保留").isEqualTo(99L);
        assertThat(converted.getList()).extracting(Target::getId).containsExactly(7L);
        assertThat(BeanUtils.toBean((PageResult<Source>) null, Target.class)).isNull();
        assertThat(BeanUtils.toBean((PageResult<Source>) null, Target.class, bean -> {
        })).as("null 分页结果不得触发处理逻辑").isNull();
    }

    /** 分页结果的逐元素处理必须对每个元素生效。 */
    @Test
    void toBeanAppliesConsumerForPageElements() {
        Source source = new Source();
        source.setName("DUMMY");
        PageResult<Source> page = new PageResult<>(List.of(source), 1L);

        PageResult<Target> converted = BeanUtils.toBean(page, Target.class,
                bean -> bean.setName(bean.getName() + "-VISITED"));

        assertThat(converted.getList()).extracting(Target::getName).containsExactly("DUMMY-VISITED");
    }

    /**
     * 属性拷贝按名称忽略大小写匹配，源或目标为空时静默跳过。
     *
     * <p>实测行为：{@code copyProperties} 使用 Hutool 默认的忽略大小写策略，因此
     * {@code upperName} 与 {@code upper_name} 这类仅大小写或下划线差异的属性同样会被覆盖。
     * 用例按真实行为断言，避免误以为它是严格同名拷贝。</p>
     */
    @Test
    void copyPropertiesMatchesNamesIgnoringCaseAndSkipsNulls() {
        CopySource source = new CopySource();
        source.setName("DUMMY-NEW");
        source.setUpperName("DUMMY-UPPER");
        CopyTarget target = new CopyTarget();
        target.setName("DUMMY-OLD");
        target.setUpperName("DUMMY-OLD-UPPER");

        BeanUtils.copyProperties(source, target);

        assertThat(target.getName()).as("同名字段必须被覆盖").isEqualTo("DUMMY-NEW");
        assertThat(target.getUpperName()).as("属性名匹配忽略大小写").isEqualTo("DUMMY-UPPER");
    }

    /** 源或目标为 null 时不得抛错，也不得产生副作用。 */
    @Test
    void copyPropertiesIgnoresNullArguments() {
        CopyTarget target = new CopyTarget();
        target.setName("DUMMY-OLD");

        BeanUtils.copyProperties(null, target);
        BeanUtils.copyProperties(new CopySource(), null);

        assertThat(target.getName()).as("源为 null 时目标必须保持不变").isEqualTo("DUMMY-OLD");
    }

    /** 无法转换的字段值必须显式失败，不能静默写入错误的业务数据。 */
    @Test
    void toBeanFailsWhenFieldValueIsNotConvertible() {
        Source source = new Source();
        source.setId("DUMMY-NOT-A-NUMBER");

        assertThatThrownBy(() -> BeanUtils.toBean(source, Target.class))
                .as("编号不是数字时必须失败，而不是写入空值或错误值")
                .isInstanceOf(RuntimeException.class);
    }

    /**
     * 工具类未声明私有构造，实例化不得改变静态转换入口的行为。
     *
     * <p>该类没有实例状态，构造方法属于真实可调用面；断言实例化后静态转换仍按同一规则工作。</p>
     */
    @Test
    void instantiationKeepsStaticEntryBehaviour() {
        new BeanUtils();
        Source source = new Source();
        source.setName("DUMMY-实例化后");

        assertThat(BeanUtils.toBean(source, Target.class).getName()).isEqualTo("DUMMY-实例化后");
    }

    /**
     * 转换源夹具，编号使用字符串以覆盖类型转换。
     *
     * @author shady2713
     */
    public static class Source {

        /** 编号。 */
        private String id;
        /** 名称。 */
        private String name;

        /**
         * 获取编号。
         *
         * @return 编号
         */
        public String getId() {
            return id;
        }

        /**
         * 设置编号。
         *
         * @param id 编号
         */
        public void setId(String id) {
            this.id = id;
        }

        /**
         * 获取名称。
         *
         * @return 名称
         */
        public String getName() {
            return name;
        }

        /**
         * 设置名称。
         *
         * @param name 名称
         */
        public void setName(String name) {
            this.name = name;
        }
    }

    /**
     * 转换目标夹具，编号声明为数字以覆盖类型转换。
     *
     * @author shady2713
     */
    public static class Target {

        /** 编号。 */
        private Long id;
        /** 名称。 */
        private String name;

        /**
         * 获取编号。
         *
         * @return 编号
         */
        public Long getId() {
            return id;
        }

        /**
         * 设置编号。
         *
         * @param id 编号
         */
        public void setId(Long id) {
            this.id = id;
        }

        /**
         * 获取名称。
         *
         * @return 名称
         */
        public String getName() {
            return name;
        }

        /**
         * 设置名称。
         *
         * @param name 名称
         */
        public void setName(String name) {
            this.name = name;
        }
    }

    /**
     * 同名字段拷贝的源夹具。
     *
     * @author shady2713
     */
    public static class CopySource {

        /** 与目标同名的属性。 */
        private String name;
        /** 仅大小写与目标不同的属性。 */
        private String upperName;

        /**
         * 获取名称。
         *
         * @return 名称
         */
        public String getName() {
            return name;
        }

        /**
         * 设置名称。
         *
         * @param name 名称
         */
        public void setName(String name) {
            this.name = name;
        }

        /**
         * 获取大小写不同的属性。
         *
         * @return 属性值
         */
        public String getUpperName() {
            return upperName;
        }

        /**
         * 设置大小写不同的属性。
         *
         * @param upperName 属性值
         */
        public void setUpperName(String upperName) {
            this.upperName = upperName;
        }
    }

    /**
     * 同名字段拷贝的目标夹具。
     *
     * @author shady2713
     */
    public static class CopyTarget {

        /** 与源同名的属性。 */
        private String name;
        /** 仅大小写与源不同的属性。 */
        private String upperName;

        /**
         * 获取名称。
         *
         * @return 名称
         */
        public String getName() {
            return name;
        }

        /**
         * 设置名称。
         *
         * @param name 名称
         */
        public void setName(String name) {
            this.name = name;
        }

        /**
         * 获取大小写不同的属性。
         *
         * @return 属性值
         */
        public String getUpperName() {
            return upperName;
        }

        /**
         * 设置大小写不同的属性。
         *
         * @param upperName 属性值
         */
        public void setUpperName(String upperName) {
            this.upperName = upperName;
        }
    }

}
