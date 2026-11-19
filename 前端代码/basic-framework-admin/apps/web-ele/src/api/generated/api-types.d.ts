// 自动由 scripts/openapi/generate-api-types.mjs 根据 openapi.json 生成，禁止手改。

export namespace OpenApiSchemas {
  export interface AliyunSmsCallbackRespVO {
    code?: number;
    msg?: string;
  }

  /** 管理后台 - 地区节点 Response VO */
  export interface AreaNodeRespVO {
    children?: OpenApiSchemas.AreaNodeRespVO[];
    /** 编号 */
    id: number;
    /** 名字 */
    name: string;
  }

  /** 管理后台 - 账号密码登录 Request VO */
  export interface AuthLoginReqVO {
    /** 验证码，验证码开启时，需要传递 */
    captchaVerification: string;
    /** SM2 密码密文（C1C3C2） */
    password: string;
    /** 账号 */
    username: string;
  }

  /** 管理后台 - 登录 Response VO */
  export interface AuthLoginRespVO {
    /** 访问令牌 */
    accessToken: string;
    /** 过期时间 */
    expiresTime: number;
    /** 是否要求先修改密码 */
    passwordChangeRequired: boolean;
    /** 刷新令牌 */
    refreshToken: string;
    /** 用户编号 */
    userId: number | string;
  }

  /** 管理后台 - 登录用户的权限信息 Response VO，额外包括用户信息和角色列表 */
  export interface AuthPermissionInfoRespVO {
    /** 菜单树 */
    menus: OpenApiSchemas.AuthPermissionInfoRespVO_MenuVO[];
    /** 操作权限数组 */
    permissions: string[];
    /** 角色标识数组 */
    roles: string[];
    user: OpenApiSchemas.AuthPermissionInfoRespVO_UserVO;
  }

  /** 管理后台 - 登录用户的菜单信息 Response VO */
  export interface AuthPermissionInfoRespVO_MenuVO {
    /** 是否总是显示 */
    alwaysShow?: boolean;
    children?: OpenApiSchemas.AuthPermissionInfoRespVO_MenuVO[];
    /** 组件路径,仅菜单类型为菜单时，才需要传 */
    component?: string;
    /** 组件名 */
    componentName?: string;
    /** 菜单图标,仅菜单类型为菜单或者目录时，才需要传 */
    icon?: string;
    /** 菜单名称 */
    id: number | string;
    /** 是否缓存 */
    keepAlive: boolean;
    /** 菜单名称 */
    name: string;
    /** 父菜单 ID */
    parentId: number | string;
    /** 路由地址,仅菜单类型为菜单或者目录时，才需要传 */
    path?: string;
    /** 是否可见 */
    visible: boolean;
  }

  /** 用户信息 VO */
  export interface AuthPermissionInfoRespVO_UserVO {
    /** 用户头像 */
    avatar: string;
    /** 部门编号 */
    deptId: number | string;
    /** 用户邮箱 */
    email?: string;
    /** 用户编号 */
    id: number | string;
    /** 用户昵称 */
    nickname: string;
    /** 是否要求先修改密码 */
    passwordChangeRequired: boolean;
    /** 所属后台类型 */
    userType: string;
    /** 用户账号 */
    username: string;
  }

  /** 管理后台 - 刷新访问令牌 Request VO */
  export interface AuthRefreshTokenReqVO {
    /** 刷新令牌 */
    refreshToken: string;
  }

  /** 管理后台 - 短信重置账号密码 Request VO */
  export interface AuthResetPasswordReqVO {
    /** 手机短信验证码 */
    code: string;
    /** 手机号 */
    mobile: string;
    /** SM2 密码密文（C1C3C2） */
    password: string;
  }

  /** 管理后台 - 短信验证码的登录 Request VO */
  export interface AuthSmsLoginReqVO {
    /** 短信验证码 */
    code: string;
    /** 手机号 */
    mobile: string;
  }

  /** 管理后台 - 发送手机验证码 Request VO */
  export interface AuthSmsSendReqVO {
    /** 验证码，验证码开启时，需要传递 */
    captchaVerification: string;
    /** 手机号 */
    mobile: string;
    /** 短信场景 */
    scene: number;
  }

  export interface CaptchaVO {
    browserInfo?: string;
    captchaFontSize?: number;
    captchaFontType?: string;
    captchaId?: string;
    captchaOriginalPath?: string;
    captchaType?: string;
    captchaVerification?: string;
    clientUid?: string;
    jigsawImageBase64?: string;
    originalImageBase64?: string;
    point?: OpenApiSchemas.PointVO;
    pointJson?: string;
    pointList?: OpenApiSchemas.Point[];
    projectCode?: string;
    result?: boolean;
    secretKey?: string;
    token?: string;
    ts?: number | string;
    wordList?: string[];
  }

  export interface CommonResult_AuthLoginRespVO {
    code?: number;
    data?: OpenApiSchemas.AuthLoginRespVO;
    msg?: string;
  }

  export interface CommonResult_AuthPermissionInfoRespVO {
    code?: number;
    data?: OpenApiSchemas.AuthPermissionInfoRespVO;
    msg?: string;
  }

  export interface CommonResult_Boolean {
    code?: number;
    data?: boolean;
    msg?: string;
  }

  export interface CommonResult_ConfigRespVO {
    code?: number;
    data?: OpenApiSchemas.ConfigRespVO;
    msg?: string;
  }

  export interface CommonResult_DeptRespVO {
    code?: number;
    data?: OpenApiSchemas.DeptRespVO;
    msg?: string;
  }

  export interface CommonResult_DictDataRespVO {
    code?: number;
    data?: OpenApiSchemas.DictDataRespVO;
    msg?: string;
  }

  export interface CommonResult_DictTypeRespVO {
    code?: number;
    data?: OpenApiSchemas.DictTypeRespVO;
    msg?: string;
  }

  export interface CommonResult_FilePresignedUrlRespVO {
    code?: number;
    data?: OpenApiSchemas.FilePresignedUrlRespVO;
    msg?: string;
  }

  export interface CommonResult_FileRespVO {
    code?: number;
    data?: OpenApiSchemas.FileRespVO;
    msg?: string;
  }

  export interface CommonResult_JobLogRespVO {
    code?: number;
    data?: OpenApiSchemas.JobLogRespVO;
    msg?: string;
  }

  export interface CommonResult_JobRespVO {
    code?: number;
    data?: OpenApiSchemas.JobRespVO;
    msg?: string;
  }

  export interface CommonResult_List_AreaNodeRespVO {
    code?: number;
    data?: OpenApiSchemas.AreaNodeRespVO[];
    msg?: string;
  }

  export interface CommonResult_List_DeptRespVO {
    code?: number;
    data?: OpenApiSchemas.DeptRespVO[];
    msg?: string;
  }

  export interface CommonResult_List_DeptSimpleRespVO {
    code?: number;
    data?: OpenApiSchemas.DeptSimpleRespVO[];
    msg?: string;
  }

  export interface CommonResult_List_DictDataSimpleRespVO {
    code?: number;
    data?: OpenApiSchemas.DictDataSimpleRespVO[];
    msg?: string;
  }

  export interface CommonResult_List_DictTypeSimpleRespVO {
    code?: number;
    data?: OpenApiSchemas.DictTypeSimpleRespVO[];
    msg?: string;
  }

  export interface CommonResult_List_LocalDateTime {
    code?: number;
    data?: number[];
    msg?: string;
  }

  export interface CommonResult_List_MenuRespVO {
    code?: number;
    data?: OpenApiSchemas.MenuRespVO[];
    msg?: string;
  }

  export interface CommonResult_List_MenuSimpleRespVO {
    code?: number;
    data?: OpenApiSchemas.MenuSimpleRespVO[];
    msg?: string;
  }

  export interface CommonResult_List_PostSimpleRespVO {
    code?: number;
    data?: OpenApiSchemas.PostSimpleRespVO[];
    msg?: string;
  }

  export interface CommonResult_List_RoleSimpleRespVO {
    code?: number;
    data?: OpenApiSchemas.RoleSimpleRespVO[];
    msg?: string;
  }

  export interface CommonResult_List_SmsChannelSimpleRespVO {
    code?: number;
    data?: OpenApiSchemas.SmsChannelSimpleRespVO[];
    msg?: string;
  }

  export interface CommonResult_List_UserSimpleRespVO {
    code?: number;
    data?: OpenApiSchemas.UserSimpleRespVO[];
    msg?: string;
  }

  export interface CommonResult_LoginLogRespVO {
    code?: number;
    data?: OpenApiSchemas.LoginLogRespVO;
    msg?: string;
  }

  export interface CommonResult_Long {
    code?: number;
    data?: number | string;
    msg?: string;
  }

  export interface CommonResult_MenuRespVO {
    code?: number;
    data?: OpenApiSchemas.MenuRespVO;
    msg?: string;
  }

  export interface CommonResult_OAuth2ClientRespVO {
    code?: number;
    data?: OpenApiSchemas.OAuth2ClientRespVO;
    msg?: string;
  }

  export interface CommonResult_OAuth2OpenTokenRespVO {
    code?: number;
    data?: OpenApiSchemas.OAuth2OpenTokenRespVO;
    msg?: string;
  }

  export interface CommonResult_OAuth2UserInfoRespVO {
    code?: number;
    data?: OpenApiSchemas.OAuth2UserInfoRespVO;
    msg?: string;
  }

  export interface CommonResult_OperateLogRespVO {
    code?: number;
    data?: OpenApiSchemas.OperateLogRespVO;
    msg?: string;
  }

  export interface CommonResult_PageResult_ConfigRespVO {
    code?: number;
    data?: OpenApiSchemas.PageResult_ConfigRespVO;
    msg?: string;
  }

  export interface CommonResult_PageResult_DictDataRespVO {
    code?: number;
    data?: OpenApiSchemas.PageResult_DictDataRespVO;
    msg?: string;
  }

