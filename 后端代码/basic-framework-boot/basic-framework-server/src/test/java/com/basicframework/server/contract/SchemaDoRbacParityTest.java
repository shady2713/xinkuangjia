package com.basicframework.server.contract;

import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.basicframework.framework.common.exception.ErrorCode;
import com.basicframework.framework.common.exception.enums.ServiceErrorCodeRange;
import com.basicframework.framework.mybatis.core.dataobject.BaseDO;
import com.basicframework.framework.mybatis.core.dataobject.UniqueBaseDO;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Controller;

import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Schema-DO-RBAC-ErrorCode 三位一体契约校验门禁。
 *
 * <p>在不依赖外部 MySQL 实例的前提下，直接解析 {@code 数据库文件/basic_framework.sql} 并结合反射校验：
 * 1. 所有 {@code @TableName} 持久化 DO 的表名、列名与 SQL 基线 100% 一致，且 {@link UniqueBaseDO} 子类的唯一索引必须包含 {@code deleted_tag}；
 * 2. 所有控制器 {@code @PreAuthorize} 声明的权限码均已在 {@code system_menu} 定义并绑定超级管理员角色；
 * 3. 所有业务模块错误码唯一且严格落在 {@link ServiceErrorCodeRange} 声明的模块区间内。</p>
 *
 * @author shady
 */
class SchemaDoRbacParityTest {

    private static final Pattern CREATE_TABLE_PATTERN = Pattern.compile(
            "CREATE\\s+TABLE\\s+`([^`]+)`\\s*\\((.*?)\\)\\s*ENGINE\\s*=",
            Pattern.DOTALL | Pattern.CASE_INSENSITIVE);

    private static final Pattern COLUMN_LINE_PATTERN = Pattern.compile("^\\s*`([^`]+)`\\s+([a-zA-Z]+).*");

    private static final Pattern UNIQUE_INDEX_PATTERN = Pattern.compile(
            "UNIQUE(?:\\s+(?:INDEX|KEY))?(?:\\s+`[^`]+`)?\\s*\\(([^)]+)\\)",
            Pattern.CASE_INSENSITIVE);

    private static final Pattern MENU_INSERT_PATTERN = Pattern.compile(
            "INSERT\\s+INTO\\s+`system_menu`\\s+VALUES\\s*\\((\\d+),\\s*'[^']*',\\s*'([^']*)',\\s*\\d+,\\s*'([^']*)',\\s*\\d+,\\s*(\\d+),");

    private static final Pattern ROLE_MENU_INSERT_PATTERN = Pattern.compile(
            "INSERT\\s+INTO\\s+`system_role_menu`\\s+VALUES\\s*\\(\\d+,\\s*1,\\s*(\\d+),");

    private static final Pattern PERMISSION_FUNC_PATTERN = Pattern.compile(
            "@ss\\.has(?:Any)?Permissions?\\(([^)]*)\\)");

    private static final Pattern SINGLE_QUOTED_PATTERN = Pattern.compile("'([^']+)'");

    /** 仅存一次性密码学随机令牌、删除后永不复用旧值的表，豁免 deleted_tag 要求。 */
    private static final Set<String> IMMUTABLE_TOKEN_UNIQUE_TABLES = Set.of(
            "system_oauth2_access_token",
            "system_oauth2_refresh_token");

    /** 校验全部持久化 DO 类与 basic_framework.sql 的表结构及软删除唯一索引严格对齐。 */
    @Test
    void dataObjectsMatchBaselineSqlColumnsAndUniqueIndexes() throws Exception {
        String sql = Files.readString(resolveBaselineSqlPath(), StandardCharsets.UTF_8);
        Map<String, SqlTableMeta> sqlTables = parseSqlTables(sql);
        assertFalse(sqlTables.isEmpty(), "未能从 basic_framework.sql 解析出任何表结构");

        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(TableName.class));
        Set<BeanDefinition> candidates = scanner.findCandidateComponents("com.basicframework.module");
        assertFalse(candidates.isEmpty(), "未扫描到任何 @TableName DO 类");

