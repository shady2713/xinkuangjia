package com.basicframework.server;

import com.mysql.cj.conf.ConnectionUrl;
import com.mysql.cj.conf.HostInfo;
import com.mysql.cj.conf.PropertyDefinitions;
import com.mysql.cj.conf.PropertyKey;
import com.mysql.cj.jdbc.JdbcPropertySetImpl;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;

/**
 * Fail-closed production check of the final bound datasource configuration.
 * <p>
 * Runs before initialization of each {@link DataSource} bean, after Spring Boot's
 * {@code PriorityOrdered} configuration-property binding, and before the lazy Hikari
 * pool can be started. It never opens connections and never reports configuration values.
 */
@Component
@Profile("prod")
public class ProductionDataSourcePolicy implements BeanPostProcessor {

    static final String ERROR_MESSAGE = "Production datasource must be a lazily initialized HikariDataSource "
            + "using the MySQL Connector/J driver with a jdbc:mysql:// URL, sslMode=VERIFY_IDENTITY and "
            + "allowPublicKeyRetrieval=false on every host";

    private static final String MYSQL_DRIVER = "com.mysql.cj.jdbc.Driver";

    private static final String CLASSIC_PREFIX = "jdbc:mysql://";

    private static final Set<ConnectionUrl.Type> CLASSIC_TYPES =
            EnumSet.of(ConnectionUrl.Type.SINGLE_CONNECTION, ConnectionUrl.Type.FAILOVER_CONNECTION);

    @Override
    public Object postProcessBeforeInitialization(Object bean, String beanName) {
        if (bean instanceof DataSource && !isCompliant(bean)) {
            throw new IllegalStateException(ERROR_MESSAGE);
        }
        return bean;
    }

    private static boolean isCompliant(Object bean) {
        if (bean.getClass() != HikariDataSource.class) {
            return false;
        }
        HikariDataSource dataSource = (HikariDataSource) bean;
        if (dataSource.isClosed() || dataSource.getHikariPoolMXBean() != null) {
            return false;
        }
        if (dataSource.getDataSource() != null
                || dataSource.getDataSourceClassName() != null
                || dataSource.getDataSourceJNDI() != null) {
            return false;
        }
        if (!MYSQL_DRIVER.equals(dataSource.getDriverClassName())) {
            return false;
        }
        String jdbcUrl = dataSource.getJdbcUrl();
        if (jdbcUrl == null || !jdbcUrl.startsWith(CLASSIC_PREFIX)) {
            return false;
        }
        try {
            return hostsAreCompliant(jdbcUrl, copyOf(dataSource.getDataSourceProperties()));
        }
        catch (RuntimeException ex) {
            return false;
        }
    }

    private static boolean hostsAreCompliant(String jdbcUrl, Properties properties) {
        ConnectionUrl connectionUrl = ConnectionUrl.getConnectionUrlInstance(jdbcUrl, properties);
        if (!CLASSIC_TYPES.contains(connectionUrl.getType())) {
            return false;
        }
        List<HostInfo> hosts = connectionUrl.getHostsList();
        if (hosts == null || hosts.isEmpty()) {
            return false;
        }
        for (HostInfo host : hosts) {
            JdbcPropertySetImpl propertySet = new JdbcPropertySetImpl();
            propertySet.initializeProperties(host.exposeAsProperties());
            PropertyDefinitions.SslMode sslMode =
                    propertySet.<PropertyDefinitions.SslMode>getEnumProperty(PropertyKey.sslMode).getValue();
            Boolean allowPublicKeyRetrieval =
                    propertySet.getBooleanProperty(PropertyKey.allowPublicKeyRetrieval).getValue();
            if (sslMode != PropertyDefinitions.SslMode.VERIFY_IDENTITY
                    || !Boolean.FALSE.equals(allowPublicKeyRetrieval)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Mirrors how Hikari's DriverDataSource hands driver properties to the JDBC driver.
     */
    private static Properties copyOf(Properties source) {
        Properties copy = new Properties();
        if (source != null) {
            for (Map.Entry<Object, Object> entry : source.entrySet()) {
                if (entry.getKey() == null || entry.getValue() == null) {
                    throw new IllegalStateException(ERROR_MESSAGE);
                }
                copy.setProperty(entry.getKey().toString(), entry.getValue().toString());
            }
        }
        return copy;
    }
}