  export interface CommonResult_PageResult_DictTypeRespVO {
    code?: number;
    data?: OpenApiSchemas.PageResult_DictTypeRespVO;
    msg?: string;
  }

  export interface CommonResult_PageResult_FileRespVO {
    code?: number;
    data?: OpenApiSchemas.PageResult_FileRespVO;
    msg?: string;
  }

  export interface CommonResult_PageResult_JobLogRespVO {
    code?: number;
    data?: OpenApiSchemas.PageResult_JobLogRespVO;
    msg?: string;
  }

  export interface CommonResult_PageResult_JobRespVO {
    code?: number;
    data?: OpenApiSchemas.PageResult_JobRespVO;
    msg?: string;
  }

  export interface CommonResult_PageResult_LoginLogRespVO {
    code?: number;
    data?: OpenApiSchemas.PageResult_LoginLogRespVO;
    msg?: string;
  }

  export interface CommonResult_PageResult_OAuth2AccessTokenRespVO {
    code?: number;
    data?: OpenApiSchemas.PageResult_OAuth2AccessTokenRespVO;
    msg?: string;
  }

  export interface CommonResult_PageResult_OAuth2ClientRespVO {
    code?: number;
    data?: OpenApiSchemas.PageResult_OAuth2ClientRespVO;
    msg?: string;
  }

  export interface CommonResult_PageResult_OperateLogRespVO {
    code?: number;
    data?: OpenApiSchemas.PageResult_OperateLogRespVO;
    msg?: string;
  }

  export interface CommonResult_PageResult_PostRespVO {
    code?: number;
    data?: OpenApiSchemas.PageResult_PostRespVO;
    msg?: string;
  }

  export interface CommonResult_PageResult_RoleRespVO {
    code?: number;
    data?: OpenApiSchemas.PageResult_RoleRespVO;
    msg?: string;
  }

  export interface CommonResult_PageResult_SmsChannelRespVO {
    code?: number;
    data?: OpenApiSchemas.PageResult_SmsChannelRespVO;
    msg?: string;
  }

  export interface CommonResult_PageResult_SmsTemplateRespVO {
    code?: number;
    data?: OpenApiSchemas.PageResult_SmsTemplateRespVO;
    msg?: string;
  }

  export interface CommonResult_PageResult_UserRespVO {
    code?: number;
    data?: OpenApiSchemas.PageResult_UserRespVO;
    msg?: string;
  }

  export interface CommonResult_PostRespVO {
    code?: number;
    data?: OpenApiSchemas.PostRespVO;
    msg?: string;
  }

  export interface CommonResult_RoleRespVO {
    code?: number;
    data?: OpenApiSchemas.RoleRespVO;
    msg?: string;
  }

  export interface CommonResult_Set_Long {
    code?: number;
    data?: (number | string)[];
    msg?: string;
  }

  export interface CommonResult_Sm2PublicKeyRespVO {
    code?: number;
    data?: OpenApiSchemas.Sm2PublicKeyRespVO;
    msg?: string;
  }

  export interface CommonResult_SmsChannelRespVO {
    code?: number;
    data?: OpenApiSchemas.SmsChannelRespVO;
    msg?: string;
  }

  export interface CommonResult_SmsTemplateRespVO {
    code?: number;
    data?: OpenApiSchemas.SmsTemplateRespVO;
    msg?: string;
  }

  export interface CommonResult_String {
    code?: number;
    data?: string;
    msg?: string;
  }

  export interface CommonResult_UserImportRespVO {
    code?: number;
    data?: OpenApiSchemas.UserImportRespVO;
    msg?: string;
  }

  export interface CommonResult_UserProfileRespVO {
    code?: number;
    data?: OpenApiSchemas.UserProfileRespVO;
    msg?: string;
  }

  export interface CommonResult_UserRespVO {
    code?: number;
    data?: OpenApiSchemas.UserRespVO;
    msg?: string;
  }

  /** 管理后台 - 参数配置分页 Request VO */
  export interface ConfigPageReqVO {
    /** 创建时间 */
    createTime?: number[];
    /** 参数键名，模糊匹配 */
    key?: string;
    /** 数据源名称，模糊匹配 */
    name?: string;
    /** 页码，从 1 开始 */
    pageNo: number;
    /** 每页条数，最大值为 200 */
    pageSize: number;
    /** 排序字段 */
    sortingFields?: OpenApiSchemas.SortingField[];
    /** 参数类型，参见 ConfigTypeEnum 枚举 */
    type?: number;
  }

  /** 管理后台 - 参数配置信息 Response VO */
  export interface ConfigRespVO {
    /** 参数分类 */
    category: string;
    /** 创建时间 */
    createTime: number;
    /** 参数配置序号 */
    id: number | string;
    /** 参数键名 */
    key: string;
    /** 参数名称 */
    name: string;
    /** 备注 */
    remark?: string;
    /** 参数类型，参见 ConfigTypeEnum 枚举 */
    type: number;
    /** 参数键值 */
    value: string;
    /** 是否可见 */
    visible: boolean;
  }

  /** 管理后台 - 参数配置创建/修改 Request VO */
  export interface ConfigSaveReqVO {
    /** 参数分组 */
    category: string;
    /** 参数配置序号 */
    id?: number | string;
    /** 参数键名 */
    key: string;
    /** 参数名称 */
    name: string;
    /** 备注 */
    remark?: string;
    /** 参数键值 */
    value: string;
    /** 是否可见 */
    visible: boolean;
  }

  /** 管理后台 - 部门列表 Request VO */
  export interface DeptListReqVO {
    /** 部门名称，模糊匹配 */
    name?: string;
    /** 展示状态，参见 CommonStatusEnum 枚举类 */
    status?: number;
  }

  /** 管理后台 - 部门信息 Response VO */
  export interface DeptRespVO {
    /** 创建时间 */
    createTime: number;
    /** 邮箱 */
    email?: string;
    /** 部门编号 */
    id?: number | string;
    /** 负责人的用户编号 */
    leaderUserId?: number | string;
    /** 部门名称 */
    name: string;
    /** 父部门 ID */
    parentId?: number | string;
    /** 联系电话 */
    phone?: string;
    /** 显示顺序 */
    sort: number;
    /** 状态,见 CommonStatusEnum 枚举 */
    status: number;
  }

  /** 管理后台 - 部门创建/修改 Request VO */
  export interface DeptSaveReqVO {
    /** 邮箱 */
    email?: string;
    /** 部门编号 */
    id?: number | string;
    /** 负责人用户编号 */
    leaderUserId?: number | string;
    /** 部门名称 */
    name: string;
    /** 父部门 ID */
    parentId?: number | string;
    /** 联系电话 */
    phone?: string;
    /** 显示顺序 */
    sort: number;
    /** 状态，参见 CommonStatusEnum 枚举 */
    status: number;
  }

  /** 管理后台 - 部门精简信息 Response VO */
  export interface DeptSimpleRespVO {
    /** 部门编号 */
    id: number | string;
    /** 部门名称 */
    name: string;
    /** 父部门 ID */
    parentId: number | string;
  }

  /** 管理后台 - 字典类型分页列表 Request VO */
  export interface DictDataPageReqVO {
    /** 字典类型，模糊匹配 */
    dictType?: string;
    /** 字典标签 */
    label?: string;
    /** 页码，从 1 开始 */
    pageNo: number;
    /** 每页条数，最大值为 200 */
    pageSize: number;
    /** 排序字段 */
    sortingFields?: OpenApiSchemas.SortingField[];
    /** 展示状态，参见 CommonStatusEnum 枚举类 */
    status?: number;
  }

  /** 管理后台 - 字典数据信息 Response VO */
  export interface DictDataRespVO {
    /** 颜色类型,default、primary、success、info、warning、danger */
    colorType?: string;
    /** 创建时间 */
    createTime: number;
    /** css 样式 */
    cssClass?: string;
    /** 字典类型 */
    dictType: string;
    /** 字典数据编号 */
    id: number | string;
    /** 字典标签 */
    label: string;
    /** 备注 */
    remark?: string;
    /** 显示顺序 */
    sort: number;
    /** 状态,见 CommonStatusEnum 枚举 */
    status: number;
    /** 字典值 */
    value: string;
  }

  /** 管理后台 - 字典数据创建/修改 Request VO */
  export interface DictDataSaveReqVO {
    /** 颜色类型,default、primary、success、info、warning、danger */
    colorType?: string;
    /** css 样式 */
    cssClass?: string;
    /** 字典类型 */
    dictType: string;
    /** 字典数据编号 */
    id?: number | string;
    /** 字典标签 */
    label: string;
    /** 备注 */
    remark?: string;
    /** 显示顺序 */
    sort: number;
    /** 状态,见 CommonStatusEnum 枚举 */
    status: number;
    /** 字典值 */
    value: string;
  }

  /** 管理后台 - 数据字典精简 Response VO */
  export interface DictDataSimpleRespVO {
    /** 颜色类型，default、primary、success、info、warning、danger */
    colorType?: string;
    /** css 样式 */
    cssClass?: string;
    /** 字典类型 */
    dictType: string;
    /** 字典标签 */
    label: string;
    /** 字典键值 */
    value: string;
  }

  /** 管理后台 - 字典类型分页列表 Request VO */
  export interface DictTypePageReqVO {
    /** 创建时间 */
    createTime?: number[];
    /** 字典类型名称，模糊匹配 */
    name?: string;
    /** 页码，从 1 开始 */
    pageNo: number;
    /** 每页条数，最大值为 200 */
    pageSize: number;
    /** 排序字段 */
    sortingFields?: OpenApiSchemas.SortingField[];
    /** 展示状态，参见 CommonStatusEnum 枚举类 */
    status?: number;
    /** 字典类型，模糊匹配 */
    type?: string;
  }

  /** 管理后台 - 字典类型信息 Response VO */
  export interface DictTypeRespVO {
    /** 创建时间 */
    createTime: number;
    /** 字典类型编号 */
    id: number | string;
    /** 字典名称 */
    name: string;
    /** 备注 */
    remark?: string;
    /** 状态，参见 CommonStatusEnum 枚举类 */
    status: number;
    /** 字典类型 */
    type: string;
  }

