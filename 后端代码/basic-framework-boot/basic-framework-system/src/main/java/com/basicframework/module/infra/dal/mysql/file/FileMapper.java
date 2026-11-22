package com.basicframework.module.infra.dal.mysql.file;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.infra.controller.admin.file.vo.file.FilePageReqVO;
import com.basicframework.module.infra.dal.dataobject.file.FileDO;
import org.apache.ibatis.annotations.Mapper;

/**
 * 文件操作 Mapper
 *
 * @author 李杰
 */
@Mapper
public interface FileMapper extends BaseMapperX<FileDO> {

    /**
     * 分页查询文件元数据。
     *
     * @param reqVO 分页查询条件
     * @return 文件分页结果
     */
    default PageResult<FileDO> selectPage(FilePageReqVO reqVO) {
        return selectPage(reqVO, new LambdaQueryWrapperX<FileDO>()
                .likeIfPresent(FileDO::getPath, reqVO.getPath())
                .likeIfPresent(FileDO::getType, reqVO.getType())
                .betweenIfPresent(FileDO::getCreateTime, reqVO.getCreateTime())
                .orderByDesc(FileDO::getId));
    }

    /**
     * 按对象路径查询未逻辑删除的最新文件记录，用于下载前校验文件仍处于有效状态。
     *
     * @param path 对象存储相对路径
     * @return 活跃文件元数据；不存在或已软删时返回 null
     */
    default FileDO selectByPath(String path) {
        return selectOne(new LambdaQueryWrapperX<FileDO>()
                .eq(FileDO::getPath, path)
                .orderByDesc(FileDO::getId)
                .last("LIMIT 1"));
    }

}
