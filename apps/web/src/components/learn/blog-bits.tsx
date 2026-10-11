"use client";

import { ArrowRight, Check, Clock, Link2, Newspaper } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useLearnHref } from "@/components/learn/context";
import { CourseThumb } from "@/components/learn/course-bits";
import { FacebookIcon, LinkedinIcon, WhatsappIcon, XIcon } from "@/components/learn/social-icons";
import type { LearnPostCard } from "@/lib/learn-api";
import { formatPostDate } from "@/lib/learn-format";
import { cn } from "@/lib/utils";

/** Date · reading time · author — the line under every title on the blog. */
export function PostMeta({ post, className }: { post: LearnPostCard; className?: string }) {
  const t = useTranslations("learn.blog");
  const locale = useLocale();
  const date = formatPostDate(post.published_at, locale);

  return (
    <p
      className={cn(
        "text-muted-foreground flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs",
        className,
      )}
    >
      {date && <time dateTime={post.published_at ?? undefined}>{date}</time>}
      {date && <span aria-hidden>·</span>}
      <span className="inline-flex items-center gap-1">
        <Clock className="size-3.5" aria-hidden />
        {t("minutes", { count: post.reading_minutes })}
      </span>
      {post.author_name && (
        <>
          <span aria-hidden>·</span>
          <span dir="auto">{post.author_name}</span>
        </>
      )}
    </p>
  );
}

/**
 * One article on the blog's index. A 16:9 cover (a blog image is landscape, unlike a book), the
 * title, two lines of summary and the meta line — the shape every reader already knows from every
 * blog they have ever scrolled.
 */
export function PostCard({ post }: { post: LearnPostCard }) {
  const href = useLearnHref();

  return (
    <Link
      href={href(`/blog/${post.slug}`)}
      className="group bg-card focus-visible:ring-ring/60 flex flex-col overflow-hidden rounded-2xl border shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-2 focus-visible:outline-none"
    >
      <CourseThumb src={post.cover_image_path} className="aspect-video" iconClassName="size-9" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-5">
        <h3
          dir="auto"
          className="group-hover:text-primary line-clamp-2 text-base leading-snug font-bold transition-colors"
        >
          {post.title}
        </h3>
        {post.summary && (
          <p dir="auto" className="text-muted-foreground line-clamp-2 text-sm leading-relaxed">
            {post.summary}
          </p>
        )}
        <PostMeta post={post} className="mt-auto pt-2" />
      </div>
    </Link>
  );
}

/** The newest article, given the width of the page — the blog's front page, not just its first row. */
export function FeaturedPost({ post }: { post: LearnPostCard }) {
  const t = useTranslations("learn.blog");
  const href = useLearnHref();

  return (
    <Link
      href={href(`/blog/${post.slug}`)}
      className="group bg-card focus-visible:ring-ring/60 grid grid-cols-1 overflow-hidden rounded-3xl border shadow-sm transition-shadow duration-200 hover:shadow-lg focus-visible:ring-2 focus-visible:outline-none md:grid-cols-2"
    >
      <CourseThumb
        src={post.cover_image_path}
        className="aspect-video md:aspect-auto md:min-h-80"
        iconClassName="size-12"
        loading="eager"
      />
      <div className="flex min-w-0 flex-col justify-center gap-3 p-6 sm:p-8">
        <span className="text-primary text-xs font-bold tracking-[0.14em] uppercase">
          {t("latest")}
        </span>
        <h2
          dir="auto"
          className="group-hover:text-primary text-2xl leading-tight font-bold tracking-tight text-balance transition-colors sm:text-3xl"
        >
          {post.title}
        </h2>
        {post.summary && (
          <p dir="auto" className="text-muted-foreground line-clamp-3 leading-relaxed">
            {post.summary}
          </p>
        )}
        <PostMeta post={post} />
        <span className="text-primary mt-2 inline-flex items-center gap-1.5 text-sm font-semibold">
          {t("readArticle")}
          <ArrowRight
            className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
            aria-hidden
          />
        </span>
      </div>
    </Link>
  );
}

export function PostGrid({ posts, className }: { posts: LearnPostCard[]; className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {posts.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
    </div>
  );
}

export function BlogEmpty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-dashed py-16 text-center">
      <Newspaper className="text-muted-foreground/40 mx-auto size-10" aria-hidden />
      <p className="mt-4 font-semibold">{title}</p>
      {hint && <p className="text-muted-foreground mt-1 text-sm">{hint}</p>}
    </div>
  );
}

/**
 * Share this article. WhatsApp first — it is how a link actually travels for this audience — then
 * the usual three, then copy. Plain share URLs, no SDKs: nothing third-party loads until a click.
 */
export function ShareBar({ title }: { title: string }) {
  const t = useTranslations("learn.blog");
  const [copied, setCopied] = useState(false);

  // Read at click time: the page's own address, whichever host (subdomain / custom domain) served it.
  const here = () => (typeof window === "undefined" ? "" : window.location.href);
  const open = (url: string) => window.open(url, "_blank", "noopener,noreferrer");

  const targets = [
    {
      key: "whatsapp",
      Icon: WhatsappIcon,
      url: () => `https://wa.me/?text=${encodeURIComponent(`${title} ${here()}`)}`,
    },
    {
      key: "facebook",
      Icon: FacebookIcon,
      url: () => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(here())}`,
    },
    {
      key: "x",
      Icon: XIcon,
      url: () =>
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(here())}`,
    },
    {
      key: "linkedin",
      Icon: LinkedinIcon,
      url: () =>
        `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(here())}`,
    },
  ];

  const button =
    "border-border hover:border-primary/50 hover:text-primary flex size-10 items-center justify-center rounded-xl border transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground me-1 text-sm font-semibold">{t("share")}</span>
      {targets.map(({ key, Icon, url }) => (
        <button
          key={key}
          type="button"
          className={button}
          aria-label={t(`shareOn.${key}`)}
          title={t(`shareOn.${key}`)}
          onClick={() => open(url())}
        >
          <Icon className="size-4" />
        </button>
      ))}
      <button
        type="button"
        className={button}
        aria-label={t("copyLink")}
        title={copied ? t("copied") : t("copyLink")}
        onClick={() => {
          void navigator.clipboard?.writeText(here()).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
      >
        {copied ? <Check className="size-4" /> : <Link2 className="size-4" />}
      </button>
    </div>
  );
}
