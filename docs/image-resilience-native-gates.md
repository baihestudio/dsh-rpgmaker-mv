# Image resilience native gates

These focused gates assume the existing installed NUC session and do not install
DSH, create a clean profile, or download providers.

## Direct Windows hung-child probe

From the repository on Windows:

```powershell
bun run image:windows-hung-child
```

The probe imports the shipped image plugin directly, supplies a test-owned
hung Node child, aborts through the plugin signal, and requires cancellation to
settle within the five-second cleanup grace. It uses `taskkill /T /F` through
the plugin's native Windows termination path and removes its temporary fixture.

## Existing-NUC trim/pad replay

Use `scripts/image-trim-pad-nuc-web-poll.ps1` on the NUC with two small
trigger scripts. The trim/pad trigger should drive the already-running DSH Web
session's `image_trim_pad` call; the inspect trigger should drive the subsequent
`image_inspect` call. The poller checks the fixed DSH Web URL for HTTP 200 while
each trigger runs and again after completion:

```powershell
./scripts/image-trim-pad-nuc-web-poll.ps1 `
  -TriggerScript .\scripts\trigger-image-tool.ps1 `
  -InspectScript .\scripts\trigger-image-inspect.ps1 `
  -ProjectPath 'C:\path\to\existing\project' `
  -InputPath 'img\faces\source.png' `
  -OutputPath 'img\faces\ticket02-trim-pad.png'
```

The trigger scripts are intentionally supplied by the native workflow owner:
they contain the authenticated DSH Web interaction and are not part of the
ordinary test suite. The poller reports failure if Web stops returning 200,
`image_trim_pad` fails, or the subsequent `image_inspect` fails.
