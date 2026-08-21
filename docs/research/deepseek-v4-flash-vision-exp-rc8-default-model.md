# DeepSeek V4 Vision default for DSH rc.8

**Scope:** research only. No application code, user profile/config state, or commit was changed. DSH rc.8 was inspected at commit [`141eb6fef83422698aef7a981029e843e8161534`](https://github.com/deepseek-ai/deepseek-harness/tree/141eb6fef83422698aef7a981029e843e8161534), plus the local runtime at `/mnt/c/Users/white/.dsh` (its `@deepseek-ai/dsh` and provider packages report `0.1.0-rc.8`). No rc.7 behavior was used as evidence.

## Conclusion

**Yes, adopt `deepseek-v4-flash-vision-exp` as the default, but do not change only `agent-default-model`.** The smallest safe change is one generated shared Host/profile patch containing:

1. an `agent-default-model` patch selecting provider `deepseek-official` and model `deepseek-v4-flash-vision-exp`; and
2. an `llm-deepseek` catalog patch that advertises the vision model with `inputModalities: [text, image]` while retaining the existing Flash and Pro entries.

The first row affects all five shipped Code-derived presets because they are mounted as Agent presets under one shared `web` Host; the default model is a Host service, not a persona-local setting ([`src/rpgmaker.ts`](../../src/rpgmaker.ts), [`agent-default-model` README](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/core/agent-default-model/README.md), [base bundle](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/bundle/base/cordis.patch.yml#L61-L68)). Keep ordinary user model selection as an override: rc.8 layers the user `agent-default-model` settings section over the composition default, and Web selection saves the complete selection through that service ([`agent-default-model/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/core/agent-default-model/src/index.ts), [`host/apiproxy/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/host/apiproxy/src/index.ts#L95-L103)). Existing sessions with a logged model selection retain it; a changed default applies to subsequently resolved blank/new sessions ([`host/apiproxy/src/api-proxy.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/host/apiproxy/src/api-proxy.ts#L1080-L1120)).

## Official DeepSeek contract

DeepSeek’s official Models & Pricing documentation lists the exact identifier `deepseek-v4-flash-vision-exp` and describes it as an experimental model that additionally accepts image input ([Models & Pricing](https://api-docs.deepseek.com/quick_start/models_and_pricing)). The Vision guide says it accepts images alongside text and supports JPEG, PNG, GIF, and WebP; the format is detected from file content ([Vision](https://api-docs.deepseek.com/guides/vision)). The Chat Completions contract requires user `content` to become an array of parts for image input, using an `image_url` part whose URL can be a base64 data URL ([Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion), [Vision examples](https://api-docs.deepseek.com/guides/vision#sending-images)).

The official limits are larger than this app’s conservative local intake: 48 MiB request body, 32 MiB maximum single inline image, 600 images/request, 64 MiB total without file IDs, and 8192 px per side (reduced to 4096 px for requests with 15+ images). External URLs additionally have an 8192-character, 32 MiB, and 60-second limit ([Vision → Limits](https://api-docs.deepseek.com/guides/vision#limits)). The official `/models` operation is the appropriate account/endpoint availability probe; documentation availability is not a guarantee that every account has experimental access ([Lists Models](https://api-docs.deepseek.com/api/list-models)).

## What rc.8 actually does

- The base bundle’s default is `provider: deepseek-official`, `model: deepseek-v4-flash` ([base `cordis.patch.yml`](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/bundle/base/cordis.patch.yml#L61-L68)). The local Windows-side rc.8 runtime has the same default in `/mnt/c/Users/white/.dsh/profiles/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml`; `/mnt/c/Users/white/.dsh/profiles/web/cordis.patch.yml` is currently an empty user patch layer.
- `dsh-llm-deepseek` passes the selected model ID through as the wire `model`; it does not need a lifecycle registration for a new ID. However, its default catalog advertises only V4 Flash and V4 Pro, and omitted `inputModalities` means text-only. A catalog entry must explicitly declare `[text, image]` for image use ([`llm-deepseek/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/llm/llm-deepseek/src/index.ts#L49-L57), [provider README](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/llm/llm-deepseek/README.md#config)).
- An unlisted model is deliberately resolved as text-only. When a request contains an image, the adapter checks the configured model capability **before credentials, attachment reads, or network I/O** and rejects non-image models ([`llm-deepseek/src/adapter.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/llm/llm-deepseek/src/adapter.ts#L205-L245)). Therefore changing only the default ID does **not** unlock attachments.
- With the capability entry present, rc.8 resolves the durable image reference and sends an ordered user content array containing text and `image_url: { url: "data:<media-type>;base64,..." }`; it rejects image content in system/assistant history ([`llm-deepseek/src/serialize.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/llm/llm-deepseek/src/serialize.ts#L89-L117), [rc.8 adapter test](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/llm/llm-deepseek/tests/adapter.spec.ts#L112-L174)). This is image input only; the adapter documents no assistant image output, Files API, or external-URL path ([provider README limitations](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/llm/llm-deepseek/README.md#known-limitations-and-deferred-work)).

## Recommended single shared patch

Extend the repository’s generated `renderPresetOnlyPatch()` in [`src/rpgmaker.ts`](../../src/rpgmaker.ts) rather than editing any of the five `presets/*/agent.cordis.yml` files. Conceptually, retain the existing `agent-presets` patch and add these two rows:

```yaml
- id: agent-default-model
  config:
    provider: deepseek-official
    model: deepseek-v4-flash-vision-exp

- id: llm-deepseek
  config:
    models:
      - id: deepseek-v4-flash
        name: DeepSeek-V4-Flash
        contextWindow: 1000000
      - id: deepseek-v4-pro
        name: DeepSeek-V4-Pro
        contextWindow: 1000000
      - id: deepseek-v4-flash-vision-exp
        name: DeepSeek-V4-Flash-Vision-Exp
        inputModalities: [text, image]
```

Retaining all three catalog entries matters: rc.8’s explicit `models` list replaces the default list, and a patch replaces the targeted row’s whole config ([`llm-deepseek` README](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/llm/llm-deepseek/README.md#config), [base bundle README](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/bundle/base/README.md)). Do not write a forced user `agent-default-model` settings value: that would destroy the intended user override. A user-supplied `llm-deepseek.models` section can still replace the composition catalog and remove the vision capability; this is an explicit user configuration limitation, not a reason to add migration logic.

## Current UI and verification

The shipped rc.8 attachment UI is image-only; it has thumbnails, drag/drop, and history rendering, but no non-image file cards ([`ui-attachment README`](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/client/ui-attachment/README.md#known-limitations-and-deferred-work)). The local attachment backend accepts only PNG/JPEG/WebP/GIF, defaults to 3.5 MiB per image, 20 images/message, 100 MiB aggregate raw bytes, 40M pixels, and 2000 px per side ([`attachment-local/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/attachment/attachment-local/src/index.ts#L20-L71)). The DeepSeek adapter separately defaults to a 20 MiB accumulated base64 image payload and replaces older oversized history images with a text placeholder ([`llm-deepseek/src/adapter.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/llm/llm-deepseek/src/adapter.ts#L101-L108), [provider README](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/llm/llm-deepseek/README.md#model-experience)). The Web RPC does not expose `inputModalities` in its model-picker schema, so the picker cannot proactively label vision capability; the Host still enforces it on selection and prompt submission ([`buildModelCatalog`](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/host/apiproxy/src/api-proxy.ts#L273-L313), [`sessions.schema.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/host/apiproxy/src/api/sessions.schema.ts#L180-L207), [prompt gate](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/host/apiproxy/src/api-proxy.ts#L2395-L2415)).

Smallest appropriate checks after implementation: (1) extend the existing disposable `tests/phase2.test.ts` composition assertions to require one shared default-model row and one three-entry DeepSeek catalog across each of the five `CUSTOM_AGENT_PRESET_IDS` ([`src/rpgmaker.ts`](../../src/rpgmaker.ts), [`tests/phase2.test.ts`](../../tests/phase2.test.ts)); (2) run rc.8 `--dump-config` against a test-owned DSH home and assert the effective default and `inputModalities`; and (3) run the existing rc.8 adapter contract with a tiny test-owned PNG, asserting `image_url` emission, plus the negative text-only/unlisted-model rejection ([rc.8 adapter tests](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/llm/llm-deepseek/tests/adapter.spec.ts#L112-L174)). A separate manual smoke may call the official Chat Completions endpoint with a test PNG and a user-provided key, but it should not be part of the ordinary suite or log the key.
