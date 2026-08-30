# JSON Schema 投影方案调研

日期：2026-08-29

## 结论先行

这里的“投影”（projection）不是把 JSON Schema 重新验证一遍，也不是把它
转换成 TypeScript。它是一个有明确损失策略的函数：把上游的完整 schema 映射成
DSH 能接受、能注册、并能生成 Code Mode SDK 类型的 schema，同时保留原 schema
给 MCP 服务端做真正的运行时校验。

例如，Redseb schema 中的：

```json
{
  "type": "object",
  "properties": {
    "id": { "type": ["integer", "null"], "minimum": 1 }
  },
  "propertyNames": { "pattern": "^[a-z]+$" },
  "additionalProperties": { "type": "string" }
}
```

可以投影为：

```json
{
  "type": "object",
  "properties": {
    "id": {
      "oneOf": [{ "type": "integer" }, { "type": "null" }]
    }
  },
  "additionalProperties": true
}
```

`minimum`、`propertyNames` 和 schema-valued `additionalProperties` 并没有被
“实现”或“等价转换”：它们被有意丢弃/放宽。模型看到的是参数形状近似，MCP
服务端仍是参数语义和安全性的最终来源。因此投影的正确性标准是：输出通过
DSH 官方子集校验、不会伪造更严格的约束、并且类型尽量有用；不是保持完整
JSON Schema 的验证等价性。

DSH `@deepseek-ai/dsh-tools@0.1.1-rc.2` 的官方子集只允许：

* 一个字符串 `type`：`object | array | string | number | integer | boolean | null`；
* `oneOf`（至少两个 schema，且不能和 `type`/其他约束兄弟并列）；
* 对象的 `properties`、`required`、布尔值 `additionalProperties`；
* 数组的 `items`；
* 标量的类型正确 `enum`/`const`；
* `description`、`title`、无损 JSON 的 `default`/`examples` 注解。

