package com.basicframework.module.system.controller.admin.user;

import com.basicframework.framework.common.biz.system.dict.DictDataCommonApi;
import com.basicframework.framework.common.biz.system.dict.dto.DictDataRespDTO;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.dict.core.DictFrameworkUtils;
import com.basicframework.framework.excel.core.util.ExcelUtils;
import com.basicframework.module.system.controller.admin.user.vo.user.UserImportExcelVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserImportRespVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserPageReqVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserRespVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserSaveReqVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserSimpleRespVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserUpdatePasswordReqVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserUpdateStatusReqVO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import com.basicframework.module.system.dal.dataobject.dept.PostDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.enums.DictTypeConstants;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.common.SexEnum;
import com.basicframework.module.system.service.dept.DeptService;
import com.basicframework.module.system.service.dept.PostService;
import com.basicframework.module.system.service.permission.PermissionService;
import com.basicframework.module.system.service.user.AdminUserService;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.ByteArrayInputStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证用户管理接口的平台类型传递、分页补全、详情裁剪、导出边界与导入解析契约。
 *
 * <p>控制器是权限校验之后的业务入口，也是两个管理平台共用的边界：写操作必须把当前登录平台类型
 * 一起下传，否则会跨平台改动账号；分页与精简列表必须按真实部门与角色补全展示字段，
 * 且只补当前分页内的用户，避免越权读取；详情必须过滤已删除岗位；导出必须限制单次条数并写出
 * 真实 Excel；导入必须把表格标签解析成字典值后交给服务。</p>
 *
 * <p>服务协作者按进程外边界替换为替身，模型转换、字典转换与 Excel 读写使用真实实现：
 * 导出结果用 POI 读回断言表头与单元格取值，导入用例先用真实写出流程生成表格再读回，
 * 因此断言的是外部可观察的表格内容而不是内部字段。</p>
 *
 * @author shady2713
 */
class UserControllerTest {

    /** 导出接口声明的单次上限，用于构造越界夹具。 */
    private static final int MAX_EXPORT_SIZE = 10_000;
    /** 当前登录用户所属平台类型。 */
    private static final String LOGIN_USER_TYPE = AdminPlatformTypeEnum.BUSINESS_ADMIN.getType();

    /** 被测控制器。 */
    private UserController controller;
    /** 用户服务替身。 */
    private AdminUserService userService;
    /** 权限服务替身，用于观察角色名称补全的入参。 */
    private PermissionService permissionService;
    /** 部门服务替身。 */
    private DeptService deptService;
    /** 岗位服务替身。 */
    private PostService postService;

    /** 装配控制器与替身，并注入字典数据替身供真实字典转换使用。 */
    @BeforeEach
    void setUp() {
        controller = new UserController();
        userService = mock(AdminUserService.class);
        permissionService = mock(PermissionService.class);
        deptService = mock(DeptService.class);
        postService = mock(PostService.class);
        ReflectionTestUtils.setField(controller, "userService", userService);
        ReflectionTestUtils.setField(controller, "permissionService", permissionService);
        ReflectionTestUtils.setField(controller, "deptService", deptService);
        ReflectionTestUtils.setField(controller, "postService", postService);
        when(userService.getLoginUserTypeOrDefault()).thenReturn(LOGIN_USER_TYPE);
        DictFrameworkUtils.init(dictDataApi());
        DictFrameworkUtils.clearCache();
    }

    /** 清理静态字典缓存，避免把本用例的字典替身带出。 */
    @AfterEach
    void tearDown() {
        DictFrameworkUtils.clearCache();
    }

    /** 创建用户必须返回服务生成的编号，并把当前平台类型一起下传。 */
    @Test
    void createUserReturnsGeneratedIdWithLoginUserType() {
        UserSaveReqVO reqVO = new UserSaveReqVO();
        reqVO.setUsername("DUMMY-USER");
        when(userService.createUser(reqVO, LOGIN_USER_TYPE)).thenReturn(1024L);

        CommonResult<Long> result = controller.createUser(reqVO);

        assertThat(result.getCode()).isZero();
        assertThat(result.getData()).isEqualTo(1024L);
        verify(userService).createUser(reqVO, LOGIN_USER_TYPE);
    }

