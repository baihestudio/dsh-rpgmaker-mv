# Third-party notices

## `@anionex/dsh-vision-toolkit@0.1.31`

This Windows harness installs the exact npm package `@anionex/dsh-vision-toolkit@0.1.31` through DSH's standard `web` profile plugin manager. The package is distributed under the MIT License.

- Repository: https://github.com/Anionex/dsh-vision-toolkit
- License: https://github.com/Anionex/dsh-vision-toolkit/blob/main/LICENSE
- npm integrity: `sha512-0fp+8mBKXxn/nrYj+Gbq3a6CmmwS0HOIOrPwLKh0nYOB+Yst71M9BCTusjb+TerHSbTtqEHutBwqx91+ovXk8w==`
- Pinned upstream visual toolkit metadata is provided by the installed package and is verified by its own runtime.

## `pnpm@10.15.1`

When no system `pnpm` is available, the installer keeps an app-owned exact `pnpm@10.15.1` runtime so DSH's standard plugin manager can run without modifying a user's global package manager. npm integrity: `sha512-NOU4wym1VTAUyo6PRTWZf5YYCh0PYUM5NXRJk1NQ2STiL4YUaCGRJk7DPRRirCFWGv+X9rsYBlNRwWLH6PbeZw==`. pnpm is distributed under the MIT License: https://github.com/pnpm/pnpm/blob/main/LICENSE.

The default Vision Toolkit provider is a shared remote service. Image data is sent to `https://vision.anionex.me/v1` unless the user configures another provider in **Settings → Vision Toolkit**.
