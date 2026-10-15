# 项目目标

- 主工作区：`D:\github\qq-farm-2.3.x-rebuild`。
- 旧版参考项目：`D:\github\qq-farm-2.3.1`。查旧功能、接口行为、文案和流程时先对照它，但不要机械复刻旧 UI。
- 目标是把 QQ 农场自动化工具整理成前后端更易维护、容易排查、方便扩展的结构。
- 重构方向：统一目录和模块边界，减少冗余和历史代码味道，降低阅读/修改成本，逐步解耦架构与依赖。
- 非目标：不做无关大改，不一次性全站格式化，不把“复刻 2.3.1 UI”当成目标。

# 当前状态

- TSDK/ACE 安全链路已升级到 2026-09-24 本机官方展开包中的
  `v3.9.0.1790160550` WASM（161081 字节，SHA-256
  `2c9e377ecc9a4fd9019f12191b589d543a60d6654580eb3e237b35f1fa5b1cb7`）。
  静态检查确认 22 个 imports、61 个 exports、17 个 mergewasm 数据段及解密密钥
  均与现有 Node 宿主兼容；默认运行文件已切换为
  `tsdk-v3.9.0.1790160550.wasm`，保留旧版本化 WASM 用于回退。
  登录与心跳请求已按 `1.14.2.15_20260922` 官方抓包逐字节锁定；自定义设备
  协议仍保留扩展设备字段，受控在线验收待完成。
  语法检查、定向 ESLint 和 TSDK/网关协议测试通过；完整后端测试 360/360 通过。
  调用映射和内存所有权见 `core/docs/tsdk-ace-runtime.md`；受控在线 5/30 分钟好友
  操作仍需测试账号实测。
- WASM 后续更新已标准化：新增 `core/scripts/inspect-tsdk-update.js` 和
  `npm run inspect:tsdk`，可静态输出 SHA-256、imports、exports、active data
  segments、解密高频常量、`game.js` 版本/关键标记及基线兼容性；完整发现、快照、
  差异分级、更新、离线/在线验收和回退流程见
  `core/docs/tsdk-update-runbook.md`。
- 宠物页已支持通用手工激活：后端复用 `DogService.ActivateDog` 及同一串行化校验，
  以服务端 `field_6` 或背包中未锁定的同 ID 宠物卡判断可激活；worker/provider/API/
  Pinia/页面入口已贯通，激活后会刷新宠物快照。