    /** 更新用户必须下传当前平台类型并返回成功标记。 */
    @Test
    void updateUserDelegatesWithLoginUserType() {
        UserSaveReqVO reqVO = new UserSaveReqVO();
        reqVO.setId(7L);

        CommonResult<Boolean> result = controller.updateUser(reqVO);

        assertThat(result.getData()).isTrue();
        verify(userService).updateUser(reqVO, LOGIN_USER_TYPE);
    }

    /** 删除单个与批量删除都必须带上当前平台类型，避免跨平台删除账号。 */
    @Test
    void deleteUserAndListDelegateWithLoginUserType() {
        assertThat(controller.deleteUser(7L).getData()).isTrue();
        verify(userService).deleteUser(7L, LOGIN_USER_TYPE);

        assertThat(controller.deleteUserList(List.of(7L, 8L)).getData()).isTrue();
        verify(userService).deleteUserList(List.of(7L, 8L), LOGIN_USER_TYPE);
    }

    /** 重置密码必须按编号与口令下传，并带上当前平台类型。 */
    @Test
    void updateUserPasswordDelegatesIdAndPassword() {
        UserUpdatePasswordReqVO reqVO = new UserUpdatePasswordReqVO();
        reqVO.setId(7L);
        reqVO.setPassword("CHANGE_ME_NEW_PASSWORD");

        assertThat(controller.updateUserPassword(reqVO).getData()).isTrue();

        verify(userService).updateUserPassword(7L, "CHANGE_ME_NEW_PASSWORD", LOGIN_USER_TYPE);
    }

    /** 修改状态必须按编号与状态下传，并带上当前平台类型。 */
    @Test
    void updateUserStatusDelegatesIdAndStatus() {
        UserUpdateStatusReqVO reqVO = new UserUpdateStatusReqVO();
        reqVO.setId(7L);
        reqVO.setStatus(CommonStatusEnum.DISABLE.getStatus());

        assertThat(controller.updateUserStatus(reqVO).getData()).isTrue();

        verify(userService).updateUserStatus(7L, CommonStatusEnum.DISABLE.getStatus(), LOGIN_USER_TYPE);
    }

    /** 分页为空时只返回总数，不得调用部门或权限补全。 */
    @Test
    void getUserPageReturnsTotalOnlyWhenListEmpty() {
        UserPageReqVO pageReqVO = new UserPageReqVO();
        when(userService.getUserPage(pageReqVO)).thenReturn(new PageResult<>(5L));

        CommonResult<PageResult<UserRespVO>> result = controller.getUserPage(pageReqVO);

        assertThat(pageReqVO.getUserType()).as("分页条件必须限定当前平台").isEqualTo(LOGIN_USER_TYPE);
        assertThat(result.getData().getList()).isEmpty();
        assertThat(result.getData().getTotal()).isEqualTo(5L);
        verify(deptService, never()).getDeptMap(anyCollection());
        verify(permissionService, never()).getUserRoleNames(anyCollection(), anyString());
    }

    /** 分页有数据时必须补全部门名称与角色名称，且角色只查当前分页内的用户。 */
    @Test
    void getUserPageEnrichesDeptAndRoleNamesWithinPage() {
        AdminUserDO first = user(1L, "DUMMY-USER-A", 100L);
        AdminUserDO second = user(2L, "DUMMY-USER-B", 200L);
        UserPageReqVO pageReqVO = new UserPageReqVO();
        when(userService.getUserPage(pageReqVO)).thenReturn(new PageResult<>(List.of(first, second), 2L));
        Map<Long, DeptDO> deptMap = new LinkedHashMap<>();
        deptMap.put(100L, dept(100L, "DUMMY-研发部"));
        deptMap.put(200L, dept(200L, "DUMMY-财务部"));
        when(deptService.getDeptMap(List.of(100L, 200L))).thenReturn(deptMap);
        when(permissionService.getUserRoleNames(List.of(1L, 2L), LOGIN_USER_TYPE))
                .thenReturn(Map.of(1L, List.of("DUMMY-角色")));

        CommonResult<PageResult<UserRespVO>> result = controller.getUserPage(pageReqVO);

        List<UserRespVO> users = result.getData().getList();
        assertThat(users).hasSize(2);
        assertThat(users.get(0).getDeptName()).isEqualTo("DUMMY-研发部");
        assertThat(users.get(0).getRoleNames()).containsExactly("DUMMY-角色");
        assertThat(users.get(1).getDeptName()).isEqualTo("DUMMY-财务部");
        assertThat(users.get(1).getRoleNames()).as("未返回角色的用户必须是空列表而不是 null").isEmpty();
        assertThat(result.getData().getTotal()).isEqualTo(2L);
    }

