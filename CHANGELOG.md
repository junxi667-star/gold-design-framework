# Changelog

## v0.8.0

- Added a cloud-ready Master API + local Image Worker architecture.
- Added persistent image-generation task queue, worker registry, task leases, heartbeat, idempotency, retry and timeout recovery.
- Added WebSocket as the primary task push channel.
- Added authenticated HTTP registration, claim, heartbeat, renew, progress, binary upload, complete and fail endpoints as the fallback path.
- Added direct binary image upload from Worker to Master; images are not sent as Base64 through WebSocket.
- Added SHA-256 verification when Master receives Worker images.
- Added background Windows Image Worker service, one-click start/stop scripts and worker logs.
- Added `worker`, `direct` and `hybrid` image execution modes.
- Added Master restart recovery for queued/running Agent generation jobs.
- Added Worker status to the UI and diagnostics.
- Preserved the v0.7.0 Seedream API configuration and all Monad/Supabase behavior.

## v0.7.0

- Rebuilt the demo around the hackathon core flow: V1 → Monad → V2 → finalization.
- Removed the local ComfyUI dependency; uses Volcengine Ark Seedream image generation API.
- Added deterministic Agent orchestration and task states.
- Added local/Supabase image and Metadata storage.
- Added canonical Metadata, Keccak-256 hashes, parentContentHash and integrity checks.
- Added MetaMask connection and automatic Monad Testnet network setup.
- Added manual ABI transaction encoding without third-party runtime dependencies.
- Added txHash receipt/event verification on the backend.
- Added version timeline, Explorer links, final certificate download and Agent evidence Q&A.
