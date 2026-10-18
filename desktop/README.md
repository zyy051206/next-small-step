# 下一小步 · Windows

双击 `next-small-step-2.0.2-windows-x64.exe` 即可运行，无需安装 Node.js、浏览器扩展或本地服务器。支持 Windows 10/11 x64。网页资源随 EXE 打包，离线可用。

2.0.1 移除了顶部的“文件 / 编辑 / 视图”菜单栏，并包含分页布局与最新修复。外观设置支持选择本地背景图片、调整浅色遮罩和自定义应用内图标与 Logo 颜色，重开应用后保留设置。

此版本**未进行 Windows 数字签名**，系统可能显示未知发布者。请从项目所有者提供的发布链接下载，并可核对同目录的 SHA256SUMS.txt。

## 进度与备份

进度固定保存在 `%APPDATA%\NextSmallStep`，不会随便携 EXE 的解压目录或版本号改变。替换 EXE 后仍读取同一份进度；删除这个数据目录会删除本机数据。桌面版、网页版和 Android 版的数据彼此独立，通过 JSON 导出/导入迁移。不会读取用户浏览器的个人配置或存储。

“导出备份”使用 Windows 系统保存对话框。只有文件保存完成后才提示成功；取消操作会显示已取消。同名文件遵循系统的覆盖确认。“导入备份”使用系统文件选择器，网页验证内容并在覆盖当前进度前要求确认。

应用关闭后不运行后台服务、不提供后台提醒；重新打开后依据保存的时钟状态校准计时。

## 检查更新

2.0.2 起，打开应用会检查 GitHub 正式版本，发现新版后显示提醒；也可以从“检查更新”入口手动检查并查看版本说明。离线或更新服务不可用时，原有功能仍可使用。

点击下载后，应用将已验证的官方 EXE 下载链接交给系统浏览器。下载完成后，退出当前应用并打开新版 EXE，即可继续使用原有进度、背景和图标颜色。此便携版本不会在后台覆盖正在运行的 EXE，也不会自动运行下载的文件。2.0.1 及以前的版本需要先手动下载一次新版，之后才具备检查更新功能。

## 构建

使用 Node.js 24，在 `desktop` 目录执行：

```sh
npm ci
npm test
npm run build:win
npm run smoke
```

固定依赖 Electron 44.9.0、electron-builder 26.17.0，全部间接依赖记录于 `package-lock.json`。构建时从项目自己的 `dist/icon.svg` 生成品牌 ICO，再将同一份 `dist/` 打包为 Windows x64 portable EXE。输出位于 `desktop/release/`。

GitHub 的 **Windows EXE** 工作流会在 Windows runner 构建实际分发的 EXE，然后启动该 EXE 两次，验证菜单栏已移除、离线页面、隔离的渲染环境、目标/计时和自定义背景/图标色跨进程持久化、真实 JSON 备份导出/取消与全年统计，成功后才上传 `next-small-step-windows` 附件。`windows-verification` 附件提供检查报告与截图。

开发运行：`npm start`。开发 smoke：`node smoke.cjs --dev`。直接使用 `--smoke-test` 启动 EXE 也会建立独立临时数据目录，不会读取或修改真实用户进度。测试不清理其他用户文件。

桌面壳启用 `contextIsolation`、渲染器 sandbox，禁用 Node 注入和 webview，默认拒绝权限、外部导航与新窗口。页面通过固定 `nextstep://app` 本地协议加载，拒绝访问其他资源与外部网络。原生进程仅为更新查询访问固定的 GitHub Releases 接口，不发送用户进度或凭据；只接受稳定版本及项目官方、名称匹配的 Windows 附件地址。预加载脚本暴露只读的 `NextStepDesktop.platform` 标记和用途固定的 `NextStepUpdates` 方法，不接受网页传来的 URL 或文件路径。

`npm test` 验证版本排序、正式版本和附件匹配、恶意下载地址拒绝、网络失败/超时/响应大小限制及重复请求合并。EXE smoke 还验证真实隔离桥接的版本读取、更新结果和下载交接；测试使用固定原生数据，不连接更新服务或打开浏览器。

参考：[Electron 稳定版本](https://releases.electronjs.org/release?channel=stable)、[Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)、[原生下载保存窗口](https://www.electronjs.org/docs/latest/api/download-item)、[electron-builder Windows portable](https://www.electron.build/nsis/)。