    /** 精简列表必须只查询启用状态且限定当前平台，并补全部门名称。 */
    @Test
    void getSimpleUserListQueriesEnabledUsersOfCurrentType() {
        AdminUserDO user = user(1L, "DUMMY-USER-A", 100L);
        when(userService.getUserListByStatusAndType(CommonStatusEnum.ENABLE.getStatus(), LOGIN_USER_TYPE))
                .thenReturn(List.of(user));
        when(deptService.getDeptMap(List.of(100L))).thenReturn(Map.of(100L, dept(100L, "DUMMY-研发部")));

        CommonResult<List<UserSimpleRespVO>> result = controller.getSimpleUserList();

        assertThat(result.getData()).hasSize(1);
        assertThat(result.getData().get(0).getNickname()).isEqualTo("DUMMY-NICK");
        assertThat(result.getData().get(0).getDeptName()).isEqualTo("DUMMY-研发部");
        verify(userService).getUserListByStatusAndType(CommonStatusEnum.ENABLE.getStatus(), LOGIN_USER_TYPE);
    }

    /** 用户不存在时必须返回空数据，不得继续查询部门。 */
    @Test
    void getUserReturnsNullWhenAbsent() {
        when(userService.getUser(9L, LOGIN_USER_TYPE)).thenReturn(null);

        CommonResult<UserRespVO> result = controller.getUser(9L);

        assertThat(result.getCode()).isZero();
        assertThat(result.getData()).isNull();
        verify(deptService, never()).getDept(any());
    }

    /** 用户存在时必须补全部门，并把已删除岗位从岗位集合中过滤掉。 */
    @Test
    void getUserFiltersDeletedPosts() {
        AdminUserDO user = user(1L, "DUMMY-USER-A", 100L);
        user.setPostIds(Set.of(11L, 12L));
        when(userService.getUser(1L, LOGIN_USER_TYPE)).thenReturn(user);
        when(deptService.getDept(100L)).thenReturn(dept(100L, "DUMMY-研发部"));
        PostDO existingPost = new PostDO();
        existingPost.setId(11L);
        when(postService.getPostList(Set.of(11L, 12L))).thenReturn(List.of(existingPost));

        CommonResult<UserRespVO> result = controller.getUser(1L);

        assertThat(result.getData().getDeptName()).isEqualTo("DUMMY-研发部");
        assertThat(result.getData().getPostIds()).as("已删除岗位必须被过滤").containsExactly(11L);
    }

    /** 用户没有岗位时不得查询岗位列表，岗位集合保持为空。 */
    @Test
    void getUserSkipsPostLookupWithoutPosts() {
        AdminUserDO user = user(1L, "DUMMY-USER-A", 100L);
        user.setPostIds(Set.of());
        when(userService.getUser(1L, LOGIN_USER_TYPE)).thenReturn(user);
        when(deptService.getDept(100L)).thenReturn(dept(100L, "DUMMY-研发部"));

        CommonResult<UserRespVO> result = controller.getUser(1L);

        assertThat(result.getData().getPostIds()).isEmpty();
        verify(postService, never()).getPostList(anyCollection());
    }

