# Release channel

`dermashield-release.apk` is produced by
[`.github/workflows/build-and-bundle-apk.yml`](../../.github/workflows/build-and-bundle-apk.yml)
and committed back into this folder on every successful build of `main`.

This folder — **not `public/`** — is the channel: `@sveltejs/adapter-static`
copies `static/` into `dist/`, and Vercel serves `dist/`. Anything written to
`public/` is silently dropped, which is why the Download Centre used to probe a
path that could never exist.

| File                             | Purpose                                          |
| -------------------------------- | ------------------------------------------------ |
| `dermashield-release.apk`        | signed, installable release binary               |
| `dermashield-release.apk.sha256` | `sha256sum -c` compatible digest                 |
| `release-manifest.json`          | version, `versionCode`, byte size, digest        |

The Download Centre reads the manifest first, then `HEAD`-probes the binary:

| Probe result                                       | UI behaviour                       |
| -------------------------------------------------- | ---------------------------------- |
| `200` + `application/vnd.android.package-archive`  | download + QR code                 |
| `200` but wrong MIME / empty body                  | "build in progress" + Actions link |
| `404`                                              | stream fallback with the build recipe |

## Signing identity

`android/app/dermashield-ci.p12` (alias `dermashield`, password `dermashield`,
RSA-2048, valid to 2056) is committed on purpose. DERMA-SHIELD is self-hosted
through this folder rather than distributed on Google Play, so the only property
that matters is that **every** build carries the **same** signature — otherwise
Android rejects the upgrade and users have to uninstall first.

Override it without touching the repo by setting `DS_KEYSTORE`,
`DS_KEYSTORE_PASSWORD`, `DS_KEY_ALIAS` and `DS_KEY_PASSWORD` in the build
environment. If you ever rotate the key, bump `versionCode` and tell users to
uninstall the previous build.

The binary is deliberately **never** built on a developer workstation and faked:
a hand-crafted zip is not an APK, and Android refuses to install an unsigned
one. CI is the only producer.