  /** 管理后台 - 字典类型创建/修改 Request VO */
  export interface DictTypeSaveReqVO {
    /** 字典类型编号 */
    id?: number | string;
    /** 字典名称 */
    name: string;
    /** 备注 */
    remark?: string;
    /** 状态，参见 CommonStatusEnum 枚举类 */
    status: number;
    /** 字典类型 */
    type: string;
  }

  /** 管理后台 - 字典类型精简信息 Response VO */
  export interface DictTypeSimpleRespVO {
    /** 字典类型编号 */
    id: number | string;
    /** 字典类型名称 */
    name: string;
    /** 字典类型 */
    type: string;
  }

  /** 管理后台 - 文件创建 Request VO */
  export interface FileCreateReqVO {
    /** 原文件名 */
    name: string;
    /** 文件路径 */
    path: string;
    /** 文件大小 */
    size: number | string;
    /** 文件 MIME 类型 */
    type?: string;
    /** 文件 URL（兼容字段，服务端按 path 重新生成） */
    url: string;
  }

  /** 管理后台 - 文件分页 Request VO */
  export interface FilePageReqVO {
    /** 创建时间 */
    createTime?: number[];
    /** 页码，从 1 开始 */
    pageNo: number;
    /** 每页条数，最大值为 200 */
    pageSize: number;
    /** 文件路径，模糊匹配 */
    path?: string;
    /** 排序字段 */
    sortingFields?: OpenApiSchemas.SortingField[];
    /** 文件类型，模糊匹配 */
    type?: string;
  }

  /** 管理后台 - 文件预签名地址 Response VO */
  export interface FilePresignedUrlRespVO {
    /** 预签名绑定的 Content-Type */
    contentType?: string;
    /** 文件路径 */
    path: string;
    /** 文件上传 URL */
    uploadUrl: string;
    /** 文件访问 URL */
    url: string;
  }

  /** 管理后台 - 文件 Response VO,不返回 content 字段，太大 */
  export interface FileRespVO {
    /** 创建时间 */
    createTime: number;
    /** 文件编号 */
    id: number | string;
    /** 原文件名 */
    name: string;
    /** 文件路径 */
    path: string;
    /** 文件大小 */
    size: number | string;
    /** 文件MIME类型 */
    type?: string;
    /** 文件 URL */
    url: string;
  }

  /** 管理后台 - 上传文件 Request VO */
  export interface FileUploadReqVO {
    /** 文件目录 */
    directory?: string;
    /** 文件附件 */
    file: Blob | File;
  }

  /** 管理后台 - 定时任务日志分页 Request VO */
  export interface JobLogPageReqVO {
    /** 开始执行时间 */
    beginTime?: number;
    /** 结束执行时间 */
    endTime?: number;
    /** 处理器的名字，模糊匹配 */
    handlerName?: string;
    /** 任务编号 */
    jobId?: number | string;
    /** 页码，从 1 开始 */
    pageNo: number;
    /** 每页条数，最大值为 200 */
    pageSize: number;
    /** 排序字段 */
    sortingFields?: OpenApiSchemas.SortingField[];
    /** 任务状态，参见 JobLogStatusEnum 枚举 */
    status?: number;
  }

  /** 管理后台 - 定时任务日志 Response VO */
  export interface JobLogRespVO {
    /** 开始执行时间 */
    beginTime: number;
    /** 创建时间 */
    createTime: number;
    /** 执行时长 */
    duration?: number;
    /** 结束执行时间 */
    endTime?: number;
    /** 第几次执行 */
    executeIndex: number;
    /** 处理器的名字 */
    handlerName: string;
    /** 处理器的参数 */
    handlerParam?: string;
    /** 日志编号 */
    id: number | string;
    /** 任务编号 */
    jobId: number | string;
    /** 结果数据 */
    result?: string;
    /** 任务状态，参见 JobLogStatusEnum 枚举 */
    status: number;
  }

  /** 管理后台 - 定时任务分页 Request VO */
  export interface JobPageReqVO {
    /** 处理器的名字，模糊匹配 */
    handlerName?: string;
    /** 任务名称，模糊匹配 */
    name?: string;
    /** 页码，从 1 开始 */
    pageNo: number;
    /** 每页条数，最大值为 200 */
    pageSize: number;
    /** 排序字段 */
    sortingFields?: OpenApiSchemas.SortingField[];
    /** 任务状态，参见 JobStatusEnum 枚举 */
    status?: number;
  }

  /** 管理后台 - 定时任务 Response VO */
  export interface JobRespVO {
    /** 创建时间 */
    createTime: number;
    /** CRON 表达式 */
    cronExpression: string;
    /** 处理器的名字 */
    handlerName: string;
    /** 处理器的参数 */
    handlerParam?: string;
    /** 任务编号 */
    id: number | string;
    /** 监控超时时间 */
    monitorTimeout?: number;
    /** 任务名称 */
    name: string;
    /** 重试次数 */
    retryCount: number;
    /** 重试间隔 */
    retryInterval: number;
    /** 任务状态 */
    status: number;
  }

  /** 管理后台 - 定时任务创建/修改 Request VO */
  export interface JobSaveReqVO {
    /** CRON 表达式 */
    cronExpression: string;
    /** 处理器的名字 */
    handlerName: string;
    /** 处理器的参数 */
    handlerParam?: string;
    /** 任务编号 */
    id?: number | string;
    /** 监控超时时间 */
    monitorTimeout?: number;
    /** 任务名称 */
    name: string;
    /** 重试次数 */
    retryCount: number;
    /** 重试间隔 */
    retryInterval: number;
  }

  /** 管理后台 - 登录日志分页列表 Request VO */
  export interface LoginLogPageReqVO {
    /** 登录时间 */
    createTime?: number[];
    /** 页码，从 1 开始 */
    pageNo: number;
    /** 每页条数，最大值为 200 */
    pageSize: number;
    /** 排序字段 */
    sortingFields?: OpenApiSchemas.SortingField[];
    /** 操作状态 */
    status?: boolean;
    /** 用户 IP，模拟匹配 */
    userIp?: string;
    /** 用户账号，模拟匹配 */
    username?: string;
  }

  /** 管理后台 - 登录日志 Response VO */
  export interface LoginLogRespVO {
    /** 登录时间 */
    createTime: number;
    /** 日志编号 */
    id: number | string;
    /** 日志类型，参见 LoginLogTypeEnum 枚举类 */
    logType: number;
    /** 登录结果，参见 LoginResultEnum 枚举类 */
    result: number;
    /** 链路追踪编号 */
    traceId?: string;
    /** 浏览器 UserAgent */
    userAgent?: string;
    /** 用户编号 */
    userId?: number | string;
    /** 用户 IP */
    userIp: string;
    /** 用户类型，参见 UserTypeEnum 枚举 */
    userType: number;
    /** 用户账号 */
    username: string;
  }

  /** 管理后台 - 菜单列表 Request VO */
  export interface MenuListReqVO {
    /** 菜单名称，模糊匹配 */
    name?: string;
    /** 展示状态，参见 CommonStatusEnum 枚举类 */
    status?: number;
  }

  /** 管理后台 - 菜单信息 Response VO */
  export interface MenuRespVO {
    /** 是否总是显示 */
    alwaysShow?: boolean;
    /** 组件路径,仅菜单类型为菜单时，才需要传 */
    component?: string;
    /** 组件名 */
    componentName?: string;
    /** 创建时间 */
    createTime: number;
    /** 菜单图标,仅菜单类型为菜单或者目录时，才需要传 */
    icon?: string;
    /** 菜单编号 */
    id: number | string;
    /** 是否缓存 */
    keepAlive?: boolean;
    /** 所属后台类型 */
    menuType: string;
    /** 菜单名称 */
    name: string;
    /** 父菜单 ID */
    parentId: number | string;
    /** 路由地址,仅菜单类型为菜单或者目录时，才需要传 */
    path?: string;
    /** 权限标识,仅菜单类型为按钮时，才需要传递 */
    permission?: string;
    /** 显示顺序 */
    sort: number;
    /** 状态,见 CommonStatusEnum 枚举 */
    status: number;
    /** 类型，参见 MenuTypeEnum 枚举类 */
    type: number;
    /** 是否可见 */
    visible?: boolean;
  }

  /** 管理后台 - 菜单创建/修改 Request VO */
  export interface MenuSaveVO {
    /** 是否总是显示 */
    alwaysShow?: boolean;
    /** 组件路径,仅菜单类型为菜单时，才需要传 */
    component?: string;
    /** 组件名 */
    componentName?: string;
    /** 菜单图标,仅菜单类型为菜单或者目录时，才需要传 */
    icon?: string;
    /** 菜单编号 */
    id?: number | string;
    /** 是否缓存 */
    keepAlive?: boolean;
    /** 菜单名称 */
    name: string;
    /** 父菜单 ID */
    parentId: number | string;
    /** 路由地址,仅菜单类型为菜单或者目录时，才需要传 */
    path?: string;
    /** 权限标识,仅菜单类型为按钮时，才需要传递 */
    permission?: string;
    /** 显示顺序 */
    sort: number;
    /** 状态,见 CommonStatusEnum 枚举 */
    status: number;
    /** 类型，参见 MenuTypeEnum 枚举类 */
    type: number;
    /** 是否可见 */
    visible?: boolean;
  }

  /** 管理后台 - 菜单精简信息 Response VO */
  export interface MenuSimpleRespVO {
    /** 菜单编号 */
    id: number | string;
    /** 所属后台类型 */
    menuType: string;
    /** 菜单名称 */
    name: string;
    /** 父菜单 ID */
    parentId: number | string;
    /** 类型，参见 MenuTypeEnum 枚举类 */
    type: number;
  }

