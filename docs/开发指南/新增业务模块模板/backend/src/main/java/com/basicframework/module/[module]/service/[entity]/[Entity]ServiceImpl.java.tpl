package com.basicframework.module.[module].service.[entity];

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.[module].controller.admin.[entity].vo.[Entity]PageReqVO;
import com.basicframework.module.[module].controller.admin.[entity].vo.[Entity]SaveReqVO;
import com.basicframework.module.[module].dal.dataobject.[entity].[Entity]DO;
import com.basicframework.module.[module].dal.mysql.[entity].[Entity]Mapper;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;
import org.springframework.validation.annotation.Validated;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.module.[module].enums.ErrorCodeConstants.[ENTITY]_NAME_DUPLICATE;
import static com.basicframework.module.[module].enums.ErrorCodeConstants.[ENTITY]_NOT_EXISTS;

/**
 * [entity-name]服务实现类。
 *
 * <p>本类承载三类真实业务约束：名称唯一（重复会让前端无法区分记录）、修改必须命中已存在记录
 * （否则过期列表行会改出新记录）、删除前必须确认存在（否则调用方把未删除当成删除成功）。
 * 持久化边界由 Mapper 承担，条件查询在本类用 LambdaQueryWrapperX 表达，空筛选不参与 SQL。</p>
 *
 * <p>占位符：[module]、[entity]、[Entity]、[entity-name]。</p>
 *
 * @author [author]
 */
@Service
@Validated
public class [Entity]ServiceImpl implements [Entity]Service {

    /** [entity-name]持久化接口。 */
    @Resource
    private [Entity]Mapper [entity]Mapper;

    /**
     * 创建[entity-name]。
     *
     * @param createReqVO 创建请求
     * @return 新记录编号
     */
    @Override
    public Long create[Entity]([Entity]SaveReqVO createReqVO) {
        // 名称是业务唯一键：先校验再落库，冲突时不产生任何写入。
        validateNameUnique(null, createReqVO.getName());
        [Entity]DO [entity] = BeanUtils.toBean(createReqVO, [Entity]DO.class);
        [entity]Mapper.insert([entity]);
        return [entity].getId();
    }

    /**
     * 修改[entity-name]。
     *
     * @param updateReqVO 修改请求
     */
    @Override
    public void update[Entity]([Entity]SaveReqVO updateReqVO) {
        // 先确认目标记录存在，再校验名称没有被其它记录占用。
        validate[Entity]Exists(updateReqVO.getId());
        validateNameUnique(updateReqVO.getId(), updateReqVO.getName());
        [Entity]DO updateObj = BeanUtils.toBean(updateReqVO, [Entity]DO.class);
        [entity]Mapper.updateById(updateObj);
    }

    /**
     * 删除[entity-name]。
     *
     * @param id 目标记录编号
     */
    @Override
    public void delete[Entity](Long id) {
        // 不存在时抛业务异常，避免调用方把“没有删除任何记录”当成删除成功。
        validate[Entity]Exists(id);
        [entity]Mapper.deleteById(id);
    }

    /**
     * 查询[entity-name]详情。
     *
     * @param id 目标记录编号
     * @return 记录；不存在时为 {@code null}
     */
    @Override
    public [Entity]DO get[Entity](Long id) {
        return [entity]Mapper.selectById(id);
    }

    /**
     * 分页查询[entity-name]。
     *
     * @param pageReqVO 分页与筛选条件
     * @return 按编号倒序的分页结果
     */
    @Override
    public PageResult<[Entity]DO> get[Entity]Page([Entity]PageReqVO pageReqVO) {
        // 名称模糊、状态精确，为空时不参与 SQL；固定按编号倒序保证翻页结果稳定。
        return [entity]Mapper.selectPage(pageReqVO, new LambdaQueryWrapperX<[Entity]DO>()
                .likeIfPresent([Entity]DO::getName, pageReqVO.getName())
                .eqIfPresent([Entity]DO::getStatus, pageReqVO.getStatus())
                .orderByDesc([Entity]DO::getId));
    }

    /**
     * 校验名称唯一。
     *
     * @param id   当前记录编号；新增时为空
     * @param name 待校验名称
     */
    private void validateNameUnique(Long id, String name) {
        [Entity]DO [entity] = [entity]Mapper.selectOne([Entity]DO::getName, name);
        if ([entity] == null || [entity].getId().equals(id)) {
            return;
        }
        throw exception([ENTITY]_NAME_DUPLICATE, name);
    }

    /**
     * 校验记录存在。
     *
     * <p>编号为空直接按“记录不存在”处理：修改/删除缺少编号属于调用契约错误，必须返回业务
     * 错误码，不能让持久化层抛出不可控异常或把它当成一次成功的空操作。</p>
     *
     * @param id 目标记录编号
     */
    private void validate[Entity]Exists(Long id) {
        if (id == null || [entity]Mapper.selectById(id) == null) {
            throw exception([ENTITY]_NOT_EXISTS);
        }
    }

}
