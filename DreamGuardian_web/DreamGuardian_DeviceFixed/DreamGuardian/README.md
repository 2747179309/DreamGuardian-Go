# DreamGuardian NX 网页组交付包 v5

交付日期：2026-09-08。

本包来自 NX 当前生产网页，供网页组在 Windows 上离线查看和继续调整。它不包含
NX 后端、`.env`、数据库、日志、Wi-Fi 密码、令牌或真实用户数据。

## Windows 直接运行

1. 完整解压 ZIP，不能只在压缩软件预览窗口里运行。
2. 双击 `启动Windows离线演示.bat`。
3. 脚本使用电脑已有的 Python 3 启动本地 HTTP 服务并自动打开浏览器。
4. 若没有 Python 3，请从 python.org 安装，并勾选 `Add Python to PATH`。

离线地址通常为 `http://127.0.0.1:18766/static/offline.html`。端口占用时脚本会自动
寻找下一个端口。必须通过 HTTP 打开；直接用 `file://` 打开无法加载 GLB 三维模型。

离线页面显示的是明确标注的模拟数据，不会连接 NX、GD、ESP、蓝牙音响或其他设备，
也不会发送真实控制命令。模拟内容包括 EEG 原始波形/五频段、六点压力、睡眠状态、
深睡守护、干预、睡前引导、鼾声、设备控制回执和 AI 占位回复。

## 修改位置

- `static/index.html`：生产页面结构。
- `static/offline.html`：由生产页面自动生成的 Windows 离线页面，不要直接修改。
- `static/style.css`、`readability.css`、`sleep-modules.css`：样式。
- `static/app.js`：生产数据绑定、页面导航和图表。
- `static/offline-mock.js`：仅离线页使用的模拟接口。
- `static/scene3d.js`：三维场景源码。
- `static/scene3d.bundle.js`：浏览器实际加载的三维打包文件。
- `static/models/`：GLB 模型，不要改名或移动而不更新引用。

当前 ESP 扩展详情页不再占用左侧导航位置。请在“实时检测”首页点击
“原始脑电波形”图进入，详情页右上角可返回实时检测。首页实时动态趋势中的
心率、呼吸与体动共用一张时间轴，并分别使用独立纵轴量程。

普通 HTML/CSS/app.js 调整不需要 Node。修改 `scene3d.js` 后才需要 Node.js，并在包目录运行：

```powershell
npm install
npm run build:3d
```

每次运行 `启动Windows离线演示.bat` 时，`tools/sync-offline.ps1` 会先根据
`static/index.html` 重新生成 `static/offline.html`，再启动本地服务。生产页面结构更新后
无需再手动维护第二份 HTML。离线专用的数据和行为仍放在 `static/offline-mock.js` 中。

## 对接真实 NX

生产部署时将 `static/` 覆盖到 NX bridge 的静态目录，页面与后端保持同源。页面自动连接
`/ws/live`，失败后降级轮询 `/api/live`。接口详见 `docs/API_CONTRACT.md`。

当前 NX 地址仅供现场参考：`http://10.34.179.161:8000`。局域网地址可能变化，页面源码
不得写死该地址。

## 交付注意

请不要把离线 mock 合入生产 `index.html`。真实页面不应生成随机生理或 EEG 数据。
修改后请同时测试 1024×600 和常见桌面分辨率，并用 Ctrl+F5 排除旧缓存。
