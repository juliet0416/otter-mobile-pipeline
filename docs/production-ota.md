# 生产安装包与 OTA 的固定环境

## 使用入口

安装包仍使用现有 Mobile iOS Release / Mobile Android Release。新增 **Mobile OTA Update** 只负责 `prod`（iOS / Android）和 `cn-prod`（Android）的 OTA。`test` 的本地测试入口保持不变。

App 仓库现可通过 `bun run ota prod` / `bun run ota cn-prod` 交互选择平台、Tag 和母包产物，填写多行说明后自动触发此工作流；生产补丁不会再从本机导出。`test` 仍从本机发布。

## 首次启用

1. 评审后将本分支合并并推送流水线仓库 `main`。GitHub 的手动工作流入口需要先存在于默认分支。
2. 在流水线仓库 Actions secrets 配置 `EXPO_TOKEN`（具有当前 Expo 项目的发布权限）。复用 `SOURCE_REPO`、`SOURCE_REPO_PAT`；Android 复用 `GOOGLE_SERVICES_PROD_JSON_BASE64`。Sentry 继续复用 `SENTRY_AUTH_TOKEN`。
3. Expo 的 EAS `production` 环境供生产 OTA 使用。不要在这里保存与渠道冲突的 API、地区及 OTA 配置变量，尤其不要固定一个渠道供 prod、cn-prod 共用。冲突会明确报错；更新说明由每次发布输入提供。
4. 用新的安装包流水线构建基准包，`upload_private_release` 默认开启，本地发布脚本也自动传入 `true`，无需额外调整。成功后 Release 应同时有安装包和 `<安装包完整文件名>.ota.json`。记录从实际 APK/AAB/IPA 提取 runtime，并绑定安装包 SHA256。
5. 安装此基准包再验证 OTA。旧流水线生成、缺少这份记录的安装包不能补写假记录绕过校验；应重新构建真实母包。只修复流水线时可以使用原有 Tag 重新触发，无需删除 Tag 或提升 App 版本。

Token 创建说明：https://docs.expo.dev/eas-update/github-actions/

## 发布操作

推荐先提交并推送 App 补丁代码，保持工作区干净，在 `apps/mobile` 运行 `bun run ota prod`（或 `cn-prod`）。选择平台 → 目标 Tag → 安装包 → 更新说明 → 确认发布。脚本自动读取当前完整 SHA；Tag 用来选择母包基准，不会把补丁源码回退成旧 Tag。确认发布后 CI 先校验、再上传，无需手动运行两次。

`bun run ota prod --verify-only` 只触发 CI 校验；`--dry-run` 只显示请求。终端“已提交”不是“发布成功”，仍需到 Actions 查看结果。

需要手工操作时，在 Actions → Mobile OTA Update → Run workflow 输入：

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
- Android 母包和 OTA 在计算指纹前共用 `scripts/ota/prepare-android.mjs`，提前执行 masked-view 0.3.2 的 Manifest package 删除规则，保留其余字节。依赖版本变化时停止并要求重新审查，避免 Gradle 编译中修改 node_modules 导致前后指纹漂移。该步骤仅用于 Android，不改变现有 iOS 准备流程和 recipe。
- Android 准备步骤还会在 CI checkout 的 `.fingerprintignore` 中精确排除 `**/expo-updates-gradle-plugin/.kotlin/**/*`。Kotlin 随机会话文件在编译期间存在、编译后清除，不能参与原生兼容性指纹；插件源码仍完整参与，母包与 OTA 共用规则，iOS 不受影响。无需修改 App 源码或移动原有 Tag。
- `record.mjs` 在构建前后计算指纹，与二进制内 runtime 比对。失败时停止 Release、R2 和商店分发；保留前后指纹诊断。记录只保存来源标识和 hash，不保存原始配置内容。
- 发布时下载准确的二进制和记录，验证 SHA256、版本、平台、渠道、准备流程 hash、Node/Bun/OS/CPU 架构与 runtime。导出前后均检查，通过后用 `--skip-bundler` 上传同一份导出。
- runner 使用 macos-26 / ubuntu-24.04；托管镜像仍会更新，所以最终以真实二进制与候选指纹一致为准，不能把 runner 标签视为永久不变的镜像。