  /** 管理后台 - 访问令牌分页 Request VO */
  export interface OAuth2AccessTokenPageReqVO {
    /** 客户端编号 */
    clientId: string;
    /** 页码，从 1 开始 */
    pageNo: number;
    /** 每页条数，最大值为 200 */
    pageSize: number;
    /** 排序字段 */
    sortingFields?: OpenApiSchemas.SortingField[];
    /** 用户编号 */
    userId: number | string;
    /** 用户类型，参见 UserTypeEnum 枚举 */
    userType: number;
  }

  /** 管理后台 - 访问令牌 Response VO */
  export interface OAuth2AccessTokenRespVO {
    /** 客户端编号 */
    clientId: string;
    /** 创建时间 */
    createTime: number;
    /** 过期时间 */
    expiresTime: number;
    /** 编号 */
    id: number | string;
    /** 用户编号 */
    userId: number | string;
    /** 用户类型，参见 UserTypeEnum 枚举 */
    userType: number;
  }

  /** 管理后台 - OAuth2 客户端分页 Request VO */
  export interface OAuth2ClientPageReqVO {
    /** 应用名，模糊匹配 */
    name?: string;
    /** 页码，从 1 开始 */
    pageNo: number;
    /** 每页条数，最大值为 200 */
    pageSize: number;
    /** 排序字段 */
    sortingFields?: OpenApiSchemas.SortingField[];
    /** 状态，参见 CommonStatusEnum 枚举 */
    status?: number;
  }

  /** 管理后台 - OAuth2 客户端 Response VO */
  export interface OAuth2ClientRespVO {
    /** 访问令牌的有效期 */
    accessTokenValiditySeconds: number;
    /** 附加信息 */
    additionalInformation?: string;
    /** 权限 */
    authorities?: string[];
    /** 授权类型，参见 OAuth2GrantTypeEnum 枚举 */
    authorizedGrantTypes: string[];
    /** 自动通过的授权范围 */
    autoApproveScopes?: string[];
    /** 客户端编号 */
    clientId: string;
    /** 创建时间 */
    createTime: number;
    /** 应用描述 */
    description?: string;
    /** 编号 */
    id: number | string;
    /** 应用图标 */
    logo: string;
    /** 应用名 */
    name: string;
    /** 可重定向的 URI 地址 */
    redirectUris: string[];
    /** 刷新令牌的有效期 */
    refreshTokenValiditySeconds: number;
    /** 资源 */
    resourceIds?: string[];
    /** 授权范围 */
    scopes?: string[];
    /** 状态，参见 CommonStatusEnum 枚举 */
    status: number;
  }

  /** 管理后台 - OAuth2 客户端创建/修改 Request VO */
  export interface OAuth2ClientSaveReqVO {
    /** 访问令牌的有效期 */
    accessTokenValiditySeconds: number;
    /** 附加信息 */
    additionalInformation?: string;
    /** 权限 */
    authorities?: string[];
    /** 授权类型，参见 OAuth2GrantTypeEnum 枚举 */
    authorizedGrantTypes: string[];
    /** 自动通过的授权范围 */
    autoApproveScopes?: string[];
    /** 客户端编号 */
    clientId: string;
    /** 应用描述 */
    description?: string;
    /** 编号 */
    id?: number | string;
    /** 应用图标 */
    logo: string;
    /** 应用名 */
    name: string;
    /** 可重定向的 URI 地址 */
    redirectUris: string[];
    /** 刷新令牌的有效期 */
    refreshTokenValiditySeconds: number;
    /** 资源 */
    resourceIds?: string[];
    /** 授权范围 */
    scopes?: string[];
    /** 客户端密钥；创建时必填，更新时留空表示不变 */
    secret?: string;
    /** 状态，参见 CommonStatusEnum 枚举 */
    status: number;
  }

  /** 开放接口 - OAuth2 客户端模式令牌 Response VO */
  export interface OAuth2OpenTokenRespVO {
    /** 访问令牌 */
    accessToken: string;
    /** 访问令牌剩余有效秒数 */
    expiresIn: number | string;
    /** 刷新令牌 */
    refreshToken: string;
    /** 实际授权范围 */
    scope: string;
    /** 令牌类型 */
    tokenType: string;
  }

  /** 管理后台 - OAuth2 获得用户基本信息 Response VO */
  export interface OAuth2UserInfoRespVO {
    /** 用户头像 */
    avatar?: string;
    dept?: OpenApiSchemas.OAuth2UserInfoRespVO_Dept;
    /** 用户邮箱 */
    email?: string;
    /** 用户编号 */
    id: number | string;
    /** 手机号码 */
    mobile?: string;
    /** 用户昵称 */
    nickname: string;
    posts?: OpenApiSchemas.OAuth2UserInfoRespVO_Post[];
    /** 用户性别，参见 SexEnum 枚举类 */
    sex?: number;
    /** 用户账号 */
    username: string;
  }

  /** 部门 */
  export interface OAuth2UserInfoRespVO_Dept {
    /** 部门编号 */
    id: number | string;
    /** 部门名称 */
    name: string;
  }

  /** 岗位 */
  export interface OAuth2UserInfoRespVO_Post {
    /** 岗位编号 */
    id: number | string;
    /** 岗位名称 */
    name: string;
  }

  /** 管理后台 - OAuth2 更新用户基本信息 Request VO */
  export interface OAuth2UserUpdateReqVO {
    /** 用户邮箱 */
    email?: string;
    /** 手机号 */
    mobile?: string;
    /** 用户昵称 */
    nickname: string;
    /** 用户性别，参见 SexEnum 枚举类 */
    sex?: number;
  }

  /** 管理后台 - 操作日志分页列表 Request VO */
  export interface OperateLogPageReqVO {
    /** 操作明细，模拟匹配 */
    action?: string;
    /** 操作模块业务编号 */
    bizId?: number | string;
    /** 开始时间 */
    createTime?: number[];
    /** 页码，从 1 开始 */
    pageNo: number;
    /** 每页条数，最大值为 200 */
    pageSize: number;
    /** 排序字段 */
    sortingFields?: OpenApiSchemas.SortingField[];
    /** 操作名，模拟匹配 */
    subType?: string;
    /** 操作模块，模拟匹配 */
    type?: string;
    /** 用户编号 */
    userId?: number | string;
  }

  /** 管理后台 - 操作日志 Response VO */
  export interface OperateLogRespVO {
    /** 操作明细 */
    action?: string;
    /** 操作模块业务编号 */
    bizId: number | string;
    /** 创建时间 */
    createTime: number;
    /** 拓展字段 */
    extra?: string;
    /** 日志编号 */
    id: number | string;
    /** 请求方法名 */
    requestMethod: string;
    /** 请求地址 */
    requestUrl: string;
    /** 操作名 */
    subType: string;
    /** 链路追踪编号 */
    traceId: string;
    /** 操作模块类型 */
    type: string;
    /** 浏览器 UserAgent */
    userAgent: string;
    /** 用户编号 */
    userId: number | string;
    /** 用户 IP */
    userIp: string;
    /** 用户昵称 */
    userName: string;
    /** 用户类型 */
    userType: number;
  }

  /** 分页结果 */
  export interface PageResult_ConfigRespVO {
    /** 数据 */
    list: OpenApiSchemas.ConfigRespVO[];
    /** 总量 */
    total: number | string;
  }

  /** 分页结果 */
  export interface PageResult_DictDataRespVO {
    /** 数据 */
    list: OpenApiSchemas.DictDataRespVO[];
    /** 总量 */
    total: number | string;
  }

  /** 分页结果 */
  export interface PageResult_DictTypeRespVO {
    /** 数据 */
    list: OpenApiSchemas.DictTypeRespVO[];
    /** 总量 */
    total: number | string;
  }

  /** 分页结果 */
  export interface PageResult_FileRespVO {
    /** 数据 */
    list: OpenApiSchemas.FileRespVO[];
    /** 总量 */
    total: number | string;
  }

  /** 分页结果 */
  export interface PageResult_JobLogRespVO {
    /** 数据 */
    list: OpenApiSchemas.JobLogRespVO[];
    /** 总量 */
    total: number | string;
  }

  /** 分页结果 */
  export interface PageResult_JobRespVO {
    /** 数据 */
    list: OpenApiSchemas.JobRespVO[];
    /** 总量 */
    total: number | string;
  }

  /** 分页结果 */
  export interface PageResult_LoginLogRespVO {
    /** 数据 */
    list: OpenApiSchemas.LoginLogRespVO[];
    /** 总量 */
    total: number | string;
  }

  /** 分页结果 */
  export interface PageResult_OAuth2AccessTokenRespVO {
    /** 数据 */
    list: OpenApiSchemas.OAuth2AccessTokenRespVO[];
    /** 总量 */
    total: number | string;
  }

  /** 分页结果 */
  export interface PageResult_OAuth2ClientRespVO {
    /** 数据 */
    list: OpenApiSchemas.OAuth2ClientRespVO[];
    /** 总量 */
    total: number | string;
  }

  /** 分页结果 */
  export interface PageResult_OperateLogRespVO {
    /** 数据 */
    list: OpenApiSchemas.OperateLogRespVO[];
    /** 总量 */
    total: number | string;
  }

  /** 分页结果 */
  export interface PageResult_PostRespVO {
    /** 数据 */
    list: OpenApiSchemas.PostRespVO[];
    /** 总量 */
    total: number | string;
  }

  /** 分页结果 */
  export interface PageResult_RoleRespVO {
    /** 数据 */
    list: OpenApiSchemas.RoleRespVO[];
    /** 总量 */
    total: number | string;
  }

  /** 分页结果 */
  export interface PageResult_SmsChannelRespVO {
    /** 数据 */
    list: OpenApiSchemas.SmsChannelRespVO[];
    /** 总量 */
    total: number | string;
  }

  /** 分页结果 */
  export interface PageResult_SmsTemplateRespVO {
    /** 数据 */
    list: OpenApiSchemas.SmsTemplateRespVO[];
    /** 总量 */
    total: number | string;
  }

