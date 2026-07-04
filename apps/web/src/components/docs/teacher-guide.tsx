"use client";

import {
  CalendarDays,
  ClipboardCheck,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogIn,
  Menu,
  Monitor,
  Moon,
  PanelsTopLeft,
  Presentation,
  Printer,
  ShieldAlert,
  Sun,
  Users,
  Video,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

/* ─── section registry (drives the sidebar + scrollspy) ───────────────── */

const SECTIONS = [
  { id: "login", n: 1, label: "تسجيل الدخول", icon: LogIn },
  { id: "tour", n: 2, label: "الواجهة والقائمة", icon: PanelsTopLeft },
  { id: "dashboard", n: 3, label: "لوحة التحكم", icon: LayoutDashboard },
  { id: "students", n: 4, label: "الطلاب", icon: Users },
  { id: "calendar", n: 5, label: "الجدول", icon: CalendarDays },
  { id: "attendance", n: 6, label: "الحضور والتقارير", icon: ClipboardCheck },
  { id: "reports", n: 7, label: "التقارير الشهرية", icon: FileText },
  { id: "video", n: 8, label: "فصل الفيديو", icon: Video },
  { id: "incall", n: 9, label: "داخل الحصة", icon: Presentation },
  { id: "payroll", n: 10, label: "رواتبي", icon: Wallet },
  { id: "desktop", n: 11, label: "تطبيق سطح المكتب", icon: Monitor },
  { id: "rules", n: 12, label: "أمور مهمة", icon: ShieldAlert },
] as const;

/* ─── small building blocks ───────────────────────────────────────────── */

function Chip({
  children,
  tone = "primary",
}: {
  children: ReactNode;
  tone?: "primary" | "ghost" | "gold";
}) {
  const tones = {
    primary: "bg-primary text-primary-foreground",
    gold: "bg-gold text-gold-foreground",
    ghost: "bg-muted text-foreground border border-border",
  } as const;
  return (
    <span
      className={`mx-0.5 inline-block whitespace-nowrap rounded-md px-2 py-px text-[0.9em] font-bold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function Note({
  tone = "info",
  icon,
  children,
}: {
  tone?: "info" | "tip" | "warn";
  icon: string;
  children: ReactNode;
}) {
  const tones = {
    info: "bg-primary/10 border-primary/25",
    tip: "bg-gold/12 border-gold/35",
    warn: "bg-destructive/10 border-destructive/30",
  } as const;
  return (
    <div
      className={`mt-4 grid grid-cols-[auto_1fr] items-start gap-3 rounded-xl border p-4 text-[0.95rem] leading-relaxed ${tones[tone]}`}
    >
      <span className="text-xl leading-6" aria-hidden>
        {icon}
      </span>
      <div className="[&_b]:font-extrabold">{children}</div>
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-7">
      {children}
    </div>
  );
}

function Mini({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-3 flex items-center gap-2.5 text-[1.05rem] font-extrabold text-foreground">
      <span className="size-2 shrink-0 rounded-full bg-gold" />
      {children}
    </h3>
  );
}

function Section({
  id,
  n,
  title,
  sub,
  children,
}: {
  id: string;
  n: number;
  title: string;
  sub: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} data-doc className="mt-14 first:mt-0">
      <div className="mb-2 flex items-center gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-lg font-extrabold text-primary-foreground shadow-sm tabular-nums">
          {n}
        </span>
        <h2 className="text-balance text-2xl font-extrabold tracking-tight sm:text-[1.7rem]">
          {title}
        </h2>
      </div>
      <p className="mb-5 pr-[60px] text-[1.02rem] text-muted-foreground">{sub}</p>
      {children}
    </section>
  );
}

/* ─── main component ──────────────────────────────────────────────────── */

export function TeacherGuide() {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const [dark, setDark] = useState(false);
  const mounted = useRef(false);

  // theme: read stored / OS preference on mount, reflect on <html>
  useEffect(() => {
    const stored = localStorage.getItem("academiq-guide-theme");
    const prefersDark =
      window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    const isDark = stored ? stored === "dark" : prefersDark;
    setDark(isDark);
    mounted.current = true;
  }, []);

  useEffect(() => {
    if (!mounted.current) return;
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("academiq-guide-theme", dark ? "dark" : "light");
  }, [dark]);

  // scrollspy: highlight the section currently near the top
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-88px 0px -65% 0px", threshold: 0 },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div dir="rtl" className="tg min-h-screen bg-background font-sans text-foreground">
      {/* page-scoped styles for the bits Tailwind utilities don't cover cleanly */}
      <style>{`
        html { scroll-behavior: smooth; }
        @media (prefers-reduced-motion: reduce){ html { scroll-behavior: auto; } }
        .tg section[data-doc]{ scroll-margin-top: 92px; }
        .tg-steps{ list-style:none; margin:0; padding:0; counter-reset: st; }
        .tg-steps > li{ counter-increment: st; position:relative; padding:0 46px 20px 0; }
        .tg-steps > li:last-child{ padding-bottom:0; }
        .tg-steps > li::before{
          content: counter(st); position:absolute; right:0; top:-2px;
          width:31px; height:31px; border-radius:9999px; display:grid; place-items:center;
          font-weight:800; font-size:14px; font-variant-numeric: tabular-nums;
          background: color-mix(in oklab, var(--primary) 16%, transparent); color: var(--primary);
        }
        .tg-steps > li::after{
          content:""; position:absolute; right:15px; top:33px; bottom:6px; width:2px; background: var(--border);
        }
        .tg-steps > li:last-child::after{ display:none; }
        .tg-plain{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:7px; }
        .tg-plain > li{ position:relative; padding-right:20px; color: var(--muted-foreground); }
        .tg-plain > li::before{
          content:""; position:absolute; right:4px; top:13px; width:6px; height:6px; border-radius:9999px; background: var(--primary);
        }
        .tg-plain > li strong{ color: var(--foreground); font-weight:700; }
        @media print {
          .tg-noprint{ display:none !important; }
          .tg-grid{ display:block !important; }
          .tg section[data-doc]{ break-inside: avoid; }
        }
      `}</style>

      {/* ── header ── */}
      <header className="tg-noprint sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 lg:px-8">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Academiq" width={30} height={30} className="rounded-md" />
            <div className="leading-tight">
              <div className="text-sm font-extrabold">دليل المعلّم</div>
              <div className="text-[11px] text-muted-foreground">Academiq</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => window.print()}
              className="hidden items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-muted sm:inline-flex"
            >
              <Printer className="size-4" />
              طباعة / PDF
            </button>
            <button
              type="button"
              aria-label="تبديل الوضع الداكن"
              onClick={() => setDark((d) => !d)}
              className="grid size-9 place-items-center rounded-lg border border-border text-foreground transition hover:bg-muted"
            >
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-bold text-primary-foreground transition hover:opacity-90"
            >
              <LogIn className="size-4" />
              تسجيل الدخول
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-10 lg:grid-cols-[264px_1fr] lg:px-8 lg:py-14 tg-grid">
        {/* ── sidebar (desktop) ── */}
        <aside className="tg-noprint hidden lg:block">
          <nav className="sticky top-24">
            <div className="mb-3 px-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              محتويات الدليل
            </div>
            <ul className="flex flex-col gap-0.5">
              {SECTIONS.map((s) => {
                const Icon = s.icon;
                const on = active === s.id;
                return (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-[0.95rem] transition ${
                        on
                          ? "bg-primary/10 font-bold text-primary"
                          : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <Icon
                        className={`size-4 shrink-0 ${on ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`}
                      />
                      <span className="truncate">{s.label}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        {/* ── content ── */}
        <main className="min-w-0">
          {/* hero */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-primary/80 p-7 text-primary-foreground sm:p-10">
            <div
              className="pointer-events-none absolute inset-0 opacity-40"
              style={{
                backgroundImage:
                  "radial-gradient(rgba(255,255,255,.14) 1px, transparent 1px)",
                backgroundSize: "22px 22px",
              }}
            />
            <div className="relative">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/15 px-3.5 py-1.5 text-[13px] font-bold">
                <GraduationCap className="size-4" />
                دليل استخدام حساب المعلّم
              </span>
              <h1 className="mt-5 text-balance text-3xl font-extrabold leading-tight sm:text-[2.6rem]">
                دليلك الكامل لاستخدام حسابك خطوة بخطوة
              </h1>
              <p className="mt-3 max-w-2xl text-[1.05rem] text-white/90">
                مكتوب بلغة بسيطة وواضحة. سنبدأ من تسجيل الدخول، ثم نشرح كل صفحة ستجدها
                في حسابك وكيفية استخدامها. لا حاجة لأي خبرة تقنية — فقط اتبع الخطوات
                بالترتيب.
              </p>
            </div>
          </div>

          {/* mobile nav */}
          <details className="tg-noprint mt-6 rounded-xl border border-border bg-card lg:hidden">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-bold">
              <Menu className="size-4 text-primary" />
              محتويات الدليل
            </summary>
            <ul className="grid grid-cols-1 gap-0.5 border-t border-border p-2 sm:grid-cols-2">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    onClick={(e) =>
                      e.currentTarget.closest("details")?.removeAttribute("open")
                    }
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <span className="text-primary tabular-nums">{s.n}.</span>
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </details>

          <div className="mt-10">
            {/* 1 — LOGIN */}
            <Section
              id="login"
              n={1}
              title="تسجيل الدخول إلى حسابك"
              sub="حسابك يُنشئه لك مدير الأكاديمية ويرسل لك بريدك الإلكتروني وكلمة المرور. لا يوجد تسجيل ذاتي — أنت فقط تستخدم البيانات التي وصلتك."
            >
              <Card>
                <ol className="tg-steps text-[1.02rem]">
                  <li>
                    افتح المتصفح (Google Chrome أو أي متصفح) واذهب إلى رابط الأكاديمية
                    الذي وصلك، ثم أضف في نهايته <strong>‏/login</strong>.
                  </li>
                  <li>
                    اكتب <strong>بريدك الإلكتروني</strong> في الخانة الأولى.
                  </li>
                  <li>
                    اكتب <strong>كلمة المرور</strong> في الخانة الثانية. يمكنك الضغط على
                    أيقونة <strong>العين 👁</strong> لإظهار كلمة المرور والتأكد من كتابتها
                    بشكل صحيح.
                  </li>
                  <li>
                    اضغط زر <Chip>تسجيل الدخول</Chip>.
                  </li>
                  <li>
                    بعد نجاح الدخول ستنتقل مباشرةً إلى <strong>لوحة التحكم</strong>، وهي
                    صفحتك الرئيسية.
                  </li>
                </ol>
                <Note tone="warn" icon="⚠️">
                  <b>إذا ظهرت رسالة «بيانات الدخول غير صحيحة»:</b> تأكد من البريد وكلمة
                  المرور (بدون مسافات إضافية). إذا استمرّت المشكلة، تواصل مع مدير
                  الأكاديمية — فلا توجد خاصية «نسيت كلمة المرور» في هذه الصفحة، والمدير هو
                  من يعيد ضبط كلمة مرورك.
                </Note>
                <Note tone="tip" icon="🌐">
                  <b>اللغة:</b> في أعلى الصفحة يوجد زر لتبديل اللغة بين العربية
                  والإنجليزية. اختر ما يناسبك، وسيتذكّر النظام اختيارك.
                </Note>
              </Card>
            </Section>

            {/* 2 — TOUR */}
            <Section
              id="tour"
              n={2}
              title="جولة في الواجهة والقائمة الجانبية"
              sub="بعد الدخول ستجد قائمة جانبية على جهة الشاشة فيها كل الصفحات المتاحة لك. الضغط على أي عنصر ينقلك إلى تلك الصفحة."
            >
              <Card>
                <Mini>ما الذي ستجده في القائمة</Mini>
                <ul className="tg-plain">
                  <li><strong>لوحة التحكم</strong> — ملخّص سريع ليومك وأسبوعك.</li>
                  <li><strong>الطلاب</strong> — قائمة الطلاب المُسندين إليك.</li>
                  <li><strong>الجدول</strong> — مواعيد حصصك خلال الأسبوع.</li>
                  <li><strong>فصل الفيديو</strong> — الحصص المرئية والتسجيلات.</li>
                  <li><strong>الحضور</strong> — تسجيل نتيجة كل حصة وكتابة تقريرها.</li>
                  <li><strong>تقارير الطلاب</strong> — كتابة تقرير شهري عن تقدّم الطالب.</li>
                  <li><strong>رواتبي</strong> — كشوف رواتبك وتفاصيل أرباحك.</li>
                </ul>
                <div className="my-5 border-t border-border" />
                <Mini>في أسفل القائمة الجانبية</Mini>
                <p className="text-muted-foreground">
                  ستجد <strong className="text-foreground">اسمك</strong> ووصف حسابك
                  «معلم»، وبجانبه زر <strong className="text-foreground">تسجيل الخروج</strong>{" "}
                  (أيقونة الخروج). اضغطه عند إنهاء استخدام حسابك، خاصةً على جهاز مشترك.
                </p>
                <Note tone="info" icon="💡">
                  <b>ملاحظة:</b> قد تختلف الصفحات الظاهرة لك قليلًا حسب باقة الأكاديمية.
                  إذا رأيت بجانب أحد العناصر شارة <b>«ترقية»</b>، فهذا يعني أن هذه الميزة
                  غير مُفعّلة في باقتكم الحالية.
                </Note>
              </Card>
            </Section>

            {/* 3 — DASHBOARD */}
            <Section
              id="dashboard"
              n={3}
              title="لوحة التحكم (الصفحة الرئيسية)"
              sub="أول صفحة تراها بعد الدخول. الهدف منها أن تعرف وضعك بلمحة سريعة."
            >
              <Card>
                <Mini>ماذا ستجد فيها</Mini>
                <ul className="tg-plain">
                  <li>تحية ترحيبية حسب وقت اليوم (صباح/مساء الخير) مع تاريخ اليوم.</li>
                  <li><strong>عدد طلابك</strong> — الضغط عليها ينقلك إلى صفحة الطلاب.</li>
                  <li><strong>حصص هذا الأسبوع</strong> — عدد حصصك المجدولة هذا الأسبوع.</li>
                  <li><strong>ساعات هذا الشهر</strong> — عدد الساعات التي قمت بتدريسها فعليًا.</li>
                  <li><strong>أرباح هذا الشهر</strong> — إجمالي راتبك المستحق حتى الآن، وينقلك إلى صفحة رواتبي.</li>
                  <li>رسم بياني بسيط يوضّح حصصك على مدار الأسبوع.</li>
                </ul>
                <Note tone="tip" icon="🔄">
                  <b>زر التحديث:</b> إذا أردت أحدث الأرقام، اضغط زر التحديث في أعلى الصفحة.
                </Note>
              </Card>
            </Section>

            {/* 4 — STUDENTS */}
            <Section
              id="students"
              n={4}
              title="الطلاب"
              sub="هنا تجد قائمة الطلاب المُسندين إليك فقط (لن ترى طلاب المعلمين الآخرين)."
            >
              <Card>
                <Mini>ماذا يمكنك أن تفعل</Mini>
                <ul className="tg-plain">
                  <li>تصفّح أسماء طلابك.</li>
                  <li>
                    الضغط على اسم أي طالب لفتح <strong>ملفه</strong> والاطّلاع على بياناته،
                    وجدوله، وسجلّ تقاريره السابقة.
                  </li>
                </ul>
                <Note tone="info" icon="👁️">
                  <b>هذه الصفحة للاطّلاع فقط:</b> يمكنك مشاهدة بيانات طلابك، لكن إضافة
                  طالب جديد أو تعديل بياناته أو تسجيله في المواد مهام يقوم بها مدير
                  الأكاديمية.
                </Note>
              </Card>
            </Section>

            {/* 5 — CALENDAR */}
            <Section
              id="calendar"
              n={5}
              title="الجدول (مواعيد حصصك)"
              sub="يعرض حصصك خلال الأسبوع بشكل تقويم. تظهر لك حصصك أنت فقط."
            >
              <Card>
                <Mini>عند الضغط على أي حصة، يمكنك:</Mini>
                <ul className="tg-plain">
                  <li>رؤية تفاصيل الحصة: اليوم، الوقت، المدة، اسم الطالب، وحالتها.</li>
                  <li>الانتقال مباشرةً إلى <strong>الحضور والتقرير</strong> لتسجيل نتيجة الحصة.</li>
                  <li><strong>إعادة الجدولة</strong> — نقل هذه الحصة وحدها إلى وقت آخر.</li>
                  <li><strong>طلب إلغاء</strong> الحصة (مشروح أدناه).</li>
                </ul>
                <div className="my-5 border-t border-border" />
                <Mini>كيف تعيد جدولة حصة</Mini>
                <ol className="tg-steps text-[1.02rem]">
                  <li>
                    اضغط على الحصة، ثم اختر <Chip tone="ghost">إعادة جدولة</Chip>.
                  </li>
                  <li>
                    حدّد <strong>الوقت الجديد</strong> (اليوم والساعة)، ويمكنك كتابة سبب إن أردت.
                  </li>
                  <li>احفظ — سيتم نقل هذه الحصة فقط إلى الموعد الجديد.</li>
                </ol>
                <Note tone="warn" icon="🔒">
                  <b>مهم جدًا — إلغاء الحصص:</b> كمعلّم لا تستطيع إلغاء الحصة مباشرةً، بل{" "}
                  <b>ترسل «طلب إلغاء»</b>. عند الضغط على «طلب إلغاء» واختيار السبب
                  (من طرف المعلّم أو الطالب) وإرساله، تبقى الحصة مجدولة حتى{" "}
                  <b>يوافق مدير الأكاديمية</b> على الطلب. ستظهر رسالة: «تم إرسال الطلب —
                  بانتظار موافقة المالك».
                </Note>
              </Card>
            </Section>

            {/* 6 — ATTENDANCE */}
            <Section
              id="attendance"
              n={6}
              title="الحضور وكتابة تقرير الحصة"
              sub="من أهم صفحاتك اليومية: بعد كل حصة تسجّل نتيجتها وتكتب تقريرًا عنها. لاحظ الشارة الحمراء بجانب «الحضور» في القائمة — تُظهر عدد حصص اليوم التي لم تُسجَّل بعد."
            >
              <Card>
                <Mini>شكل الصفحة</Mini>
                <ul className="tg-plain">
                  <li>أعلى الصفحة أدوات للتنقّل بين الأيام، وزر <strong>اليوم</strong> للعودة إلى تاريخ اليوم.</li>
                  <li>بطاقات إحصائية: حصص هذا اليوم / حضَر / قيد الانتظار / تجريبي.</li>
                  <li>خانة بحث بالاسم، وفلاتر لعرض الحصص حسب حالتها.</li>
                  <li>
                    جدول بالحصص، وأمام كل حصة زر <Chip>تسجيل</Chip> (إن لم تُسجَّل بعد) أو{" "}
                    <Chip tone="ghost">فتح</Chip> (إن كانت مسجّلة).
                  </li>
                </ul>
                <div className="my-5 border-t border-border" />
                <Mini>كيف تسجّل حصة وتكتب تقريرها</Mini>
                <ol className="tg-steps text-[1.02rem]">
                  <li>
                    اضغط <Chip>تسجيل</Chip> أمام الحصة لفتح نموذج التسجيل.
                  </li>
                  <li>
                    اختر <strong>النتيجة</strong>: <strong>حضَر</strong>، أو{" "}
                    <strong>مجاني</strong>، أو <strong>ملغاة (المعلّم)</strong>، أو{" "}
                    <strong>ملغاة (الطالب)</strong>.
                  </li>
                  <li>
                    اكتب <strong>تقرير الحصة</strong>: ما تم شرحه، ملاحظاتك عن الطالب،
                    والواجب المنزلي.
                  </li>
                  <li>
                    اضغط زر <Chip>حفظ</Chip>. عند اكتمال التسجيل تظهر علامة <strong>«مكتمل»</strong>.
                  </li>
                </ol>
                <Note tone="tip" icon="✦">
                  <b>زر «صياغة» السحري:</b> بعد كتابة ملاحظاتك، اضغط زر <b>✦ صياغة</b> ليحوّل
                  النظام كلامك تلقائيًا إلى <b>تقرير احترافي منسّق</b> (يتضمّن اسم الطالب،
                  المعلم، التاريخ، المدة، النتيجة، وملاحظات الحصة). يمكنك اختيار صياغته
                  بالعربية (ع) أو الإنجليزية (EN) — تقرير جميل بضغطة واحدة.
                </Note>
                <Note tone="info" icon="📜">
                  <b>عرض السجل:</b> يمكنك فتح <b>سجلّ الطالب</b> لمراجعة تقارير حصصه
                  السابقة، كما يمكنك <b>تصدير</b> حصص اليوم إلى ملف Excel من زر «تصدير».
                </Note>
                <Note tone="warn" icon="🔒">
                  <b>انتبه لأمرين:</b>
                  <br />
                  • إذا اخترت نتيجة «ملغاة»، فهذا يتحوّل إلى <b>طلب إلغاء</b> ينتظر موافقة
                  المدير، بينما «حضَر» و«مجاني» تُسجَّل فورًا.
                  <br />
                  • <b>إرسال التقرير إلى وليّ الأمر عبر واتساب ليس من مهامك</b> — أنت تكتب
                  التقرير فقط، وإرساله يتولّاه مدير الأكاديمية.
                </Note>
              </Card>
            </Section>

            {/* 7 — REPORTS */}
            <Section
              id="reports"
              n={7}
              title="تقارير الطلاب الشهرية"
              sub="غير تقرير الحصة اليومي، هنا تكتب تقرير تقدّم شهري عن الطالب وترسله للإدارة لمراجعته."
            >
              <Card>
                <Mini>كيف تكتب تقريرًا شهريًا</Mini>
                <ol className="tg-steps text-[1.02rem]">
                  <li>اضغط <strong>تقرير جديد</strong>.</li>
                  <li>اختر <strong>الطالب</strong> من القائمة، ثم حدّد <strong>الشهر</strong>.</li>
                  <li>اكتب <strong>العنوان</strong>، ثم نصّ <strong>التقرير</strong> عن مستوى الطالب وتقدّمه.</li>
                  <li>
                    اضغط <Chip>إرسال للمراجعة</Chip>. تظهر رسالة: «تم إرسال التقرير إلى
                    الإدارة للمراجعة».
                  </li>
                </ol>
                <Note tone="info" icon="🏷️">
                  <b>متابعة حالة تقاريرك:</b> أسفل الصفحة قائمة بتقاريرك السابقة، وبجانب
                  كل تقرير حالته: <b>قيد المراجعة</b>، أو <b>معتمد</b>، أو <b>مرفوض</b> —
                  ومعها اسم المُراجِع وملاحظته بعد المراجعة.
                </Note>
              </Card>
            </Section>

            {/* 8 — VIDEO */}
            <Section
              id="video"
              n={8}
              title="فصل الفيديو (الحصص المرئية)"
              sub="من هنا تدخل إلى الحصص المرئية المباشرة وتشاهد التسجيلات. (تظهر إذا كانت باقة الأكاديمية تدعم الحصص المرئية.)"
            >
              <Card>
                <Mini>ماذا يمكنك أن تفعل</Mini>
                <ul className="tg-plain">
                  <li>تصفّح <strong>الغرف</strong> المتاحة، مع بحث وفلاتر لمعرفة الغرف النشطة الآن.</li>
                  <li>الدخول إلى الحصة بالضغط على <strong>انضمام</strong> (تُفتح في نافذة جديدة).</li>
                  <li>نسخ <strong>رابط الطالب</strong> لإرساله لطلابك حتى ينضمّوا إلى الحصة.</li>
                  <li>فتح <strong>سجلّ</strong> الغرفة لمشاهدة تفاصيلها.</li>
                  <li>من تبويب <strong>التسجيلات</strong>: <Chip tone="ghost">تشغيل</Chip> أو <Chip tone="ghost">تنزيل</Chip> تسجيلات الحصص المكتملة.</li>
                </ul>
                <Note tone="info" icon="💡">
                  <b>ملاحظة:</b> إنشاء الغرف وإدارتها وحذف التسجيلات مهام خاصة بالإدارة.
                  دورك هو <b>الدخول</b> إلى الحصة ومشاركة الرابط مع طلابك ومشاهدة التسجيلات.
                </Note>
              </Card>
            </Section>

            {/* 9 — IN-CALL */}
            <Section
              id="incall"
              n={9}
              title="داخل الحصة المرئية"
              sub="عندما تنضمّ إلى الحصة تدخل كـ«مضيف» (المعلّم)، ويدخل الطلاب كضيوف عبر الرابط الذي أرسلته لهم."
            >
              <Card>
                <Mini>الخطوات</Mini>
                <ol className="tg-steps text-[1.02rem]">
                  <li>
                    عند الدخول تظهر <strong>غرفة تجهيز (اللوبي)</strong>: تحقّق من الكاميرا
                    والميكروفون، واختر الجهاز الصحيح إن لزم.
                  </li>
                  <li>ادخل إلى الحصة المباشرة.</li>
                </ol>
                <div className="my-5 border-t border-border" />
                <Mini>ما تستطيع فعله أثناء الحصة</Mini>
                <ul className="tg-plain">
                  <li><strong>تشغيل/إيقاف</strong> الميكروفون والكاميرا من الشريط السفلي.</li>
                  <li><strong>مشاركة الشاشة</strong> لعرض الدرس.</li>
                  <li><strong>السبورة</strong> للكتابة والشرح (وتدعم ملفات PDF).</li>
                  <li><strong>المحادثة (الشات)</strong> للتواصل الكتابي مع الطلاب.</li>
                  <li><strong>قائمة المشاركين</strong>، و<strong>تسجيل الحصة</strong>.</li>
                  <li><strong>قبول الطلاب المنتظرين</strong>: عندما يطرق طالب الباب للدخول، يظهر لك تنبيه لتسمح له بالدخول.</li>
                </ul>
              </Card>
            </Section>

            {/* 10 — PAYROLL */}
            <Section
              id="payroll"
              n={10}
              title="رواتبي"
              sub="هنا ترى كشوف رواتبك أنت فقط، مقسّمة حسب الفترة. (تظهر إذا كانت الباقة تدعم الرواتب.)"
            >
              <Card>
                <Mini>ماذا يمكنك أن تفعل</Mini>
                <ul className="tg-plain">
                  <li>اختيار <strong>السنة</strong> و<strong>الشهر</strong> لعرض كشف الفترة.</li>
                  <li>رؤية حالة الكشف: <strong>مفتوح</strong> (ما زال يُحتسب) أو <strong>معتمد</strong>، مع الإجمالي.</li>
                  <li>الضغط على أي كشف لعرض <strong>تفاصيله</strong>: كل حصة بتاريخها واسم الطالب والمبلغ.</li>
                  <li>الضغط على <strong>عرض التقرير</strong> لمشاهدة تقرير كل حصة.</li>
                  <li><strong>تصدير</strong> الكشف إلى ملف Excel.</li>
                </ul>
                <Note tone="tip" icon="💰">
                  <b>كيف تُحتسب أرباحك:</b> يُحسب راتبك حسب الحصص التي قمت بتدريسها فعليًا،
                  ولا تُحتسب الحصص التجريبية المجانية.
                </Note>
              </Card>
            </Section>

            {/* 11 — DESKTOP */}
            <Section
              id="desktop"
              n={11}
              title="تطبيق سطح المكتب (اختياري)"
              sub="تطبيق خاص بالمعلّمين لأجهزة الكمبيوتر (ويندوز). ليس ضروريًا — كل شيء يعمل من المتصفح — لكنه يضيف ميزات مفيدة أثناء الشرح."
            >
              <Card>
                <ul className="tg-plain">
                  <li><strong>الرسم على الشاشة أثناء المشاركة</strong>: ترسم وتؤشّر فوق ما تعرضه، فيراه الطلاب مباشرةً داخل الشاشة المشتركة (زر «✏️ Annotate»).</li>
                  <li><strong>وضع العرض</strong>: يصغّر نافذة الحصة إلى لوحة صغيرة عائمة لا يراها الطلاب، حتى تستخدم جهازك بحرية أثناء المشاركة.</li>
                </ul>
                <Note tone="info" icon="🖥️">
                  <b>ملاحظة:</b> إن لم يكن لديك هذا التطبيق فلا تقلق — يمكنك إعطاء حصصك
                  كاملةً من المتصفح كالمعتاد. هذا التطبيق مجرد إضافة اختيارية.
                </Note>
              </Card>
            </Section>

            {/* 12 — RULES */}
            <Section
              id="rules"
              n={12}
              title="أمور مهمة يجب معرفتها"
              sub="هذه الأمور تجنّبك الحيرة لاحقًا. صلاحياتك مصمّمة لتركّز على التدريس، وبعض المهام الإدارية يتولّاها المدير."
            >
              <Card>
                <ul className="flex flex-col gap-2.5">
                  {[
                    <>
                      <strong className="text-foreground">لا تُلغي الحصص مباشرةً</strong> —
                      ترسل «طلب إلغاء» ويوافق عليه المدير.
                    </>,
                    <>
                      <strong className="text-foreground">لا ترسل التقارير عبر واتساب</strong> —
                      أنت تكتب التقرير، والإرسال لوليّ الأمر يتولّاه المدير.
                    </>,
                    <>
                      <strong className="text-foreground">لا توجد صفحة إشعارات</strong> في حسابك.
                    </>,
                    <>
                      <strong className="text-foreground">لا ترى المعلمين الآخرين</strong> ولا
                      الفواتير ولا الإعدادات ولا لوحات الإدارة.
                    </>,
                    <>
                      <strong className="text-foreground">بيانات الطلاب للاطّلاع فقط</strong>،
                      وتقتصر على طلابك المُسندين إليك.
                    </>,
                  ].map((item, i) => (
                    <li key={i} className="grid grid-cols-[auto_1fr] items-start gap-3 text-[0.98rem] text-muted-foreground">
                      <span className="mt-0.5 font-extrabold text-destructive">✕</span>
                      <div>{item}</div>
                    </li>
                  ))}
                </ul>
                <Note tone="tip" icon="📞">
                  <b>عند أي إشكال:</b> إعادة ضبط كلمة المرور، إسناد طالب جديد، تفعيل ميزة
                  عليها شارة «ترقية»، أو أي طلب إداري — تواصل مع <b>مدير الأكاديمية</b> وهو
                  من يتولّى ذلك.
                </Note>
              </Card>
            </Section>
          </div>

          {/* footer */}
          <footer className="mt-16 border-t border-border pt-8 text-center text-sm text-muted-foreground">
            <p>
              دليل استخدام حساب المعلّم —{" "}
              <span className="font-extrabold text-primary">Academiq</span>
            </p>
            <p className="mt-1">نتمنّى لك تجربة تدريس موفّقة ✦</p>
          </footer>
        </main>
      </div>
    </div>
  );
}