- 技术栈：后端 `core` 是 Node.js/CommonJS + Express + Socket.IO；前端 `web` 是 Vue 3 + Vite + TypeScript + Pinia + UnoCSS。
- 最新快速体检结果：`web/src` 全量 ESLint 通过，`web` 生产构建通过；`core/src/**/*.js` 全量 `node --check` 通过。源码扫描未发现真实替换字符类乱码、孤立 `undefined` 行或 `_v###` 反编译变量残留；`core` ESLint 因本地 `core/node_modules` 缺少 `@antfu/eslint-config` 未作为源码失败处理。
- UTF-8 源码扫描未发现 `core/src`、`web/src` 存在真实替换字符类乱码；PowerShell 仍可能把中文显示成乱码，不能据此改源码。
- 已完成第一批低风险前端规范清理：背包空态分支、主题读取空块、确认框无意义绑定、微信扫码调试输出、静态正则、`Friends.vue` 定义顺序、`Login.vue` 换行格式。
- 已完成前端全站 ESLint 清理：对 `web/src` 全量 `eslint --fix` 收敛缩进/换行/CSS 与 UnoCSS class 排序/import 顺序等自动可修项，并手工修复 4 处无法自动修复的问题（`AccountModal.vue` 的 `stopWxCheck` 定义顺序、`CharityFlowerActivityPanel.vue` 单行双语句、`StrategyTimingPanel.vue` 未使用的 `props`）；`web/src` 全量 ESLint 现为 0 error 0 warning，`web` 生产构建通过。
- `Renewal.vue` 已修复登录态入口与续费分支：`/renewal` 不再因有效 token 被路由守卫强制跳回 dashboard；已登录用户进入续费页会预填并锁定当前用户名，提交走 `/api/user/renew` 并同步本地用户信息；未登录用户仍走 `/api/public/renew`。旧版 `D:\github\qq-farm-2.3.1` 仅作为接口行为参考，未照搬产物。
- 登录页“账号续费”闭环已补齐：`Login.vue` 会把当前输入用户名带到 `/renewal`，`Renewal.vue` 公共续费成功后带用户名回 `/login`，登录页会在输入框为空时从 query 回填用户名；已登录用户续费仍走当前账号锁定流程。
- `Login.vue` 已开始结构瘦身：卡密领取结果弹窗、找回密码验证弹窗和设置新密码弹窗已抽到 `web/src/components/login/LoginModals.vue`，父页面保留登录/注册/找回密码请求与状态 wiring，行为不变。
- 登录密码强度逻辑已抽离：评分规则在 `web/src/composables/usePasswordStrength.ts`，展示条在 `web/src/components/login/PasswordStrengthMeter.vue`，登录注册表单和重置密码弹窗复用同一套规则与 UI。
- `Friends.vue` 的 QQ 好友自动同步设置块已抽到 `web/src/components/friends/FriendsSyncSettings.vue`；父页面保留设置保存/刷新/GID 弹窗状态，组件负责展示设置项、统计提示和入口按钮。
- `Friends.vue` 的好友列表卡片与分页已抽到 `web/src/components/friends/FriendsFriendList.vue`；父页面继续持有好友筛选、展开状态、操作确认、黑名单和头像错误状态。
- 后台连接堆积导致网站打不开的问题已做防护：`core/src/controllers/admin.js` 增加 HTTP request/header/keep-alive/idle socket 超时、连接 close 清理、JSON 请求体大小限制和 `/api/health`；`core/src/models/user-store.js` 将 IP 登录失败限制加硬为 1 分钟 6 次后锁 10 分钟，并在登录成功后清理当前 IP 失败计数。
- 页面切换短暂显示“未登录/账号未登录”的问题已修复：`status` store 新增当前账号状态就绪标记，`Dashboard.vue`、`Friends.vue`、`FarmPanel.vue`、`BagPanel.vue`、`TaskPanel.vue` 只在确认当前账号离线后显示离线空态，并避免组件首次挂载时清空已有账号状态。
- `Dashboard.vue` 已去掉顶部重复状态卡、日志说明条、动作说明条和中间重复摘要卡；保留账号资源卡、运行日志、筛选、倒计时和今日统计，仪表盘信息密度更低、干扰更少。
- `Shop.vue` 已把商城标题、账号资源、分区切换、排序和刷新收敛到一条稳定横栏；删除无引用的 `ShopOverviewPanel.vue`、`ShopInfoCard.vue`，去掉分区概览统计卡和各分区商品列表前的说明条，购买流程保持不变。
- `Illustrated.vue` 已把图鉴标题、解锁/未解锁/可购买/Lv 状态、图鉴类型切换、筛选、一键购买和刷新收敛到一条稳定横栏；去掉“当前查看建议、当前阻塞汇总、当前筛选下”等解释型摘要和重复统计卡，图鉴卡片和购买流程保持不变。
- 图鉴卡片已抽到 `web/src/components/illustrated/IllustratedItemCard.vue`，卡片密度、圆角、网格列数、图片区域、状态胶囊和底部按钮区已对齐商城商品卡；图鉴图片增加加载失败兜底。
- `Activity.vue` 已按商城/图鉴同款结构收紧：活动中心标题、荷露余额、今日剩余、奖池、兑换数量、当前账号、抽奖/兑换切换和刷新统一到顶部横栏；删除无引用的 `ActivityNavigation.vue`、`ActivityOverview.vue` 和旧活动卡类型，荷露抽奖/兑换流程保持不变；活动奖励图片增加加载失败兜底，避免显示破损图片。
- 活动中心已接入本期 4 个子活动入口：奇遇礼莲、荷露商店、荷风游记、节令小札；后端 `normalizeHeluGroup` 会从活动树中标准化子活动节点参数（id/title/status/time/payload），前端只展示这 4 个入口，不恢复已过期的粽香大比拼。奇遇礼莲/荷露商店继续绑定已验证抽奖/兑换操作，荷风游记/节令小札先展示活动节点参数，等确认协议操作字段后再补交互。
- `Friends.vue` 已去掉好友页顶部说明、好友总数/黑名单/最近访客/已知 GID 统计卡，以及“当前分区说明/当前局部结论”摘要组件；删除无引用的 `FriendsStatsGrid.vue`、`FriendsSummaryCards.vue`，保留搜索、tab、QQ 同步设置、好友列表、黑名单和访客功能。
- `Friends.vue` 已修复好友管理页后台刷新后自动回到顶部的问题：整页加载态只在首次无数据时显示，已有数据刷新不再卸载主体内容；账号 watcher 也收窄到账号 id/运行状态变化，避免普通账号对象更新触发列表重载。
- 布局账号入口已调整：新增 `TopAccountMenu.vue`，将账号切换、添加账号、管理账号和备注编辑入口从左侧栏搬到顶部栏右侧；`Sidebar.vue` 删除原账号选择块，左侧更专注于用户信息、导航和底部状态。
- 左侧导航菜单已简化为短标签：概览、个人、好友、活动、商城、图鉴、分析、设置、后台；后台仍保留管理员可见限制。
- 活动页荷露抽奖点完后疑似掉线的问题已做保守防护：`core/src/services/activity.js` 对活动 Operate 增加连接状态检查，免费多抽改为串行节流请求并延迟刷新活动状态；`web/src/views/Activity.vue` 防止抽奖请求重复提交。服务已重启，`/api/health` 返回 200。
- “雨落成诗”已接入活动页与后端接口：支持天气状态、天气采集瓶购买、好友雷雨采集、雷雨召唤瓶使用、气象研究解锁、气象任务展示和闪电变异类型 12 识别；活动有效期为 2026-08-26 10:00:00 至 2026-09-08 23:59:59（Asia/Shanghai）。已补齐 4002/4003 闪电感应、2159 雨落成诗头像框等活动物品名称/图标映射，避免气象研究后段奖励显示“未知物品”。账号设置 → 日常与活动已新增雨落成诗二级卡片，可配置自动买瓶、自动采集、自动召唤和自动研究；活动过期后后端会压关，前端二级卡片和活动入口会随时间窗隐藏。活动页雨落成诗面板已改为只读展示，手动操作入口不再显示。
- 萌宠日记（S3 比熊萌宠主题赛季，`2026090100`）已接入为只读活动状态展示：`activitypb.proto` 为 `ActivityNode` 字段 115 新增 `ActivityBodyPetDiary` 及比熊成长/寻宝/照片墙/锦囊子消息；`services/activity.js` 新增只读归一化与 `getPetDiaryActivity`，worker RPC/`data-provider`/`/api/activity/pet-diary` 路由与活动卡背景均已接通；前端 `Activity.vue` 接入 `PetDiaryActivityPanel.vue` 只读面板（比熊之家、爪印手记、拾物小铺、比熊赠礼），不提供投喂/寻宝/兑换/领取操作入口。协议字段来自 2026-09-10 官方 List/Operate 明文响应，子字段语义为推断（置信度见文档），证据与待确认项见 `core/docs/pet-diary-protocol-recovery.md`；`core/test/pet-diary-activity.test.js` 4/4 通过，后端 `node --check`/`require` 与前端构建通过。
- 蹲守与飞升/秒偷功能已完全去除：前端设置 tab、独立蹲守页、相关组件、setting store 字段、后端 `/api/instant-steal`/`/api/stakeout` 路由、worker RPC/自动启动、runtime provider/config snapshot、store 配置模型和对应 service 文件均已删除；源码残留扫描无匹配。
- `core/src/controllers/admin-bag-routes.js` 已从 `_v###`/逗号表达式风格清理为命名 helper + 清晰路由处理；接口路径、主要返回结构和旧版缺账号行为保持对齐。
- `core/src/controllers/admin-farm-resource-routes.js` 已清理为命名 helper + 清晰路由处理；`/api/status` 缺账号 200 返回、其它资源接口缺账号 400 的旧行为保持对齐。
- `core/src/controllers/admin-public-info-routes.js` 已清理为命名 helper + 清晰路由处理；公共信息、更新日志、鉴权校验和 scheduler fallback 的返回结构保持对齐。
- `core/src/controllers/admin.js` 已完成入口可读性清理：CORS、静态资源、鉴权门、SPA fallback、Socket.IO 订阅逻辑均已命名化；`core/src/controllers/admin*.js` 当前无 `_v###` 残留。
- 已完成的关键结构成果：`Activity.vue`、`Settings.vue`、`Shop.vue` 已拆成页面协调器 + 组件/composables；`Friends.vue` 已开始拆页面壳，标题/搜索、统计卡、摘要提示和 tab 条已抽到 `web/src/components/friends/`；后端 `admin.js` 已拆出大量领域路由，入口主要负责启动、注册、静态资源、鉴权和 Socket.IO。
- `AdminPanel.vue` 已继续结构拆分：登录日志面板已抽到 `web/src/components/admin/AdminLoginLogPanel.vue`，登录日志状态/格式化/清空逻辑已抽到 `web/src/composables/useAdminLoginLogs.ts`，清空确认弹窗已抽到 `web/src/components/admin/AdminLoginLogConfirmModal.vue`；卡密面板已抽到 `web/src/components/admin/AdminCardPanel.vue`，卡密状态、筛选、复制、创建、删除和领取开关逻辑已抽到 `web/src/composables/useAdminCards.ts`，卡密确认弹窗已抽到 `web/src/components/admin/AdminCardConfirmModals.vue`；用户面板已抽到 `web/src/components/admin/AdminUserPanel.vue`，用户状态、统计、续费、封禁、删除、清理到期和编辑逻辑已抽到 `web/src/composables/useAdminUsers.ts`，用户确认弹窗已抽到 `web/src/components/admin/AdminUserConfirmModals.vue`；系统配置面板已抽到 `web/src/components/admin/AdminSystemPanel.vue`，系统/微信配置状态、加载、保存、重置和确认框开关已抽到 `web/src/composables/useAdminSystemConfig.ts`，对应确认弹窗已抽到 `web/src/components/admin/AdminSystemConfigConfirmModals.vue`；后台通用提示弹窗已抽到 `web/src/components/admin/AdminAlertModal.vue`；顶部汇总和 tab 外壳已抽到 `web/src/components/admin/AdminPanelHeader.vue`、`web/src/components/admin/AdminPanelTabs.vue`，页面目前主要负责模块 wiring。
- 活动能力状态：Helu 活动可见；南瓜活动后端保留但前端隐藏，属于 dormant/hidden 能力。
- 当前只保留 `progress.md` 作为接力摘要；`maintenance.md` 已删除，后续维护信息写回本文件但保持短而有用。

