# 下一小步 · Windows

双击 `next-small-step-2.0.0-windows-x64.exe` 即可运行，无需安装 Node.js、浏览器扩展或本地服务器。支持 Windows 10/11 x64。网页资源随 EXE 打包，离线可用。

此版本**未进行 Windows 数字签名**，系统可能显示未知发布者。请从项目所有者提供的发布链接下载，并可核对同目录的 SHA256SUMS.txt。

## 进度与备份

进度固定保存在 `%APPDATA%\NextSmallStep`，不会随便携 EXE 的解压目录或版本号改变。替换 EXE 后仍读取同一份进度；删除这个数据目录会删除本机数据。桌面版、网页版和 Android 版的数据彼此独立，通过 JSON 导出/导入迁移。不会读取用户浏览器的个人配置或存储。

“导出备份”使用 Windows 系统保存对话框。只有文件保存完成后才提示成功；取消操作会显示已取消。同名文件遵循系统的覆盖确认。“导入备份”使用系统文件选择器，网页验证内容并在覆盖当前进度前要求确认。

应用关闭后不运行后台服务、不提供后台提醒；重新打开后依据保存的时钟状态校准计时。没有自动更新模块。

## 构建

使用 Node.js 24，在 `desktop` 目录执行：

```sh
npm ci
npm run build:win
npm run smoke
```

固定依赖 Electron 44.9.0、electron-builder 26.17.0，全部间接依赖记录于 `package-lock.json`。构建时从项目自己的 `dist/icon.svg` 生成品牌 ICO，再将同一份 `dist/` 打包为 Windows x64 portable EXE。输出位于 `desktop/release/`。

GitHub 的 **Windows EXE** 工作流会在 Windows runner 构建实际分发的 EXE，然后启动该 EXE 两次，验证离线页面、隔离的渲染环境、目标/计时跨进程持久化、真实 JSON 备份导出/取消与全年统计，成功后才上传 `next-small-step-windows` 附件。`windows-verification` 附件提供检查报告与截图。

开发运行：`npm start`。开发 smoke：`node smoke.cjs --dev`。直接使用 `--smoke-test` 启动 EXE 也会建立独立临时数据目录，不会读取或修改真实用户进度。测试不清理其他用户文件。

桌面壳启用 `contextIsolation`、渲染器 sandbox，禁用 Node 注入和 webview，默认拒绝权限、外部导航与新窗口。页面通过固定 `nextstep://app` 本地协议加载，拒绝访问其他资源与外部网络。预加载脚本只暴露只读的 `NextStepDesktop.platform` 标记。

参考：[Electron 稳定版本](https://releases.electronjs.org/release?channel=stable)、[Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)、[原生下载保存窗口](https://www.electronjs.org/docs/latest/api/download-item)、[electron-builder Windows portable](https://www.electron.build/nsis/)。