        List<String> mismatches = new ArrayList<>();
        for (BeanDefinition bd : candidates) {
            Class<?> doClass = Class.forName(bd.getBeanClassName());
            if (doClass.getPackageName().contains(".footgun")) {
                continue;
            }
            TableName tableNameAnn = doClass.getAnnotation(TableName.class);
            String tableName = tableNameAnn.value().trim().toLowerCase(Locale.ROOT);
            SqlTableMeta tableMeta = sqlTables.get(tableName);
            if (tableMeta == null) {
                mismatches.add(doClass.getSimpleName() + " 映射的表不存在于 basic_framework.sql: " + tableName);
                continue;
            }
            Set<String> doColumns = extractPersistentColumns(doClass);
            if (!tableMeta.columns.equals(doColumns)) {
                Set<String> missingInDo = new TreeSet<>(tableMeta.columns);
                missingInDo.removeAll(doColumns);
                Set<String> extraInDo = new TreeSet<>(doColumns);
                extraInDo.removeAll(tableMeta.columns);
                mismatches.add(String.format(
                        "表 `%s` (%s) 字段失步 -> SQL有但DO缺: %s, DO有但SQL缺: %s",
                        tableName, doClass.getSimpleName(), missingInDo, extraInDo));
            }
            if (UniqueBaseDO.class.isAssignableFrom(doClass)) {
                if (tableMeta.uniqueIndexColumnSets.isEmpty()) {
                    mismatches.add(doClass.getSimpleName() + " 继承了 UniqueBaseDO，但表 `" + tableName + "` 未声明任何 UNIQUE INDEX");
                }
                for (Set<String> ukCols : tableMeta.uniqueIndexColumnSets) {
                    if (!ukCols.contains("deleted_tag")) {
                        mismatches.add("表 `" + tableName + "` 的唯一索引未包含 deleted_tag 列: " + ukCols);
                    }
                }
            } else if (BaseDO.class.isAssignableFrom(doClass)
                    && !tableMeta.uniqueIndexColumnSets.isEmpty()
                    && !IMMUTABLE_TOKEN_UNIQUE_TABLES.contains(tableName)) {
                // 反向门禁：任何可软删除的 BaseDO 表只要声明了业务 UNIQUE INDEX，就必须继承 UniqueBaseDO 并包含 deleted_tag。
                mismatches.add(doClass.getSimpleName() + " 对应软删除表 `" + tableName
                        + "` 含唯一索引 " + tableMeta.uniqueIndexColumnSets + "，必须继承 UniqueBaseDO 并加入 deleted_tag");
            }
        }
        assertTrue(mismatches.isEmpty(), String.join("\n", mismatches));
    }

    /** 校验所有控制器（含类级与方法级）@PreAuthorize 权限标识与 system_menu / 超级管理员及业务管理员角色严格对齐。 */
    @Test
    void allControllerPermissionsExistInBaselineMenuAndSuperAdminRole() throws Exception {
        String sql = Files.readString(resolveBaselineSqlPath(), StandardCharsets.UTF_8);
        Set<Long> superAdminRoleMenuIds = new LinkedHashSet<>();
        Matcher rmMatcher = ROLE_MENU_INSERT_PATTERN.matcher(sql);
        while (rmMatcher.find()) {
            superAdminRoleMenuIds.add(Long.parseLong(rmMatcher.group(1)));
        }

        Set<Long> allMenuIds = new LinkedHashSet<>();
        List<long[]> menuParentLinks = new ArrayList<>();
        Set<Long> superAdminMenuIds = new LinkedHashSet<>();
        Set<String> invalidPlatforms = new TreeSet<>();
        Map<String, List<Long>> permToMenuIds = new HashMap<>();
        List<Map.Entry<Long, String>> businessAdminMenuPerms = new ArrayList<>();

        Matcher menuMatcher = MENU_INSERT_PATTERN.matcher(sql);
        while (menuMatcher.find()) {
            long menuId = Long.parseLong(menuMatcher.group(1));
            String perm = menuMatcher.group(2);
            String menuType = menuMatcher.group(3);
            long parentId = Long.parseLong(menuMatcher.group(4));
            allMenuIds.add(menuId);
            menuParentLinks.add(new long[]{menuId, parentId});
            if (!"super_admin".equals(menuType) && !"business_admin".equals(menuType)) {
                invalidPlatforms.add(menuId + ":" + menuType);
            }
            if ("super_admin".equals(menuType)) {
                superAdminMenuIds.add(menuId);
                if (!perm.isEmpty()) {
                    permToMenuIds.computeIfAbsent(perm, k -> new ArrayList<>()).add(menuId);
                }
            } else if ("business_admin".equals(menuType) && !perm.isEmpty()) {
                businessAdminMenuPerms.add(Map.entry(menuId, perm));
            }
        }
        assertTrue(invalidPlatforms.isEmpty(), "system_menu 存在非法平台标识: " + invalidPlatforms);
        List<String> orphanMenus = new ArrayList<>();
        for (long[] link : menuParentLinks) {
            if (link[1] != 0L && !allMenuIds.contains(link[1])) {
                orphanMenus.add("menuId=" + link[0] + " -> missing parentId=" + link[1]);
            }
        }
        assertTrue(orphanMenus.isEmpty(), "system_menu 存在孤儿父节点引用: " + orphanMenus);
        Set<Long> unboundSuperAdminMenuRows = new TreeSet<>();
        for (Long superAdminMenuId : superAdminMenuIds) {
            if (!superAdminRoleMenuIds.contains(superAdminMenuId)) {
                unboundSuperAdminMenuRows.add(superAdminMenuId);
            }
        }
        assertTrue(unboundSuperAdminMenuRows.isEmpty(),
                "super_admin 菜单或目录未绑定至超级管理员角色(role_id=1): " + unboundSuperAdminMenuRows);

        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(Controller.class));
        Set<String> declaredControllerPerms = new TreeSet<>();
        Set<String> missingInMenu = new TreeSet<>();
        Set<String> unboundToSuperAdmin = new TreeSet<>();

        for (BeanDefinition bd : scanner.findCandidateComponents("com.basicframework")) {
            Class<?> controllerClass = Class.forName(bd.getBeanClassName());
            if (controllerClass.getPackageName().contains(".footgun")) {
                continue;
            }
            PreAuthorize classPreAuth = controllerClass.getAnnotation(PreAuthorize.class);
            if (classPreAuth != null) {
                verifyControllerPermissions(classPreAuth, controllerClass.getSimpleName() + "#<class>",
                        permToMenuIds, superAdminRoleMenuIds, declaredControllerPerms, missingInMenu, unboundToSuperAdmin);
            }
            for (Method method : controllerClass.getDeclaredMethods()) {
                PreAuthorize preAuth = method.getAnnotation(PreAuthorize.class);
                if (preAuth == null) {
                    continue;
                }
                verifyControllerPermissions(preAuth, controllerClass.getSimpleName() + "#" + method.getName(),
                        permToMenuIds, superAdminRoleMenuIds, declaredControllerPerms, missingInMenu, unboundToSuperAdmin);
            }
        }
        assertTrue(missingInMenu.isEmpty(), "控制器使用了未在 system_menu 注册的权限码: " + missingInMenu);
        assertTrue(unboundToSuperAdmin.isEmpty(), "权限菜单未绑定至超级管理员角色(role_id=1): " + unboundToSuperAdmin);
        List<String> staleBusinessAdminPerms = new ArrayList<>();
        for (Map.Entry<Long, String> entry : businessAdminMenuPerms) {
            if (!declaredControllerPerms.contains(entry.getValue())) {
                staleBusinessAdminPerms.add("menuId=" + entry.getKey() + ":" + entry.getValue());
            }
        }
        assertTrue(staleBusinessAdminPerms.isEmpty(),
                "business_admin 菜单声明了控制器不存在的权限码: " + staleBusinessAdminPerms);
    }

    /**
     * 提取 {@code @PreAuthorize} 中的全部权限码并核验其在超管基线菜单及角色授权中的存在性。
     *
     * @param preAuth               权限注解
     * @param sourceLocation        来源类名与方法位置
     * @param permToMenuIds         超管菜单权限索引
     * @param superAdminRoleMenuIds 超管角色已绑定菜单集合
     * @param declaredPerms         控制器实际声明的权限码集合（出参）
     * @param missingInMenu         未登记菜单的权限码集合（出参）
     * @param unboundToSuperAdmin   未授予超管角色的权限码集合（出参）
     */
    private static void verifyControllerPermissions(
            PreAuthorize preAuth,
            String sourceLocation,
            Map<String, List<Long>> permToMenuIds,
            Set<Long> superAdminRoleMenuIds,
            Set<String> declaredPerms,
            Set<String> missingInMenu,
            Set<String> unboundToSuperAdmin) {
        Matcher funcMatcher = PERMISSION_FUNC_PATTERN.matcher(preAuth.value());
        while (funcMatcher.find()) {
            Matcher quoteMatcher = SINGLE_QUOTED_PATTERN.matcher(funcMatcher.group(1));
            while (quoteMatcher.find()) {
                String perm = quoteMatcher.group(1);
                declaredPerms.add(perm);
                List<Long> menuIds = permToMenuIds.get(perm);
                if (menuIds == null || menuIds.isEmpty()) {
                    missingInMenu.add(perm + " (" + sourceLocation + ")");
                } else if (menuIds.stream().noneMatch(superAdminRoleMenuIds::contains)) {
                    unboundToSuperAdmin.add(perm + " -> menuIds=" + menuIds);
                }
            }
        }
    }

    /** 校验所有业务模块 ErrorCodeConstants 编码全局唯一且严格位于各自模块分配区间内。 */
    @Test
    void errorCodesAreUniqueAndWithinAssignedModuleRanges() throws Exception {
        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter((metadataReader, metadataReaderFactory) ->
                metadataReader.getClassMetadata().getClassName().endsWith(".ErrorCodeConstants"));
        Map<Integer, String> seenCodes = new HashMap<>();
        List<String> violations = new ArrayList<>();
        // 支持同一业务模块下存在多个 ErrorCodeConstants 类，避免按模块名覆盖导致漏检。
        List<Map.Entry<String, Class<?>>> constantClasses = new ArrayList<>();
        Set<String> discoveredModules = new LinkedHashSet<>();
        Pattern modulePattern = Pattern.compile("^com\\.basicframework\\.module\\.([a-z0-9_]+)\\..*\\.ErrorCodeConstants$");
        for (BeanDefinition candidate : scanner.findCandidateComponents("com.basicframework.module")) {
            String className = candidate.getBeanClassName();
            Matcher matcher = modulePattern.matcher(className);
            if (matcher.matches()) {
                discoveredModules.add(matcher.group(1));
                constantClasses.add(Map.entry(matcher.group(1), Class.forName(className)));
            }
        }
        assertTrue(ServiceErrorCodeRange.MODULE_RANGES.keySet().containsAll(discoveredModules),
                "存在未在 ServiceErrorCodeRange.MODULE_RANGES 登记号段的模块: " + discoveredModules);

        for (Map.Entry<String, Class<?>> entry : constantClasses) {
            String moduleName = entry.getKey();
            Class<?> clazz = entry.getValue();
            int[] range = ServiceErrorCodeRange.MODULE_RANGES.get(moduleName);
            assertNotNull(range);
            for (Field field : clazz.getDeclaredFields()) {
                if (!Modifier.isStatic(field.getModifiers()) || !ErrorCode.class.isAssignableFrom(field.getType())) {
                    continue;
                }
                ErrorCode errorCode = (ErrorCode) field.get(null);
                int code = errorCode.getCode();
                String label = moduleName + ":" + field.getName() + "(" + code + ")";
                if (code < range[0] || code >= range[1]) {
                    violations.add(label + " 越出模块号段 [" + range[0] + ", " + range[1] + ")");
                }
                String previous = seenCodes.putIfAbsent(code, label);
                if (previous != null) {
                    violations.add("错误码重复: " + previous + " 与 " + label);
                }
            }
        }
        assertTrue(violations.isEmpty(), String.join("\n", violations));
    }

    /** 解析仓库根目录下的数据库基线 SQL 路径。 */
    private static Path resolveBaselineSqlPath() {
        for (Path current = Path.of("").toAbsolutePath(); current != null; current = current.getParent()) {
            Path candidate = current.resolve("数据库文件").resolve("basic_framework.sql").normalize();
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("找不到 数据库文件/basic_framework.sql");
    }

    /** 解析 SQL 中的 CREATE TABLE 列名集合与唯一索引定义。 */
    private static Map<String, SqlTableMeta> parseSqlTables(String sql) {
        Map<String, SqlTableMeta> tables = new LinkedHashMap<>();
        Matcher tableMatcher = CREATE_TABLE_PATTERN.matcher(sql);
        while (tableMatcher.find()) {
            String tableName = tableMatcher.group(1).toLowerCase(Locale.ROOT);
            String body = tableMatcher.group(2);
            Set<String> columns = new TreeSet<>();
            List<Set<String>> uniqueIndexes = new ArrayList<>();
            for (String line : body.split("\\r?\\n")) {
                String trimmed = line.trim();
                if (trimmed.isEmpty()) {
                    continue;
                }
                String upper = trimmed.toUpperCase(Locale.ROOT);
                if (upper.startsWith("UNIQUE ")
                        || (upper.startsWith("CONSTRAINT ") && upper.contains(" UNIQUE"))) {
                    Matcher ukMatcher = UNIQUE_INDEX_PATTERN.matcher(trimmed);
                    if (ukMatcher.find()) {
                        Set<String> ukCols = new TreeSet<>();
                        Matcher colMatcher = Pattern.compile("`([^`]+)`").matcher(ukMatcher.group(1));
                        while (colMatcher.find()) {
                            ukCols.add(colMatcher.group(1).toLowerCase(Locale.ROOT));
                        }
                        uniqueIndexes.add(ukCols);
                    }
                    continue;
                }
                if (upper.startsWith("PRIMARY KEY")
                        || upper.startsWith("INDEX ")
                        || upper.startsWith("KEY ")
                        || upper.startsWith("CONSTRAINT ")
                        || upper.startsWith("FOREIGN KEY")) {
                    continue;
                }
                Matcher colMatcher = COLUMN_LINE_PATTERN.matcher(trimmed);
                if (colMatcher.matches()) {
                    columns.add(colMatcher.group(1).toLowerCase(Locale.ROOT));
                }
            }
            tables.put(tableName, new SqlTableMeta(columns, uniqueIndexes));
        }
        return tables;
    }

    /** 递归提取 DO 类及其继承链上的全部持久化列名。 */
    private static Set<String> extractPersistentColumns(Class<?> doClass) {
        Set<String> columns = new TreeSet<>();
        for (Class<?> current = doClass; current != null && current != Object.class; current = current.getSuperclass()) {
            for (Field field : current.getDeclaredFields()) {
                if (Modifier.isStatic(field.getModifiers()) || Modifier.isTransient(field.getModifiers())) {
                    continue;
                }
                TableField tf = field.getAnnotation(TableField.class);
                if (tf != null && !tf.exist()) {
                    continue;
                }
                String columnName = null;
                if (tf != null && StrUtil.isNotBlank(tf.value())) {
                    columnName = tf.value();
                } else {
                    TableId tid = field.getAnnotation(TableId.class);
                    if (tid != null && StrUtil.isNotBlank(tid.value())) {
                        columnName = tid.value();
                    }
                }
                if (StrUtil.isBlank(columnName)) {
                    columnName = StrUtil.toUnderlineCase(field.getName());
                }
                columnName = StrUtil.strip(columnName.trim(), "`", "`").toLowerCase(Locale.ROOT);
                columns.add(columnName);
            }
        }
        return columns;
    }

    /**
     * SQL 基线表结构摘要，记录列名集合与全部唯一索引列集合。
     */
    private record SqlTableMeta(Set<String> columns, List<Set<String>> uniqueIndexColumnSets) {
    }

}
