# Third-Party Notices

V0.6.0 uses or distributes third-party materials. This file is a practical
inventory, not legal advice and not a replacement for the complete license
texts shipped with each component.

## Node.js runtime

The Windows portable package receives its Node.js runtime from the build-time
`-RuntimeDir` argument. The packaging script requires and preserves the
runtime's license file beside `runtime/node.exe`.

Node.js includes software under multiple open-source licenses. Consult the
preserved `runtime/NODE-LICENSE.txt` or equivalent runtime license file.

## Production npm dependencies

- `ethers` — MIT license.
- `ganache` — MIT license and bundled/transitive third-party components.

The portable package installs production dependencies from `pnpm-lock.yaml`
and preserves license/notices files inside `node_modules`. Transitive
dependencies keep their own terms; inspect their package directories for the
complete texts.

The package build also produces `THIRD_PARTY_LICENSE_MANIFEST.json`. Every
physically distributed production package path must declare a `package.json`
license and provide a complete LICENSE/NOTICE body. A README is accepted only
when it contains the complete license grant, preservation condition,
disclaimer, and liability limitation. If a package omits a complete body, the
build fails unless that exact `name@version` is on the manual-notice allowlist.
The manifest binds this physical closure to the packaged `pnpm-lock.yaml`
SHA-256. The smaller `pnpm licenses list` view is recorded as informational
with an explicit `UNKNOWN` reconciliation status because bundled package paths
may be collapsed or omitted by that ecosystem view.

`async-eventemitter@0.2.4` declares MIT in its package metadata, but its
installed package has only a short README license heading and the line
`Copyright © 2013 Andreas Hultgren`. The complete version-matched MIT notice
retained for distribution is:

`third_party/manual-licenses/async-eventemitter@0.2.4.txt`

## Development-only dependency

- `solc` — used at build time to compile `contracts/DesignRegistry.sol`.

The packaging workflow copies the resulting minimal
`contracts/artifacts/DesignRegistry.json` into the portable package. `solc`
itself is not required by, and is not installed into, the production portable
package.

## Editorial photographs

The interface includes photographs sourced from Pexels. Creator credits,
source URLs, and the applicable source record are preserved in:

`public/assets/editorial-gold/SOURCES.md`

Those photographs remain subject to their own source terms. The project's
private LICENSE does not claim ownership of or relicense them.

## Smart-contract toolchain and network

The local demo uses Ganache only on loopback. The Monad Testnet page performs
read-only requests to public network infrastructure when available. Network
services, explorers, and their branding remain subject to their operators'
terms; they are not bundled project assets.
