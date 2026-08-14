# dsh-testgen

> 面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的自动化单元测试生成插件：`/testgen` 命令 + `generate_tests` 工具，自动生成测试、运行项目测试框架，并**持续修复失败直到通过**——有界、可观测、对改动诚实。

[![release](https://img.shields.io/github/v/release/bujue600-arch/dsh-testgen?color=4D6BFE)](https://github.com/bujue600-arch/dsh-testgen/releases)
[![license](https://img.shields.io/github/license/bujue600-arch/dsh-testgen)](./LICENSE)
[![CI](https://github.com/bujue600-arch/dsh-testgen/actions/workflows/ci.yml/badge.svg)](https://github.com/bujue600-arch/dsh-testgen/actions/workflows/ci.yml)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-4D6BFE?logo=deepseek&logoColor=white)](https://github.com/topics/dsh-plugin)

[English](./README.md) | 中文

---

## 为什么需要这个插件

DeepSeek Harness 的 Agent 不断写代码——却常常不写测试。`dsh-testgen` 在框架内部补上这个闭环：

- **给人一条命令** —— `/testgen src/utils/math.ts`，生成、运行、修复一步到位。
- **给 Agent 一个工具** —— Agent 写完代码后可直接调用 `generate_tests`，闭环留在会话里。
- **双生成器，永不卡死** —— 配置了 LLM 时生成行为测试；没有 LLM 时退化为确定性结构冒烟测试（零依赖、离线可用）。
- **真正的修复循环** —— 从 vitest / jest / mocha / node:test 输出中解析失败并回喂给 LLM，迭代次数有上界，且只会重写它自己生成的测试文件。

不做重复轮子：生态里有 Git 工具和评测框架，但没有把「生成 → 运行 → 修复」单元测试作为一等框架能力的插件。

## 特性

| | |
|---|---|
| ⚡ `/testgen` 斜杠命令 | `[options] <file-or-glob>`、`--json`、`--help`；结果直接渲染在 Web UI |
| 🛠️ `generate_tests` 模型工具 | 结构化 JSON 输入/输出、协作式取消、从不并行执行 |
| 🧠 LLM 生成器 | 经由 `ctx.llm` 流式生成，遵循你的 provider/model，源文件截断有界 |
| 🧩 模板生成器 | 零依赖，从导出符号搭建冒烟测试——不需要 API Key |
| 🔁 生成 → 运行 → 修复 | 按框架解析失败，`maxIterations` 限定循环 |
| 🧪 运行器自动探测 | 按项目依赖识别 vitest / jest / mocha；兜底 `node --test` |
| 🔥 配置热加载 | `settings.yaml` 的 `testgen:` 段，修改后下次调用即生效，无需重启 |
| 🧰 生命周期干净 | 注册与在途任务随插件 fiber 卸载；绝不覆盖用户已有的测试 |
| 📐 全链路类型化 | TypeScript、schemastery 配置、稳定错误码、78 个单元测试（含真实端到端） |

## 演示

终端风格演示（确定性模板生成器 + 真实 `node --test` 运行）：

![dsh-testgen CLI demo](./assets/demo-cli.png)

在 Web UI 中，插件出现在 **Settings → Plugins → Plugin list**，状态为已启用（真实 `dsh web` 启动，共加载 134 个插件）：

![dsh-testgen Web UI](./assets/demo-web.png)

## 安装

需要 Node ≥ 22 与 `dsh`（DeepSeek Harness CLI）。

```sh
# 直接从 GitHub 安装
dsh plugin --profile web add github:bujue600-arch/dsh-testgen
```

`dsh plugin add` 会把包安装进 profile 并自动对账 bundle 层叠——插件声明了 `dsh.bundle` 清单（`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`），无需手工编辑。任何 profile 都适用：`web`、`headless` 或自定义。（npm 包将随目标 dsh 稳定版发布；届时建议固定到 release 标签。）

> git/file 安装说明：pnpm 对链接依赖会以非零退出码提示缺失 peers——这是预期行为：启动时 harness 会从 profile 自身的模块回退中解析这些 peer 包（`@deepseek-ai/dsh-*`、cordis）。插件照常加载。

验证加载成功（Web）：**Settings → Plugins → Plugin list** 中可见 `testgen` 条目，且状态点为绿色。

## 使用

### 斜杠命令

```
/testgen [options] <file-or-glob> [更多目标…]

选项：
  --runner <vitest|jest|node-test|mocha|auto>  测试框架（默认 auto）
  --generator <llm|template|auto>              生成器（默认 auto）
  --iterations <n>                             修复循环上界（默认 3）
  --model <provider/model>                     生成模型覆盖
  --no-run                                     只生成，不运行
  --json                                       输出机器可读报告
  -h, --help                                   显示帮助
```

```sh
/testgen src/utils/math.ts
/testgen --runner vitest "src/**/*.ts"
/testgen --generator template --no-run src/app.ts
/testgen --model deepseek-official/deepseek-chat src/parser.ts
```

### 模型工具

Agent 可以直接调用——同一管线、结构化结果：

```
generate_tests({ target: "src/utils/math.ts", runner: "vitest", maxIterations: 3 })
```

### 产物位置

对 `src/utils/math.ts`，测试写入 `src/utils/__tests__/math.test.ts`（扩展名随框架变化，`node:test` 用 `.test.mts`）。已存在的测试文件**绝不会被覆盖**——已有测试的目标会被跳过并给出警告。

## 配置

所有设置位于 harness 设置文档（`$DSH_HOME/settings.yaml`）的 `testgen:` 段，并支持**热加载**——改完即生效。分层：schema 默认值 → 组合入口（`cordis.patch.yml`）→ 你的设置段。

```yaml
testgen:
  runner: auto            # auto | vitest | jest | node-test | mocha
  generator: auto         # auto | llm | template
  maxIterations: 3        # 生成 → 运行 → 修复循环上界（0 禁用修复）
  timeoutSec: 120         # 单次运行的墙钟超时
  autoRun: true           # 生成后运行测试
  includeGlobs:
    - '**/*.{ts,tsx,js,jsx}'
  excludeGlobs:
    - '**/node_modules/**'
    - '**/dist/**'
    - '**/*.test.*'
    - '**/*.spec.*'
    - '**/__tests__/**'
  testDir: __tests__      # 生成的测试放在目标旁的该目录
  model:                  # 可选的 provider/model 覆盖
    provider: deepseek-official
    model: deepseek-chat
  maxSourceChars: 60000   # 每个目标喂给 LLM 的源码字符上限
```

也可以在 profile 的 `cordis.patch.yml` 里按行 id（`testgen`）覆盖以上任意字段（patch 会整体替换该行配置）。完整参考见 [`docs/config.md`](./docs/config.md)。

## 输入 / 输出规范

命令、工具、引擎共用同一份契约。工具的规范输出 schema 即 `TestgenReport` 的 JSON 投影；完整文档见 [`docs/io-spec.md`](./docs/io-spec.md)。

```ts
interface TestgenReport {
  status: 'passed' | 'fixed' | 'generated' | 'failed' | 'skipped'
  targets: { path: string; language: string }[]
  generated: GeneratedTest[]        // path、framework、generator、testCount
  runs: TestRun[]                   // 每次迭代的退出码、统计、失败明细
  warnings: string[]
  stats: { generatedFiles: number; passed: number; failed: number; iterations: number }
  elapsedMs: number
}
```

## 架构

一切皆插件，本插件严守边界：

```
dsh-testgen
├── src/
│   ├── index.ts            # cordis 入口：name / inject / Config / apply
│   ├── schema.ts           # schemastery 配置 + settings 命名空间 schema
│   ├── settings.ts         # 热加载感知的有效配置解析
│   ├── command.ts          # /testgen 语法与处理器
│   ├── tool.ts             # generate_tests 定义（输入/输出 schema）
│   ├── report.ts           # plain / markdown / JSON 渲染
│   ├── errors.ts           # 稳定的 TESTGEN_* 错误码（HarnessError）
│   └── engine/             # 纯逻辑内核，与框架解耦（完整单测）
│       ├── resolve.ts      # 路径/glob → SourceTarget[]、语言识别
│       ├── template.ts     # 确定性冒烟测试生成器
│       ├── generate-llm.ts # ctx.llm 流式生成、提示词组装、提取
│       ├── runner.ts       # 框架探测、进程执行、输出解析
│       └── pipeline.ts     # 生成 → 运行 → 修复编排
├── cordis.patch.yml        # bundle 补丁：一行 `testgen` insert
├── docs/                   # io-spec、配置参考
├── examples/fixture/       # 演示项目
└── test/                   # 78 个单元测试（vitest）
```

- **不侵入**：组合树中仅一行 insert；无核心补丁、无猴子补丁。`dsh plugin --profile web remove dsh-testgen` 即可干净卸载。
- **可组合**：仅硬注入 `commands` 与 `tools`（所有出厂 profile 均具备）；`settings`、`llm` 与 agent 会话按需消费——没有 settings provider 或 LLM 适配器的 profile 同样可用。
- **诚实的副作用**：只写测试文件、拒绝覆盖已有文件、只修复自己生成的文件；测试进程使用项目自身的运行器，从工作区根启动，超时会杀死整个进程树，并接入了取消信号。

## 开发

```sh
pnpm install
pnpm run typecheck     # tsc --noEmit
pnpm run lint          # eslint
pnpm test              # vitest（78 个用例）
pnpm run build         # tsdown → lib/
pnpm run verify:manifest  # dsh.bundle / exports / files 契约
pnpm run demo          # 对 examples/fixture 的端到端演示
```

欢迎贡献——见 [CONTRIBUTING.md](./CONTRIBUTING.md) 与[行为准则](./CODE_OF_CONDUCT.md)。Bug 与特性请求请使用 Issue 模板。

## 常见问题

**需要 API Key 吗？** 不需要。没有 LLM 适配器时，`generator: auto` 使用确定性模板生成器——生成可证明导入与导出存续的结构冒烟测试。配置了 LLM 后，`auto` 优先生成行为测试。

**哪些项目可以用 `node --test`？** TypeScript 目标需要 ESM 项目（package.json 中 `"type": "module"`——常见情形），因为 Node 只对 ESM 文件剥离类型；JSX 目标请使用 vitest 或 jest（用 `runner` 指定）。

**会改我的源码吗？** 不会。只写测试文件，且跳过已有测试文件的目标。

**修复循环无法转绿怎么办？** 到达 `maxIterations` 即停止，报告 `failed` 并附上最后一次失败明细与警告——不会无限重试。

## 更新日志与版本

[`CHANGELOG.md`](./CHANGELOG.md) —— 版本遵循 [SemVer](https://semver.org)。

## 许可

[MIT](./LICENSE) © bujue600-arch 与 dsh-testgen 贡献者。本项目为社区项目，与 DeepSeek 无关。
