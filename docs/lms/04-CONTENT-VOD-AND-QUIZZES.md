# 04 — Content, VOD delivery & quizzes

## Lesson types

A lesson's `type` selects its payload. Cheap types (no storage/transcode) ship first; uploaded video
(the expensive one) is deferred to phase 3 so phases 1–2 are a complete product without it.

| Type | Payload column | Player | Phase |
|---|---|---|---|
| `YOUTUBE` | `youtube_video_id` | `youtube-nocookie` embed | 1 |
| `AUDIO` | `media_asset_id` (direct file, no HLS) | `<audio>` + signed URL | 1 |
| `PDF` | `attachment_path` | in-browser PDF viewer + signed URL | 1 |
| `TEXT` | `body` (markdown) | rendered inline | 1 |
| `VIDEO_UPLOAD` | `media_asset_id` (HLS) | `hls.js` adaptive player | 3 |
| `QUIZ` | `quiz_id` | quiz runner | 4 |

`lesson_attachments` (worksheets, slides) can hang off **any** lesson type as downloadable extras.

### YouTube

The dashboard accepts a full URL and parses the 11-char video id server-side (store the id, not the
URL). Playback embeds `https://www.youtube-nocookie.com/embed/<id>` with related-videos and branding
minimized. Zero storage cost — the cheapest way to stand up real courses on day one.

### Audio / PDF (direct files)

Uploaded to object storage; the row stores the key. Playback returns a **short-lived signed URL**
(minutes) after the enrollment check — the file is never public. Audio needs no transcode (serve the
source mp3/m4a); PDF is served to a viewer.

## VOD pipeline (phase 3 — uploaded video)

The one genuinely heavy piece. Live video (the `VIDEO` module / LiveKit) is a *different serving
path* from on-demand course video, but the storage/CDN layer from `infra/video` is reused.

```
dashboard                      API                     object storage        transcode worker        CDN
   │  request upload URL  ─────▶ create media_asset(PENDING)
   │                             return presigned PUT ─────▶
   │  PUT file directly ─────────────────────────────────▶ source object
   │  notify uploaded  ────────▶ status=PROCESSING, enqueue job ───────────▶ ffmpeg → HLS renditions
   │                                                       ◀───── write .m3u8 + segments
   │                             status=READY, hls_manifest_key
learner site                   API
   │  GET playback ───────────▶ check enrollment, sign manifest+segment URLs (short TTL) ─────────▶ hls.js ◀── CDN
```

Design points:

- **Direct-to-storage upload** via presigned PUT — big files never stream through PHP.
- **Transcode**: an ffmpeg worker produces a small HLS ladder (e.g. 360p/720p; add 1080p if the
  plan's storage allows). Reuses the video-platform egress/storage conventions. Start simple —
  a single-rendition progressive MP4 behind a signed URL is an acceptable v0 if the worker slips;
  the `media_assets` shape supports upgrading to HLS without a data change.
- **Protection**: enrollment check → signed, expiring URLs for the manifest and segments. No public
  bucket, no hotlinkable file. This is the pragmatic protection level (not DRM).
- **Storage accounting**: `media_assets.size_bytes` summed per academy feeds the `maxStorageGb`
  limit (see [05](05-BILLING-ENTITLEMENT-PERMISSIONS.md)); at-limit upload returns 402-style upgrade.

### Status

- **v0 (phase 3, shipped)** — progressive MP4: `markUploaded` flips a confirmed video straight to
  READY and serves the source object behind a signed URL. No transcode; works with zero object
  storage (the `local` disk + signed-proxy branch in `App\Support\LmsMedia`).
- **HLS (phase 3b, shipped)** — gated by `LMS_TRANSCODE` (default off = v0). When on, a confirmed
  **video** goes `PROCESSING` and `App\Jobs\TranscodeMediaJob` shells to ffmpeg
  (`App\Support\Lms\HlsTranscoder` seam) → a 360p/720p HLS ladder under
  `lms/{academy}/{asset}/hls/`, then READY + `hls_manifest_key` (or FAILED + error). The source
  object is dropped and `size_bytes` reset to the rendition total. Audio never transcodes.
  - **Delivery**: playback returns `protocol: hls|progressive`. The HLS manifest is served through
    the API (`lms.media.hls`) on **both** disk drivers, rewriting each child URI to its own signed
    URL — a signed URL's query string can't be resolved relatively by hls.js — while segments still
    go direct-to-storage (presigned) on S3. The learner player picks `hls.js` vs a plain `<video>`.
  - ffmpeg is integration-only; the job's download → transcode → upload → READY/FAILED wiring and
    the manifest-rewrite route are covered by `tests/Feature/Lms/TranscodeMediaTest` with a fake
    transcoder + faked queue on a `local` disk.

## Progress & resume (phase 2)

`lesson_progress` is upserted as the learner watches:

- Video/audio player posts `position_seconds` periodically (throttled) and on pause/leave → resume
  next time.
- A lesson flips to `COMPLETED` at ~95% watched (video/audio), on open (PDF/TEXT), or on quiz pass.
- Course percent = completed lessons / total. Drives the learner's "continue" card and the
  certificate trigger.

## Quizzes & assignments (phase 4)

The largest sub-system, isolated to its own phase.

- **Authoring** (dashboard, `course.manage`): a quiz belongs to a course and is attached as a `QUIZ`
  lesson (`lessons.quiz_id`). Questions are `SINGLE` / `MULTIPLE` / `TRUE_FALSE` with weighted
  `points`; `pass_mark` is a percent; `max_attempts` optional.
- **Taking** (learner): `quiz_attempts` opens on start; answers land in `quiz_answers`; on submit the
  server grades (never trust the client), writes `score` + `passed`, and marks the lesson complete on
  pass. Re-attempts allowed until `max_attempts`.
- **Grading** is server-side only; correct-answer flags (`quiz_options.is_correct`) are never sent to
  the learner client.

## Certificates (phase 4)

On course completion (all lessons COMPLETED, every quiz passed), issue a `course_certificates` row
with a printable `serial`. Prefer reusing the existing `certificate.*` capability + certificate
rendering already in the platform over building a parallel generator — this table only records that
issuance happened and gives a verifiable serial.
