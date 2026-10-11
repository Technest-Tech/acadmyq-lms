<?php

declare(strict_types=1);

namespace App\Support\Lms;

use App\Support\LmsMedia;
use DOMElement;
use DOMNode;
use Illuminate\Support\Facades\DB;
use Masterminds\HTML5;
use Symfony\Component\HtmlSanitizer\HtmlSanitizer;
use Symfony\Component\HtmlSanitizer\HtmlSanitizerConfig;

/**
 * The one gate between a blog post's body and the database, and the one way back out (docs/lms/12).
 *
 * The editor (Tiptap) sends HTML. That HTML is staff-authored but still untrusted — the API is
 * reachable without the editor — and it is rendered on a PUBLIC page under the client's domain,
 * so it is allow-listed down to the handful of elements a blog post is made of. Two things are
 * then rewritten into a STORED form rather than kept as the browser sent them:
 *
 *  - An uploaded image keeps only its media-asset id (`data-media-id`). Its URL is a short-lived
 *    signature, so storing it would publish a picture that breaks a few hours later. Every read
 *    re-signs it ({@see render}), and the lookup runs under RLS, so an id from another academy
 *    simply resolves to nothing.
 *  - A YouTube embed keeps only its 11-character video id (`data-youtube-video="<id>"`). The
 *    iframe is rebuilt on read with a src WE choose, so no stored row can frame any other host.
 *
 * symfony/html-sanitizer does the allow-listing; the DOM passes around it are the two rewrites
 * above plus attribute hygiene (link targets, `dir` values) that an allow-list cannot express.
 */
final class BlogContent
{
    /** The body's ceiling, in bytes of HTML. Long-form, but not a dumping ground. */
    public const MAX_BYTES = 500_000;

    /** Silent-reading speed. Arabic and English land close enough that one number serves both. */
    private const WORDS_PER_MINUTE = 200;

    private const EXCERPT_CHARS = 220;

    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';

    private const YOUTUBE_ID = '/^[A-Za-z0-9_-]{11}$/';

    /** Block elements that carry a writing direction (Tiptap's `textDirection: 'auto'`). */
    private const DIRECTIONAL = ['p', 'h2', 'h3', 'h4', 'blockquote', 'ul', 'ol', 'li', 'pre'];

    /** Editor HTML → the stored form. Never throws: anything unrecognised is dropped, not rejected. */
    public static function sanitize(?string $html): string
    {
        $html = (string) $html;
        if (trim($html) === '') {
            return '';
        }

        // Embeds first: the allow-list has no iframe, so a valid YouTube embed must already be
        // its placeholder by the time the sanitizer sees it — and an invalid one is gone.
        $html = self::transform($html, static function (DOMElement $root): void {
            // The post title is the page's only H1, and the body's outline stops at H4 — demote
            // rather than drop, so a pasted heading stays a heading.
            foreach (['h1' => 'h2', 'h5' => 'h4', 'h6' => 'h4'] as $from => $to) {
                foreach (self::elements($root, $from) as $heading) {
                    $replacement = $root->ownerDocument->createElement($to);
                    while ($heading->firstChild !== null) {
                        $replacement->appendChild($heading->firstChild);
                    }
                    $heading->parentNode?->replaceChild($replacement, $heading);
                }
            }

            foreach (self::elements($root, 'iframe') as $iframe) {
                $parent = $iframe->parentNode;
                $wrapper = $parent instanceof DOMElement && $parent->hasAttribute('data-youtube-video')
                    ? $parent
                    : $iframe;
                $id = self::youtubeId($iframe->getAttribute('src'));

                if ($id === null) {
                    $wrapper->parentNode?->removeChild($wrapper);

                    continue;
                }

                $placeholder = $root->ownerDocument->createElement('div');
                $placeholder->setAttribute('data-youtube-video', $id);
                $wrapper->parentNode?->replaceChild($placeholder, $wrapper);
            }
        });

        $clean = self::sanitizer()->sanitize($html);

        return trim(self::transform($clean, static function (DOMElement $root): void {
            foreach (self::elements($root, 'img') as $img) {
                $mediaId = trim($img->getAttribute('data-media-id'));
                if ($mediaId !== '' && preg_match(self::UUID, $mediaId) === 1) {
                    // Stored by id alone — the signed URL the editor showed is already expiring.
                    $img->setAttribute('data-media-id', strtolower($mediaId));
                    $img->removeAttribute('src');
                } else {
                    $img->removeAttribute('data-media-id');
                    // The sanitizer already dropped any non-http(s) src (blob:, data:, javascript:),
                    // so a missing one here means the image had nothing safe to point at.
                    if (trim($img->getAttribute('src')) === '') {
                        $img->parentNode?->removeChild($img);

                        continue;
                    }
                }
                foreach (['width', 'height'] as $dimension) {
                    if ($img->hasAttribute($dimension) && ! ctype_digit($img->getAttribute($dimension))) {
                        $img->removeAttribute($dimension);
                    }
                }
            }

            foreach (self::elements($root, 'div') as $div) {
                $id = $div->getAttribute('data-youtube-video');
                if (preg_match(self::YOUTUBE_ID, $id) === 1) {
                    while ($div->firstChild !== null) {
                        $div->removeChild($div->firstChild);
                    }

                    continue;
                }
                // Any other div is structure the editor never produces — keep what is inside it.
                self::unwrap($div);
            }

            foreach (self::elements($root, 'a') as $a) {
                if (trim($a->getAttribute('href')) === '') {
                    self::unwrap($a);

                    continue;
                }
                if ($a->hasAttribute('target')) {
                    $a->setAttribute('target', '_blank');
                }
                $a->setAttribute('rel', 'noopener noreferrer');
            }

            foreach (self::DIRECTIONAL as $tag) {
                foreach (self::elements($root, $tag) as $el) {
                    if ($el->hasAttribute('dir') && ! in_array($el->getAttribute('dir'), ['auto', 'ltr', 'rtl'], true)) {
                        $el->setAttribute('dir', 'auto');
                    }
                }
            }
        }));
    }

