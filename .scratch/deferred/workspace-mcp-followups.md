Status: deferred

# Deferred: same-project concurrent writer protection

Agents sharing one workspace server may issue concurrent writes. Documentation warns against simultaneous write sessions, but the initial feature adds no exclusive lease, serialization queue, or conflict detector. Add one only if observed project corruption or common accidental overlap justifies the product restriction.

# Deferred: workspace server eviction

A registered workspace server and its pooled Xerolo process remain warm from first use until DSH Host shutdown. Reference counting, last-Agent unregistration, idle timers, and re-acquisition races are deferred until measured process cost or long-lived multi-project Hosts justify them.

# Deferred: automatic workspace server recovery

If a shared Xerolo process crashes after startup, affected workspace Agents fail until Host restart. Automatic restart, exponential backoff, tool resynchronization, stale-tool behavior, and crash-loop exhaustion are deferred until operational evidence justifies the shared lifecycle complexity.

# Deferred: upstream DSH workspace-scoped MCP client seam

The official `@deepseek-ai/dsh-mcp-client` owns one connection per plugin
instance. Mounting it per Agent would start one child per Agent; mounting it at
Host scope cannot select or route by the calling Agent's canonical workspace.
Our RPG Maker integration therefore owns a separate Host pool and Agent access
layer today.

Propose an upstream DSH seam where an Agent-scoped resolver returns a stable
`connectionKey` and fixed transport configuration. A Host-owned manager should
single-flight and reference-count connections by that key while registering the
connection's tools only in the calling Agent scope. It should preserve first
assembly Code Mode SDK generation, deterministic `mcp__<server>__<tool>` names,
tool resynchronization, cancellation containment, reconnect policy, and final
child cleanup.

Reconsider when a third workspace-bound MCP is selected, another DSH product
needs the same lifecycle, or we are ready to propose the interface upstream.
The acceptance target is two Agents in one canonical workspace sharing one
child, two different workspace keys receiving isolated children and tool
scopes, and disposal releasing only the relevant reference without leaking
workspace identity into model-facing names.

# Deferred: upstream DSH MCP schema-adapter and call-policy seams

The official MCP client validates raw `tools/list` input schemas directly
against DSH's smaller JSON Schema subset. The pinned Xerolo and Redseb releases
currently pass 0/41 and 0/119 raw schemas respectively, so transport connection
can succeed while DSH tool registration cannot. A workspace connection seam
alone does not solve this incompatibility.

Propose an optional MCP tool-bridge `schemaAdapter(rawSchema, tool)` seam. DSH
must validate the adapter output with its official validator before
registration and use that exact projected schema for native presentation and
Code Mode SDK generation. Preserve the raw schema separately for upstream
contract/parity checks. Projection loss should be observable, and an invalid
adapter result must fail closed rather than degrade to an empty or `unknown`
contract.

Also evaluate a narrow call-policy seam that can reject or canonicalize
arguments before `tools/call`. Workspace-bound servers such as Redseb expose
`set_project`; an unmediated native bridge would let a model retarget a child
outside its `(engine, canonical workspace)` identity. The policy must receive
the Agent-selected connection identity without adding workspace paths to every
model-supplied tool argument.

Reconsider with the workspace-scoped client proposal or when a second
non-RPG-Maker MCP needs schema adaptation. Until then, retain the small local
projector and pair-containment policy; generic validation, dereferencing, and
TypeScript code-generation libraries do not supply this DSH-specific loss and
security policy.