# 当前优先级

1. 继续拆高风险大页面，优先 `Friends.vue` 或 `AdminPanel.vue`，其次 `Login.vue`、`Sidebar.vue`、`Dashboard.vue`、`Analytics.vue`。
2. 继续拆 `AdminPanel.vue`，优先按卡密、用户、系统配置拆成 focused components/composables。
3. 对照旧版 `D:\github\qq-farm-2.3.1` 补齐/核对功能时，只迁移必要行为，按当前项目结构重落地。
4. 目录结构统一要随着模块拆分逐步做，不要先做大规模移动造成引用噪音。

# 关键决策

- 大页面只做协调器；业务规则、状态组合、重复 UI 拆到 composables、stores 或 focused components。
- 后端入口只做 wiring；具体接口按领域放到 `admin-*-routes.js` 和领域 helper/service 中。
- 后端 admin 控制器目录的 `_v###` 债务已清空；后续不要重新引入逗号表达式/反编译式临时变量风格。
- 隐藏或内部能力必须在接力记录中说明；尤其南瓜活动不要重新暴露到导航或活动页，除非用户明确要求。
- 中文乱码判断以 UTF-8 真实内容为准；终端乱码先用 Node 读取文件确认。
- 前端全量 ESLint 当前可通过；继续优先对触碰文件跑 targeted lint，阶段性再跑全量 lint 和构建。
- `git status`/`git diff` 在当前 worktree 曾不可用或不可靠；继续工作以实际文件内容和命令检查为准，不依赖 git 状态判断。