    /** 导出必须固定首页与上限条数、限定当前平台，并写出包含用户与字典标签的真实 Excel。 */
    @Test
    void exportUserListWritesExcelWithinLimit() throws Exception {
        UserPageReqVO exportReqVO = new UserPageReqVO();
        AdminUserDO user = user(1L, "DUMMY-USER-A", 100L);
        user.setStatus(CommonStatusEnum.ENABLE.getStatus());
        user.setSex(SexEnum.MALE.getSex());
        when(userService.getUserPage(exportReqVO)).thenReturn(new PageResult<>(List.of(user), 1L));
        when(deptService.getDeptMap(List.of(100L))).thenReturn(Map.of(100L, dept(100L, "DUMMY-研发部")));
        MockHttpServletResponse response = new MockHttpServletResponse();

        controller.exportUserList(exportReqVO, response);

        assertThat(exportReqVO.getPageNo()).as("导出必须从第一页开始").isEqualTo(1);
        assertThat(exportReqVO.getPageSize()).as("导出必须限定单次上限").isEqualTo(MAX_EXPORT_SIZE);
        assertThat(exportReqVO.getUserType()).isEqualTo(LOGIN_USER_TYPE);
        assertThat(response.getContentType()).contains("application/vnd.ms-excel");
        assertThat(response.getHeader("Content-Disposition")).contains("attachment;filename=");

        try (Workbook workbook = new XSSFWorkbook(new ByteArrayInputStream(response.getContentAsByteArray()))) {
            Sheet sheet = workbook.getSheet("数据");
            assertThat(sheet).isNotNull();
            assertThat(cellOf(sheet, "用户名称", 1)).isEqualTo("DUMMY-USER-A");
            assertThat(cellOf(sheet, "部门", 1)).isEqualTo("DUMMY-研发部");
            assertThat(cellOf(sheet, "状态", 1)).as("导出必须显示字典标签而不是内部编号").isEqualTo("开启");
            assertThat(cellOf(sheet, "用户性别", 1)).isEqualTo("男");
        }
    }

    /** 超过单次上限时必须显式拒绝，不得生成部分文件。 */
    @Test
    void exportUserListRejectsOverLimit() {
        UserPageReqVO exportReqVO = new UserPageReqVO();
        when(userService.getUserPage(exportReqVO))
                .thenReturn(new PageResult<>(List.of(user(1L, "DUMMY-USER-A", 100L)), (long) MAX_EXPORT_SIZE + 1));
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThatThrownBy(() -> controller.exportUserList(exportReqVO, response))
                .isInstanceOf(ServiceException.class)
                .hasMessageContaining("单次最多导出 10000 条用户");
        assertThat(response.getContentAsByteArray()).as("拒绝时不得写出任何内容").isEmpty();
        verify(deptService, never()).getDeptMap(anyCollection());
    }

    /** 导入模板必须写出两条示例数据，列头与导入模型一致。 */
    @Test
    void importTemplateWritesSampleRows() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        controller.importTemplate(response);

