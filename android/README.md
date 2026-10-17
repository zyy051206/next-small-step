# 下一小步 · Android

这是将仓库 `dist/` 原样打包进 APK 的轻量 Android 应用。最低 Android 8.0（API 26），包名 `io.github.zyy051206.nextstep`。无需网络连接，也不申请网络、广泛存储、通知或后台服务权限。

## 安装与数据

使用所有者交付的正式签名 APK，传到手机安装。系统可能要求允许当前浏览器或文件管理器安装此来源的应用。GitHub Actions 的构建附件是开发产物：其中 `next-small-step-unsigned.apk` 需要所有者用固定私有密钥签名后才可安装；`next-small-step-debug.apk` 只用于开发和模拟器验证。

网页与 APK 的存储相互独立。在原网页中导出 JSON 备份，在 APK 内选择“导入备份”可迁移；导入前会显示确认框。APK 中导出使用 Android 系统保存窗口，导入使用系统文档选择器，仅访问你主动选择的文件。

应用关闭或进入后台后，不保证持续运行，也没有后台通知。正在运行的计时依据已保存的结束时间，在回到应用时校准并补记；暂停的计时保持暂停。

正式安装包使用所有者持有的固定私有签名；后续版本保持相同包名和签名，并提高 `versionCode`，即可覆盖升级保留进度。签名密钥保存在仓库之外，不上传源码或构建附件。更新前仍建议导出备份。开发调试包和正式包签名不同，不能互相覆盖；需要先备份，再卸载调试包后安装正式包并恢复备份。卸载/清除应用数据会删除本地进度。

## 构建

已固定使用 Android Gradle Plugin 8.7.3、Gradle 8.9、JDK 17、compile/target SDK 35；与 [Android 官方兼容说明](https://developer.android.com/build/releases/agp-8-7-0-release-notes)一致。APK 无原生 CPU 二进制，可在支持的 ARM 与 x86 Android 设备使用。页面需要系统 Android WebView 支持现代 HTML/JS；建议更新系统 WebView。

CI 直接通过 Gradle 官方 `setup-gradle` 安装固定版本，无需向仓库提交第三方 Wrapper 二进制。已安装 JDK 17、Gradle 8.9 与 Android SDK 的本机可在仓库根目录执行：

```sh
gradle -p android assembleDebug assembleRelease lintDebug
```

APK 输出：`android/app/build/outputs/apk/debug/app-debug.apk` 与 `android/app/build/outputs/apk/release/app-release-unsigned.apk`。Android Studio 可打开 `android/`，配置 JDK 17、SDK 35 和本地 Gradle 8.9；也可用安装好的 Gradle 运行 `gradle -p android wrapper --gradle-version 8.9` 生成标准 Wrapper。

正式 APK 须使用 SDK 的 `apksigner` 和所有者的固定私有密钥签名，并运行 `apksigner verify --verbose` 验证；私钥和密码不能提交到仓库或公开产物。工作流提供同版本 `apksigner.jar` 方便在可信本机完成签名。

## 验证

工作流先构建与 Android Lint，再启动 API 35 模拟器，用真实 Android WebView 运行 `connectedDebugAndroidTest`：检查离线页面与原生桥加载、Activity 重建后的持久化，以及系统返回先关闭网页对话框。测试通过后才上传同一次构建的 unsigned release、debug APK、签名工具和 SHA-256；另上传检查报告。模拟器测试使用 debug APK，正式包仍需完成签名校验和安装验收。

人工在手机继续检查：新建目标与行动；开始计时后切到后台再回来；导出备份（保存和取消）；选择备份导入并确认；退出重开后检查进度。模拟器检查不代替所有手机型号的兼容性测试。

## 边界

本地页面使用 Android 官方 [WebViewAssetLoader](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content) 映射到 `https://appassets.androidplatform.net/assets/index.html`。只允许本地 assets 请求和主页面导航，远程地址与非本地资源被拒绝，文件 URL 访问禁用。JavaScript 桥仅提供 `NextStepAndroid.saveBackup(json, filename)`；保存结果通过 `nextstep-backup-result` 事件通知页面，`detail.status` 为 `success`、`cancelled` 或 `error`。恢复前台时派发 `nextstep-resume` 与 `visibilitychange` 以刷新计时。
