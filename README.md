# Bili QQ Bot

![License](https://img.shields.io/badge/license-ISC-blue.svg) ![Docker](https://img.shields.io/badge/docker-ready-blue) ![Node](https://img.shields.io/badge/node-%3E%3D22.12.0-green) ![Python](https://img.shields.io/badge/python-%3E%3D3.10-yellow)

基于 OneBot 11 开发的 订阅和链接解析机器人，可选 QQ 官方机器人 OpenAPI Provider。它能智能识别并解析B站各种类型的链接，并为这些内容生成高清预览卡片，还支持订阅直播/投稿推送。

## 目录

- [✨ 核心特性](#核心特性)
- [📸 预览效果](#预览效果)
- [🚀 一键快速部署](#一键快速部署)
- [🖥️ WebUI 管理面板](#webui-管理面板)
- [💬 指令列表](#指令列表)

---

## 核心特性

*   🚀 **全类型解析**：精准识别并解析以下内容
    *   视频 (BV/av)、番剧/影视 (ss/ep/md)、直播间 (live)
    *   专栏文章 (cv) - 统一渲染为紧凑预览卡，支持封面、标题、三行摘要、作者装扮与统计信息
    *   动态 (t.bilibili.com) - 支持长文、多图、转发动态，完美还原装扮卡片与粉丝编号
    *   用户主页 (space) - 展示用户数据，自动抓取并展示最新一条动态
    *   Opus 图文 (opus) - 自动区分普通动态与“文章型 opus”，文章型 opus 按专栏语义解析并渲染
    *   收藏夹、音频/歌单、话题、合集/系列、文集、笔记、课堂视频等扩展类型
    *   小程序/短链 (b23.tv) - 自动还原目标链接

*   🎨 **高颜值预览**
    *   生成精美长截图卡片，支持浅色 / 深色 / 定时深色模式，毛玻璃视觉风格
    *   智能配色：自动提取装扮卡片重点色，动态调整氛围背景
    *   专栏与动态卡片还原头像框、认证、装扮与粉丝编号等细节

*   ⬇️ **视频下载**
    *   解析到 B 站视频链接后可异步自动下载并发送 MP4（不阻塞预览卡片）
    *   支持多 P 视频续下：`/下载 P{n}`，并支持订阅推送视频下载扇出
    *   支持全局与分群配置：开关、默认分辨率、最大时长、自动清理

*   📡 **订阅推送**：内置订阅系统，支持分群订阅与同步关注分组，实时追踪 UP 主动态、视频、专栏、直播与番剧更新

*   🔌 **QQ 接入方式**
    *   默认使用 LLBot，可选择 NapCat、已有 OneBot 或 QQ 官方入口
    *   可在 WebUI 或配置中切换 QQ 官方入口，通过官方接口收发消息
    *   官方入口支持文本、图片、视频、订阅推送、基础指令与消息撤回；部分 OneBot 专属群管能力会自动隐藏或降级

*   🖥️ **WebUI 管理面板**：内置可视化管理后台，支持分群配置、QQ 连接模式、视频下载策略、订阅管理、日志查看、B站登录等操作，无需命令行

*   🐳 **Docker 一键部署**：开箱即用，无需手动安装依赖

## 预览效果

### ☀️ 浅色模式

<table align="center">
  <tr>
    <td align="center"><img src="docs/images/帮助菜单-浅色模式.webp" height="400" /><br /><b>帮助菜单</b></td>
    <td align="center"><img src="docs/images/管理菜单-浅色模式.webp" height="400" /><br /><b>管理菜单</b></td>
  </tr>
</table>

<details>
<summary><b>展开查看更多功能预览（视频、动态、用户主页...）</b></summary>
<table align="center">
  <tr>
    <td align="center"><img src="docs/images/用户卡片-浅色模式.png" height="300" /><br /><b>用户主页</b></td>
    <td align="center"><img src="docs/images/直播-浅色模式.png" height="300" /><br /><b>直播间</b></td>
    <td align="center"><img src="docs/images/动态-浅色模式.png" height="300" /><br /><b>常规动态</b></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/视频动态-浅色模式.png" height="300" /><br /><b>视频动态</b></td>
    <td align="center"><img src="docs/images/视频-浅色模式.png" height="300" /><br /><b>视频解析</b></td>
    <td align="center"><img src="docs/images/转发动态-浅色模式.png" height="300" /><br /><b>转发动态</b></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/Opus专栏-浅色模式.png" height="300" /><br /><b>Opus专栏</b></td>
    <td align="center"><img src="docs/images/番剧-浅色模式.png" height="300" /><br /><b>番剧信息</b></td>
    <td align="center"><img src="docs/images/电影-浅色模式.png" height="300" /><br /><b>电影信息</b></td>
  </tr>
</table>
</details>

### 🌙 深色模式
<table align="center">
  <tr>
    <td align="center"><img src="docs/images/帮助菜单-深色模式.webp" height="400" /><br /><b>帮助菜单</b></td>
    <td align="center"><img src="docs/images/管理菜单-深色模式.webp" height="400" /><br /><b>管理菜单</b></td>
  </tr>
</table>

<details>
<summary><b>展开查看更多功能预览（视频、动态、用户主页...）</b></summary>
<table align="center">
  <tr>
    <td align="center"><img src="docs/images/用户卡片-深色模式.png" height="300" /><br /><b>用户主页</b></td>
    <td align="center"><img src="docs/images/直播-深色模式.png" height="300" /><br /><b>直播间</b></td>
    <td align="center"><img src="docs/images/动态-深色模式.png" height="300" /><br /><b>常规动态</b></td>
    
  </tr>
  <tr>
    <td align="center"><img src="docs/images/视频动态-深色模式.png" height="300" /><br /><b>视频动态</b></td>
    <td align="center"><img src="docs/images/视频-深色模式.png" height="300" /><br /><b>视频解析</b></td>
    <td align="center"><img src="docs/images/转发动态-深色模式.png" height="300" /><br /><b>转发动态</b></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/Opus专栏-深色模式.png" height="300" /><br /><b>Opus专栏</b></td>
    <td align="center"><img src="docs/images/番剧-深色模式.png" height="300" /><br /><b>番剧信息</b></td>
    <td align="center"><img src="docs/images/电影-深色模式.png" height="300" /><br /><b>电影信息</b></td>
    
  </tr>
</table>
</details>

## 一键快速部署

*[视频教程](https://www.bilibili.com/video/BV1YsrEBVEs6/ "bilibili")*

```bash
# 从 GitHub 下载
wget -O setup.sh https://raw.githubusercontent.com/UnsplashZ/SubX-bot/refs/heads/main/setup.sh && chmod +x setup.sh && sudo ./setup.sh

# 网络受限时从代理下载
wget -O setup.sh https://gh-proxy.org/https://raw.githubusercontent.com/UnsplashZ/SubX-bot/refs/heads/main/setup.sh && chmod +x setup.sh && sudo ./setup.sh
```

首次运行按提示选择 QQ 接入方式并填写账号信息，脚本会自动生成 Compose 与 `config/config.yaml`；之后对同一安装目录再次运行同一条命令即可更新，现有配置与业务数据都会保留。

| 接入方式 | 说明 |
| --- | --- |
| LLBot（默认） | 默认 `linyuchen/llbot:latest`，扫码登录。面板绑定 `127.0.0.1:3080`，远程安装后执行 `ssh -L 3080:127.0.0.1:3080 <服务器>`，再打开本机 `http://127.0.0.1:3080`；初始面板密码在 `llbot/data/webui_token.txt`，Auth Token 获取见 [LLBot 文档](https://luckylillia.com)。 |
| NapCat | 保留 NapCat 容器、账号配置与扫码方式。 |
| QQ 官方入口 | 只部署 Bot；AppID / ClientSecret 可在安装时输入，也可稍后到 WebUI 补充。 |
| 已有 OneBot v11 | 只部署 Bot；填写从 Bot 容器可访问的 WebSocket 地址和实际 Token。 |

- 脚本不要求 QQ 登录成功：管理面板一定可用；QQ 未就绪时稍后到 WebUI 修改连接配置即可，Bot 会自动重连。
- LLBot 与已有 OneBot 模式通过 `onebot/media` 目录共享媒体文件；连接已有服务时，需把同一目录挂载到该服务的 `/app/.config/QQ/tmp`（跨主机部署需要共享文件系统）。
- 更新不会覆盖现有 Compose；同一套 `config/`、`data/` 只运行一个 Bot 容器。


## WebUI 管理面板

<details>
<summary><b>展开查看 WebUI 说明</b></summary>

部署完成后，访问 `http://<服务器IP>:3000` 即可打开 WebUI 管理面板。

### 访问说明

*   **本地访问**：`localhost` 或 `127.0.0.1` 无需额外配置，自动允许访问
*   **其他来源**：Tailscale、局域网、公网域名或 IP 都必须把完整 origin（例如 `https://bot.example.com`）逐项写入 `config/config.yaml` 的 `dashboard.allowedOrigins`

### 登录

首次访问需要输入密码登录。默认密码为 `admin`，请部署后尽快修改 `config/config.yaml` 的 `dashboard.password`。

### 功能模块

| 模块 | 说明 |
| :--- | :--- |
| **仪表盘** | 实时监控 CPU、内存、网络等系统状态，可视化图表展示 |
| **群组管理** | 分群配置：启用/禁用群组、链接冷却、标签开关、深色模式、黑名单、管理员、关注同步、视频下载（继承/覆盖） |
| **全局设置** | 常规配置（轮询间隔等）、全局黑名单、B站登录、视频下载全局策略、应用重启 |
| **实时日志** | WebSocket 实时推送应用日志，支持暂停/清空 |

> 说明：WebUI 仅管理群聊配置，暂不支持私聊会话。

</details>

## 指令列表

所有指令均以 `/` 开头，部分指令仅限管理员使用。
Root 可使用私聊能力，但私聊仅支持链接解析/下载；`/设置`、`/管理`、订阅管理指令需在群聊或 WebUI 操作。

<details>
<summary><b>展开查看完整指令列表</b></summary>

### 通用指令
| 指令 | 说明 | 作用域 | 权限 |
| :--- | :--- | :--- | :--- |
| `/菜单` / `/帮助` | 查看用户帮助菜单 | 当前群 | 所有人 |
| `/设置 帮助` | 查看管理配置面板 | 当前群 | 群管/Root |
| `/订阅列表` | 查看本群当前的订阅列表 (用户与番剧) | 当前群 | 所有人 |

### 视频下载指令
| 指令 | 参数 | 说明 | 作用域 | 权限 |
| :--- | :--- | :--- | :--- | :--- |
| `/下载 P{n}` | 例如 `P2` | 下载最近一次视频链接的指定分 P（需当前群已启用视频下载） | 当前群 | 所有人 |
| `/下载状态` | 无 | 查看下载目录文件数量与占用体积 | 当前群 | 群管/Root |
| `/清理下载` | 无 | 清理下载目录中的视频文件（有活跃任务时会拒绝） | 当前群 | 群管/Root |

### 订阅管理 (需要群管理员权限)
| 指令 | 参数 | 说明 | 作用域 |
| :--- | :--- | :--- | :--- |
| `/订阅用户` | `<UID>` | 订阅指定 UP 主的动态与直播 | **当前群** |
| `/取消订阅用户` | `<UID\|用户名>` | 取消订阅指定 UP 主 | **当前群** |
| `/订阅番剧` | `<SeasonID\|链接>` | 订阅番剧/影视更新 | **当前群** |
| `/取消订阅番剧` | `<SeasonID>` | 取消番剧订阅 | **当前群** |
| `/查询订阅` | `<UID>` | 立即检查某用户的订阅状态 (调试用) | **当前群** |

### 配置指令 (需要群管理员或 Root 权限)
> **注意**：以下指令在群聊中发送时，默认**仅对当前群生效**。
> 私聊不支持配置管理指令；如需修改全局默认配置，请在群聊使用 Root 指令或通过 WebUI 操作。

| 指令 | 参数 | 说明 | 作用域 |
| :--- | :--- | :--- | :--- |
| `/设置 登录` | (无) | 获取 B 站登录二维码（全局 Cookie；群号参数已弃用） | **当前群** |
| `/设置 验证` | `<key>` | 验证登录状态 (配合登录指令使用) | **当前群** |
| `/设置 功能` | `<开\|关> [群号]` | 开启或关闭指定群组的 Bot 响应 | Root用户可以指定群，群管仅限当前群 |
| `/设置 关注同步` | `<开\|关>` | 开启或关闭关注同步功能 | **当前群** |
| `/设置 关注同步` | `<添加\|删除> <分组>` | 管理同步的 B 站关注分组 | **当前群** |
| `/设置 推送AT全体` | `<开\|关>` | `@全体` 总开关；细粒度规则（来源/分类/UID）请在 WebUI 群组管理中配置（需要为Bot QQ管理员权限） | **当前群** |
| `/设置 黑名单` | `<添加\|移除\|列表> [QQ]` | 管理黑名单。Root 操作全局黑名单，群管理员操作本群黑名单 | **当前群** / 全局 |
| `/设置 标签` | `<类型> <开\|关>` | 开关左上角类型标签 (视频/番剧/动态等) | **当前群** |
| `/设置 冷却` | `<秒数>` | 设置相同链接解析冷却时间 | **当前群** |
| `/设置 显示UID` | `<开\|关>` | 开关卡片中 UID 的显示 | **当前群** |
| `/设置 深色模式` | `<开\|关\|定时> [时间]` | 配置深色模式。定时格式如 `21:00-07:00` | **当前群** |
| `/设置 管理员` | `<添加\|移除> <QQ>` | (仅 Root) 设置本群的管理员 | **当前群** |

</details>
