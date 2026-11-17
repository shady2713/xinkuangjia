# IDEA HTTP Client 本地环境

`http-client.env.json` 是 IntelliJ IDEA HTTP Client 的本地环境样例，只用于在本机调试 `local`（48080）与 `gateway`（8888）两套管理端/App API 地址。

- `token`、`appToken` 默认为空，由使用者在本机填写；真实令牌不得提交。
- 该文件不参与服务器部署、镜像构建、生产配置或交付包制作。
- 服务器安装与部署只按[部署说明](../../../../docs/部署/部署说明.md)执行。
