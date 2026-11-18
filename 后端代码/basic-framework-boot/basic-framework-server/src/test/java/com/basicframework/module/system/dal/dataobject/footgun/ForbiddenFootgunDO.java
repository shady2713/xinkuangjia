package com.basicframework.module.system.dal.dataobject.footgun;

/**
 * 反向失败夹具：模拟持久化层的数据对象 DO。
 *
 * @author shady2713
 */
public class ForbiddenFootgunDO {

    /** 主键编号。 */
    private Long id;

    /**
     * 获取主键编号。
     *
     * @return 主键编号
     */
    public Long getId() {
        return id;
    }

    /**
     * 设置主键编号。
     *
     * @param id 主键编号
     */
    public void setId(Long id) {
        this.id = id;
    }
}
