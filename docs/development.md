# Building and releases

- `endercord-plugin/`: Java 25 / Paper plugin. Built against Paper 26.1.2; tested live on 26.3.
- `endercord-workers/`: shared TypeScript bot with Node/Docker and Cloudflare Workers runtimes.
- PingGuard is a separate plugin; Endercord can relay its alerts but does not require it.

## Build the plugin

With Java 25 installed, run `./gradlew build` (`gradlew.bat build` on Windows).
The output is `endercord-plugin/build/libs/Endercord.jar`. Each successful
[Checks run](https://github.com/syed-zayd/endercord/actions/workflows/check.yml) also provides
an `Endercord` artifact containing this jar.

## Development checks

```bash
./gradlew build
cd endercord-workers
npm ci
npm run check
npm test
npm run build:node
```

Node 24 is required for the Docker runtime and bot tests. Gradle can provision a Java 25 toolchain,
but needs an installed Java runtime to start; installing Java 25 covers both.

## Publishing a version

Pushing a `v*` tag runs the release workflow: it builds/tests the plugin, attaches the jar to a
**draft** GitHub release, and builds/tests/pushes an amd64/arm64 bot image to
`ghcr.io/syed-zayd/endercord-bot:<tag>`. Review/publish the draft and set the GHCR package's
visibility to public when you are ready to share it. No release/image is published just by
merging code. Until an image is published, the quick start builds locally from the Dockerfile.