# 未完成待办

- 前端结构治理：
  - `Friends.vue`：页面仍大；标题/搜索、统计卡、摘要提示和 tab 条已抽到 `web/src/components/friends/`。下一步适合继续拆 QQ 好友自动同步设置块、好友列表项/分页、访客列表或 GID 弹窗。
  - `AdminPanel.vue`：主要面板 UI、卡密/用户/日志/系统配置逻辑、全部后台弹窗模板、顶部汇总和 tab 外壳均已抽离；页面目前主要保留各模块 wiring，后续优先转向 `Friends.vue`、`Login.vue`、`Sidebar.vue` 等仍偏大的页面。
  - 快速排查显示剩余主要债务不是语法错误，而是大文件和类型边界：`Friends.vue`、`Login.vue`、`Sidebar.vue`、`Dashboard.vue`、`Analytics.vue`、`models/store.js`、`core/worker.js`、`models/user-store.js`、`services/activity.js` 等仍适合分批拆分；前端大量 `any` 应优先从 store/API 边界和高频页面逐步收窄。
  - 逐步减少 `any`，优先在 store/API 边界和高频页面中补类型，不做一次性全项目类型重写。
- 后端结构治理：
  - 已清理 `admin.js`、`admin-bag-routes.js`、`admin-farm-resource-routes.js`、`admin-public-info-routes.js`，这些文件应保持 0 个 `_v###`。
  - 大型服务/模型仍需逐步拆分：`models/store.js`、`core/worker.js`、`models/user-store.js`、`services/activity.js`、好友/农场/仓库相关服务。
