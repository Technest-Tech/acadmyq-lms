"use client";

import {
  ArrowRight,
  BarChart3,
  Calendar,
  Check,
  CheckCircle,
  ClipboardCheck,
  Code2,
  FileText,
  GraduationCap,
  Menu,
  Play,
  Shield,
  Star,
  Users,
  X,
  Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

/* ─── types ──────────────────────────────────────────────────────────── */

type Lang = "ar" | "en";

/* ─── translations ───────────────────────────────────────────────────── */

const CONTENT = {
  ar: {
    nav: {
      features: "المميزات",
      howItWorks: "طريقة العمل",
      reviews: "آراء العملاء",
      signIn: "تسجيل الدخول",
      getStarted: "ابدأ دلوقتي",
    },
    hero: {
      badge: "المنصة الشاملة لإدارة الأكاديميات",
      headline1: "شغّل أكاديميتك",
      gradient: "بشكل أذكى",
      subtitle:
        "الطلاب، المدرسين، الجداول، الفواتير، والحضور — كلهم في منصة واحدة أنيقة مصممة للأكاديميات الجادة.",
      cta1: "راسلنا على واتساب",
      cta2: "تابع العرض",
      trust: ["مش محتاج كارت ائتمان", "إعداد في 5 دقايق", "إلغاء في أي وقت"],
    },
    features: {
      badge: "كل اللي محتاجه",
      title: "مبني على طريقة الأكاديميات الحقيقية",
      subtitle:
        "كل وحدة مصممة خصيصاً لطريقة شغل الأكاديميات — مش مجرد إضافة لأداة عامة.",
      items: [
        {
          title: "إدارة الطلاب والأولياء",
          desc: "ملفات كاملة، بيانات أولياء الأمور، سجل التسجيل، وحقول مخصصة — كل حاجة متصلة ببعضها.",
        },
        {
          title: "جدولة ذكية",
          desc: "تقويم أسبوعي بصري مع حصص متكررة، كشف التعارضات، وإعادة جدولة بنقرة واحدة.",
        },
        {
          title: "تتبع الحضور",
          desc: "حضور لكل حصة مع إشعارات واتساب تلقائية وتقارير الغياب التفصيلية.",
        },
        {
          title: "الفواتير والمدفوعات",
          desc: "فواتير شهرية تلقائية، روابط دفع أونلاين، وبوابة دفع بتصميمك للأولياء.",
        },
        {
          title: "لوحة التحكم المالية",
          desc: "الإيرادات مقارنة بالمدفوعات، معدلات التحصيل، والأرصدة المتأخرة — في رسوم بيانية مباشرة.",
        },
        {
          title: "صلاحيات وتدقيق",
          desc: "أذونات دقيقة لكل دور، مع سجل تدقيق كامل لكل عملية في النظام.",
        },
      ],
    },
    founder: {
      badge: "قصة المؤسس",
      title: "اتبنى من جوا الأكاديميات",
      quote:
        "أنا مهندس برمجيات وصاحب أكاديمية في نفس الوقت. بنيت Acadmyq لأني تعبت من إدارة الطلاب على Excel، تتبع المدفوعات يدوياً، وضياع سجلات الحضور. كل feature في النظام ده بيحل مشكلة حقيقية أنا شخصياً عشتها.",
      role: "مهندس برمجيات وصاحب أكاديمية",
      points: [
        "فاهم الألم الحقيقي لإدارة الأكاديميات من الداخل",
        "مش شركة درست المشكلة من بره — ده حد عاشها",
        "كل قرار في المنتج بيجي من تجربة حقيقية مش تخيلات",
      ],
    },
    stats: [
      { value: "500+", label: "أكاديمية" },
      { value: "+12k", label: "طالب نشط" },
      { value: "98%", label: "رضا العملاء" },
      { value: "4.9★", label: "التقييم العام" },
    ],
    howItWorks: {
      badge: "بسيط من الأساس",
      title: "شغّال في دقايق",
      subtitle:
        "مش محتاج إعداد طويل. مش محتاج تدريب. 3 خطوات وأكاديميتك شغالة.",
      steps: [
        {
          n: "01",
          title: "أنشئ أكاديميتك",
          desc: "سجّل، اضبط البراند بتاعك، وادعي أول مدرس — في أقل من 5 دقايق.",
        },
        {
          n: "02",
          title: "رتّب الجداول وسجّل الطلاب",
          desc: "ابني جدولك الأسبوعي بصرياً وسجّل الطلاب مع بيانات أولياء الأمور.",
        },
        {
          n: "03",
          title: "أتمتة ونمو",
          desc: "الفواتير بتتبعت لوحدها. الحضور بيتسجل لكل حصة. أنت تركز على التدريس.",
        },
      ],
    },
    testimonials: {
      title: "بيحبوها مديري الأكاديميات",
      subtitle: "متقلقيش، مش كلام بس بتاعنا.",
      items: [
        {
          quote:
            "Acadmyq قلّل وقت الإدارة عندنا بـ 70٪. الفواتير لوحدها بتوفرلنا 8 ساعات كل شهر — والأولياء بدأوا يدفعوا في وقتهم.",
          author: "سارة الرشيدي",
          role: "مديرة، أكاديمية نور",
          rating: 5,
        },
        {
          quote:
            "عرض الجدول الأسبوعي ده بالظبط اللي كنا محتاجينه. المدرسين دلوقتي شايفين أسبوعهم كامل بوضوح.",
          author: "محمد خليل",
          role: "صاحب، معهد العقول المضيئة",
          rating: 5,
        },
      ],
    },
    cta: {
      title1: "مستعد",
      title2: "تحوّل أكاديميتك؟",
      subtitle:
        "انضم لمئات الأكاديميات اللي بتستخدم Acadmyq دلوقتي. ابدأ تجربتك المجانية — مش محتاج كارت ائتمان.",
      btn1: "راسلنا على واتساب",
      btn2: "سجّل دخول لأكاديميتك",
      pills: ["عربي وإنجليزي", "إشعارات واتساب", "آمن وخصوصي", "متوافق مع الموبايل"],
    },
    footer: {
      rights: "جميع الحقوق محفوظة.",
      links: ["الخصوصية", "الشروط", "تواصل معنا"],
    },
    mockup: {
      url: "app.academiq.io",
      kpis: [
        { label: "الطلاب", value: "248", pct: "75%" },
        { label: "المدرسين", value: "18", pct: "55%" },
        { label: "الحصص", value: "64", pct: "62%" },
      ],
      legend: ["الإيرادات", "المصروفات"],
    },
  },
  en: {
    nav: {
      features: "Features",
      howItWorks: "How it works",
      reviews: "Reviews",
      signIn: "Sign in",
      getStarted: "Get started",
    },
    hero: {
      badge: "The all-in-one academy management platform",
      headline1: "Run your academy",
      gradient: "smarter",
      subtitle:
        "Students, teachers, scheduling, invoicing, and attendance — unified in one elegant platform designed for serious academies.",
      cta1: "Send us on WhatsApp",
      cta2: "Watch demo",
      trust: ["No credit card required", "Setup in 5 minutes", "Cancel anytime"],
    },
    features: {
      badge: "Everything you need",
      title: "Built for how academies actually work",
      subtitle:
        "Every module is purpose-built for the academy workflow — not bolted onto a generic tool.",
      items: [
        {
          title: "Student & Guardian Management",
          desc: "Full profiles, guardian contacts, enrollment history, and custom report fields — all connected and searchable.",
        },
        {
          title: "Smart Scheduling",
          desc: "Visual weekly calendar with recurring sessions, conflict detection, and one-click rescheduling.",
        },
        {
          title: "Attendance Tracking",
          desc: "Per-session attendance with automated WhatsApp notifications and historical absence reports.",
        },
        {
          title: "Invoicing & Payments",
          desc: "Auto-generated monthly invoices, online payment links, and a branded public payment portal for parents.",
        },
        {
          title: "Financial Dashboard",
          desc: "Revenue vs. payouts, collection rates, and outstanding balances — in live charts at a glance.",
        },
        {
          title: "Role-Based Access & Audit",
          desc: "Granular permissions for every role, with a complete audit trail for every action across the platform.",
        },
      ],
    },
    founder: {
      badge: "Founder Story",
      title: "Built from the inside out",
      quote:
        "I'm a software engineer who also runs his own academy. I built Acadmyq because I was tired of managing students on spreadsheets, chasing parents for payments, and losing track of attendance. Every feature in this system solves a real problem I personally lived through.",
      role: "Software Engineer & Academy Owner",
      points: [
        "Understands the real pain of running an academy from the inside",
        "Not a company that studied the problem — someone who lived it",
        "Every product decision comes from real-world experience",
      ],
    },
    stats: [
      { value: "500+", label: "Academies" },
      { value: "12k+", label: "Active Students" },
      { value: "98%", label: "Satisfaction" },
      { value: "4.9★", label: "Avg. Rating" },
    ],
    howItWorks: {
      badge: "Simple by design",
      title: "Up and running in minutes",
      subtitle:
        "No lengthy setup. No training required. Three steps to a fully operational academy.",
      steps: [
        {
          n: "01",
          title: "Create your academy",
          desc: "Sign up, configure your branding, and invite your first teacher — in under 5 minutes.",
        },
        {
          n: "02",
          title: "Schedule & enroll",
          desc: "Build your weekly timetable visually and enroll students with their guardian contacts.",
        },
        {
          n: "03",
          title: "Automate & grow",
          desc: "Invoices run on autopilot. Attendance is tracked per session. You focus on teaching.",
        },
      ],
    },
    testimonials: {
      title: "Loved by academy directors",
      subtitle: "Don't take our word for it.",
      items: [
        {
          quote:
            "Acadmyq cut our admin time by 70%. The invoicing alone saves us 8 hours every month — and parents actually pay on time now.",
          author: "Sarah Al-Rashidi",
          role: "Director, Noor Academy",
          rating: 5,
        },
        {
          quote:
            "The scheduling view is exactly what we needed. The weekly calendar finally gave our teachers real visibility into their week.",
          author: "Mohammed Khalil",
          role: "Owner, Bright Minds Institute",
          rating: 5,
        },
      ],
    },
    cta: {
      title1: "Ready to transform",
      title2: "your academy?",
      subtitle:
        "Join hundreds of academies already using Acadmyq. Start your free trial — no credit card required.",
      btn1: "Send us on WhatsApp",
      btn2: "Sign in to your academy",
      pills: ["Arabic & English", "WhatsApp notifications", "Secure & private", "Mobile friendly"],
    },
    footer: {
      rights: "All rights reserved.",
      links: ["Privacy", "Terms", "Contact"],
    },
    mockup: {
      url: "app.academiq.io",
      kpis: [
        { label: "Students", value: "248", pct: "75%" },
        { label: "Teachers", value: "18", pct: "55%" },
        { label: "Sessions", value: "64", pct: "62%" },
      ],
      legend: ["Revenue", "Payouts"],
    },
  },
};

type Content = (typeof CONTENT)["en"];

const FEATURE_ICONS: React.ElementType[] = [
  Users,
  Calendar,
  ClipboardCheck,
  FileText,
  BarChart3,
  Shield,
];

/* ─── Lang Toggle ────────────────────────────────────────────────────── */

const WA_LINK = "https://wa.me/201557601371";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

/* ─── Floating WhatsApp Button ───────────────────────────────────────── */

function WhatsAppFloat() {
  return (
    <a
      href={WA_LINK}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat on WhatsApp"
      className="fixed bottom-6 end-6 z-50 flex size-14 items-center justify-center rounded-full shadow-2xl transition-transform duration-200 hover:scale-110 active:scale-95"
      style={{
        background: "#25D366",
        boxShadow: "0 8px 28px rgba(37, 211, 102, 0.5), 0 0 0 0 rgba(37, 211, 102, 0.4)",
        animation: "wa-pulse 2.5s ease-out infinite",
      }}
    >
      <WhatsAppIcon className="size-7 text-white" />
      <style>{`
        @keyframes wa-pulse {
          0%   { box-shadow: 0 8px 28px rgba(37,211,102,0.5), 0 0 0 0 rgba(37,211,102,0.4); }
          70%  { box-shadow: 0 8px 28px rgba(37,211,102,0.5), 0 0 0 14px rgba(37,211,102,0); }
          100% { box-shadow: 0 8px 28px rgba(37,211,102,0.5), 0 0 0 0 rgba(37,211,102,0); }
        }
      `}</style>
    </a>
  );
}

function LangToggle({
  lang,
  setLang,
  scrolled,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  scrolled: boolean;
}) {
  return (
    <button
      onClick={() => setLang(lang === "ar" ? "en" : "ar")}
      className={`flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-all hover:scale-105 ${
        scrolled
          ? "border-border text-foreground/70 hover:text-foreground"
          : "border-white/20 text-white/70 hover:border-white/40 hover:text-white"
      }`}
    >
      <span className="text-sm leading-none">
        {lang === "ar" ? "🇺🇸" : "🇪🇬"}
      </span>
      {lang === "ar" ? "English" : "عربي"}
    </button>
  );
}

/* ─── Navbar ─────────────────────────────────────────────────────────── */

function Navbar({
  lang,
  setLang,
  t,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Content["nav"];
}) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const navLinks = [
    { href: "#features", label: t.features },
    { href: "#how-it-works", label: t.howItWorks },
    { href: "#testimonials", label: t.reviews },
  ];

  return (
    <nav
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-border bg-white/95 shadow-sm backdrop-blur-md"
          : "bg-transparent"
      }`}
    >
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          {/* Logo */}
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Acadmyq"
              className="size-9 shrink-0 object-contain"
            />
            <span
              className={`text-lg font-bold tracking-tight transition-colors ${
                scrolled ? "text-foreground" : "text-white"
              }`}
            >
              Acadmyq
            </span>
          </Link>

          {/* Desktop nav links */}
          <div className="hidden flex-1 items-center justify-center gap-8 md:flex">
            {navLinks.map(({ href, label }) => (
              <a
                key={href}
                href={href}
                className={`text-sm font-medium transition-colors hover:text-primary ${
                  scrolled
                    ? "text-foreground/65"
                    : "text-white/70 hover:text-white"
                }`}
              >
                {label}
              </a>
            ))}
          </div>

          {/* Desktop CTAs */}
          <div className="hidden shrink-0 items-center gap-3 md:flex">
            <LangToggle lang={lang} setLang={setLang} scrolled={scrolled} />
            <Link
              href="/login"
              className={`text-sm font-medium transition-colors hover:text-primary ${
                scrolled
                  ? "text-foreground/65"
                  : "text-white/70 hover:text-white"
              }`}
            >
              {t.signIn}
            </Link>
            <Link
              href="/login"
              className="flex h-9 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-white shadow-sm transition-all hover:opacity-90 hover:shadow-md"
              style={{ background: "oklch(0.519 0.158 163.2)" }}
            >
              {t.getStarted}
              <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
            </Link>
          </div>

          {/* Mobile: lang toggle + hamburger */}
          <div className="flex items-center gap-2 md:hidden">
            <LangToggle lang={lang} setLang={setLang} scrolled={scrolled} />
            <button
              onClick={() => setOpen((v) => !v)}
              className={`rounded-lg p-2 transition-colors ${
                scrolled ? "text-foreground" : "text-white"
              }`}
              aria-label="Toggle navigation"
            >
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="border-b border-border bg-white shadow-lg md:hidden">
          <div className="space-y-1 px-6 py-4">
            {navLinks.map(({ href, label }) => (
              <a
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-2.5 text-sm font-medium text-foreground/70 hover:bg-muted hover:text-foreground"
              >
                {label}
              </a>
            ))}
            <Link
              href="/login"
              className="mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-white"
              style={{ background: "oklch(0.519 0.158 163.2)" }}
            >
              {t.getStarted}
              <ArrowRight className="size-3.5 rtl:rotate-180" />
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}

/* ─── Dashboard Mockup ───────────────────────────────────────────────── */

/* ─── Hero Image ─────────────────────────────────────────────────────── */

function HeroImage({ lang }: { lang: Lang }) {
  return (
    <div className="relative px-4 py-8">
      {/* Ambient glow behind the frame */}
      <div
        className="pointer-events-none absolute inset-4 rounded-[2.5rem] blur-[90px]"
        style={{
          background:
            "radial-gradient(ellipse at 50% 60%, oklch(0.519 0.158 163 / 0.3), oklch(0.835 0.118 85 / 0.12) 55%, transparent 75%)",
        }}
      />

      {/* Gradient border wrapper — 1.5 px emerald→gold */}
      <div
        className="relative rounded-[1.625rem] p-[1.5px]"
        style={{
          background:
            "linear-gradient(135deg, oklch(0.519 0.158 163.2 / 0.8) 0%, oklch(1 0 0 / 0.12) 45%, oklch(0.835 0.118 85 / 0.65) 100%)",
        }}
      >
        {/* Inner card */}
        <div
          className="overflow-hidden rounded-[1.5rem]"
          style={{
            boxShadow:
              "0 32px 80px oklch(0 0 0 / 0.55), 0 0 0 1px oklch(1 0 0 / 0.05)",
          }}
        >
          {/* Browser chrome — always LTR */}
          <div
            className="flex items-center gap-1.5 px-4 py-2.5"
            dir="ltr"
            style={{
              background: "oklch(0.135 0.02 250)",
              borderBottom: "1px solid oklch(1 0 0 / 0.08)",
            }}
          >
            <div className="size-2.5 rounded-full" style={{ background: "#FF5F57" }} />
            <div className="size-2.5 rounded-full" style={{ background: "#FEBC2E" }} />
            <div className="size-2.5 rounded-full" style={{ background: "#28C840" }} />
            <div
              className="mx-3 flex flex-1 items-center rounded-md px-3 text-[10px]"
              style={{
                height: "22px",
                background: "oklch(1 0 0 / 0.07)",
                color: "oklch(1 0 0 / 0.32)",
                lineHeight: "22px",
              }}
            >
              app.academiq.io
            </div>
          </div>

          {/* Real screenshot */}
          <Image
            src="/hero_image.png"
            alt={lang === "ar" ? "لوحة تحكم أكادْميك" : "Acadmyq Dashboard"}
            width={1560}
            height={900}
            priority
            quality={93}
            className="w-full"
            style={{ display: "block" }}
          />
        </div>
      </div>

      {/* Floating badge — top-start: setup time */}
      <div
        className="absolute top-4 start-0 flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold text-white"
        style={{
          background: "oklch(0.519 0.158 163.2)",
          boxShadow:
            "0 6px 20px oklch(0.519 0.158 163 / 0.55), 0 0 0 1px oklch(0.519 0.158 163 / 0.3)",
        }}
      >
        <Zap className="size-3 shrink-0" aria-hidden />
        {lang === "ar" ? "إعداد في 5 دقايق" : "Setup in 5 min"}
      </div>

      {/* Floating badge — bottom-end: satisfaction */}
      <div
        className="absolute bottom-4 end-0 flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold"
        style={{
          background: "oklch(0.09 0.018 250)",
          color: "oklch(0.835 0.118 85)",
          border: "1px solid oklch(0.835 0.118 85 / 0.35)",
          boxShadow: "0 6px 20px oklch(0 0 0 / 0.45)",
        }}
      >
        <Star className="size-3 shrink-0 fill-current" aria-hidden />
        {lang === "ar" ? "98٪ رضا العملاء" : "98% satisfaction"}
      </div>

      {/* Floating notification card — vertical centre, outside end edge */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -end-3 flex items-center gap-2.5 rounded-2xl px-3 py-2.5"
        dir={lang === "ar" ? "rtl" : "ltr"}
        style={{
          background: "oklch(1 0 0)",
          border: "1px solid oklch(0.905 0.002 248)",
          boxShadow: "0 8px 28px oklch(0 0 0 / 0.18)",
        }}
      >
        <div
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-sm"
          style={{ background: "#25D366" }}
          aria-hidden
        >
          💬
        </div>
        <div className="min-w-0">
          <div
            className="text-[11px] font-semibold whitespace-nowrap"
            style={{ color: "oklch(0.13 0 0)" }}
          >
            {lang === "ar" ? "إشعار واتساب" : "WhatsApp Alert"}
          </div>
          <div
            className="text-[10px] whitespace-nowrap"
            style={{ color: "oklch(0.55 0 0)" }}
          >
            {lang === "ar" ? "أُرسل تلقائياً ✓✓" : "Sent automatically ✓✓"}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Hero ───────────────────────────────────────────────────────────── */

function Hero({ t, lang }: { t: Content["hero"]; lang: Lang }) {
  return (
    <section className="relative flex min-h-[88vh] items-center overflow-hidden rounded-b-[2.5rem]">
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(155deg, oklch(0.09 0.018 250) 0%, oklch(0.12 0.032 210) 50%, oklch(0.15 0.065 163) 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute -top-56 -right-56 size-[700px] rounded-full blur-[140px]"
        style={{ background: "radial-gradient(circle, oklch(0.519 0.158 163 / 0.22), transparent 70%)" }}
      />
      <div
        className="pointer-events-none absolute -bottom-40 -left-40 size-[550px] rounded-full blur-[110px]"
        style={{ background: "radial-gradient(circle, oklch(0.835 0.118 85 / 0.15), transparent 70%)" }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.038]"
        style={{
          backgroundImage: "radial-gradient(circle at 1.5px 1.5px, white 1.5px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />

      <div className="relative z-10 mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-16 px-6 py-32 lg:grid-cols-2 lg:gap-12 lg:px-8">
        {/* Copy */}
        <div className="animate-page-enter space-y-8">
          {/* Badge */}
          <div
            className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold"
            style={{
              background: "oklch(0.519 0.158 163 / 0.13)",
              color: "oklch(0.76 0.13 163)",
              border: "1px solid oklch(0.519 0.158 163 / 0.26)",
            }}
          >
            <Zap className="size-3 shrink-0" aria-hidden />
            {t.badge}
          </div>

          {/* Headline */}
          <div className="space-y-3">
            <h1 className="text-5xl font-bold leading-[1.12] tracking-tight text-white lg:text-6xl xl:text-[4.25rem]">
              {t.headline1}{" "}
              <br className="hidden sm:block" />
              <span
                style={{
                  backgroundImage:
                    "linear-gradient(135deg, oklch(0.73 0.16 163) 0%, oklch(0.835 0.118 85) 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {t.gradient}
              </span>
            </h1>
            <p className="max-w-lg text-lg leading-relaxed text-white/55">
              {t.subtitle}
            </p>
          </div>

          {/* CTAs */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <a
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-12 items-center justify-center gap-2 rounded-xl px-7 text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02]"
              style={{
                background: "#25D366",
                boxShadow: "0 8px 24px rgba(37,211,102,0.4)",
              }}
            >
              <WhatsAppIcon className="size-5 shrink-0" />
              {t.cta1}
            </a>
            <button
              className="flex h-12 items-center justify-center gap-2.5 rounded-xl px-7 text-sm font-semibold text-white/70 transition-colors hover:text-white"
              style={{ border: "1px solid oklch(1 0 0 / 0.14)" }}
            >
              <div
                className="flex size-6 items-center justify-center rounded-full"
                style={{ background: "oklch(1 0 0 / 0.12)" }}
              >
                <Play
                  className={`size-3 fill-white text-white ${lang === "ar" ? "rtl:scale-x-[-1]" : ""}`}
                  aria-hidden
                />
              </div>
              {t.cta2}
            </button>
          </div>

          {/* Trust badges */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
            {t.trust.map((item) => (
              <div key={item} className="flex items-center gap-1.5 text-xs text-white/42">
                <CheckCircle
                  className="size-3.5 shrink-0"
                  style={{ color: "oklch(0.72 0.14 163)" }}
                  aria-hidden
                />
                {item}
              </div>
            ))}
          </div>
        </div>

        {/* Real app screenshot */}
        <div className="hidden lg:block">
          <HeroImage lang={lang} />
        </div>
      </div>
    </section>
  );
}

/* ─── Features ───────────────────────────────────────────────────────── */

function Features({ t }: { t: Content["features"] }) {
  return (
    <section id="features" className="bg-background py-28">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto mb-16 max-w-2xl space-y-4 text-center">
          <div
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold"
            style={{
              background: "oklch(0.519 0.158 163 / 0.1)",
              color: "oklch(0.519 0.158 163.2)",
              border: "1px solid oklch(0.519 0.158 163 / 0.2)",
            }}
          >
            {t.badge}
          </div>
          <h2 className="text-4xl font-bold tracking-tight text-foreground">
            {t.title}
          </h2>
          <p className="text-lg leading-relaxed text-muted-foreground">{t.subtitle}</p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {t.items.map(({ title, desc }, i) => {
            const Icon = FEATURE_ICONS[i] ?? Users;
            return (
              <div
                key={i}
                className="group relative overflow-hidden rounded-2xl p-6 transition-all duration-300 hover:-translate-y-0.5"
                style={{
                  background: "oklch(1 0 0)",
                  border: "1px solid oklch(0.905 0.002 248)",
                  boxShadow: "0 1px 3px oklch(0 0 0 / 0.06)",
                }}
              >
                <div
                  className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                  style={{
                    background:
                      "radial-gradient(360px at 50% -20%, oklch(0.519 0.158 163 / 0.05), transparent 60%)",
                  }}
                />
                <div
                  className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                  style={{
                    boxShadow:
                      "inset 0 0 0 1px oklch(0.519 0.158 163 / 0.2), 0 8px 32px oklch(0 0 0 / 0.08)",
                  }}
                />
                <div
                  className="relative mb-4 flex size-11 items-center justify-center rounded-xl"
                  style={{ background: "oklch(0.519 0.158 163 / 0.1)" }}
                >
                  <Icon
                    className="relative size-5"
                    style={{ color: "oklch(0.519 0.158 163.2)" }}
                    aria-hidden
                  />
                </div>
                <h3 className="relative mb-2 font-semibold text-foreground">{title}</h3>
                <p className="relative text-sm leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─── Founder Section ────────────────────────────────────────────────── */

function FounderSection({ t }: { t: Content["founder"] }) {
  return (
    <section className="bg-background py-12 pb-28">
      <div className="mx-auto max-w-5xl px-6 lg:px-8">
        <div
          className="relative overflow-hidden rounded-3xl p-8 sm:p-12"
          style={{
            background:
              "linear-gradient(145deg, oklch(0.10 0.02 250) 0%, oklch(0.14 0.04 200) 45%, oklch(0.17 0.07 163) 100%)",
            border: "1px solid oklch(1 0 0 / 0.1)",
          }}
        >
          {/* Background orbs */}
          <div
            className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full blur-[80px]"
            style={{ background: "radial-gradient(circle, oklch(0.519 0.158 163 / 0.25), transparent 70%)" }}
          />
          <div
            className="pointer-events-none absolute -bottom-20 -left-16 size-56 rounded-full blur-[70px]"
            style={{ background: "radial-gradient(circle, oklch(0.835 0.118 85 / 0.18), transparent 70%)" }}
          />
          {/* Dot grid */}
          <div
            className="pointer-events-none absolute inset-0 rounded-3xl opacity-[0.04]"
            style={{
              backgroundImage: "radial-gradient(circle at 1.5px 1.5px, white 1.5px, transparent 0)",
              backgroundSize: "24px 24px",
            }}
          />

          <div className="relative grid gap-10 lg:grid-cols-2 lg:items-center">
            {/* Left: icons + badge + title */}
            <div className="space-y-6">
              {/* Dual icon */}
              <div className="flex items-center gap-3">
                <div
                  className="flex size-14 items-center justify-center rounded-2xl"
                  style={{
                    background: "oklch(0.519 0.158 163.2 / 0.2)",
                    border: "1px solid oklch(0.519 0.158 163.2 / 0.3)",
                  }}
                >
                  <Code2
                    className="size-7"
                    style={{ color: "oklch(0.72 0.14 163)" }}
                    aria-hidden
                  />
                </div>
                <div
                  className="flex size-14 items-center justify-center rounded-2xl"
                  style={{
                    background: "oklch(0.835 0.118 85 / 0.15)",
                    border: "1px solid oklch(0.835 0.118 85 / 0.3)",
                  }}
                >
                  <GraduationCap
                    className="size-7"
                    style={{ color: "oklch(0.835 0.118 85)" }}
                    aria-hidden
                  />
                </div>
                <div
                  className="ms-2 rounded-full px-3 py-1 text-xs font-semibold"
                  style={{
                    background: "oklch(1 0 0 / 0.08)",
                    color: "oklch(1 0 0 / 0.55)",
                    border: "1px solid oklch(1 0 0 / 0.12)",
                  }}
                >
                  {t.badge}
                </div>
              </div>

              <h2 className="text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
                {t.title}
              </h2>

              {/* Role badge */}
              <div className="flex items-center gap-2.5">
                <div
                  className="flex size-9 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ background: "oklch(0.519 0.158 163.2)" }}
                >
                  <GraduationCap className="size-4" aria-hidden />
                </div>
                <span className="text-sm font-medium text-white/60">{t.role}</span>
              </div>
            </div>

            {/* Right: quote + points */}
            <div className="space-y-7">
              {/* Quote */}
              <div
                className="relative rounded-2xl p-6"
                style={{
                  background: "oklch(1 0 0 / 0.06)",
                  border: "1px solid oklch(1 0 0 / 0.1)",
                }}
              >
                {/* Opening quote mark */}
                <div
                  className="absolute -top-3 start-5 text-5xl font-serif leading-none"
                  style={{ color: "oklch(0.519 0.158 163.2 / 0.5)" }}
                  aria-hidden
                >
                  &ldquo;
                </div>
                <p className="pt-2 text-base leading-relaxed text-white/80">
                  {t.quote}
                </p>
              </div>

              {/* Points */}
              <ul className="space-y-3">
                {t.points.map((point) => (
                  <li key={point} className="flex items-start gap-3 text-sm text-white/65">
                    <span
                      className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full"
                      style={{
                        background: "oklch(0.519 0.158 163.2 / 0.2)",
                        border: "1px solid oklch(0.519 0.158 163.2 / 0.35)",
                      }}
                    >
                      <Check
                        className="size-3"
                        style={{ color: "oklch(0.72 0.14 163)" }}
                        aria-hidden
                      />
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Stats ──────────────────────────────────────────────────────────── */

function Stats({ stats }: { stats: Content["stats"] }) {
  return (
    <section
      className="relative overflow-hidden py-24"
      style={{
        background:
          "linear-gradient(155deg, oklch(0.10 0.018 250) 0%, oklch(0.14 0.04 200) 50%, oklch(0.17 0.068 163) 100%)",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 50%, oklch(0.519 0.158 163 / 0.18), transparent 65%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: "radial-gradient(circle at 1.5px 1.5px, white 1.5px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />
      <div className="relative mx-auto max-w-5xl px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-12 sm:grid-cols-4">
          {stats.map(({ value, label }) => (
            <div key={label} className="text-center">
              <div
                className="text-4xl font-bold tracking-tight lg:text-5xl"
                style={{
                  backgroundImage:
                    "linear-gradient(135deg, oklch(0.88 0.06 163) 0%, oklch(0.835 0.118 85) 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {value}
              </div>
              <div className="mt-2 text-sm font-medium text-white/45">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── How It Works ───────────────────────────────────────────────────── */

function HowItWorks({ t }: { t: Content["howItWorks"] }) {
  return (
    <section id="how-it-works" className="bg-background py-28">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto mb-16 max-w-2xl space-y-4 text-center">
          <div
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold"
            style={{
              background: "oklch(0.835 0.118 85 / 0.12)",
              color: "oklch(0.55 0.1 85)",
              border: "1px solid oklch(0.835 0.118 85 / 0.25)",
            }}
          >
            {t.badge}
          </div>
          <h2 className="text-4xl font-bold tracking-tight text-foreground">{t.title}</h2>
          <p className="text-lg leading-relaxed text-muted-foreground">{t.subtitle}</p>
        </div>

        <div className="relative grid gap-10 lg:grid-cols-3">
          {/* Connector line */}
          <div
            className="pointer-events-none absolute top-8 hidden lg:block"
            style={{
              insetInlineStart: "calc(100% / 6 + 2rem)",
              insetInlineEnd: "calc(100% / 6 + 2rem)",
              height: "1px",
              background:
                "linear-gradient(90deg, transparent, oklch(0.519 0.158 163 / 0.3) 20%, oklch(0.519 0.158 163 / 0.3) 80%, transparent)",
            }}
          />
          {t.steps.map(({ n, title, desc }) => (
            <div key={n} className="relative flex flex-col items-center gap-5 text-center">
              <div
                className="relative z-10 flex size-16 items-center justify-center rounded-2xl text-xl font-bold text-white"
                style={{
                  background:
                    "linear-gradient(135deg, oklch(0.519 0.158 163.2), oklch(0.46 0.14 190))",
                  boxShadow: "0 8px 24px oklch(0.519 0.158 163 / 0.32)",
                }}
              >
                {n}
              </div>
              <h3 className="text-lg font-semibold text-foreground">{title}</h3>
              <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Testimonials ───────────────────────────────────────────────────── */

function Testimonials({ t }: { t: Content["testimonials"] }) {
  return (
    <section
      id="testimonials"
      className="py-28"
      style={{ background: "oklch(0.96 0.003 248)" }}
    >
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto mb-14 max-w-xl space-y-3 text-center">
          <h2 className="text-4xl font-bold tracking-tight text-foreground">{t.title}</h2>
          <p className="text-muted-foreground">{t.subtitle}</p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          {t.items.map(({ quote, author, role, rating }) => (
            <div
              key={author}
              className="flex flex-col gap-6 rounded-2xl p-8"
              style={{
                background: "oklch(1 0 0)",
                border: "1px solid oklch(0.905 0.002 248)",
                boxShadow: "0 1px 3px oklch(0 0 0 / 0.05)",
              }}
            >
              <div className="flex gap-0.5">
                {Array.from({ length: rating }).map((_, i) => (
                  <Star
                    key={i}
                    className="size-4 fill-current"
                    style={{ color: "oklch(0.835 0.118 85)" }}
                    aria-hidden
                  />
                ))}
              </div>
              <blockquote className="flex-1 text-[0.9375rem] leading-relaxed text-foreground">
                &ldquo;{quote}&rdquo;
              </blockquote>
              <div className="flex items-center gap-3">
                <div
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ background: "oklch(0.519 0.158 163.2)" }}
                >
                  {[...author].find((c) => /\p{L}/u.test(c)) ?? "?"}
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">{author}</div>
                  <div className="text-xs text-muted-foreground">{role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── CTA ────────────────────────────────────────────────────────────── */

function CTA({ t }: { t: Content["cta"] }) {
  return (
    <section
      className="relative overflow-hidden py-32"
      style={{
        background:
          "linear-gradient(155deg, oklch(0.09 0.018 250) 0%, oklch(0.13 0.035 200) 50%, oklch(0.17 0.07 163) 100%)",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 60% 50%, oklch(0.519 0.158 163 / 0.2), transparent 60%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: "radial-gradient(circle at 1.5px 1.5px, white 1.5px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />

      <div className="relative mx-auto max-w-3xl px-6 text-center lg:px-8">
        <div className="space-y-8">
          <div className="space-y-5">
            <h2 className="text-4xl font-bold leading-tight tracking-tight text-white lg:text-5xl">
              {t.title1}{" "}
              <span
                style={{
                  backgroundImage:
                    "linear-gradient(135deg, oklch(0.76 0.15 163) 0%, oklch(0.835 0.118 85) 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {t.title2}
              </span>
            </h2>
            <p className="mx-auto max-w-md text-lg text-white/52">{t.subtitle}</p>
          </div>

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <a
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-12 items-center gap-2 rounded-xl px-8 text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02]"
              style={{
                background: "#25D366",
                boxShadow: "0 8px 28px rgba(37,211,102,0.45)",
              }}
            >
              <WhatsAppIcon className="size-5 shrink-0" />
              {t.btn1}
            </a>
            <Link
              href="/login"
              className="flex h-12 items-center gap-2 rounded-xl px-8 text-sm font-semibold text-white/65 transition-colors hover:text-white"
              style={{ border: "1px solid oklch(1 0 0 / 0.14)" }}
            >
              {t.btn2}
            </Link>
          </div>

          <div className="flex flex-wrap justify-center gap-2.5">
            {t.pills.map((item) => (
              <div
                key={item}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white/55"
                style={{
                  background: "oklch(1 0 0 / 0.07)",
                  border: "1px solid oklch(1 0 0 / 0.1)",
                }}
              >
                <Check
                  className="size-3 shrink-0"
                  style={{ color: "oklch(0.72 0.14 163)" }}
                  aria-hidden
                />
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer ─────────────────────────────────────────────────────────── */

function Footer({ t, lang }: { t: Content["footer"]; lang: Lang }) {
  return (
    <footer
      className="py-10"
      style={{
        background: "oklch(0.07 0.014 250)",
        borderTop: "1px solid oklch(1 0 0 / 0.07)",
      }}
    >
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Acadmyq"
              className="size-8 shrink-0 object-contain"
            />
            <span className="text-sm font-bold text-white">Acadmyq</span>
          </div>

          <p className="order-last text-xs text-white/28 sm:order-none">
            © 2025 Acadmyq. {t.rights}
          </p>

          <div className="flex gap-6">
            {t.links.map((item) => (
              <a
                key={item}
                href="#"
                className="text-xs text-white/32 transition-colors hover:text-white/60"
              >
                {item}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────── */

export default function LandingPage() {
  const [lang, setLang] = useState<Lang>("ar");
  const dir = lang === "ar" ? "rtl" : "ltr";
  // Cast to shared Content type — both locales share the same structure
  const t = CONTENT[lang] as Content;

  return (
    <div dir={dir} lang={lang} className="min-h-screen">
      <Navbar lang={lang} setLang={setLang} t={t.nav} />
      <main>
        <Hero t={t.hero} lang={lang} />
        <Features t={t.features} />
        <FounderSection t={t.founder} />
        <Stats stats={t.stats} />
        <HowItWorks t={t.howItWorks} />
        <Testimonials t={t.testimonials} />
        <CTA t={t.cta} />
      </main>
      <Footer t={t.footer} lang={lang} />
      <WhatsAppFloat />
    </div>
  );
}