    /**
     * The stored form → HTML a browser can show: images re-signed, embeds re-expanded.
     *
     * Runs under the caller's tenant context, so the media lookup is RLS-scoped: a `data-media-id`
     * naming another academy's upload finds no row and the image is dropped rather than leaked.
     */
    public static function render(?string $stored): string
    {
        $stored = (string) $stored;
        if (trim($stored) === '') {
            return '';
        }

        $ids = self::mediaIds($stored);
        $urls = $ids === [] ? [] : DB::table('media_assets')
            ->whereIn('id', $ids)
            ->where('kind', 'IMAGE')
            ->where('status', 'READY')
            ->pluck('storage_key', 'id')
            ->map(fn ($key): string => LmsMedia::objectUrl((string) $key))
            ->all();

        return self::transform($stored, static function (DOMElement $root) use ($urls): void {
            foreach (self::elements($root, 'img') as $img) {
                $mediaId = $img->getAttribute('data-media-id');
                if ($mediaId !== '') {
                    $url = $urls[$mediaId] ?? null;
                    if ($url === null) {
                        $img->parentNode?->removeChild($img);

                        continue;
                    }
                    $img->setAttribute('src', $url);
                }
                $img->setAttribute('loading', 'lazy');
                $img->setAttribute('decoding', 'async');
            }

            foreach (self::elements($root, 'div') as $div) {
                $id = $div->getAttribute('data-youtube-video');
                if (preg_match(self::YOUTUBE_ID, $id) !== 1) {
                    continue;
                }
                // Tiptap parses `div[data-youtube-video] iframe` back into a video node, so this one
                // shape serves the public page and the editor's next load alike.
                $iframe = $root->ownerDocument->createElement('iframe');
                $iframe->setAttribute('src', 'https://www.youtube-nocookie.com/embed/'.$id);
                $iframe->setAttribute('title', 'YouTube video');
                $iframe->setAttribute('loading', 'lazy');
                $iframe->setAttribute('allow', 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
                $iframe->setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
                $iframe->setAttribute('allowfullscreen', 'true');
                $div->appendChild($iframe);
            }
        });
    }

    /** The body as plain text — for the excerpt, the word count and search. */
    public static function plainText(?string $html): string
    {
        $html = (string) $html;
        // Block boundaries become spaces first, or "<p>end</p><p>Start" reads as "endStart".
        $spaced = preg_replace('~</(p|h[1-6]|li|blockquote|pre|div)>|<br\s*/?>~i', ' ', $html) ?? $html;
        $text = html_entity_decode(strip_tags($spaced), ENT_QUOTES | ENT_HTML5, 'UTF-8');

        return trim(preg_replace('/\s+/u', ' ', $text) ?? $text);
    }

    /** A card-sized summary: the opening of the body, cut on a word boundary. */
    public static function excerpt(?string $html): string
    {
        $text = self::plainText($html);
        if (mb_strlen($text) <= self::EXCERPT_CHARS) {
            return $text;
        }

        $cut = mb_substr($text, 0, self::EXCERPT_CHARS);
        $space = mb_strrpos($cut, ' ');
        if ($space !== false && $space > self::EXCERPT_CHARS / 2) {
            $cut = mb_substr($cut, 0, $space);
        }

        return rtrim($cut, " \t\n\r\0\x0B.,;:،؛").'…';
    }

    public static function readingMinutes(?string $html): int
    {
        $text = self::plainText($html);
        $words = $text === '' ? 0 : count(preg_split('/\s+/u', $text) ?: []);

        return max(1, (int) ceil($words / self::WORDS_PER_MINUTE));
    }

    /** Does the body hold anything a reader would see — words, an image or a video? */
    public static function hasContent(?string $stored): bool
    {
        $stored = (string) $stored;

        return self::plainText($stored) !== ''
            || str_contains($stored, '<img')
            || str_contains($stored, 'data-youtube-video="');
    }

    /** @return list<string> */
    public static function mediaIds(string $stored): array
    {
        preg_match_all('/data-media-id="([0-9a-f-]{36})"/', $stored, $m);

        return array_values(array_unique($m[1]));
    }

    // ── internals ────────────────────────────────────────────────────────────

    /**
     * The allow-list. Everything a Tiptap StarterKit document can contain (headings H2–H4 — the
     * pre-pass has already demoted the rest), and nothing else: no style, no class, no event
     * handler, no form.
     */
    private static function sanitizer(): HtmlSanitizer
    {
        $config = (new HtmlSanitizerConfig())
            ->withMaxInputLength(self::MAX_BYTES)
            ->allowLinkSchemes(['https', 'http', 'mailto', 'tel'])
            ->allowMediaSchemes(['https', 'http'])
            ->allowElement('a', ['href', 'title', 'target'])
            ->allowElement('img', ['src', 'alt', 'title', 'width', 'height', 'data-media-id'])
            ->allowElement('div', ['data-youtube-video'])
            ->allowElement('ol', ['dir', 'start'])
            ->blockElement('span');

        foreach (self::DIRECTIONAL as $tag) {
            if ($tag !== 'ol') {
                $config = $config->allowElement($tag, ['dir']);
            }
        }
        foreach (['strong', 'b', 'em', 'i', 'u', 's', 'code', 'br', 'hr'] as $tag) {
            $config = $config->allowElement($tag);
        }

        return new HtmlSanitizer($config);
    }

    /**
     * Parse a fragment, let $edit rewrite it, serialise it back. HTML5-aware and UTF-8 safe on every
     * PHP version this app runs on (prod is 8.2, so not the 8.4 `Dom\HTMLDocument`).
     *
     * @param  callable(DOMElement): void  $edit
     */
    private static function transform(string $html, callable $edit): string
    {
        $html5 = new HTML5(['disable_html_ns' => true]);
        $doc = $html5->loadHTML('<!doctype html><html><body><div id="blog-root">'.$html.'</div></body></html>');
        $root = $doc->getElementById('blog-root');
        if (! $root instanceof DOMElement) {
            return '';
        }

        $edit($root);

        $out = '';
        foreach (iterator_to_array($root->childNodes) as $child) {
            $out .= $html5->saveHTML($child);
        }

        return $out;
    }

    /**
     * A STATIC list of the descendants named $tag — the live DOMNodeList would skip nodes as the
     * loop removes or replaces them.
     *
     * @return list<DOMElement>
     */
    private static function elements(DOMElement $root, string $tag): array
    {
        $found = [];
        foreach ($root->getElementsByTagName($tag) as $el) {
            if ($el instanceof DOMElement && $el !== $root) {
                $found[] = $el;
            }
        }

        return $found;
    }

    /** Replace an element with its own children. */
    private static function unwrap(DOMNode $el): void
    {
        $parent = $el->parentNode;
        if ($parent === null) {
            return;
        }
        while ($el->firstChild !== null) {
            $parent->insertBefore($el->firstChild, $el);
        }
        $parent->removeChild($el);
    }

    /** The video id out of any YouTube embed / watch / short url, or null for anything else. */
    private static function youtubeId(string $src): ?string
    {
        $src = trim($src);
        if (preg_match(
            '~^(?:https?:)?//(?:www\.|m\.)?(?:youtube(?:-nocookie)?\.com/(?:embed/|watch\?(?:.*&)?v=|shorts/)|youtu\.be/)([A-Za-z0-9_-]{11})(?:[?&#/].*)?$~',
            $src,
            $m,
        ) !== 1) {
            return null;
        }

        return $m[1];
    }
}