  /** 分页结果 */
  export interface PageResult_UserRespVO {
    /** 数据 */
    list: OpenApiSchemas.UserRespVO[];
    /** 总量 */
    total: number | string;
  }

  /** 管理后台 - 赋予角色数据权限 Request VO */
  export interface PermissionAssignRoleDataScopeReqVO {
    /** 数据范围，参见 DataScopeEnum 枚举类 */
    dataScope: number;
    /** 部门编号列表，只有范围类型为 DEPT_CUSTOM 时，该字段才需要 */
    dataScopeDeptIds?: (number | string)[];
    /** 角色编号 */
    roleId: number | string;
  }

  /** 管理后台 - 赋予角色菜单 Request VO */
  export interface PermissionAssignRoleMenuReqVO {
    /** 菜单编号列表 */
    menuIds?: (number | string)[];
    /** 角色编号 */
    roleId: number | string;
  }

  /** 管理后台 - 赋予用户角色 Request VO */
  export interface PermissionAssignUserRoleReqVO {
    /** 角色编号列表 */
    roleIds?: (number | string)[];
    /** 用户编号 */
    userId: number | string;
  }

  export interface Point {
    x: number;
    y: number;
  }

  export interface PointVO {
    secretKey?: string;
    x: number;
    y: number;
  }

  /** 管理后台 - 岗位分页 Request VO */
  export interface PostPageReqVO {
    /** 岗位编码，模糊匹配 */
    code?: string;
    /** 岗位名称，模糊匹配 */
    name?: string;
    /** 页码，从 1 开始 */
    pageNo: number;
    /** 每页条数，最大值为 200 */
    pageSize: number;
    /** 排序字段 */
    sortingFields?: OpenApiSchemas.SortingField[];
    /** 展示状态，参见 CommonStatusEnum 枚举类 */
    status?: number;
  }

  /** 管理后台 - 岗位信息 Response VO */
  export interface PostRespVO {
    /** 岗位编码 */
    code: string;
    /** 创建时间 */
    createTime: number;
    /** 岗位序号 */
    id: number | string;
    /** 岗位名称 */
    name: string;
    /** 备注 */
    remark?: string;
    /** 显示顺序 */
    sort: number;
    /** 状态，参见 CommonStatusEnum 枚举类 */
    status: number;
  }

  /** 管理后台 - 岗位创建/修改 Request VO */
  export interface PostSaveReqVO {
    /** 岗位编码 */
    code: string;
    /** 岗位编号 */
    id?: number | string;
    /** 岗位名称 */
    name: string;
    /** 备注 */
    remark?: string;
    /** 显示顺序 */
    sort: number;
    /** 状态 */
    status: number;
  }

  /** 管理后台 - 岗位信息的精简 Response VO */
  export interface PostSimpleRespVO {
    /** 岗位序号 */
    id: number | string;
    /** 岗位名称 */
    name: string;
  }

  export interface ResponseModel {
    repCode?: string;
    repData?: Record<string, unknown>;
    repMsg?: string;
  }

  /** 管理后台 - 角色分页 Request VO */
  export interface RolePageReqVO {
    /** 角色标识，模糊匹配 */
    code?: string;
    /** 创建时间 */
    createTime?: number[];
    /** 角色名称，模糊匹配 */
    name?: string;
    /** 页码，从 1 开始 */
    pageNo: number;
    /** 每页条数，最大值为 200 */
    pageSize: number;
    /** 排序字段 */
    sortingFields?: OpenApiSchemas.SortingField[];
    /** 展示状态，参见 CommonStatusEnum 枚举类 */
    status?: number;
  }

  /** 管理后台 - 角色信息 Response VO */
  export interface RoleRespVO {
    /** 角色标志 */
    code: string;
    /** 创建时间 */
    createTime: number;
    /** 数据范围，参见 DataScopeEnum 枚举类 */
    dataScope: number;
    /** 数据范围(指定部门数组) */
    dataScopeDeptIds?: (number | string)[];
    /** 角色编号 */
    id: number | string;
    /** 角色名称 */
    name: string;
    /** 备注 */
    remark?: string;
    /** 所属后台类型 */
    roleType: string;
    /** 显示顺序 */
    sort: number;
    /** 状态，参见 CommonStatusEnum 枚举类 */
    status: number;
    /** 角色类型，参见 RoleTypeEnum 枚举类 */
    type: number;
  }

  /** 管理后台 - 角色创建/更新 Request VO */
  export interface RoleSaveReqVO {
    /** 角色标志 */
    code: string;
    /** 角色编号 */
    id?: number | string;
    /** 角色名称 */
    name: string;
    /** 备注 */
    remark?: string;
    /** 显示顺序 */
    sort: number;
    /** 状态 */
    status: number;
  }

  /** 管理后台 - 角色精简信息 Response VO */
  export interface RoleSimpleRespVO {
    /** 角色编号 */
    id: number | string;
    /** 角色名称 */
    name: string;
    /** 角色状态 */
    status: number;
  }

  /** 管理后台 - SM2 密码传输公钥 Response VO */
  export interface Sm2PublicKeyRespVO {
    /** 密文模式，1=C1C3C2 */
    cipherMode: number;
    /** SM2 公钥（04 前缀十六进制） */
    publicKey: string;
  }

  /** 管理后台 - 短信渠道分页 Request VO */
  export interface SmsChannelPageReqVO {
    /** 短信渠道编码 */
    code?: string;
    /** 创建时间 */
    createTime?: number[];
    /** 页码，从 1 开始 */
    pageNo: number;
    /** 每页条数，最大值为 200 */
    pageSize: number;
    /** 短信签名，模糊匹配 */
    signature?: string;
    /** 排序字段 */
    sortingFields?: OpenApiSchemas.SortingField[];
    /** 任务状态 */
    status?: number;
  }

  /** 管理后台 - 短信渠道 Response VO */
  export interface SmsChannelRespVO {
    /** 短信 API 的账号 */
    apiKey: string;
    /** 是否已配置短信 API 密钥 */
    apiSecretConfigured: boolean;
    /** 短信发送回调 URL */
    callbackUrl?: string;
    /** 渠道编码，参见 SmsChannelEnum 枚举类 */
    code: string;
    /** 创建时间 */
    createTime: number;
    /** 编号 */
    id: number | string;
    /** 备注 */
    remark?: string;
    /** 短信签名 */
    signature: string;
    /** 启用状态 */
    status: number;
  }

  /** 管理后台 - 短信渠道创建/修改 Request VO */
  export interface SmsChannelSaveReqVO {
    /** 短信 API 的账号 */
    apiKey: string;
    /** 短信 API 的密钥；更新时留空表示保持原密钥不变 */
    apiSecret?: string;
    /** 短信发送回调 URL */
    callbackUrl?: string;
    /** 渠道编码，参见 SmsChannelEnum 枚举类 */
    code: string;
    /** 编号 */
    id?: number | string;
    /** 备注 */
    remark?: string;
    /** 短信签名 */
    signature: string;
    /** 启用状态 */
    status: number;
  }

  /** 管理后台 - 短信渠道精简 Response VO */
  export interface SmsChannelSimpleRespVO {
    /** 渠道编码，参见 SmsChannelEnum 枚举类 */
    code: string;
    /** 编号 */
    id: number | string;
    /** 短信签名 */
    signature: string;
  }

  /** 管理后台 - 短信模板分页 Request VO */
  export interface SmsTemplatePageReqVO {
    /** 短信 API 的模板编号，模糊匹配 */
    apiTemplateId?: string;
    /** 短信渠道编号 */
    channelId?: number | string;
    /** 模板编码，模糊匹配 */
    code?: string;
    /** 模板内容，模糊匹配 */
    content?: string;
    /** 创建时间 */
    createTime?: number[];
    /** 页码，从 1 开始 */
    pageNo: number;
    /** 每页条数，最大值为 200 */
    pageSize: number;
    /** 排序字段 */
    sortingFields?: OpenApiSchemas.SortingField[];
    /** 开启状态 */
    status?: number;
    /** 短信签名 */
    type?: number;
  }

  /** 管理后台 - 短信模板 Response VO */
  export interface SmsTemplateRespVO {
    /** 短信 API 的模板编号 */
    apiTemplateId: string;
    /** 短信渠道编码 */
    channelCode: string;
    /** 短信渠道编号 */
    channelId: number | string;
    /** 模板编码 */
    code: string;
    /** 模板内容 */
    content: string;
    /** 创建时间 */
    createTime: number;
    /** 编号 */
    id: number | string;
    /** 模板名称 */
    name: string;
    /** 参数数组 */
    params?: string[];
    /** 备注 */
    remark?: string;
    /** 开启状态，参见 CommonStatusEnum 枚举类 */
    status: number;
    /** 短信类型，参见 SmsTemplateTypeEnum 枚举类 */
    type: number;
  }

  /** 管理后台 - 短信模板创建/修改 Request VO */
  export interface SmsTemplateSaveReqVO {
    /** 短信 API 的模板编号 */
    apiTemplateId: string;
    /** 短信渠道编号 */
    channelId: number | string;
    /** 模板编码 */
    code: string;
    /** 模板内容 */
    content: string;
    /** 编号 */
    id?: number | string;
    /** 模板名称 */
    name: string;
    /** 备注 */
    remark?: string;
    /** 开启状态，参见 CommonStatusEnum 枚举类 */
    status: number;
    /** 短信类型，参见 SmsTemplateTypeEnum 枚举类 */
    type: number;
  }

  /** 管理后台 - 短信模板发送 Request VO */
  export interface SmsTemplateSendReqVO {
    /** 手机号 */
    mobile: string;
    /** 模板编码 */
    templateCode: string;
    /** 模板参数 */
    templateParams?: Record<string, Record<string, unknown>>;
  }

  export interface SortingField {
    field?: string;
    order?: string;
  }

  export interface TencentSmsCallbackRespVO {
    errmsg?: string;
    result?: number;
  }

