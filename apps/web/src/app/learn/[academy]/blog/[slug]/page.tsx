import { ArrowLeft, ArrowRight, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { cache } from "react";
import { PostGrid, ShareBar } from "@/components/learn/blog-bits";
import { Container, CtaButton, Section, SectionHeading } from "@/components/learn/sections";
import { resolveSiteName } from "@/lib/learn-brand";
import { formatPostDate } from "@/lib/learn-format";
import { fetchLearnPost, fetchLearnSite } from "@/lib/learn-server";

/**
 * One article (docs/lms/12). Server-rendered end to end — the body, the title, the per-article
 * `<title>`/description/OG card and the schema.org `BlogPosting` — because the point of a post is
 * to be found and shared, and both crawlers and link previews read the first response only.
 *
 * `content_html` is sanitized by the API on write and rebuilt on read (BlogContent), so it is
 * rendered as-is: there is no script, style, handler or foreign frame left in it to escape.
 */

type Props = { params: Promise<{ academy: string; slug: string }> };

/** One fetch per request, shared by generateMetadata and the page. */
const load = cache((academy: string, slug: string) => fetchLearnPost(academy, slug));

async function siteInfo(academy: string) {
  try {
    const { site, academy: info } = await fetchLearnSite(academy);
    return { brandName: site.brand.name, name: info.name, url: info.url ?? null };
  } catch {
    return { brandName: "", name: "", url: null };
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { academy, slug } = await params;
  const data = await load(academy, slug);
  if (data === null) return {};

  const t = await getTranslations("learn");
  const info = await siteInfo(academy);
  const name = resolveSiteName(info.brandName, info.name) ?? t("brand.fallbackName");
  const { post } = data;
  const url = info.url && info.url.startsWith("http") ? `${info.url}/blog/${post.slug}` : null;
  const description = post.summary ?? undefined;
  const image = post.cover_image_path ?? undefined;

  return {
    title: `${post.title} — ${name}`,
    description,
    ...(url ? { alternates: { canonical: url } } : {}),
    openGraph: {
      title: post.title,
      description,
      siteName: name,
      type: "article",
      ...(url ? { url } : {}),
      publishedTime: post.published_at ?? undefined,
      modifiedTime: post.updated_at ?? undefined,
      authors: post.author_name ? [post.author_name] : undefined,
      images: image ? [image] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: post.title,
      description,
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { academy, slug } = await params;
  const data = await load(academy, slug);
  if (data === null) notFound();

  const t = await getTranslations("learn.blog");
  const locale = await getLocale();
  const info = await siteInfo(academy);
  const { post, more } = data;
  const date = formatPostDate(post.published_at, locale);
  const Back = locale.startsWith("ar") ? ArrowRight : ArrowLeft;
  const Forward = locale.startsWith("ar") ? ArrowLeft : ArrowRight;
  const blogHref = `/learn/${academy}/blog`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.summary ?? undefined,
    image: post.cover_image_path ?? undefined,
    datePublished: post.published_at ?? undefined,
    dateModified: post.updated_at ?? undefined,
    author: post.author_name ? { "@type": "Person", name: post.author_name } : undefined,
    publisher: {
      "@type": "Organization",
      name: resolveSiteName(info.brandName, info.name) ?? undefined,
    },
    ...(info.url && info.url.startsWith("http")
      ? { mainEntityOfPage: `${info.url}/blog/${post.slug}` }
      : {}),
  };

  return (
    <>
      <script
        type="application/ld+json"
        // `<` escaped so no string in the post can close this script tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />

      <article>
        <header className="relative isolate overflow-hidden border-b">
          <div
            className="absolute inset-0 -z-10"
            style={{ background: "linear-gradient(160deg, var(--brand-soft), transparent 70%)" }}
          />
          <Container className="py-9 sm:py-14">
            <div className="mx-auto max-w-3xl space-y-5">
              <Link
                href={blogHref}
                className="text-muted-foreground hover:text-primary inline-flex items-center gap-1.5 text-sm font-semibold transition-colors"
              >
                <Back className="size-4" aria-hidden /> {t("backToBlog")}
              </Link>
              <h1
                dir="auto"
                className="text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl lg:text-5xl"
              >
                {post.title}
              </h1>
              {post.summary && (
                <p dir="auto" className="text-muted-foreground text-lg leading-relaxed">
                  {post.summary}
                </p>
              )}
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                {post.author_name && (
                  <span dir="auto" className="text-foreground font-semibold">
                    {post.author_name}
                  </span>
                )}
                {date && <time dateTime={post.published_at ?? undefined}>{date}</time>}
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-4" aria-hidden />
                  {t("minutes", { count: post.reading_minutes })}
                </span>
              </div>
            </div>
          </Container>
        </header>

        <Container className="py-8 sm:py-12">
          <div className="mx-auto max-w-3xl">
            {post.cover_image_path && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={post.cover_image_path}
                alt=""
                className="mb-8 aspect-video w-full rounded-2xl object-cover shadow-sm sm:mb-10"
                fetchPriority="high"
              />
            )}

            <div
              dir="auto"
              className="blog-prose prose prose-neutral prose-lg prose-a:text-primary prose-headings:tracking-tight max-w-none"
              dangerouslySetInnerHTML={{ __html: post.content_html }}
            />

            <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t pt-6">
              <ShareBar title={post.title} />
              <CtaButton variant="outline" size="md" href={`/learn/${academy}/courses`}>
                {t("browseCourses")}
                <Forward className="size-4" aria-hidden />
              </CtaButton>
            </div>
          </div>
        </Container>
      </article>

      {more.length > 0 && (
        <Section tone="muted" divider>
          <SectionHeading title={t("moreTitle")} />
          <PostGrid posts={more} />
          <div className="mt-10 text-center">
            <CtaButton variant="outline" href={blogHref}>
              {t("viewAll")}
              <Forward className="size-4" aria-hidden />
            </CtaButton>
          </div>
        </Section>
      )}
    </>
  );
}
