# Luma Video → 3D (experiment)

Tiny, zero-dependency Node server + HTML page that submits a video to Luma's
capture API and displays the resulting GLTF in `<model-viewer>`.

> **Heads up.** Luma archived the public Capture API in September 2024
> ([lumalabs/lumaapi-python](https://github.com/lumalabs/lumaapi-python)).
> The endpoints under `webapp.engineeringlumalabs.com/api/v2/capture` may
> still respond, but they are unsupported. The current Luma "Dream Machine" /
> Ray API is video *generation*, not video-to-3D — so depending on which
> product your key is for, this may return `401`.

## Setup

```sh
cd experiments/luma-video-to-3d
cp .env.example .env
# edit .env and put your real LUMA_API_KEY in
node --env-file=.env server.mjs
```

Open <http://localhost:5173>, pick a video, hit submit, watch the log.

## How it works

The server is a thin proxy that adds `Authorization: luma-api-key=<key>` and
forwards three calls:

| Browser → server         | Server → Luma                                  |
| ------------------------ | ---------------------------------------------- |
| `POST /api/start`        | `POST /api/v2/capture` (returns slug + signed URL) |
| `PUT  <signed URL>` *(direct from browser)* | n/a — uploads straight to Luma's storage |
| `POST /api/trigger?slug` | `POST /api/v2/capture/{slug}` (start reconstruction) |
| `GET  /api/status?slug`  | `GET  /api/v2/capture/{slug}` (poll until artifacts appear) |

Once Luma reports an artifact whose type or URL contains `gltf`/`glb`, the
page hands the URL to `<model-viewer>` for a draggable preview.

## If the key is rejected

If `/api/start` returns 401/403, the key is for a different Luma product
(most likely Dream Machine). Options:

1. Ask Luma support whether your account has Capture API access.
2. Switch to an alternative video/photo → 3D service (Meshy, Tripo3D,
   KIRI Engine, Polycam) and adapt the three-step flow in `server.mjs`.