  /** 管理后台 - 用户导入 Response VO */
  export interface UserImportRespVO {
    /** 创建成功的用户名数组 */
    createUsernames: string[];
    /** 导入失败的用户集合，key 为用户名，value 为失败原因 */
    failureUsernames: Record<string, string>;
    /** 更新成功的用户名数组 */
    updateUsernames: string[];
  }

  /** 管理后台 - 用户分页 Request VO */
  export interface UserPageReqVO {
    /** 创建时间 */
    createTime?: number[];
    /** 部门编号，同时筛选子部门 */
    deptId?: number | string;
    /** 手机号码，模糊匹配 */
    mobile?: string;
    /** 页码，从 1 开始 */
    pageNo: number;
    /** 每页条数，最大值为 200 */
    pageSize: number;
    /** 角色编号 */
    roleId?: number | string;
    /** 排序字段 */
    sortingFields?: OpenApiSchemas.SortingField[];
    /** 展示状态，参见 CommonStatusEnum 枚举类 */
    status?: number;
    /** 用户账号，模糊匹配 */
    username?: string;
  }

  /** 管理后台 - 用户个人中心信息 Response VO */
  export interface UserProfileRespVO {
    /** 用户头像 */
    avatar?: string;
    /** 创建时间 */
    createTime: number;
    dept?: OpenApiSchemas.DeptSimpleRespVO;
    /** 用户邮箱 */
    email?: string;
    /** 用户编号 */
    id: number | string;
    /** 最后登录时间 */
    loginDate: number;
    /** 最后登录 IP */
    loginIp: string;
    /** 手机号码 */
    mobile?: string;
    /** 用户昵称 */
    nickname: string;
    posts?: OpenApiSchemas.PostSimpleRespVO[];
    roles?: OpenApiSchemas.RoleSimpleRespVO[];
    /** 用户性别，参见 SexEnum 枚举类 */
    sex?: number;
    /** 用户账号 */
    username: string;
  }

  /** 管理后台 - 用户个人中心更新密码 Request VO */
  export interface UserProfileUpdatePasswordReqVO {
    /** 新密码的 SM2 密文（C1C3C2） */
    newPassword: string;
    /** 旧密码的 SM2 密文（C1C3C2） */
    oldPassword: string;
  }

  /** 管理后台 - 用户个人信息更新 Request VO */
  export interface UserProfileUpdateReqVO {
    /** 角色头像 */
    avatar?: string;
    /** 用户邮箱 */
    email?: string;
    /** 手机号 */
    mobile?: string;
    /** 用户昵称 */
    nickname?: string;
    /** 用户性别，参见 SexEnum 枚举类 */
    sex?: number;
  }

  /** 管理后台 - 用户信息 Response VO */
  export interface UserRespVO {
    /** 用户头像 */
    avatar?: string;
    /** 创建时间 */
    createTime: number;
    /** 部门ID */
    deptId?: number | string;
    /** 部门名称 */
    deptName?: string;
    /** 用户邮箱 */
    email?: string;
    /** 用户编号 */
    id: number | string;
    /** 最后登录时间 */
    loginDate: number;
    /** 最后登录 IP */
    loginIp: string;
    /** 手机号码 */
    mobile?: string;
    /** 用户昵称 */
    nickname: string;
    /** 岗位编号数组 */
    postIds?: (number | string)[];
    /** 备注 */
    remark?: string;
    /** 当前平台已分配角色名称 */
    roleNames?: string[];
    /** 用户性别，参见 SexEnum 枚举类 */
    sex?: number;
    /** 状态，参见 CommonStatusEnum 枚举类 */
    status: number;
    /** 所属后台类型 */
    userType: string;
    /** 用户账号 */
    username: string;
  }

  /** 管理后台 - 用户创建/修改 Request VO */
  export interface UserSaveReqVO {
    /** 用户头像 */
    avatar?: string;
    /** 部门编号 */
    deptId?: number | string;
    /** 用户邮箱 */
    email?: string;
    /** 用户编号 */
    id?: number | string;
    /** 手机号 */
    mobile?: string;
    /** 用户昵称 */
    nickname: string;
    /** SM2 密码密文（C1C3C2） */
    password: string;
    /** 岗位编号数组 */
    postIds?: (number | string)[];
    /** 备注 */
    remark?: string;
    /** 用户性别，参见 SexEnum 枚举类 */
    sex?: number;
    /** 用户状态，参见 CommonStatusEnum 枚举类 */
    status?: number;
    /** 用户账号 */
    username: string;
  }

  /** 管理后台 - 用户精简信息 Response VO */
  export interface UserSimpleRespVO {
    /** 部门ID */
    deptId?: number | string;
    /** 部门名称 */
    deptName?: string;
    /** 用户编号 */
    id: number | string;
    /** 用户昵称 */
    nickname: string;
  }

  /** 管理后台 - 用户更新密码 Request VO */
  export interface UserUpdatePasswordReqVO {
    /** 用户编号 */
    id: number | string;
    /** SM2 密码密文（C1C3C2） */
    password: string;
  }

  /** 管理后台 - 用户更新状态 Request VO */
  export interface UserUpdateStatusReqVO {
    /** 用户编号 */
    id: number | string;
    /** 状态，见 CommonStatusEnum 枚举 */
    status: number;
  }

}

