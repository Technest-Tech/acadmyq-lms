# 12 — Blog

> Articles on the client's public course site. Written in the dashboard (`/lms/blog`), published to
> `/blog` on their site. The content-marketing half of selling courses: a search engine finds an
> article long before it finds a course page.

## 1. What a client can do

- Write a post in a rich-text editor: headings, bold/italic/underline/strike, lists, quote, code,
  divider, links, **uploaded images** and **YouTube embeds**. Arabic and English mix freely — every
  block carries `dir="auto"`.
- Give it a cover, an optional summary, a byline (defaults to the writer's name) and a URL slug.
- Publish / unpublish / delete. The first publish date sticks — unpublishing to fix a typo does not
  bump an old article to the top.

No categories, tags, scheduling or comments. Minimum viable form, same rule as books (docs/lms/11 §1).

## 2. Built from packages, not from scratch

| Piece | Package |
|---|---|
| Editor | **Tiptap 3** (`@tiptap/react`, `starter-kit`, `extension-image`, `extension-youtube`, `extensions` for the placeholder) |
| Article typography | **`@tailwindcss/typography`** (`prose`), plus a small `.blog-prose` block in `globals.css` for embeds/images |
| HTML sanitizing | **`symfony/html-sanitizer`** (allow-list), wrapped by `App\Support\Lms\BlogContent` |

## 3. The stored form — `App\Support\Lms\BlogContent`

The editor sends HTML; the API never stores it as sent.

- `sanitize()` allow-lists the StarterKit's elements (H2–H4, no style/class/handlers/forms), demotes a
  pasted H1 to H2, forces `rel="noopener noreferrer"` on links and drops non-http(s) URLs.
- **Uploaded images** are stored as `<img data-media-id="<asset uuid>">` with NO `src` — a signed URL
  expires. `render()` re-signs on every read, and the lookup runs under RLS, so an id from another
  academy resolves to nothing and the image is dropped.
- **YouTube** is stored as `<div data-youtube-video="<11-char id>"></div>`; `render()` rebuilds the
  iframe pointing at `youtube-nocookie.com`. No stored row can frame any other host.
- `auto_excerpt` and `reading_minutes` (200 wpm) are derived on every body save. Cards show
  `excerpt ?: auto_excerpt` as `summary`.

## 4. Schema

Migration `2026_10_08_000001_lms_blog_posts` — one table, `blog_posts`: uuid v7, `academy_id`,
`title`, `slug` (unique per academy), `excerpt`, `auto_excerpt`, `content_html`, `cover_image_path`
(same contract as a course cover), `author_name`, `reading_minutes`, `status DRAFT|PUBLISHED`,
`published_at`, soft delete. FORCE RLS `tenant_isolation`. The client purge picks it up automatically.

## 5. API

Staff (`entitled:lms`, `course.read` / `course.manage` — no new capabilities, like books):
`GET|POST /api/courses/posts`, `GET /api/courses/posts/summary`, `GET|PATCH|DELETE /api/courses/posts/{id}`,
`POST /api/courses/posts/{id}/publish`. Publishing an empty post is a 422; so is emptying a published one.

Public (`/api/learn`, read-only): `GET /posts?page=N` (12 per page) and `GET /posts/{slug}` (+ three
more to read). A draft or deleted slug 404s. `GET /api/learn/site` carries `stats.posts`, which is
what the header's Blog link turns on — right on the first frame.

## 6. Surfaces

- **Dashboard** — `/lms/blog` (list, filter, search, publish menu) and `/lms/blog/[id]` (full-page
  editor: one Save, unsaved-changes state, Ctrl/⌘+S, leave-page warning; Publish saves first). Nav
  item `lmsBlog`, part of `LMS_ONLY_KEYS`.
- **Site** — `/blog` (newest post featured, grid, pagination) and `/blog/[slug]` (article, share bar,
  "keep reading"). Both are **server components**: per-article title/description/OG `article` card,
  their own canonical (the layout's points at the site root), and a schema.org `BlogPosting`. The home
  page shows the latest three when any exist.

Tests: `tests/Feature/Lms/BlogPostsTest.php` (6) + the Blog-link cases in `site-chrome.test.tsx`.
