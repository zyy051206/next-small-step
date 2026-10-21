# 下一小步 · Windows

运行 `next-small-step-2.3.0-windows-x64.exe`，按提示安装后使用。支持 Windows 10/11 x64，默认安装到当前用户目录，无需管理员权限。网页资源随应用打包，离线可用。

2.0.3 使用 NSIS 安装版，支持应用内下载、取消、重试和重启安装。旧版便携 EXE 用户需先安装一次 2.0.3；之后的新版本可以直接在应用内更新。请关闭旧版便携程序，再启动安装后的新版。

此版本**未进行 Windows 数字签名**，系统可能显示未知发布者。请从项目官方 GitHub Releases 下载，并可核对同目录的 SHA256SUMS.txt。

2.1.0 增加深色/跟随系统主题、字号与遮罩调节、完整备份和系统到时提醒。应用最小化时提醒有效，完全退出后停止提醒。更新信息主入口失败时尝试官方发布资源的备用入口。

2.3.0 增加待办番茄预估与自动计数、今日番茄清单、每日目标和沉浸专注模式。白噪音在本地合成，不需要联网或额外素材；关闭沉浸模式或计时结束即停止播放。

## 更新与进度

打开应用会检查 GitHub 正式版本，也可以手动选择“检查更新”。发现新版后显示版本说明；点击“下载更新”后，应用直接下载并显示进度，支持取消和重试。下载完成后点击“重启并安装”，应用保存数据、退出并启动 NSIS 更新，完成后重新打开。不会打开浏览器，也不需要手动寻找安装包。

仅用户明确选择安装时才会更新。正常退出、关机或取消下载都不会自动安装。下载后的文件通过 SHA512 校验，安装前再次核对，校验失败时要求重新下载。更新服务不可用不影响原有离线功能。

进度仍保存在 `%APPDATA%\NextSmallStep`，从便携版迁移和后续更新都读取同一份数据；删除这个目录会删除本机数据。桌面版、网页版和 Android 版数据彼此独立，通过 JSON 导出/导入迁移。2.1.0 起的完整备份包含背景图片、外观和提醒设置，兼容旧版进度备份；2.3.0 起还包括待办番茄、每日目标和白噪音偏好。

“导出备份”使用 Windows 系统保存对话框，仅在保存完成后提示成功；取消时反馈已取消。同名文件遵循系统覆盖确认。应用关闭后不运行后台服务，重新打开后根据保存的时钟状态恢复计时。

## 构建与发布

使用 Node.js 24，在 `desktop` 目录执行：

```sh
npm ci
npm test
npm run build:win
npm run smoke
```

固定依赖 Electron 44.9.0、electron-builder 26.17.0 和 electron-updater 6.8.9，间接依赖记录于 `package-lock.json`。品牌 ICO 从项目的 `dist/icon.svg` 生成。Windows 构建输出在 `desktop/release/`，每次正式发布需一起上传：

- `next-small-step-版本号-windows-x64.exe`：当前用户 NSIS 安装程序。
- 对应的 `.exe.blockmap`：差分更新元数据。
- `latest.yml`：版本、安装包大小与 SHA512，供已安装版本检查更新。

GitHub 更新源固定为 `zyy051206/next-small-step`，拒绝预发布、降级、任意文件名和 NSIS 网络安装程序。`autoDownload` 与 `autoInstallOnAppQuit` 均关闭；明确点击后才下载和安装。更新使用独立的原生网络会话，不向服务发送用户目标、计时或背景图片。

## 验证

`npm test` 覆盖版本和元数据验证、下载进度、取消/重试、超时、损坏文件、安装前篡改校验和重复安装防护。

`npm run smoke` 从实际 NSIS 安装包提取应用到独立临时目录，启动两次验证离线页面、数据/背景/图标色持久化、备份和全年统计。原生更新测试使用真实 `NsisUpdater` 和仅绑定本机回环地址的临时服务，验证下载、损坏文件拒绝、重试以及安装/重启参数；最终启动安装进程的调用被拦截，不修改本机已安装程序或注册表。测试报告记录安装包 SHA256 及该验证边界。

开发运行：`npm start`。开发验证：`node smoke.cjs --dev`。显式 `--smoke-test` 使用隔离的数据与更新缓存，不读取或改写真实进度。

桌面壳保留 `contextIsolation`、sandbox、无 Node 注入和无 webview 的边界；页面只通过 `nextstep://app` 加载本地资源。`NextStepUpdates` 仅接受请求标识，不接受网页传来的 URL、文件路径或命令。

参考：[electron-builder v26 更新文档](https://www.electron.build/v26/docs/features/auto-update/)、[NSIS 配置](https://www.electron.build/nsis/)、[Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)。
