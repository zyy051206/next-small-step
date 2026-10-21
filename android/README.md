# 下一小步 · Android

这是将仓库 `dist/` 原样打包进 APK 的轻量 Android 应用。最低 Android 8.0（API 26），包名 `io.github.zyy051206.nextstep`。任务、计时和本机数据可离线使用；原生更新检查与下载需要网络权限。2.0.3 使用安装来源权限调起 Android 系统安装确认，不申请广泛存储或后台服务权限。2.1.0 增加系统通知与准时提醒权限，仅在用户主动选择时申请。2.2.0 增加桌面组件，2.3.0 增加待办番茄预估与自动计数、今日番茄清单、每日目标和沉浸专注模式。

## 安装与数据

使用所有者交付的正式签名 APK，传到手机安装。系统可能要求允许当前浏览器或文件管理器安装此来源的应用。GitHub Actions 的构建附件是开发产物：其中 `next-small-step-unsigned.apk` 需要所有者用固定私有密钥签名后才可安装；`next-small-step-debug.apk` 只用于开发和模拟器验证。

网页与 APK 的存储相互独立。在原网页中导出 JSON 备份，在 APK 内选择“导入备份”可迁移；导入前会显示确认框。APK 中导出使用 Android 系统保存窗口，导入使用系统文档选择器，仅访问你主动选择的文件。

2.0.1 支持从系统文件选择器选择本地图片作为背景；图片只保存在本机。图片选择器筛选图片，JSON 备份导入仍保留对不同文件提供器的兼容。应用内图标与 Logo 颜色也可在外观设置中调整。

2.0.3 支持应用内下载与安装更新：检查公开 GitHub 仓库的新正式版本，在应用内查看下载进度或取消；下载后点击“安装更新”，直接进入 Android 安装确认窗口。首次安装需在系统设置中允许“下一小步”安装此来源的应用，返回后会继续刚才的安装操作。系统确认仍需本人点击。下载文件放在应用私有缓存，不需要到浏览器或文件管理器查找 APK；重开后恢复已校验的更新文件。未下载完成的文件会在 Activity 销毁时取消并清理，需要重新下载，不提供后台下载服务。

2.0.2 的更新按钮会打开浏览器；先安装一次 2.0.3，后续即可使用应用内流程。所有更新操作都不会上传目标、专注记录或背景图片。无法联网时仍可使用原有功能，稍后重试更新即可。清理应用缓存会删除下载的更新文件，不影响独立保存的进度。

应用关闭或进入后台后，不保证持续运行，2.1.0 可以通过系统 AlarmManager 在后台提醒当前这一段计时结束；需要在番茄钟设置中开启并允许通知，未允许准时提醒时可能延迟。强行停止应用、勿扰或厂商省电设置可能阻止提醒。正在运行的计时依据已保存的结束时间，在回到应用时校准并补记；暂停的计时保持暂停。

正式安装包使用所有者持有的固定私有签名；后续版本保持相同包名和签名，并提高 `versionCode`，即可覆盖升级保留进度。签名密钥保存在仓库之外，不上传源码或构建附件。更新前仍建议导出备份。开发调试包和正式包签名不同，不能互相覆盖；需要先备份，再卸载调试包后安装正式包并恢复备份。卸载/清除应用数据会删除本地进度。

## 构建

