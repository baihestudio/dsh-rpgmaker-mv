# 03 — Dual-engine Windows release delivery

**What to build:** The existing RPG Maker Agent Windows package installs, repairs, diagnoses, and documents both exact editing engines without renaming or migrating the installed product.

**Blocked by:** 01 — Workspace-selected MV/MZ editing loop; 02 — MZ authoring experience and enhancement roadmap.

Status: done

- [x] Release staging and installed-product verification include both exact MCP packages, both manifests, the MZ skill, engine-neutral active configuration, and Redseb's required MIT notice while preserving current program/data paths, archive identity, and Start Menu name.
- [x] Installer repair fails closed on either missing or tampered engine runtime and safely reuses an already verified dual-engine runtime.
- [x] Doctor reports MV and MZ runtime health independently without reading live project state or credentials.
- [x] Current README, user guide, Windows release documentation, preset metadata, and bundle documentation explain workspace-selected MV/MZ editing and the explicit MZ Playtest/build limitations.
- [x] Focused release/install tests, the ordinary `bun test` suite, `bun run check`, and `git diff --check` pass using disposable roots and fake dependencies.
- [x] Real package-download, native Windows, clean-machine, and other `phase*:real` gates remain unrun unless separately authorized, and the implementation report lists them as unverified.
