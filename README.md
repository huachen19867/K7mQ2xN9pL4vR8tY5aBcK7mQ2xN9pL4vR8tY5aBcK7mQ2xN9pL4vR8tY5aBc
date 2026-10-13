# QAU UI Demo

青岛农业大学智慧校园请假界面的纯前端静态演示，展示「首页 → 我的申请 → 学生请销假」三页浏览链路。

[在线演示](https://huachen19867.github.io/qau-ui-demo/)

在首页点击「我的申请」，再点击申请卡片中的「查看表单」即可进入对应记录的学生请销假页面。页面中的姓名、学号、申请记录和审批内容均为演示用示例数据，不代表真实人员、申请或审批结果，也不会向学校系统提交数据。

## 新增假条

[后台入口](https://huachen19867.github.io/qau-ui-demo/admin.html)连接私有飞书多维表格。在表格新增一行，填写标题、状态、申请时间及详情，勾选“发布”后进入公开列表。选择“已批准”时，卡片右上角直接使用已有的绿色“已完成”印章素材，在“已完成”分类中可查看。

数据库为飞书 Base，管理员由飞书登录与资源权限管理。GitHub Actions 约每十分钟读取一次勾选发布的行，生成公开快照并部署；GitHub 调度可能延迟，也可在后台入口打开 Actions 手动运行。应用密钥只保存在 GitHub Secrets，浏览器只读 `leaves.json`。未发布的行不会公开，读取或校验出错时保留已有快照。

`scripts/feishu-leaves-sync.mjs` 为云端同步后端，`.github/workflows/publish.yml` 为发布工作流。需要 Secrets `FEISHU_APP_ID`、`FEISHU_APP_SECRET` 和 vars `FEISHU_BASE_TOKEN`、`FEISHU_LEAVES_TABLE_ID`；不得将密钥写入 HTML、JavaScript 配置或仓库。网页只提供演示记录的展示，不含真实学校提交或审批服务。

## 内容配置

发布目录中的 `content.json` 保存页面文案与示例内容；`pages.p1`、`pages.p3`、`pages.p4` 分别对应三页，`appBar` 控制顶部标题栏，`approvals` 控制审批示例。修改配置时需同步更新 `js/content.js` 中的 `window.QAU_CONTENT` 对象；页面优先使用这份 JavaScript 配置，保存后刷新即可查看。

## 素材来源

界面样式、图片及字体素材整理自青岛农业大学智慧校园原站页面，包含站点自定义样式和第三方组件素材。相关名称、标识与素材的权利归原权利人所有；本仓库未取得或授予这些素材的再分发、商业使用等权利授权，也不代表学校的官方服务。
