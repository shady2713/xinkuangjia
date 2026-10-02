package com.basicframework.module.system.convert.auth;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.ObjUtil;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeSendReqDTO;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeUseReqDTO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthPermissionInfoRespVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthSmsLoginReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthSmsSendReqVO;
import com.basicframework.module.system.dal.dataobject.permission.MenuDO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.enums.permission.MenuTypeEnum;
import org.mapstruct.Mapper;
import org.mapstruct.factory.Mappers;
import org.slf4j.LoggerFactory;

import java.util.*;

import static com.basicframework.framework.common.util.collection.CollectionUtils.convertSet;
import static com.basicframework.framework.common.util.collection.CollectionUtils.filterList;
import static com.basicframework.module.system.dal.dataobject.permission.MenuDO.ID_ROOT;

/**
 * AuthConvert 对象转换组件。
 *
 * @author 李杰
 */
@Mapper
public interface AuthConvert {

    AuthConvert INSTANCE = Mappers.getMapper(AuthConvert.class);

    /**
     * 转换指定数据。
     *
     * @param user 用户参数
     * @param roleList 数据集合
     * @param menuList 数据集合
     * @return 转换结果
     */
    default AuthPermissionInfoRespVO convert(AdminUserDO user, List<RoleDO> roleList, List<MenuDO> menuList) {
        return AuthPermissionInfoRespVO.builder()
                .user(BeanUtils.toBean(user, AuthPermissionInfoRespVO.UserVO.class))
                .roles(convertSet(roleList, RoleDO::getCode))
                // 权限标识信息
                .permissions(convertSet(menuList, MenuDO::getPermission))
                // 菜单树
                .menus(buildMenuTree(menuList))
                .build();
    }

    /**
     * 将菜单列表，构建成菜单树
     *
     * @param menuList 菜单列表
     * @return 菜单树
     */
    default List<AuthPermissionInfoRespVO.MenuVO> buildMenuTree(List<MenuDO> menuList) {
        if (CollUtil.isEmpty(menuList)) {
            return Collections.emptyList();
        }
        // 移除按钮
        menuList.removeIf(menu -> menu.getType().equals(MenuTypeEnum.BUTTON.getType()));
        // 排序，保证菜单的有序性
        menuList.sort(Comparator.comparing(MenuDO::getSort));

        // 构建菜单树
        // 使用 LinkedHashMap 的原因，是为了排序 。实际也可以用 Stream API ，就是太丑了。
        Map<Long, AuthPermissionInfoRespVO.MenuVO> treeNodeMap = new LinkedHashMap<>();
        menuList.forEach(menu -> treeNodeMap.put(menu.getId(),
                BeanUtils.toBean(menu, AuthPermissionInfoRespVO.MenuVO.class)));
        // 处理父子关系
        treeNodeMap.values().stream().filter(node -> ObjUtil.notEqual(node.getParentId(), ID_ROOT)).forEach(childNode -> {
            // 获得父节点
            AuthPermissionInfoRespVO.MenuVO parentNode = treeNodeMap.get(childNode.getParentId());
            if (parentNode == null) {
                LoggerFactory.getLogger(getClass()).error("[buildRouterTree][resource({}) 找不到父资源({})]",
                        childNode.getId(), childNode.getParentId());
                return;
            }
            // 将自己添加到父节点中
            if (parentNode.getChildren() == null) {
                parentNode.setChildren(new ArrayList<>());
            }
            parentNode.getChildren().add(childNode);
        });
        // 获得到所有的根节点
        return filterList(treeNodeMap.values(), node -> ID_ROOT.equals(node.getParentId()));
    }

    /**
     * 转换指定数据。
     *
     * @param reqVO 请求参数
     * @return 转换结果
     */
    SmsCodeSendReqDTO convert(AuthSmsSendReqVO reqVO);

    /**
     * 转换指定数据。
     *
     * @param reqVO 请求参数
     * @param scene 场景参数
     * @param usedIp usedIp参数
     * @return 转换结果
     */
    SmsCodeUseReqDTO convert(AuthSmsLoginReqVO reqVO, Integer scene, String usedIp);

}
