# RPG Maker MZ MCP 选型（2026-08-29）

## 结论

**综合首选：[Redseb/rpgmaker-mz-mcp](https://github.com/Redseb/rpgmaker-mz-mcp)，生产使用固定到 `rpgmaker-mz-mcp@1.3.0`。**

它不是 star 最多、历史也不算长；即使降低 npm 分发权重，把工具覆盖、用例覆盖和代码可维护性提到主要权重，它仍是当前 MZ 专用候选里最平衡的底座。它有连续版本、GitHub CI、49 个单元/集成测试文件、正式 stdio MCP 入口，以及覆盖所有写工具的 `dryRun`。更重要的是，它不仅做数据库 CRUD，还覆盖地图树、事件结构、自动 autotile、语义 tile catalog、通行标志、资产、插件命令扫描和跨文件引用校验；结构不合法的事件写入默认会被拒绝。证据见 [README/Capabilities](https://github.com/Redseb/rpgmaker-mz-mcp#capabilities)、[完整工具表](https://github.com/Redseb/rpgmaker-mz-mcp#available-tools)、[CI workflow](https://github.com/Redseb/rpgmaker-mz-mcp/blob/master/.github/workflows/ci.yml)、[package.json](https://github.com/Redseb/rpgmaker-mz-mcp/blob/master/package.json) 与 [v1.3.0 commit](https://github.com/Redseb/rpgmaker-mz-mcp/commit/7e8dcc09684f0e627ef31dfd69929401f5bff5f2)。

本项目已有严格 Git 工作流，因此本次没有把自动 `.bak` 备份放在高权重。按“成熟度、稳定性 > 好用程度 > 功能数量”的排序，Redseb 仍胜过写入更保守但长期未维护的 a951，也胜过能力更夸张但尚无稳定发布/安装通道的 runtime-bridge 项目。

**备选：**

1. **保守写入优先：** [a951753abc/rpgmaker-mz-mcp](https://github.com/a951753abc/rpgmaker-mz-mcp)。23 个工具、42 项测试，采用临时文件后 rename 的原子写入、写前 `.bak`、Zod 读入验证和 stderr-only 日志；但只能源码安装、没有已核实的 npm 发布/持续 release 节奏，最后提交停在 2026-02-16，覆盖面明显小于 Redseb，且许可证为 GPL-3.0。见其 [README](https://github.com/a951753abc/rpgmaker-mz-mcp#readme) 与 [最新 commit](https://github.com/a951753abc/rpgmaker-mz-mcp/commit/560b6767055dc8a44873989244ae7f53f6855fd2)。
2. **必须控制运行中游戏：**把 [Zagos/RPG-Maker-AI-Toolkit](https://github.com/Zagos/RPG-Maker-AI-Toolkit) 或 [NewtonAlves/RPG-Maker-MZ---MCP-Ultimate](https://github.com/NewtonAlves/RPG-Maker-MZ---MCP-Ultimate) 当作能力参考或隔离原型，而不是直接换掉首选。Zagos 的实际 105-tool / 501-test 覆盖很强；Newton 有 193 tools、带 token 的 localhost WebSocket 和 111 项 unit tests。但二者在源码实测中分别暴露出失败的 lint gate/不安全 bridge 默认值，以及无法从 `dist` 启动的交付硬错误。详细证据见下文“源码候选实测复核”。

## 首选的实际能力与边界

| 维度 | Redseb v1.3.0 |
| --- | --- |
| MZ 专用能力 | 119 个工具；actors/classes/skills/items/equipment/states/enemies/troops/common events；地图创建/删除/树编辑；event command builders；NPC/宝箱/传送；自动 autotile、对象摆放、tileset flags；资源与插件命令扫描；系统设置和引用校验。不是用工具数量直接判胜，但其覆盖没有明显停留在 CRUD 层。 |
| 读写/编辑 | 直接读写项目 `data/*.json`；可编辑 maps、events、tiles、tilesets flags、system 等。所有 mutating tools 都有 `dryRun`；结构错误的事件默认拒写，需显式 `force` 才绕过。 |
| 正确性 | Zod 输入 schema、事件 command arity/block validation、跨文件 reference lint、ID 使用扫描、项目/资产感知；源码树在 v1.3.0 有 49 个 Vitest 单元/集成测试文件（本次环境实际通过 603 个测试），CI 运行 lint、format check、测试、build 与同步检查。 |
| 安装 | 任意 MCP 客户端可运行 npm 包；Claude Code 另有 plugin（server + authoring skills），Claude Desktop 另有 MCPB。npm registry 当前 latest 是 1.3.0，2026-08-03 发布；2026-08-21 至 08-27 有 161 次下载。[npm registry metadata](https://registry.npmjs.org/rpgmaker-mz-mcp)、[npm downloads API](https://api.npmjs.org/downloads/point/last-week/rpgmaker-mz-mcp)、[Releases](https://github.com/Redseb/rpgmaker-mz-mcp/releases)。 |
| 平台 | Node.js 18+；README 提供 Windows、macOS/Linux 配置。它本身只操作跨平台项目文件，不要求 MZ 安装路径。 |
| 运行/调试 | **没有 playtest launch、运行时状态检查、截图、日志或输入自动化。** `scan_plugins` 是静态扫描，不能代替运行时调试。需要自动 playtest 时，应与现有 Windows harness 组合，而不是期待这个 MCP 单独完成。 |
| 已知限制 | 编辑器必须关闭；不编辑 `Animations.json`；plugin annotations 不足时只能做有限验证；没有自动备份；底层是直接 `writeFile`，不是 tmp→rename 原子提交。[Safety](https://github.com/Redseb/rpgmaker-mz-mcp#safety-and-best-practices)、[Limitations](https://github.com/Redseb/rpgmaker-mz-mcp#limitations)、[fileHandler.ts](https://github.com/Redseb/rpgmaker-mz-mcp/blob/master/src/utils/fileHandler.ts)。 |
| 已知 issue | 4 个 open issue 均由维护者自己记录，主要是 common-event 空槽 ID、未 catalog tileset 的空结果语义、空 event list 归一化和 object tile 可发现性；属于真实的易用性/边界问题，当前未见数据破坏类 issue。[#5](https://github.com/Redseb/rpgmaker-mz-mcp/issues/5)、[#6](https://github.com/Redseb/rpgmaker-mz-mcp/issues/6)、[#7](https://github.com/Redseb/rpgmaker-mz-mcp/issues/7)、[#8](https://github.com/Redseb/rpgmaker-mz-mcp/issues/8)。 |

### 推荐安装形态

通用 MCP 客户端使用工具 server 即可，并固定版本：

```json
{
  "mcpServers": {
    "rpgmaker-mz": {
      "command": "npx",
      "args": ["-y", "rpgmaker-mz-mcp@1.3.0"],
      "env": {
        "RPGMAKER_PROJECT_PATH": "/absolute/path/to/project"
      }
    }
  }
}
```

README 示例使用 `@latest`，但固定版本能避免每次启动自动取得未经本项目验证的新发布。若使用 Claude Code plugin，要知道它同时安装 `rpgmaker-authoring` 与 `tileset-catalog` 两个 **Agent Skills**；skills 是指导模型如何用工具的提示规则，不是 MCP server 本身。只需要工具时直接用 npm MCP 配置，权限和行为边界更清楚。[安装说明](https://github.com/Redseb/rpgmaker-mz-mcp#installation)。

## 成熟度与维护对比

下表的 stars/forks 是 2026-08-29 查询 GitHub repository API 的快照；“最近提交”来自各默认分支 Atom feed，并链接到具体 commit。stars 只作为采用信号，不作为质量结论。

| 候选 | stars / forks | 最近默认分支提交 | 测试、CI、发布 | 判断 |
| --- | ---: | --- | --- | --- |
| [Redseb](https://github.com/Redseb/rpgmaker-mz-mcp) | 4 / 1 | [2026-08-03, v1.3.0](https://github.com/Redseb/rpgmaker-mz-mcp/commit/7e8dcc09684f0e627ef31dfd69929401f5bff5f2) | 49 个 test files / 本次通过 603 个测试；CI；5 个 npm 版本（1.0.0→1.3.0）；MCPB/plugin/npm | **首选**。短历史，但源码、测试和交付链最平衡。 |
| [a951753abc](https://github.com/a951753abc/rpgmaker-mz-mcp) | 8 / 1 | [2026-02-16](https://github.com/a951753abc/rpgmaker-mz-mcp/commit/560b6767055dc8a44873989244ae7f53f6855fd2) | README 声明 42 tests；未核实到 npm/release 节奏；源码 build | **备选**。写入安全强，维护停滞、覆盖较窄。 |
| [k4zuki0539 original](https://github.com/k4zuki0539/-rpgmaker-mz-mcp) | 28 / 10 | [2025-10-19](https://github.com/k4zuki0539/-rpgmaker-mz-mcp/commit/3f1ea4bfc552509c986e58b22aad9427f6f3e0b6) | 无 test script/CI；源码 build；旧 MCP SDK | **不推荐**。star 最高但只有初期实现；Redseb 由它 fork 后已独立扩展。[Redseb acknowledgement](https://github.com/Redseb/rpgmaker-mz-mcp#acknowledgements)。 |
| [devmagary/MCP-Maker](https://github.com/devmagary/MCP-Maker) | 2 / 2 | [2025-12-11](https://github.com/devmagary/MCP-Maker/commit/c3aa4fead38f2f92ca1221e60f924acc9410e7a0) | package 无 test script；仅源码 build；README 把 event creation 写成未来项 | **不推荐**。只到基础 CRUD/map/plugin install，稳定性证据弱。 |
| [rein1225](https://github.com/rein1225/RPGMakerMZ_MCP) | 1 / 0 | [2025-11-29](https://github.com/rein1225/RPGMakerMZ_MCP/commit/0e74038c653bbd3c2ab5ddc3a4b25ba45f7e703f) | npm 0.1.2；Vitest/CI；28 tools；有 playtest | **不推荐作默认**。README 明示 experimental/WIP、仅 Windows + Antigravity 验证，且有可执行 post-launch JS 的高权限调试面。[README](https://github.com/rein1225/RPGMakerMZ_MCP#readme)。 |
| [Enushin](https://github.com/Enushin/RPG-Maker-MZ-MCP) | 1 / 0 | [2025-09-30](https://github.com/Enushin/RPG-Maker-MZ-MCP/commit/faf92c902061fb5d280a1d58d8cded2db2af84c8) | 旧 SDK；安装文档仍含 `yourusername` 与 npm“若已发布”占位 | **不推荐**。文档/分发可信度不足。 |
| [imaginalnika](https://github.com/imaginalnika/rpgmaker-mz-mcp) | 2 / 6 | [2025-11-08](https://github.com/imaginalnika/rpgmaker-mz-mcp/commit/951d0efede6ae7fda630132db940192cb1f33079) | 原实现的语言 fork；旧 SDK/旧仓库链接 | **不推荐**。fork 数不是活跃维护证据。 |

功能很大的 Newton（2 / 1，最近提交 2026-06-02）与 Zagos（1 / 1，最近提交 2026-05-16）没有放入上表主排名，因为实测显示它们更像能力很宽的源码项目，而不是稳定底座。它们值得为 runtime bridge 单独取材，但不能仅凭 README 的工具/测试数量视为成熟。

## 源码候选实测复核

### 方法与结论

2026-08-29 在独立 reference checkout 中审查固定 commit，并运行最小 `npm ci`、test、build 和 MCP `tools/list` probe；没有连接或修改真实 MZ 项目。Redseb 与 a951 使用 macOS arm64 / Node 24.18.1，Zagos 按仓库 `.nvmrc` 使用 Node 20.20.2；Newton 的结果来自同轮独立源码审查。测试数字以本次 Vitest 输出为准，不沿用 README badge。

**结论不改变：没有发现“未发 npm 但综合成熟度、稳定性、好用程度超过 Redseb”的实现。** 如果只按功能数量或 runtime 能力排名，Zagos 和 Newton 会赢；一旦把测试覆盖的落点、CI 是否真的通过、写入边界、DSH schema/命名兼容和多 workspace 生命周期一起考虑，它们都需要先 fork 修复，不能直接作为默认 server。npm 是否发布不是作出这个判断的主要原因。

| 候选与固定点 | 实测结果 | 功能、测试与代码评价 | DSH/安全/生命周期结论 |
| --- | --- | --- | --- |
| **[Redseb 1.3.0 / `7e8dcc0`](https://github.com/Redseb/rpgmaker-mz-mcp/commit/7e8dcc09684f0e627ef31dfd69929401f5bff5f2)** | `npm ci`、49 files / **603 tests**、build、lint、format、tool/version sync 全通过；真实 `tools/list` 为 **119**。 | 119 tools 覆盖数据库、地图树、事件 command builder/结构验证、autotile/对象 tile、tileset flags、资产与引用；tool modules、共享 registry/commit context、validation modules 分层清楚。测试直接落在 tool integration、地图、事件结构、tile 编码/绘制与引用验证上。 | 119 个 raw names 全符合 DSH `[a-z][a-z0-9_]*`；实际 schema 没有 `type` array、`nullable`、`$ref` 或 `anyOf`。默认只写 stderr。缺点仍是单文件直接 `writeFile`、无跨文件事务；优势是所有 mutating tools 统一 `dryRun`，风险面小且易加固。[file handler](https://github.com/Redseb/rpgmaker-mz-mcp/blob/7e8dcc09684f0e627ef31dfd69929401f5bff5f2/src/utils/fileHandler.ts)、[registry](https://github.com/Redseb/rpgmaker-mz-mcp/blob/7e8dcc09684f0e627ef31dfd69929401f5bff5f2/src/registry.ts)。 |
| **[Zagos / `4076dd2`](https://github.com/Zagos/RPG-Maker-AI-Toolkit/commit/4076dd22a5276e11a91be7cf211b7ab9d86c9fa5)** | `npm ci`、26 files / **501 tests**、build 通过；真实 `tools/list` 为 **105**。但仓库 CI 明确调用的 `npm run lint` 在 HEAD **失败 168 项**，所以不能把“有 CI 文件”等同于健康 CI。[CI](https://github.com/Zagos/RPG-Maker-AI-Toolkit/blob/4076dd22a5276e11a91be7cf211b7ab9d86c9fa5/.github/workflows/ci.yml)、[package scripts](https://github.com/Zagos/RPG-Maker-AI-Toolkit/blob/4076dd22a5276e11a91be7cf211b7ab9d86c9fa5/package.json)。 | 数据库、地图/事件/tileset、批量编辑、localization 和 runtime bridge 的场景面确实很强；501 tests 也大多是临时项目上的行为测试，并非空 badge。不过 runtime happy-path 主要通过内存 bridge/定时 ack 模拟，部分 plugin 测试只是检查生成源码包含字符串；470 行入口、721 行 writer、手写 tool 列表与 handler registry 三处同步，维护成本高于 Redseb。 | 105 个 schema 处于 DSH 支持词汇内，但 **全部工具名使用 kebab-case**，与当前 raw-name contract 不兼容，需稳定映射。server 每次启动都占用固定 `127.0.0.1:9001`，bridge 无 token 且响应 `Access-Control-Allow-Origin: *`，因此 `(engine, workspace)` 多实例会端口冲突；写入为同步 direct write，多文件操作无回滚；`MCP_DEBUG=true` 时 writer 用 `console.log` 污染 stdio stdout。没有统一 `dryRun`。[entry/bridge](https://github.com/Zagos/RPG-Maker-AI-Toolkit/blob/4076dd22a5276e11a91be7cf211b7ab9d86c9fa5/src/index.ts)、[writer](https://github.com/Zagos/RPG-Maker-AI-Toolkit/blob/4076dd22a5276e11a91be7cf211b7ab9d86c9fa5/src/rpgmaker/writer.ts)。 |
| **[Newton / `af720ba`](https://github.com/NewtonAlves/RPG-Maker-MZ---MCP-Ultimate/commit/af720ba00aec1b6bed7699bd10b2316f75bd1ca6)** | 10 files / **111 tests**、typecheck、build 通过；源码模式能列出 **193** tools。但 `node dist/index.js` 立即因缺少 `dist/data/mz-codes/event-commands.json` 崩溃；pack 结果也不含该数据或 dashboard assets。即使不要求 npm，它的标准构建产物也不可运行。[package](https://github.com/NewtonAlves/RPG-Maker-MZ---MCP-Ultimate/blob/af720ba00aec1b6bed7699bd10b2316f75bd1ca6/package.json)、[loader](https://github.com/NewtonAlves/RPG-Maker-MZ---MCP-Ultimate/blob/af720ba00aec1b6bed7699bd10b2316f75bd1ca6/src/core/mz-codes-loader.ts)。 | 193 tools 的 runtime companion、截图/日志、save、语义分析和地图能力最宽；代码总体模块化且有 Zod。111 tests 是真实行为测试，但集中在 code catalog、schema、autotile、memory、recipe、plugin parser 和 SafeWriter；193 handlers、工具 schema、build/package/startup、bridge/path boundaries 基本未进自动 suite。15 个 smoke scripts 未接入 npm/CI，并硬编码 Windows MZ `newdata`。仓库仅 8 commits、单作者、无 CI/tag/release。 | 名称全合规，但 3 个参数 schema 使用 DSH 不支持的 `type: [...]`。token 化 localhost bridge 比 Zagos 好，但注册工具即启动、写 token/port，stdin 关闭后仍驻留。README 的“所有写入原子”不成立：只有部分 SafeWriter 路径 tmp→rename；save/CSV/localization/assets 仍直接写或 copy/delete，多文件 map/restore 无事务。asset 名和若干 output path 缺 workspace containment，可 `../` 越界。[SafeWriter](https://github.com/NewtonAlves/RPG-Maker-MZ---MCP-Ultimate/blob/af720ba00aec1b6bed7699bd10b2316f75bd1ca6/src/core/safe-writer.ts)、[bridge](https://github.com/NewtonAlves/RPG-Maker-MZ---MCP-Ultimate/blob/af720ba00aec1b6bed7699bd10b2316f75bd1ca6/src/runtime/bridge.ts)。 |
| **[a951 / `560b676`](https://github.com/a951753abc/rpgmaker-mz-mcp/commit/560b6767055dc8a44873989244ae7f53f6855fd2)** | `npm ci`、5 files / **42 tests**、build 通过；真实 `tools/list` 为 **23**。没有 CI。 | 测试覆盖 FileHandler、ProjectManager、数据库与 map tools 的基础行为；23 tools 足够做数据库/地图/事件 CRUD 和 scenario 生成，但没有 autotile/tileset flag/runtime bridge，事件/跨文件验证明显浅于 Redseb。全部 14 commits 集中在 2026-02-16 一天。 | 名称与 schema 可直接通过当前 DSH 约束，日志只走 stderr。单文件 tmp→rename 和 `.bak` 优于 Redseb 当前 writer，但 tmp 名固定会并发碰撞，多文件仍无事务；安全写入优势不足以抵消功能与验证覆盖差距。[FileHandler](https://github.com/a951753abc/rpgmaker-mz-mcp/blob/560b6767055dc8a44873989244ae7f53f6855fd2/src/core/file-handler.ts)。 |

### 对“未发布但更好”的直接回答

- **整体默认方案：没有。** Redseb 仍是最适合直接接入 DSH 的基础。
- **功能覆盖/用例数量：Zagos 更强于原先判断。** 它不是应忽略的玩具项目；若目标变成“尽快拿到 runtime 控制和 bulk/localization 能力”，它值得做隔离 fork。但先要移除/鉴权默认 bridge、动态分配 workspace 端口、统一工具名、修复 lint、加 `dryRun`/原子写和 transaction boundary。
- **未来 fork 的能力矿藏：Newton 最丰富。** companion token、截图/日志、save debugging、semantic analysis 值得借鉴；当前 build artifact、路径 containment、schema 和生命周期问题使得直接基于它承担主线风险过高。
- **写入保守：a951 最简单。** 它的 per-file atomic rename 是明确优点，但没有在工具覆盖、测试覆盖或维护活跃度上整体超过 Redseb。
- **其他候选未翻盘：**rein1225 虽有 playtest/Puppeteer，但仓库包含提交进 Git 的 `node_modules`，CI workflow 有重复/错位步骤，默认依赖和权限面远大于编辑型 server；原始 k4zuki、MCP-Maker、Enushin 等仍缺足够测试或事件/地图深度。

## 真 MCP、连接器、脚本与 Skill 的区别

真正的 MCP server 需要作为 MCP transport endpoint 向客户端暴露 protocol tools/resources；stdio server 的 stdout 还必须保留给 JSON-RPC。可参考 [MCP transport specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)。

- **真正的 MCP servers：**Redseb、a951753abc、k4zuki0539、devmagary、rein1225、Enushin、Newton、Zagos。它们都有 MCP SDK/server 入口，能力与成熟度不同。
- **不是 MCP server：**[narnianpony/rpgmaker-mz-bash-mcp](https://github.com/narnianpony/rpgmaker-mz-bash-mcp) 明确说自己是 Bash + jq 的本地 CLI port，不实现 JSON-RPC/stdio MCP。它有 61 个 shell functions，终端 Agent 可以调用，但不要把它登记为 MCP server。
- **不是 MCP server：**[haramaru770/mz-mcp-easy-connector](https://github.com/haramaru770/mz-mcp-easy-connector) 是 Windows x64 GUI 连接器，负责检查 Node/npx、把 **Redseb server** 写入 Codex `config.toml` 并做连接测试；它本身不提供 RPG Maker 工具。其二进制未签名且 README 标为 beta。
- **不是独立 MCP server：**Redseb 仓库的 `rpgmaker-authoring` / `tileset-catalog` 是 Agent Skills，只负责告诉模型怎样使用 MCP 工具。它们可以改善结果，但不能独立读写 MZ 项目。
- **不是合适的 MZ 首选：**RPG Maker MV/XP 专用 MCP 即使宣称数据格式接近，也不等于经过 MZ 验证；例如 MV server 只能作为兼容性实验，不应替代 MZ 专用实现。

## 安全建议

1. 只把 `RPGMAKER_PROJECT_PATH` 指向一个纳入 Git 的单一项目，并在大量修改前确认工作树状态。
2. 固定 npm 版本，不使用 `@latest`；升级时先看 release diff，再在 disposable project 上跑读、`dryRun`、小写入、MZ 打开验证。
3. 默认先调用 `dryRun: true`，审查 diff 后才写；不要常态使用 `force: true`。
4. 写入时关闭 MZ editor，避免编辑器保存覆盖 MCP 结果。这是所有直接 JSON 写入方案共有的并发风险。
5. `set_project` 能在运行中重新定向到另一个有效 MZ 目录；MCP 进程继承本机用户的文件权限。只给受信任 Agent 使用，并限制客户端的 tool approval/allowed tools。
6. Redseb 不启动程序、不执行项目插件源码，权限面比 runtime bridge 小；Newton/Zagos/rein 的 companion、WebSocket、launch 或 eval/post-launch-script 能力应另做端口绑定、token、任意代码与进程生命周期审计。

## 最小验证建议

在采用 Redseb 前，用一个 test-owned MZ fixture 做一次短 probe：固定 `1.3.0` 启动、确认 `tools/list`、读取项目、对一个 System/actor/map 变更执行 `dryRun`、提交一个小变更、运行 `validate_project` 与 `validate_references`，最后由 MZ 打开该 fixture。不要在首次连接时直接写真实项目；运行时 Playtest 仍由现有 Windows harness 承担。