已固定使用 Android Gradle Plugin 8.7.3、Gradle 8.9、JDK 17、compile/target SDK 35；与 [Android 官方兼容说明](https://developer.android.com/build/releases/agp-8-7-0-release-notes)一致。APK 无原生 CPU 二进制，可在支持的 ARM 与 x86 Android 设备使用。页面需要系统 Android WebView 支持现代 HTML/JS；建议更新系统 WebView。

CI 直接通过 Gradle 官方 `setup-gradle` 安装固定版本，无需向仓库提交第三方 Wrapper 二进制。已安装 JDK 17、Gradle 8.9 与 Android SDK 的本机可在仓库根目录执行：

```sh
gradle -p android assembleDebug assembleRelease lintDebug
```

APK 输出：`android/app/build/outputs/apk/debug/app-debug.apk` 与 `android/app/build/outputs/apk/release/app-release-unsigned.apk`。Android Studio 可打开 `android/`，配置 JDK 17、SDK 35 和本地 Gradle 8.9；也可用安装好的 Gradle 运行 `gradle -p android wrapper --gradle-version 8.9` 生成标准 Wrapper。

正式 APK 须使用 SDK 的 `apksigner` 和所有者的固定私有密钥签名，并运行 `apksigner verify --verbose` 验证；私钥和密码不能提交到仓库或公开产物。工作流提供同版本 `apksigner.jar` 方便在可信本机完成签名。

在保存原始密钥的 Windows 账户上，可以运行仓库根目录的 `sign-android-release.ps1`。它会从仓库外的 `tmp/next-step-signing-private/` 读取 JKS 和 DPAPI 加密密码，在进程内完成签名，并检查原发布证书以及 v2/v3 签名。密码不会写入明文文件。示例：

```powershell
.\sign-android-release.ps1 `
  -UnsignedApk .\android\app\build\outputs\apk\release\app-release-unsigned.apk `
  -ApkSignerJar .\android\artifacts\apksigner.jar `
  -OutputApk .\app-release-signed.apk
```

若使用其他构建产物，将参数改成对应的 unsigned APK 和 `apksigner.jar` 路径。输出文件已经存在时脚本会停止，避免覆盖。

## 验证

工作流先构建与 Android Lint，再启动 API 35 模拟器，用真实 Android WebView 运行 `connectedDebugAndroidTest`：检查离线页面与原生桥加载、Activity 重建后的进度、背景图片与图标颜色持久化、图片和备份选择器筛选，以及系统返回先关闭网页对话框。更新测试覆盖版本、发布元数据和 GitHub SHA-256 要求、真实下载流的大小/哈希/取消、缓存被修改、APK 包名与版本号及证书比较、受限 FileProvider 安装 Intent，以及原生状态恢复和未下载时禁止安装。测试构造安装 Intent，不在用户设备上执行测试安装。测试通过后才上传同一次构建的 unsigned release、debug APK、签名工具和 SHA-256；另上传检查报告。模拟器测试使用 debug APK，正式包仍需完成签名校验和安装验收。

人工在手机继续检查：新建目标与行动；开始计时后切到后台再回来；导出备份（保存和取消）；选择备份导入并确认；退出重开后检查进度。模拟器检查不代替所有手机型号的兼容性测试。

## 边界

本地页面使用 Android 官方 [WebViewAssetLoader](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content) 映射到 `https://appassets.androidplatform.net/assets/index.html`。只允许本地 assets 请求和主页面导航，远程地址与非本地资源被拒绝，文件 URL 访问禁用。备份桥提供 `NextStepAndroid.saveBackup(json, filename)`；保存结果通过 `nextstep-backup-result` 事件通知页面，`detail.status` 为 `success`、`cancelled` 或 `error`。恢复前台时派发 `nextstep-resume` 与 `visibilitychange` 以刷新计时。

更新桥 `NextStepUpdates` 提供 `getVersion()`、`getPlatform()`、`checkUpdates(requestId)`、`downloadUpdate(requestId)`、`installUpdate(requestId)`、`cancelUpdate(requestId)` 与 `getUpdateState(requestId)`。结果通过 `nextstep-update-result` 事件派发，包含 `requestId`、`action`、`status`、`currentVersion`，有更新时包含 `version`、`notes`、`size`、`received`、`total`、`percent`。状态包括 `available`、`current`、`error`、`progress`、`ready`、`installing`、`cancelled`、`permission` 和 `idle`。下载进度沿用下载请求 ID，`ready` 代表校验完成；`installing` 表示已打开系统确认，不代表系统已安装成功。状态查询异步恢复缓存，避免主线程读取 APK。

元数据优先来自固定仓库的 HTTPS API；失败时尝试该仓库最新正式发布的 android-update.json。API 禁止重定向，备用资源仅允许已列出的 HTTPS 下载域名。下载起始地址精确匹配该仓库、标签与 APK 文件名；重定向仅允许明确列出的 GitHub HTTPS 下载主机，限制跳转次数、等待时间及 512 MiB 文件上限。要求发布资产提供 SHA-256，并核对流的实际字节数、SHA-256、APK 包名、递增的 versionCode、versionName 和当前应用签名。每次安装以及恢复缓存都重新验证；校验失败不能启动安装。FileProvider 只暴露 `cache/updates/install/`，不暴露业务数据、背景图或更新元数据，安装 Intent 仅授予临时读取权限。网页不能指定网络地址或文件路径。

相关接口依据：[Android 网络连接](https://developer.android.com/reference/java/net/HttpURLConnection)、[FileProvider](https://developer.android.com/reference/androidx/core/content/FileProvider)、[应用安装来源权限](https://developer.android.com/reference/android/content/pm/PackageManager#canRequestPackageInstalls())、[签名信息](https://developer.android.com/reference/android/content/pm/SigningInfo)、[GitHub 最新发布接口](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)。

## 番茄待办与沉浸专注（2.3.0）

待办的番茄预估、实际计数、每日目标和沉浸模式都沿用网页版本，无需新的原生权限。白噪音由 WebView 的 WebAudio 在本地合成，不请求网络、不读取媒体文件；需要用户点击进入沉浸模式后才能开始播放。安卓的省电策略可能在锁屏后暂停音频，回到应用会按计时状态恢复显示；计时本身仍按实际时钟计算。

## 桌面组件（2.2.0）

提供“专注计时”“今日待办”“重要日期”三个安卓标准桌面组件。打开应用侧栏的“桌面组件”可请求添加；如手机桌面没有弹出确认，请长按桌面空白处，在组件列表搜索“下一小步”。适配目标为用户的 iQOO 15 / OriginOS 6，仍需真机确认桌面入口与尺寸。

计时采用系统 Chronometer；应用进入后台后仍显示倒计时。点击开始、暂停、继续或待办会打开应用，用原有计时和数据保存逻辑处理。组件只缓存展示快照，不引入第二份可编辑进度；过期的操作会被拒绝，重复完成不会撤销任务。数据变化、日期变化、重启及系统定期刷新时更新组件，强行停止和省电可能延迟状态刷新。

组件不上传内容。组件显示的标题在桌面可见；删除组件不删除应用数据。
