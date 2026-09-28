# 生产安装包与 OTA 的固定环境

## 使用入口

安装包仍使用现有 Mobile iOS Release / Mobile Android Release。新增 **Mobile OTA Update** 只负责 `prod`（iOS / Android）和 `cn-prod`（Android）的 OTA。`test` 的本地测试入口保持不变。

App 仓库没有改动，旧 `bun run ota` 仍会从本机发布；生产更新请使用这个新入口，避免绕过兼容性校验。

## 首次启用

1. 评审后将本分支合并并推送流水线仓库 `main`。GitHub 的手动工作流入口需要先存在于默认分支。
2. 在流水线仓库 Actions secrets 配置 `EXPO_TOKEN`（具有当前 Expo 项目的发布权限）。复用 `SOURCE_REPO`、`SOURCE_REPO_PAT`；Android 复用 `GOOGLE_SERVICES_PROD_JSON_BASE64`。Sentry 继续复用 `SENTRY_AUTH_TOKEN`。
3. Expo 的 EAS `production` 环境供生产 OTA 使用。不要在这里保存与渠道冲突的 API / region / `OTTERMIND_OTA_*` 变量，尤其不要固定一个渠道供 prod、cn-prod 共用。冲突会明确报错；`OTTERMIND_OTA_RELEASE_NOTES` 由每次发布输入提供。
4. 用新的安装包流水线构建基准包，开启 `upload_private_release`。成功后 Release 应同时有安装包和 `<安装包完整文件名>.ota.json`。记录从实际 APK/AAB/IPA 提取 runtime，并绑定安装包 SHA256。
5. 安装此基准包再验证 OTA。现有 1.4.7 没有这份记录且存在已证实的环境漂移，不能补写一个假记录绕过校验；无需删除旧 tag。建议用新的正式版本建立基准。

Token 创建说明：https://docs.expo.dev/eas-update/github-actions/

## 发布操作

先提交并推送 App 补丁代码，记下 **完整 40 位提交 SHA**。在 Actions → Mobile OTA Update → Run workflow 输入：

- `ref`：补丁源码 SHA，不是流水线 SHA，也不是本地未提交变更。
- `release`：目标安装包的 Release tag，例如 `mobile-v1.4.8`。
- `artifact`：Release 上准确的 APK/AAB/IPA 文件名，不允许通配符。Android APK 与 AAB 若 runtime 不同，需要分别验证和发布；不能仅凭同为 Android 假设兼容。
- `channel` / `platform`：国际版选 prod；国内包选 cn-prod + android。
- `message`：完整更新说明（最多 4000 字符）。支持真实换行；App 按现有文本展示逻辑反显，不新增 Markdown 渲染。Expo Dashboard 显示首行摘要。
- `dry_run`：首次保持 true。会验证目标二进制、准备依赖、比较指纹并导出补丁，不上传 Expo。通过后用相同 SHA / 安装包 / 说明再次运行，设为 false。

网页输入框不方便编辑多行时，保存 UTF-8 文件 `ota-notes.txt`，用 GitHub CLI 提交：

```bash
gh workflow run mobile-ota-update.yml \
  --repo juliet0416/otter-mobile-pipeline --ref main \
  -f ref=补丁的完整40位提交SHA \
  -f release=mobile-v1.4.8 \
  -f artifact=Release中的完整安装包文件名 \
  -f channel=prod -f platform=ios \
  -F message=@ota-notes.txt \
  -f dry_run=true
```

验证通过后保持其他参数不变，改为 `-f dry_run=false`。查看对应 Actions run 的 Summary 和 `ota-diagnostics-*` 附件。生产渠道更新会影响匹配 runtime 的已安装用户，发布前仍需测试业务行为。

## 环境为何能复现

- 安装包与 OTA 共用 `.github/actions/prepare-mobile/action.yml`：新 checkout、Node 22.16.0、Bun 1.3.6、冻结 `bun.lock`，使用 copyfile 安装避免构建修改硬链接缓存。
- EAS CLI 固定 24.8.0，安装在 runner 临时目录，不进入 App 的依赖树。
- `scripts/ota/toolchain.json` 固定音频库 0.12.2 / 预编译版本 v3.1.0 和六个压缩包 SHA256。iOS 提前准备 Pod 脚本可能获取的全部目录；Android 准备 android 与 jniLibs。禁止恢复展开后的音频库目录缓存。
- 生产业务配置由 `setup-env.mjs` 统一；完整更新说明使用 App 已有的 `extra.otaReleaseNotes`，现有 fingerprint hook 排除说明文本。
- `record.mjs` 在构建前后计算指纹，与二进制内 runtime 比对。失败时停止 Release、R2 和商店分发；保留前后指纹诊断。记录只保存来源标识和 hash，不保存原始配置内容。
- 发布时下载准确的二进制和记录，验证 SHA256、版本、平台、渠道、准备流程 hash、Node/Bun/OS/CPU 架构与 runtime。导出前后均检查，通过后用 `--skip-bundler` 上传同一份导出。
- runner 使用 macos-26 / ubuntu-24.04；托管镜像仍会更新，所以最终以真实二进制与候选指纹一致为准，不能把 runner 标签视为永久不变的镜像。

更改准备流程或工具版本后会触发 recipe 不匹配，需要新母包或经独立审计的兼容方案。不会强行覆盖 runtime，不会忽略整个 node_modules。App 原生能力、插件或权限变化需要重打安装包。

## 失败处理

- 缺少 `.ota.json`：使用新流水线重建安装包；不要手工制造记录。
- `runtimeVersion` 不匹配：查诊断中的来源变化，区分真实原生变更与准备环境漂移。
- 导出前匹配、导出后不匹配：Metro 或依赖脚本改动了参与指纹的文件，已阻止上传。
- 预编译 SHA 校验失败：停止，不换成未校验文件。
- 下载 / 导出 / EAS 命令失败：任务失败，不自动重试发布。先查看 Expo 是否已收到该更新，再决定重跑，避免重复发布。
- “验证通过”只证明准备与导出兼容性，不替代真机功能回归，也不等于已发布。

## 本地验证命令

```bash
node --test scripts/*.test.mjs scripts/ota/*.test.mjs
python3 -m unittest discover -s scripts/ota -p '*_test.py'
actionlint .github/workflows/mobile-ota-update.yml .github/workflows/mobile-ios-release.yml .github/workflows/mobile-android-release.yml
```

真实打包和 EAS 发布需要 CI 的签名、Firebase 和 Expo secrets；没有运行这些步骤时，不得宣称生产流程已验收。