export interface OpenApiPaths {
  "/admin-api/infra/config/create": {
    /** 创建参数配置 */
    post: { body: OpenApiSchemas.ConfigSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Long };
  };
  "/admin-api/infra/config/delete": {
    /** 删除参数配置 */
    delete: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/infra/config/delete-list": {
    /** 批量删除参数配置 */
    delete: { body: never; query: { ids: (number | string)[] }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/infra/config/export-excel": {
    /** 导出参数配置 */
    get: { body: never; query: { createTime?: number[]; key?: string; name?: string; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; type?: number }; response: void };
  };
  "/admin-api/infra/config/get": {
    /** 获得参数配置 */
    get: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_ConfigRespVO };
  };
  "/admin-api/infra/config/get-value-by-key": {
    /** 根据参数键名查询参数值 */
    get: { body: never; query: { key: string }; response: OpenApiSchemas.CommonResult_String };
  };
  "/admin-api/infra/config/page": {
    /** 获取参数配置分页 */
    get: { body: never; query: { createTime?: number[]; key?: string; name?: string; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; type?: number }; response: OpenApiSchemas.CommonResult_PageResult_ConfigRespVO };
  };
  "/admin-api/infra/config/update": {
    /** 修改参数配置 */
    put: { body: OpenApiSchemas.ConfigSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/infra/file/content/**": {
    /** 下载文件 */
    get: { body: never; query: never; response: void };
  };
  "/admin-api/infra/file/create": {
    /** 创建文件 */
    post: { body: OpenApiSchemas.FileCreateReqVO; query: never; response: OpenApiSchemas.CommonResult_Long };
  };
  "/admin-api/infra/file/delete": {
    /** 删除文件 */
    delete: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/infra/file/delete-list": {
    /** 批量删除文件 */
    delete: { body: never; query: { ids: (number | string)[] }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/infra/file/get": {
    /** 获得文件 */
    get: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_FileRespVO };
  };
  "/admin-api/infra/file/page": {
    /** 获得文件分页 */
    get: { body: never; query: { createTime?: number[]; pageNo: number; pageSize: number; path?: string; sortingFields?: OpenApiSchemas.SortingField[]; type?: string }; response: OpenApiSchemas.CommonResult_PageResult_FileRespVO };
  };
  "/admin-api/infra/file/presigned-url": {
    /** 获取文件预签名地址（上传） */
    get: { body: never; query: { name: string; directory?: string }; response: OpenApiSchemas.CommonResult_FilePresignedUrlRespVO };
  };
  "/admin-api/infra/file/upload": {
    /** 上传文件 */
    post: { body: OpenApiSchemas.FileUploadReqVO; query: never; response: OpenApiSchemas.CommonResult_String };
  };
  "/admin-api/infra/job-log/export-excel": {
    /** 导出定时任务日志 Excel */
    get: { body: never; query: { beginTime?: number; endTime?: number; handlerName?: string; jobId?: number | string; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; status?: number }; response: void };
  };
  "/admin-api/infra/job-log/get": {
    /** 获得定时任务日志 */
    get: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_JobLogRespVO };
  };
  "/admin-api/infra/job-log/page": {
    /** 获得定时任务日志分页 */
    get: { body: never; query: { beginTime?: number; endTime?: number; handlerName?: string; jobId?: number | string; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; status?: number }; response: OpenApiSchemas.CommonResult_PageResult_JobLogRespVO };
  };
  "/admin-api/infra/job/create": {
    /** 创建定时任务 */
    post: { body: OpenApiSchemas.JobSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Long };
  };
  "/admin-api/infra/job/delete": {
    /** 删除定时任务 */
    delete: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/infra/job/delete-list": {
    /** 批量删除定时任务 */
    delete: { body: never; query: { ids: (number | string)[] }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/infra/job/export-excel": {
    /** 导出定时任务 Excel */
    get: { body: never; query: { handlerName?: string; name?: string; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; status?: number }; response: void };
  };
  "/admin-api/infra/job/get": {
    /** 获得定时任务 */
    get: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_JobRespVO };
  };
  "/admin-api/infra/job/get_next_times": {
    /** 获得定时任务的下 n 次执行时间 */
    get: { body: never; query: { id: number | string; count?: number }; response: OpenApiSchemas.CommonResult_List_LocalDateTime };
  };
  "/admin-api/infra/job/page": {
    /** 获得定时任务分页 */
    get: { body: never; query: { handlerName?: string; name?: string; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; status?: number }; response: OpenApiSchemas.CommonResult_PageResult_JobRespVO };
  };
  "/admin-api/infra/job/sync": {
    /** 同步定时任务 */
    post: { body: never; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/infra/job/trigger": {
    /** 触发定时任务 */
    put: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/infra/job/update": {
    /** 更新定时任务 */
    put: { body: OpenApiSchemas.JobSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/infra/job/update-status": {
    /** 更新定时任务的状态 */
    put: { body: never; query: { id: number | string; status: number }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/area/get-by-ip": {
    /** 获得 IP 对应的地区名 */
    get: { body: never; query: { ip: string }; response: OpenApiSchemas.CommonResult_String };
  };
  "/admin-api/system/area/tree": {
    /** 获得地区树 */
    get: { body: never; query: never; response: OpenApiSchemas.CommonResult_List_AreaNodeRespVO };
  };
  "/admin-api/system/auth/get-permission-info": {
    /** 获取登录用户的权限信息 */
    get: { body: never; query: never; response: OpenApiSchemas.CommonResult_AuthPermissionInfoRespVO };
  };
  "/admin-api/system/auth/login": {
    /** 使用账号密码登录 */
    post: { body: OpenApiSchemas.AuthLoginReqVO; query: never; response: OpenApiSchemas.CommonResult_AuthLoginRespVO };
  };
  "/admin-api/system/auth/logout": {
    /** 登出系统 */
    post: { body: never; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/auth/refresh-token": {
    /** 刷新令牌 */
    post: { body: OpenApiSchemas.AuthRefreshTokenReqVO; query: never; response: OpenApiSchemas.CommonResult_AuthLoginRespVO };
  };
  "/admin-api/system/auth/reset-password": {
    /** 重置密码 */
    post: { body: OpenApiSchemas.AuthResetPasswordReqVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/auth/send-sms-code": {
    /** 发送手机验证码 */
    post: { body: OpenApiSchemas.AuthSmsSendReqVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/auth/sm2-public-key": {
    /** 获取密码传输 SM2 公钥 */
    get: { body: never; query: never; response: OpenApiSchemas.CommonResult_Sm2PublicKeyRespVO };
  };
  "/admin-api/system/auth/sms-login": {
    /** 使用短信验证码登录 */
    post: { body: OpenApiSchemas.AuthSmsLoginReqVO; query: never; response: OpenApiSchemas.CommonResult_AuthLoginRespVO };
  };
  "/admin-api/system/auth/super-admin-login": {
    /** 超级管理平台账号密码登录 */
    post: { body: OpenApiSchemas.AuthLoginReqVO; query: never; response: OpenApiSchemas.CommonResult_AuthLoginRespVO };
  };
  "/admin-api/system/captcha/check": {
    /** 校验验证码 */
    post: { body: OpenApiSchemas.CaptchaVO; query: never; response: OpenApiSchemas.ResponseModel };
  };
  "/admin-api/system/captcha/get": {
    /** 获得验证码 */
    post: { body: OpenApiSchemas.CaptchaVO; query: never; response: OpenApiSchemas.ResponseModel };
  };
  "/admin-api/system/dept/create": {
    /** 创建部门 */
    post: { body: OpenApiSchemas.DeptSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Long };
  };
  "/admin-api/system/dept/delete": {
    /** 删除部门 */
    delete: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/dept/delete-list": {
    /** 批量删除部门 */
    delete: { body: never; query: { ids: (number | string)[] }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/dept/get": {
    /** 获得部门信息 */
    get: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_DeptRespVO };
  };
  "/admin-api/system/dept/list": {
    /** 获取部门列表 */
    get: { body: never; query: { name?: string; status?: number }; response: OpenApiSchemas.CommonResult_List_DeptRespVO };
  };
  "/admin-api/system/dept/simple-list": {
    /** 获取部门精简信息列表 */
    get: { body: never; query: never; response: OpenApiSchemas.CommonResult_List_DeptSimpleRespVO };
  };
  "/admin-api/system/dept/update": {
    /** 更新部门 */
    put: { body: OpenApiSchemas.DeptSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/dict-data/create": {
    /** 新增字典数据 */
    post: { body: OpenApiSchemas.DictDataSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Long };
  };
  "/admin-api/system/dict-data/delete": {
    /** 删除字典数据 */
    delete: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/dict-data/delete-list": {
    /** 批量删除字典数据 */
    delete: { body: never; query: { ids: (number | string)[] }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/dict-data/export-excel": {
    /** 导出字典数据 */
    get: { body: never; query: { dictType?: string; label?: string; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; status?: number }; response: void };
  };
  "/admin-api/system/dict-data/get": {
    /** /查询字典数据详细 */
    get: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_DictDataRespVO };
  };
  "/admin-api/system/dict-data/page": {
    /** 获得字典类型的分页 */
    get: { body: never; query: { dictType?: string; label?: string; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; status?: number }; response: OpenApiSchemas.CommonResult_PageResult_DictDataRespVO };
  };
  "/admin-api/system/dict-data/simple-list": {
    /** 获得全部字典数据列表 */
    get: { body: never; query: never; response: OpenApiSchemas.CommonResult_List_DictDataSimpleRespVO };
  };
  "/admin-api/system/dict-data/update": {
    /** 修改字典数据 */
    put: { body: OpenApiSchemas.DictDataSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/dict-type/create": {
    /** 创建字典类型 */
    post: { body: OpenApiSchemas.DictTypeSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Long };
  };
  "/admin-api/system/dict-type/delete": {
    /** 删除字典类型 */
    delete: { body: never; query: { id?: number | string }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/dict-type/delete-list": {
    /** 批量删除字典类型 */
    delete: { body: never; query: { ids: (number | string)[] }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/dict-type/export-excel": {
    /** 导出数据类型 */
    get: { body: never; query: { createTime?: number[]; name?: string; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; status?: number; type?: string }; response: void };
  };
  "/admin-api/system/dict-type/get": {
    /** /查询字典类型详细 */
    get: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_DictTypeRespVO };
  };
  "/admin-api/system/dict-type/page": {
    /** 获得字典类型的分页列表 */
    get: { body: never; query: { createTime?: number[]; name?: string; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; status?: number; type?: string }; response: OpenApiSchemas.CommonResult_PageResult_DictTypeRespVO };
  };
  "/admin-api/system/dict-type/simple-list": {
    /** 获得全部字典类型列表 */
    get: { body: never; query: never; response: OpenApiSchemas.CommonResult_List_DictTypeSimpleRespVO };
  };
  "/admin-api/system/dict-type/update": {
    /** 修改字典类型 */
    put: { body: OpenApiSchemas.DictTypeSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/login-log/export-excel": {
    /** 导出登录日志 Excel */
    get: { body: never; query: { createTime?: number[]; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; status?: boolean; userIp?: string; username?: string }; response: void };
  };
  "/admin-api/system/login-log/get": {
    /** 获得登录日志 */
    get: { body: never; query: { id?: number | string }; response: OpenApiSchemas.CommonResult_LoginLogRespVO };
  };
  "/admin-api/system/login-log/page": {
    /** 获得登录日志分页列表 */
    get: { body: never; query: { createTime?: number[]; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; status?: boolean; userIp?: string; username?: string }; response: OpenApiSchemas.CommonResult_PageResult_LoginLogRespVO };
  };
  "/admin-api/system/menu/create": {
    /** 创建菜单 */
    post: { body: OpenApiSchemas.MenuSaveVO; query: never; response: OpenApiSchemas.CommonResult_Long };
  };
  "/admin-api/system/menu/delete": {
    /** 删除菜单 */
    delete: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/menu/delete-list": {
    /** 批量删除菜单 */
    delete: { body: never; query: { ids: (number | string)[] }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/menu/get": {
    /** 获取菜单信息 */
    get: { body: never; query: { id?: number | string }; response: OpenApiSchemas.CommonResult_MenuRespVO };
  };
  "/admin-api/system/menu/list": {
    /** 获取菜单列表 */
    get: { body: never; query: { name?: string; status?: number }; response: OpenApiSchemas.CommonResult_List_MenuRespVO };
  };
  "/admin-api/system/menu/simple-list": {
    /** 获取菜单精简信息列表 */
    get: { body: never; query: never; response: OpenApiSchemas.CommonResult_List_MenuSimpleRespVO };
  };
  "/admin-api/system/menu/update": {
    /** 修改菜单 */
    put: { body: OpenApiSchemas.MenuSaveVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/oauth2-client/create": {
    /** 创建 OAuth2 客户端 */
    post: { body: OpenApiSchemas.OAuth2ClientSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Long };
  };
  "/admin-api/system/oauth2-client/delete": {
    /** 删除 OAuth2 客户端 */
    delete: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/oauth2-client/delete-list": {
    /** 批量删除 OAuth2 客户端 */
    delete: { body: never; query: { ids: (number | string)[] }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/oauth2-client/get": {
    /** 获得 OAuth2 客户端 */
    get: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_OAuth2ClientRespVO };
  };
  "/admin-api/system/oauth2-client/page": {
    /** 获得 OAuth2 客户端分页 */
    get: { body: never; query: { name?: string; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; status?: number }; response: OpenApiSchemas.CommonResult_PageResult_OAuth2ClientRespVO };
  };
  "/admin-api/system/oauth2-client/update": {
    /** 更新 OAuth2 客户端 */
    put: { body: OpenApiSchemas.OAuth2ClientSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/oauth2-token/delete": {
    /** 删除访问令牌 */
    delete: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/oauth2-token/delete-list": {
    /** 批量删除访问令牌 */
    delete: { body: never; query: { ids: (number | string)[] }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/oauth2-token/page": {
    /** 获得访问令牌分页 */
    get: { body: never; query: { clientId: string; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; userId: number | string; userType: number }; response: OpenApiSchemas.CommonResult_PageResult_OAuth2AccessTokenRespVO };
  };
  "/admin-api/system/oauth2/user/get": {
    /** 获得用户基本信息 */
    get: { body: never; query: never; response: OpenApiSchemas.CommonResult_OAuth2UserInfoRespVO };
  };
  "/admin-api/system/oauth2/user/update": {
    /** 更新用户基本信息 */
    put: { body: OpenApiSchemas.OAuth2UserUpdateReqVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/operate-log/export-excel": {
    /** 导出操作日志 */
    get: { body: never; query: { action?: string; bizId?: number | string; createTime?: number[]; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; subType?: string; type?: string; userId?: number | string }; response: void };
  };
  "/admin-api/system/operate-log/get": {
    /** 查看操作日志 */
    get: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_OperateLogRespVO };
  };
  "/admin-api/system/operate-log/page": {
    /** 查看操作日志分页列表 */
    get: { body: never; query: { action?: string; bizId?: number | string; createTime?: number[]; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; subType?: string; type?: string; userId?: number | string }; response: OpenApiSchemas.CommonResult_PageResult_OperateLogRespVO };
  };
  "/admin-api/system/permission/assign-role-data-scope": {
    /** 赋予角色数据权限 */
    post: { body: OpenApiSchemas.PermissionAssignRoleDataScopeReqVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/permission/assign-role-menu": {
    /** 赋予角色菜单 */
    post: { body: OpenApiSchemas.PermissionAssignRoleMenuReqVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/permission/assign-user-role": {
    /** 赋予用户角色 */
    post: { body: OpenApiSchemas.PermissionAssignUserRoleReqVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/permission/list-role-menus": {
    /** 获得角色拥有的菜单编号 */
    get: { body: never; query: { roleId?: number | string }; response: OpenApiSchemas.CommonResult_Set_Long };
  };
  "/admin-api/system/permission/list-user-roles": {
    /** 获得管理员拥有的角色编号列表 */
    get: { body: never; query: { userId: number | string }; response: OpenApiSchemas.CommonResult_Set_Long };
  };
  "/admin-api/system/post/create": {
    /** 创建岗位 */
    post: { body: OpenApiSchemas.PostSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Long };
  };
  "/admin-api/system/post/delete": {
    /** 删除岗位 */
    delete: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/post/delete-list": {
    /** 批量删除岗位 */
    delete: { body: never; query: { ids: (number | string)[] }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/post/export-excel": {
    /** 岗位管理 */
    get: { body: never; query: { code?: string; name?: string; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; status?: number }; response: void };
  };
  "/admin-api/system/post/get": {
    /** 获得岗位信息 */
    get: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_PostRespVO };
  };
  "/admin-api/system/post/page": {
    /** 获得岗位分页列表 */
    get: { body: never; query: { code?: string; name?: string; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; status?: number }; response: OpenApiSchemas.CommonResult_PageResult_PostRespVO };
  };
  "/admin-api/system/post/simple-list": {
    /** 获取岗位全列表 */
    get: { body: never; query: never; response: OpenApiSchemas.CommonResult_List_PostSimpleRespVO };
  };
  "/admin-api/system/post/update": {
    /** 修改岗位 */
    put: { body: OpenApiSchemas.PostSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/role/create": {
    /** 创建角色 */
    post: { body: OpenApiSchemas.RoleSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Long };
  };
  "/admin-api/system/role/delete": {
    /** 删除角色 */
    delete: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/role/delete-list": {
    /** 批量删除角色 */
    delete: { body: never; query: { ids: (number | string)[] }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/role/export-excel": {
    /** 导出角色 Excel */
    get: { body: never; query: { code?: string; createTime?: number[]; name?: string; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; status?: number }; response: void };
  };
  "/admin-api/system/role/get": {
    /** 获得角色信息 */
    get: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_RoleRespVO };
  };
  "/admin-api/system/role/page": {
    /** 获得角色分页 */
    get: { body: never; query: { code?: string; createTime?: number[]; name?: string; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; status?: number }; response: OpenApiSchemas.CommonResult_PageResult_RoleRespVO };
  };
  "/admin-api/system/role/simple-list": {
    /** 获取角色精简信息列表 */
    get: { body: never; query: never; response: OpenApiSchemas.CommonResult_List_RoleSimpleRespVO };
  };
  "/admin-api/system/role/update": {
    /** 修改角色 */
    put: { body: OpenApiSchemas.RoleSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/sms-channel/create": {
    /** 创建短信渠道 */
    post: { body: OpenApiSchemas.SmsChannelSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Long };
  };
  "/admin-api/system/sms-channel/delete": {
    /** 删除短信渠道 */
    delete: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/sms-channel/delete-list": {
    /** 批量删除短信渠道 */
    delete: { body: never; query: { ids: (number | string)[] }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/sms-channel/get": {
    /** 获得短信渠道 */
    get: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_SmsChannelRespVO };
  };
  "/admin-api/system/sms-channel/page": {
    /** 获得短信渠道分页 */
    get: { body: never; query: { code?: string; createTime?: number[]; pageNo: number; pageSize: number; signature?: string; sortingFields?: OpenApiSchemas.SortingField[]; status?: number }; response: OpenApiSchemas.CommonResult_PageResult_SmsChannelRespVO };
  };
  "/admin-api/system/sms-channel/simple-list": {
    /** 获得短信渠道精简列表 */
    get: { body: never; query: never; response: OpenApiSchemas.CommonResult_List_SmsChannelSimpleRespVO };
  };
  "/admin-api/system/sms-channel/update": {
    /** 更新短信渠道 */
    put: { body: OpenApiSchemas.SmsChannelSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/sms-template/create": {
    /** 创建短信模板 */
    post: { body: OpenApiSchemas.SmsTemplateSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Long };
  };
  "/admin-api/system/sms-template/delete": {
    /** 删除短信模板 */
    delete: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/sms-template/delete-list": {
    /** 批量删除短信模板 */
    delete: { body: never; query: { ids: (number | string)[] }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/sms-template/export-excel": {
    /** 导出短信模板 Excel */
    get: { body: never; query: { apiTemplateId?: string; channelId?: number | string; code?: string; content?: string; createTime?: number[]; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; status?: number; type?: number }; response: void };
  };
  "/admin-api/system/sms-template/get": {
    /** 获得短信模板 */
    get: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_SmsTemplateRespVO };
  };
  "/admin-api/system/sms-template/page": {
    /** 获得短信模板分页 */
    get: { body: never; query: { apiTemplateId?: string; channelId?: number | string; code?: string; content?: string; createTime?: number[]; pageNo: number; pageSize: number; sortingFields?: OpenApiSchemas.SortingField[]; status?: number; type?: number }; response: OpenApiSchemas.CommonResult_PageResult_SmsTemplateRespVO };
  };
  "/admin-api/system/sms-template/send-sms": {
    /** 发送短信 */
    post: { body: OpenApiSchemas.SmsTemplateSendReqVO; query: never; response: OpenApiSchemas.CommonResult_Long };
  };
  "/admin-api/system/sms-template/update": {
    /** 更新短信模板 */
    put: { body: OpenApiSchemas.SmsTemplateSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/sms/callback/aliyun": {
    /** 阿里云短信的回调 */
    post: { body: never; query: never; response: OpenApiSchemas.AliyunSmsCallbackRespVO };
  };
  "/admin-api/system/sms/callback/tencent": {
    /** 腾讯云短信的回调 */
    post: { body: never; query: never; response: OpenApiSchemas.TencentSmsCallbackRespVO };
  };
  "/admin-api/system/user/create": {
    /** 新增用户 */
    post: { body: OpenApiSchemas.UserSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Long };
  };
  "/admin-api/system/user/delete": {
    /** 删除用户 */
    delete: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/user/delete-list": {
    /** 批量删除用户 */
    delete: { body: never; query: { ids: (number | string)[] }; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/user/export-excel": {
    /** 导出用户 */
    get: { body: never; query: { createTime?: number[]; deptId?: number | string; mobile?: string; pageNo: number; pageSize: number; roleId?: number | string; sortingFields?: OpenApiSchemas.SortingField[]; status?: number; username?: string }; response: void };
  };
  "/admin-api/system/user/get": {
    /** 获得用户详情 */
    get: { body: never; query: { id: number | string }; response: OpenApiSchemas.CommonResult_UserRespVO };
  };
  "/admin-api/system/user/get-import-template": {
    /** 获得导入用户模板 */
    get: { body: never; query: never; response: void };
  };
  "/admin-api/system/user/import": {
    /** 导入用户 */
    post: { body: Blob | File; query: { updateSupport?: boolean }; response: OpenApiSchemas.CommonResult_UserImportRespVO };
  };
  "/admin-api/system/user/page": {
    /** 获得用户分页列表 */
    get: { body: never; query: { createTime?: number[]; deptId?: number | string; mobile?: string; pageNo: number; pageSize: number; roleId?: number | string; sortingFields?: OpenApiSchemas.SortingField[]; status?: number; username?: string }; response: OpenApiSchemas.CommonResult_PageResult_UserRespVO };
  };
  "/admin-api/system/user/profile/get": {
    /** 获得登录用户信息 */
    get: { body: never; query: never; response: OpenApiSchemas.CommonResult_UserProfileRespVO };
  };
  "/admin-api/system/user/profile/update": {
    /** 修改用户个人信息 */
    put: { body: OpenApiSchemas.UserProfileUpdateReqVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/user/profile/update-password": {
    /** 修改用户个人密码 */
    put: { body: OpenApiSchemas.UserProfileUpdatePasswordReqVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/user/simple-list": {
    /** 获取用户精简信息列表 */
    get: { body: never; query: never; response: OpenApiSchemas.CommonResult_List_UserSimpleRespVO };
  };
  "/admin-api/system/user/update": {
    /** 修改用户 */
    put: { body: OpenApiSchemas.UserSaveReqVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/user/update-password": {
    /** 重置用户密码 */
    put: { body: OpenApiSchemas.UserUpdatePasswordReqVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/admin-api/system/user/update-status": {
    /** 修改用户状态 */
    put: { body: OpenApiSchemas.UserUpdateStatusReqVO; query: never; response: OpenApiSchemas.CommonResult_Boolean };
  };
  "/system/oauth2/token": {
    /** 第三方客户端模式获取访问令牌 */
    post: { body: never; query: { grant_type: string; client_id?: string; client_secret?: string; scope: string }; response: OpenApiSchemas.CommonResult_OAuth2OpenTokenRespVO };
  };
}