未知或放错位置的关键词会被 `assertSupportedJsonSchema()` 拒绝；需要对象根时
用 `assertObjectJsonSchema()`。`jsonSchemaToTs()` 和 `renderToolsSdk()` 是
对这个已验证子集的 codegen，而不是上游完整 JSON Schema 的投影器。证据：
[DSH validator source](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/core/tools/src/json-schema.ts)、
[DSH TypeScript codegen](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/core/tools/src/ts-types.ts)、
[DSH tools package](https://github.com/deepseek-ai/deepseek-harness/tree/141eb6fef83422698aef7a981029e843e8161534/packages/core/tools)。

## 候选库评估

| 库 | 官方能力 | 对 DSH 投影的结论 | 成本/维护证据 |
| --- | --- | --- | --- |
| **DSH 自带 API** | `assertSupportedJsonSchema` / `assertObjectJsonSchema` 校验子集；`validateJsonSchemaValue` 校验值；`jsonSchemaToTs`、`renderToolsSdk` 生成 SDK。 | 最接近目标，但没有“从任意 JSON Schema 生成 DSH schema”的 API。应作为投影后的最终 oracle。 | `@deepseek-ai/dsh-tools@0.1.1-rc.2` MIT；运行时依赖 `@deepseek-ai/schemastery`，其余 DSH 包为 peer dependencies。[package.json](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/core/tools/package.json) |
| **Ajv** | 支持 draft-04/06/07/2019-09/2020-12、JTD、meta-schema 校验、远程 `$ref`、自定义 keyword。`compile` 生成的是 validator/type guard。 | **校验器，不是投影器。** 它可以在投影前验证上游 schema，不能决定 `minimum` 应丢弃、`propertyNames` 应放宽、或 schema-valued `additionalProperties` 应怎样映射。 | `ajv@8.20.0` MIT，官方 package.json 列出 4 个直接运行时依赖。[README](https://github.com/ajv-validator/ajv/blob/master/README.md)、[API](https://github.com/ajv-validator/ajv/blob/master/docs/api.md)、[package.json](https://github.com/ajv-validator/ajv/blob/master/package.json) |
| **@hyperjump/json-schema** | 多 dialect 验证（draft-04 到 2020-12、OpenAPI 3.0/3.1/3.2）、文件/HTTP schema、bundling，以及自定义 keyword/vocabulary/dialect；还明确提供构建非验证工具的 API。 | **可作 schema 语义/解引用基础设施，但没有 DSH 子集投影器。** 自定义 dialect/meta-schema 可以描述“允许哪些词”，却不会自动生成具有放宽策略的模型 schema。 | `@hyperjump/json-schema@1.17.8` MIT；官方 package.json 列出 8 个直接依赖和 `@hyperjump/browser` peer，明显比本地小投影器重。[README](https://github.com/hyperjump-io/json-schema/blob/main/README.md)、[package.json](https://github.com/hyperjump-io/json-schema/blob/main/package.json) |
| **@apidevtools/json-schema-ref-parser** | 解析、resolve、bundle、dereference JSON/YAML `$ref`；支持外部文件/URL、循环引用，并可选择不修改输入。 | **解引用器，不是投影器。** 可在存在 `$ref` 的上游 schema 上先做预处理，但解引用不会删除 DSH 不支持的关键词，也不做 DSH object-root 策略。 | `@apidevtools/json-schema-ref-parser@16.0.1` MIT；2 个运行时依赖（`undici`、`js-yaml`），官方 registry package 要求 Node `>=22.19.0`。[README](https://github.com/APIDevTools/json-schema-ref-parser/blob/main/README.md)、[package.json](https://github.com/APIDevTools/json-schema-ref-parser/blob/main/package.json)、[npm registry](https://registry.npmjs.org/@apidevtools/json-schema-ref-parser) |
| **json-schema-to-typescript** | 将 JSON Schema 编译成 `.d.ts`/TypeScript typings；官方示例保留对象字段和 scalar enum 的 TS 表达。 | **类型生成器，不是 schema 生成器。** 产物不能注册给 DSH，也不能作为运行时参数验证；只能在需要独立静态类型文件时使用。 | `json-schema-to-typescript@16.0.0` MIT；官方 package.json 列出 7 个直接运行时依赖（含 ref-parser、lodash、Prettier），Node `>=16`。[README](https://github.com/bcherny/json-schema-to-typescript/blob/master/README.md)、[package.json](https://github.com/bcherny/json-schema-to-typescript/blob/master/package.json) |
| **json-schema-traverse** | 对 schema 对象进行 pre/post traversal；`allKeys` 可遍历未知关键词。官方明确说明 `$ref` 不会被 resolve，只原样传给 callback。 | **遍历构件。** 可把自定义投影逻辑放在 callback 中，但它本身不理解 DSH 子集、不会做策略决策；应注意其 callback/实现的递归和循环语义。 | `json-schema-traverse@1.0.0` MIT，官方 registry 显示 0 个依赖；版本稳定但不是近期活跃功能线。[README](https://github.com/epoberezkin/json-schema-traverse/blob/master/README.md)、[package.json](https://github.com/epoberezkin/json-schema-traverse/blob/master/package.json)、[npm registry](https://registry.npmjs.org/json-schema-traverse) |
| **json-schema-migrate** | 把 draft-04 schema 迁移到较新 dialect，处理 `id`/`$id`、exclusive bounds、`definitions`/`$defs`、`items`/`prefixItems` 等 dialect 差异。 | **dialect migration，不是任意子集投影。** 它转换的是标准版本语义；不会把 `minimum`、`propertyNames` 等变成 DSH 可接受的表示。 | `json-schema-migrate@2.0.0` MIT，1 个直接运行时依赖 Ajv。[README](https://github.com/ajv-validator/json-schema-migrate/blob/master/README.md)、[package.json](https://github.com/ajv-validator/json-schema-migrate/blob/master/package.json) |
| **@openapi-contrib/openapi-schema-to-json-schema** | 将 OpenAPI 3.0 Schema/Parameter Object 转成 JSON Schema draft-04；其官方示例会把 `nullable` 转成 `type: ['string','null']`，也支持嵌套 `allOf`。 | **方向相反且产物常更不适合 DSH。** 它解决 OAS 3.0 与 JSON Schema 的差异，不是 JSON Schema→DSH；nullable 的 type array 正是 DSH validator 拒绝的形态。 | `@openapi-contrib/openapi-schema-to-json-schema@5.1.0` MIT；官方 package.json 列出 6 个直接依赖，Node `>=14`。[README](https://github.com/openapi-contrib/openapi-schema-to-json-schema/blob/master/README.md)、[package.json](https://github.com/openapi-contrib/openapi-schema-to-json-schema/blob/master/package.json) |
| **@openapi-contrib/json-schema-to-openapi-schema** | 将 JSON Schema draft-04 转为 OpenAPI 3.0 Schema Object；可把 `type: ['foo','null']` 变成 `type: foo` + `nullable: true`，可选 dereference。 | **仍是格式转换，不是 DSH 投影。** OAS `nullable` 也不是 DSH 的 schema keyword；把结果再送给 DSH 仍需另一个有损映射。 | `@openapi-contrib/json-schema-to-openapi-schema@4.3.4` MIT；3 个直接依赖（含 ref-parser、json-schema-walker），Node `>=18`。[README](https://github.com/openapi-contrib/json-schema-to-openapi-schema/blob/master/README.md)、[package.json](https://github.com/openapi-contrib/json-schema-to-openapi-schema/blob/master/package.json) |
| **json-schema-walker / Cloudflare walker** | schema-aware pre/post walk；官方说明很多转换应在 post callback 中修改，以确保子 schema 已处理；JonLuca 版本可先 load/dereference，再 `walk`。 | **较好的遍历构件，但仍不是端到端方案。** 它能减少自写 subschema 发现逻辑，却不会知道 DSH 的允许关键词，也不会替选择丢失约束的语义。其 in-place callback 也要求先 clone，循环/$ref 选项必须另行设计。 | `json-schema-walker@3.3.2` MIT；2 个直接依赖（ref-parser 和 types），Node `>=17`。[Cloudflare README](https://github.com/cloudflare/json-schema-tools/blob/master/workspaces/json-schema-walker/README.md)、[JonLuca README](https://github.com/jonluca/json-schema-walker/blob/master/README.md)、[package.json](https://github.com/jonluca/json-schema-walker/blob/master/package.json) |

## 为什么没有现成的端到端替代品

这些库分别解决不同问题：

```text
完整上游 schema
   ├─ Ajv / Hyperjump       → 验证 schema 或实例
   ├─ Ref Parser / Walker   → 解引用、bundle、遍历
   ├─ json-schema-migrate   → 标准 dialect 迁移
   ├─ *-to-typescript       → 生成 TS 文本
   └─ OpenAPI converters    → OAS ↔ JSON Schema 格式互转

                 （没有库拥有 DSH 的这条策略边界）
                              ↓
                项目自己的 DSH 子集投影
                              ↓
       DSH assertObjectJsonSchema + renderToolsSdk
```

DSH 子集是应用/运行时特定的 contract，不是 JSON Schema 标准 dialect：

1. `type: ['integer', 'null']` 是否拆成 `oneOf` 是表示选择；
2. 数值 bounds、`propertyNames`、formats、`allOf` 等不能机械地“转换”为同义 DSH keyword；
3. schema-valued `additionalProperties` 只能在 DSH 的布尔形态中选择 `true`（放宽）或拒绝；
4. 工具参数要求 object root，标量/数组根必须有项目策略；
5. 必须同时保留 upstream schema 供 MCP 服务端验证，并用 DSH validator 检查投影结果。

因此任何通用库若声称自动完成这一步，也只能选择一种隐含的损失策略；它不可能
替项目决定这些行为并保证与 DSH runtime/Code Mode 一致。

## 对本项目的建议

继续保留 `bundle/dsh-workspace-mcp/lib/tools.js` 的小型、显式投影器：

* 将它视为“模型可见 schema adapter”，不要把它当作完整 validator；
* 原始 Redseb manifest/schema 继续用于 digest、live parity 和 MCP 调用；
* 每次投影后立即调用 DSH `assertObjectJsonSchema`，让不合法输出失败；
* 使用 DSH 自带 `renderToolsSdk` 作为最终类型输出，避免第二套 TS codegen；
* 对被丢弃的关键词保留可测试的统计/诊断（尤其 bounds、`propertyNames`、schema-valued `additionalProperties`），防止上游升级时无声扩大参数空间；
* 当前 MZ manifest 没有需要 `$ref` 解引用的输入 schema，因此不建议仅为此加入 ref-parser、Hyperjump 或 Ajv 的运行时依赖。

若未来上游确实开始使用 `$ref`，优先在受控的 manifest 构建/预处理阶段使用
`@apidevtools/json-schema-ref-parser`（clone + dereference/bundle），再进入现有
投影器；若需要更丰富的 vocabulary-aware walk，再评估 `json-schema-walker`。
这两个库仍只是 building blocks，不能替代 DSH-specific projector。

## 维护与安全边界

上述候选库的官方仓库/registry 均标为 MIT，许可证本身没有引入 GPL 约束；真正的
工程成本来自依赖树、Node engine floor、远程 `$ref` 访问和语义漂移。尤其 ref-parser
和 Hyperjump 支持 URL/文件读取，若用于用户提供的 schema，必须显式限制 resolver 和
文件根。对当前固定、内置、无 `$ref` 的 MZ manifest，自有投影器的依赖和攻击面最小。

### 主要一手来源

* [DSH JSON Schema contract source](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/core/tools/src/json-schema.ts)
* [DSH TypeScript SDK renderer source](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/core/tools/src/ts-types.ts)
* [Ajv](https://github.com/ajv-validator/ajv)
* [Hyperjump JSON Schema](https://github.com/hyperjump-io/json-schema)
* [JSON Schema $Ref Parser](https://github.com/APIDevTools/json-schema-ref-parser)
* [json-schema-to-typescript](https://github.com/bcherny/json-schema-to-typescript)
* [json-schema-traverse](https://github.com/epoberezkin/json-schema-traverse)
* [json-schema-migrate](https://github.com/ajv-validator/json-schema-migrate)
* [OpenAPI Schema to JSON Schema](https://github.com/openapi-contrib/openapi-schema-to-json-schema)
* [JSON Schema to OpenAPI Schema](https://github.com/openapi-contrib/json-schema-to-openapi-schema)
* [Cloudflare JSON Schema Walker](https://github.com/cloudflare/json-schema-tools/tree/master/workspaces/json-schema-walker)
