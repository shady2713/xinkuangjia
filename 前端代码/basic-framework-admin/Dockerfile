# 非特权 Nginx 容器，默认 uid 101 监听 8080 端口
FROM nginxinc/nginx-unprivileged:1.27-alpine

WORKDIR /usr/share/nginx/html

COPY dist/ /usr/share/nginx/html/
COPY docker/app.config.js /usr/share/nginx/html/_app.config.js
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