更改准备流程或工具版本后会触发 recipe 不匹配，需要新母包或经独立审计的兼容方案。不会强行覆盖 runtime，不会忽略整个 node_modules。App 原生能力、插件或权限变化需要重打安装包。

## OTA 下载缓存与耗时

生产 OTA 在 `Prepare shared mobile dependencies` 之前恢复 Bun、npm 和 Electron 下载缓存。缓存按 runner 系统、CPU 架构、固定工具链及源码锁文件分组；依赖变化时可复用同一工具链下的下载，仍按当前冻结锁文件安装。缓存服务不可用时退回正常下载，Actions Summary 显示是否精确命中。

仅缓存包管理器及 Electron 的下载目录，不缓存 App 的 `node_modules`、生成的原生目录、签名材料或 `.private` 数据。共享准备 action、原生准备脚本及 recipe hash 不变，因此本次优化不会要求已经验证兼容的母包重建。npm 安装固定 EAS CLI 时优先使用下载缓存；不改变 EAS 版本。

首次运行需要填充缓存；同环境后续发布才能看到收益。安装脚本、prebuild、导出前后指纹及真实二进制校验仍完整执行；Metro 继续干净导出并用 `--skip-bundler` 上传同一份产物。

优化前参考：2026-09-28 iOS prod 任务 36423869985 总耗时 9 分 44 秒，安装 3,230 个包耗时约 288 秒，原生压缩包准备约 5 秒，EAS CLI 安装约 36 秒，Metro 打包约 138 秒。不要把整个依赖步骤的耗时归因于原生压缩包下载。优化后的耗时需合入后分别记录冷缓存与热缓存运行，不以静态测试结果宣称性能提升。

## 失败处理

2026-09-28 的 Android 1.4.7 三个任务均已编译成功，随后因 masked-view 的 Manifest 编译中被改写而未通过指纹校验。修复合入 main 后，应重新触发相同 Tag 的 Android 构建，让新运行使用最新流水线；不要点旧运行的 Re-run（它会使用旧工作流提交）。不必删除 Tag 或更改 App 版本。此前成功的 iOS 不需要因本次 Android 修复重建。

- 缺少 `.ota.json`：使用新流水线重建安装包；不要手工制造记录。
- `runtimeVersion` 不匹配：查诊断中的来源变化，区分真实原生变更与准备环境漂移。
- 导出前匹配、导出后不匹配：Metro 或依赖脚本改动了参与指纹的文件，已阻止上传。
- 预编译 SHA 校验失败：停止，不换成未校验文件。
- 下载 / 导出 / EAS 命令失败：任务失败，不自动重试发布。先查看 Expo 是否已收到该更新，再决定重跑，避免重复发布。
- “验证通过”只证明准备与导出兼容性，不替代真机功能回归，也不等于已发布。

## 本地验证命令

真实 Expo 回归使用已有依赖的源码 checkout：`OTA_TEST_SOURCE_ROOT=/path/to/app-repo node --test scripts/ota/android-fingerprint.test.mjs`。覆盖编译前、临时会话存在/改名、编译后清除、真实 Kotlin 源码变化；默认无源码路径时会跳过该集成项。

```bash
node --test scripts/*.test.mjs scripts/ota/*.test.mjs
python3 -m unittest discover -s scripts/ota -p '*_test.py'
actionlint .github/workflows/mobile-ota-update.yml .github/workflows/mobile-ios-release.yml .github/workflows/mobile-android-release.yml
```

真实打包和 EAS 发布需要 CI 的签名、Firebase 和 Expo secrets；没有运行这些步骤时，不得宣称生产流程已验收。