        assertThat(response.getContentAsByteArray()).isNotEmpty();
        List<UserImportExcelVO> rows = ExcelUtils.read(new MockMultipartFile("file", "template.xls",
                "application/vnd.ms-excel", response.getContentAsByteArray()), UserImportExcelVO.class);
        assertThat(rows).hasSize(2);
        assertThat(rows.get(0).getUsername()).isEqualTo("user_a");
        assertThat(rows.get(0).getDeptName()).isEqualTo("研发部门");
        assertThat(rows.get(1).getUsername()).isEqualTo("user_b");
        assertThat(rows.get(1).getStatus()).as("状态标签必须被解析回字典值")
                .isEqualTo(CommonStatusEnum.DISABLE.getStatus());
    }

    /** 导入必须把表格内容解析成模型后交给服务，并原样返回服务的导入结果。 */
    @Test
    @SuppressWarnings("unchecked")
    void importExcelParsesRowsAndDelegates() throws Exception {
        List<UserImportExcelVO> source = List.of(
                UserImportExcelVO.builder().username("DUMMY-IMPORT-A").nickname("DUMMY-昵称A")
                        .deptName("DUMMY-研发部").email("DUMMY-A@example.com").mobile("13800000001")
                        .sex(SexEnum.MALE.getSex()).status(CommonStatusEnum.ENABLE.getStatus()).build());
        MockMultipartFile file = new MockMultipartFile("file", "users.xls", "application/vnd.ms-excel",
                writeExcel(UserImportExcelVO.class, source));
        UserImportRespVO serviceResult = UserImportRespVO.builder().createUsernames(List.of("DUMMY-IMPORT-A"))
                .updateUsernames(List.of()).failureUsernames(Map.of()).build();
        when(userService.importUserList(any(), eq(true))).thenReturn(serviceResult);

        CommonResult<UserImportRespVO> result = controller.importExcel(file, true);

        assertThat(result.getData()).isSameAs(serviceResult);
        ArgumentCaptor<List<UserImportExcelVO>> captor = ArgumentCaptor.forClass(List.class);
        verify(userService).importUserList(captor.capture(), eq(true));
        List<UserImportExcelVO> parsed = captor.getValue();
        assertThat(parsed).hasSize(1);
        assertThat(parsed.get(0).getUsername()).isEqualTo("DUMMY-IMPORT-A");
        assertThat(parsed.get(0).getEmail()).isEqualTo("DUMMY-A@example.com");
        assertThat(parsed.get(0).getSex()).as("性别标签必须被解析回字典值").isEqualTo(SexEnum.MALE.getSex());
        assertThat(parsed.get(0).getStatus()).isEqualTo(CommonStatusEnum.ENABLE.getStatus());
    }

    /**
     * 用真实导出流程生成 Excel 字节，供导入用例读回同一份表格。
     *
     * @param head 表头类型，与数据行类型一致
     * @param rows 数据行
     * @param <T> 表头与数据行类型
     * @return 写出后的工作簿字节
     * @throws Exception 写出失败时抛出，表示测试夹具本身不可用
     */
    private static <T> byte[] writeExcel(Class<T> head, List<T> rows) throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        ExcelUtils.write(response, "users.xls", "数据", head, rows);
        return response.getContentAsByteArray();
    }

    /** 按表头名称定位列并在指定数据行读取文本值。 */
    private static String cellOf(Sheet sheet, String headerName, int rowIndex) {
        Row header = sheet.getRow(0);
        for (int index = 0; index < header.getLastCellNum(); index++) {
            if (headerName.equals(header.getCell(index).getStringCellValue())) {
                Row row = sheet.getRow(rowIndex);
                return row.getCell(index) == null ? null : row.getCell(index).getStringCellValue();
            }
        }
        throw new IllegalStateException("表头不存在：" + headerName);
    }

    /** 构造用户夹具。 */
    private static AdminUserDO user(Long id, String username, Long deptId) {
        AdminUserDO user = new AdminUserDO();
        user.setId(id);
        user.setUsername(username);
        user.setNickname("DUMMY-NICK");
        user.setDeptId(deptId);
        return user;
    }

    /** 构造部门夹具。 */
    private static DeptDO dept(Long id, String name) {
        DeptDO dept = new DeptDO();
        dept.setId(id);
        dept.setName(name);
        return dept;
    }

    /** 构造只提供性别与状态两个字典类型的字典接口替身。 */
    private static DictDataCommonApi dictDataApi() {
        return dictType -> {
            if (DictTypeConstants.USER_SEX.equals(dictType)) {
                return List.of(dictData("男", String.valueOf(SexEnum.MALE.getSex())),
                        dictData("女", String.valueOf(SexEnum.FEMALE.getSex())));
            }
            if (DictTypeConstants.COMMON_STATUS.equals(dictType)) {
                return List.of(dictData("开启", String.valueOf(CommonStatusEnum.ENABLE.getStatus())),
                        dictData("关闭", String.valueOf(CommonStatusEnum.DISABLE.getStatus())));
            }
            return List.of();
        };
    }

    /** 构造字典数据夹具。 */
    private static DictDataRespDTO dictData(String label, String value) {
        DictDataRespDTO data = new DictDataRespDTO();
        data.setLabel(label);
        data.setValue(value);
        return data;
    }

}