- 功能面核对：
  - 新增或恢复功能时，确认它是可见、隐藏、内部还是休眠。
  - 检查是否还有后端存在但前端无入口、且未记录状态的能力。

# 接力约定

- 新对话先读本文件，再读相关源码；不要凭记忆改。
- 每次只选一个明确模块推进：先读当前实现，必要时对照 `D:\github\qq-farm-2.3.1`，再小步修改和验证。
- 手工编辑使用 `apply_patch`；不要回滚用户或其他过程留下的无关改动。
- 后端改动后至少跑 `node --check` 对触碰文件；拆/改路由时再跑 `node -e "require('./core/src/controllers/admin'); console.log('backend require ok')"`。
- 前端改动后至少跑 targeted `npx eslint ...`；影响页面/组件结构时跑 `cd web && npm run build`。
- `@vueuse/core` Rollup pure-comment warning 是已知非阻塞警告；UnoCSS 拉取 Google web fonts 超时也可能在网络不稳时出现。构建退出码为 0 即可记录为通过。
- 遇到中文显示异常，先用 `node -e "const fs=require('fs'); console.log(fs.readFileSync('path','utf8'))"` 确认真实内容。
- 不把全站 lint、全站格式化、全站类型改造作为默认目标；只有用户明确要求或分阶段收敛到位后再做。
- 要记得及时更新本文件

## 2026-07-06 TSDK / ACE 修复

- 已对官方 `game.js` 完成关键静态去混淆：官方调用为
  `SdkInitEx(3167, 0)`；`AnoUserLogin(0, openId)` 仅维护账号身份。
- 官方网关 Token 来自 `AceManager.randomStr()`，格式为 64～127 个字母数字字符
  加 `=`，不是 `_generate_token` 返回的 24 字符 hash；登录后还会优先消费一次
  `_get_encrypted_init_info`，对应抓包里首条 `AllLands` 的特殊长 Token。
- ACE 生命周期已按官方封装拆分：5 秒处理接收队列和轮询上报、25 秒 TSDK
  heartbeat、30 秒速度检测、150 秒状态上报、180 秒函数检查。
- 官方 20260706 抓包确认：登录和好友操作 Token 均符合随机格式；4 分钟后仍能
  Enter、PutWeeds、PutInsects、Farming，说明持续有效依赖 ACE 状态而非固定 Token。
- `core` 定向 ESLint 通过，6 个离线测试通过；仍需使用测试账号完成至少 5 分钟
  在线好友操作验证后才能确认服务端链路完全恢复。
- 活动中心已替换为“心许千灯星垂野”：接入主活动 `2026072700`、观星礼录
  `2026072701/cmd 21`、星砂商店打开 `2026072702/cmd 7`、兑换
  `2026072702/cmd 1`、千星游记和节令小札；可展示并领取二十八星宿奖励，星砂商店
  展示 18 项商品、协议映射名和星砂余额，并支持装扮及化肥兑换。
- 已将本轮活动更新沉淀为
  `core/docs/activity-update-runbook.md`，并新增
  `npm run inspect:activity-har -- <HAR>` 脱敏检查命令，后续活动按“完整抓包、协议表、
  官方资源、种子/植物/果实映射、分层接入、离线与在线验收”流程更新。
