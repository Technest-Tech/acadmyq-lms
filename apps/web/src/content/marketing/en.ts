import { photo, shot } from "./shots";
import { ROUTES } from "./site";
import type { MarketingContent } from "./types";

/**
 * The English marketing site.
 *
 * Written as English, not as a translation of `ar.ts`: the sections and the claims match one for
 * one (the shared type guarantees that), but the sentences are composed for an English reader
 * rather than mapped word by word. Same rule as the Arabic file — nothing is claimed here that the
 * product does not already do.
 */
export const en: MarketingContent = {
  brand: {
    name: "Acadmyq",
    homeLabel: "Acadmyq — home",
  },

  nav: {
    skipToContent: "Skip to content",
    primaryLabel: "Main navigation",
    features: "Features",
    coursePlatform: "Course Platform",
    academyManagement: "Academy Management",
    pricing: "Pricing",
    contact: "Contact",
    login: "Log in",
    demo: "Request a demo",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    language: "Language",
  },

  footer: {
    tagline:
      "One system to run an online academy: students, lessons, collections, teacher pay and WhatsApp in one place — and a course website under your own brand.",
    productsHeading: "Products",
    companyHeading: "Acadmyq",
    legalHeading: "Legal",
    contactHeading: "Get in touch",
    rights: "All rights reserved.",
    emailLabel: "Email",
    phoneLabel: "Phone",
    whatsappLabel: "WhatsApp",
  },

  meta: {
    home: {
      title: "Acadmyq — the management system for online academies",
      description:
        "Run your academy from one system: students, groups and timetables, attendance, subscriptions and receipts, teacher pay, WhatsApp reminders and a follow-up link for every parent.",
    },
    coursePlatform: {
      title: "Course Platform — your own branded course website | Acadmyq",
      description:
        "A complete course website under your brand and subdomain: video, audio, files and quiz lessons, learner sign-up, progress tracking and completion certificates. From EGP 4,999 for the first year.",
    },
    academyManagement: {
      title: "Academy Management — students, schedules and invoices | Acadmyq",
      description:
        "Run your academy from one place: students and guardians, teachers and staff, recurring schedules and attendance, packages, invoices and reports, with roles, permissions and a full audit trail.",
    },
    contact: {
      title: "Request a demo | Acadmyq",
      description:
        "Tell us about your teaching business and we'll show you the system running. Leave your details and we'll get back to you.",
    },
    privacy: {
      title: "Privacy Policy | Acadmyq",
      description:
        "What data Acadmyq collects, why, how it is stored, and what rights you have over it.",
    },
    terms: {
      title: "Terms & Conditions | Acadmyq",
      description:
        "The terms for using Acadmyq: what the subscription is, how annual renewal works, content ownership and responsibilities.",
    },
  },

  home: {
    hero: {
      badge: "Management system for online academies",
      title: "Your whole academy in one system,",
      titleAccent: "from the first lesson to the last receipt",
      subtitle:
        "Students, groups and timetables, attendance, subscriptions and collections, teacher pay, WhatsApp reminders and a link for every parent — one system built for Quran, language and online tutoring academies.",
      primary: { label: "Request a demo", href: ROUTES.contact },
      secondary: { label: "See how it works", href: "#features" },
      points: [
        "Fully Arabic and English",
        "Works on any phone, no app",
        "Every academy's data isolated",
      ],
    },

    heroDemo: {
      alt: "An example academy dashboard on Acadmyq: active students, today's lessons, money collected and attendance rate, a six-month collections chart and today's lesson list, with a WhatsApp reminder, a received payment and a marked register around it.",
      url: "alnoor.acadmyq.com",
      academy: "Al-Noor Academy",
      nav: ["Home", "Students", "Groups", "Timetable", "Attendance", "Accounts", "Payroll", "WhatsApp"],
      hello: "Good morning, Sarah",
      helloSub: "18 lessons today and 3 new trial lessons",
      kpis: [
        { label: "Active students", value: "248", delta: "+12" },
        { label: "Lessons today", value: "18", delta: "6 done" },
        { label: "Collected this month", value: "86,400", delta: "+8%" },
        { label: "Attendance", value: "94%", delta: "+2%" },
      ],
      chartTitle: "Collections — last 6 months",
      chartMonths: ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"],
      todayTitle: "Today's lessons",
      lessons: [
        { time: "4:00 PM", who: "Yusuf Ahmed", teacher: "Ms. Fatima", state: "done" },
        { time: "5:00 PM", who: "Tajweed group", teacher: "Mr. Khaled", state: "live" },
        { time: "7:30 PM", who: "Maryam Khaled", teacher: "Ms. Sarah", state: "next" },
      ],
      states: { done: "Done", live: "Now", next: "Next" },
      whatsapp: { app: "WhatsApp", text: "Reminder: Yusuf's lesson with Ms. Fatima starts in 30 minutes", time: "3:30 PM" },
      payment: { title: "Payment received", body: "EGP 1,200 — Mahmoud family" },
      marked: { title: "Attendance marked", body: "Tajweed group — 9 of 10" },
    },

    builtFor: {
      label: "Built for",
      items: [
        "Quran academies",
        "Language academies",
        "Online tutoring",
        "Group classes and courses",
        "Learning centres",
      ],
    },

    audiences: {
      head: {
        eyebrow: "Who it's for",
        title: "For academies that teach online, every day",
        body: "One-to-one Quran circles, private language lessons or levelled groups — the system takes the shape of how you work, not the other way round.",
      },
      items: [
        {
          photo: photo("quran", "A navy-bound Quran with gold ornament on a dark ground, purple flowers beside it."),
          tag: "Quran & Islamic studies",
          title: "Quran academies",
          body: "Students in different countries, teachers on scattered hours, and families who want to know how their children are doing.",
          points: [
            "Recurring lessons for each student and teacher",
            "A report after every lesson, sent to the family",
            "Monthly subscription or an hours package",
          ],
        },
        {
          photo: photo("student", "A child wearing headphones following a lesson on a laptop screen."),
          tag: "Languages & tutoring",
          title: "One-to-one lessons at different prices",
          body: "Every student at their own price, every teacher on their own pay basis, and a lesson link ready for each teacher.",
          points: [
            "A price per student and per teacher",
            "Pay by the hour, per student, or a fixed salary",
            "An Enter button that records when the teacher joined",
          ],
        },
        {
          photo: photo("group", "A laptop showing a video group class, a green mug beside it on a wooden table."),
          tag: "Groups",
          title: "Group classes and courses",
          body: "One teacher and many students, with the group's timetable, register and payments in one place.",
          points: [
            "One register for the whole group",
            "Monthly, per-lesson or per-course fees",
            "A WhatsApp group reminder before each lesson",
          ],
        },
      ],
    },

    problem: {
      head: {
        eyebrow: "Before and after",
        title: "From everyday chaos to an organised day",
        body: "These are the problems academies describe on our first call — and how the system solves them.",
      },
      photo: photo("chaos", "A man whose face and chest are covered in sticky notes of tasks and reminders."),
      beforeTitle: "Before",
      afterTitle: "With Acadmyq",
      pairs: [
        {
          before: "An Excel timetable nobody is sure is the latest copy",
          after: "One timetable that generates every student's lessons from a start date",
        },
        {
          before: "Reminders typed by hand to every student before every lesson",
          after: "WhatsApp reminders that go out on their own, before and at the start",
        },
        {
          before: "Lessons that happened but nobody recorded, lost from the books",
          after: "Every unmarked lesson waits on an overdue list until someone marks it",
        },
        {
          before: "Payments scattered across transfers, cash and notebooks",
          after: "A receipt for every payment, a treasury, and a clear balance per family",
        },
        {
          before: "Teacher pay worked out on a calculator at month end",
          after: "A pay statement per teacher, built from the lessons they taught",
        },
        {
          before: "A parent asking: how many lessons did my son attend? What do I owe?",
          after: "A private link per family with lessons, reports and balance",
        },
      ],
    },

    features: {
      head: {
        eyebrow: "Inside the system",
        title: "Everything your academy runs, in one place",
        body: "Not separate lists — each part feeds the next. A marked lesson lands on the student's account, the teacher's statement and the family's report in the same moment.",
      },
      tiles: {
        schedule: {
          tag: "Timetables & attendance",
          title: "A timetable that makes its own lessons, and a register that never slips",
          body: "A weekly timetable per student or group generates lessons from the start date, and the teacher marks attendance in one tap.",
          demo: {
            days: ["Sat", "Sun", "Mon", "Tue", "Wed"],
            blocks: [
              { day: 0, row: 0, label: "Yusuf", tone: "navy" },
              { day: 1, row: 1, label: "Tajweed", tone: "gold" },
              { day: 2, row: 0, label: "Maryam", tone: "sky" },
              { day: 2, row: 2, label: "Yusuf", tone: "navy" },
              { day: 3, row: 1, label: "Tajweed", tone: "gold" },
              { day: 4, row: 0, label: "Salma", tone: "sky" },
              { day: 4, row: 2, label: "Omar", tone: "navy" },
            ],
            rows: [
              { name: "Yusuf Ahmed", time: "4:00 PM", state: "present" },
              { name: "Maryam Khaled", time: "5:00 PM", state: "absent" },
              { name: "Tajweed group", time: "7:30 PM", state: "pending" },
            ],
            states: { present: "Present", absent: "Absent", pending: "Not marked" },
          },
        },
        whatsapp: {
          tag: "WhatsApp",
          title: "Reminders sent from your academy's own number",
          body: "Link your number once by scanning a QR code, and the system reminds students and teachers before every lesson.",
          demo: {
            contact: "Al-Noor Academy",
            status: "Connected",
            messages: [
              { text: "Reminder: Yusuf's lesson with Ms. Fatima is at 4:00 PM, in 30 minutes.", time: "3:30 PM" },
              { text: "The lesson has started. Ms. Fatima is waiting for Yusuf.", time: "4:00 PM" },
            ],
          },
        },
        money: {
          tag: "Subscriptions & collections",
          title: "A receipt for every pound, a balance for every family",
          body: "Monthly subscriptions or hours packages, receipts, a treasury and discounts, and card payment from the invoice link.",
          demo: {
            title: "Payment receipt",
            number: "#1042",
            lines: [
              { label: "Family", value: "Mahmoud family" },
              { label: "Subscription", value: "8 lessons — Nov" },
              { label: "Method", value: "Card" },
            ],
            totalLabel: "Amount",
            total: "EGP 1,200",
            duesTitle: "Due this week",
            dues: [
              { name: "Salem family", value: "EGP 800", late: true },
              { name: "Omar family", value: "EGP 600", late: false },
              { name: "Yusuf family", value: "EGP 950", late: false },
            ],
            lateLabel: "Late",
          },
        },
        portal: {
          tag: "Parent link",
          title: "One link where the family follows everything",
          body: "No password, no app: upcoming and past lessons, reports and the balance — on the parent's phone.",
          demo: {
            greeting: "Hello, Mahmoud family",
            child: "Yusuf",
            nextLabel: "Next lesson",
            next: "Sun 4:00 PM",
            balanceLabel: "Balance",
            balance: "Paid in full",
            lessonsTitle: "Recent lessons",
            lessons: [
              { date: "Thursday", state: "Present" },
              { date: "Tuesday", state: "Present" },
              { date: "Saturday", state: "Present" },
            ],
            pay: "Pay by card",
          },
        },
        payroll: {
          tag: "Teacher pay",
          title: "The pay statement writes itself",
          body: "By the hour, per student or a fixed salary — every lesson a teacher gives lands on their statement, with bonuses and deductions.",
          demo: {
            teacher: "Ms. Fatima Ali",
            month: "November",
            lines: [
              { label: "42 lessons", value: "4,200" },
              { label: "Bonus", value: "+300" },
              { label: "Late deduction", value: "−150" },
            ],
            totalLabel: "Net",
            total: "EGP 4,350",
            types: ["Hourly", "Per student", "Fixed"],
          },
        },
        reports: {
          tag: "Reports",
          title: "A report after every lesson, on a card with your brand",
          body: "Report fields you define, a report card carrying your logo to send to the family, and ready-made certificate designs.",
          demo: {
            title: "Lesson report",
            student: "Yusuf Ahmed",
            rows: [
              { label: "Memorisation", stars: 5 },
              { label: "Tajweed", stars: 4 },
              { label: "Revision", stars: 4 },
            ],
            note: "Excellent memorisation of Surat Al-Mulk.",
          },
        },
      },
      more: {
        title: "And much more",
        body: "Everything a growing academy needs, without buying another system.",
        items: [
          "Trial lessons",
          "Leads",
          "Certificates",
          "Teacher supervision",
          "Teacher quality reviews",
          "Custom roles",
          "Audit log of every change",
          "Excel export",
          "Your own domain",
        ],
      },
    },

    day: {
      head: {
        eyebrow: "A day at your academy",
        title: "The system works with you, from before the lesson to month end",
        body: "This is what happens around every lesson, without anyone having to remember it.",
      },
      steps: [
        {
          icon: "BellRing",
          time: "Before the lesson",
          title: "The reminder goes out",
          body: "A WhatsApp message to the student and teacher, or their group, before the lesson and again as it starts.",
        },
        {
          icon: "Video",
          time: "Lesson time",
          title: "The teacher joins in one tap",
          body: "An Enter button opens the teacher's lesson link and records when they joined, so you know who runs late.",
        },
        {
          icon: "ClipboardCheck",
          time: "After the lesson",
          title: "Attendance and the report",
          body: "The teacher marks attendance and writes the report, which becomes a card in your brand for the family.",
        },
        {
          icon: "TriangleAlert",
          time: "If nobody marks it",
          title: "No lesson gets lost",
          body: "An unmarked lesson moves to the overdue list, and your supervision group gets a WhatsApp alert.",
        },
        {
          icon: "Wallet",
          time: "Month end",
          title: "The books are ready",
          body: "What families owe is worked out from lessons, and each teacher's statement from their lessons. No calculator.",
        },
      ],
    },

    modules: {
      head: {
        eyebrow: "Modules",
        title: "Start with management, add what you need",
        body: "You pay only for what you use, and every module works on the same data as the rest.",
      },
      items: [
        {
          icon: "LayoutDashboard",
          name: "Academy management",
          tag: "The core",
          body: "The heart of the system: students, families and teachers, timetables, attendance and groups, subscriptions, receipts and the treasury, payroll and reports.",
          points: ["Students, families, teachers", "Timetables and attendance", "Collections and payroll"],
          cta: { label: "Academy management in detail", href: ROUTES.academyManagement },
        },
        {
          icon: "MessageCircle",
          name: "WhatsApp",
          tag: "Add-on",
          body: "Link your academy's number, launch lesson reminders for students, teachers and groups, and alerts for your supervision and accounts teams.",
          points: ["Link the number by QR", "Reminders before and at the start", "Alerts for your team"],
        },
        {
          icon: "Contact",
          name: "Leads",
          tag: "Add-on",
          body: "Everyone who asked about your academy on one board: from first contact to subscription, with follow-up dates and one-click conversion to a student.",
          points: ["A board of stages", "Follow-up dates", "Convert to a student"],
        },
        {
          icon: "GraduationCap",
          name: "Course platform",
          tag: "Add-on",
          body: "A course website in your academy's brand: video lessons, files and quizzes, access codes and completion certificates.",
          points: ["A site under your name", "Lessons and quizzes", "Completion certificates"],
          cta: { label: "Course platform in detail", href: ROUTES.coursePlatform },
        },
      ],
    },

    foundation: {
      head: {
        eyebrow: "A solid foundation",
        title: "Built to carry your academy's data safely",
        body: "What you read here applies to every module in the system.",
      },
      items: [
        {
          icon: "Lock",
          title: "Every academy's data isolated",
          body: "Isolation is enforced inside the database itself, row by row — not in application code alone.",
        },
        {
          icon: "Shield",
          title: "Each person sees what is theirs",
          body: "Ready roles for owner, supervisor and teacher, plus custom roles you build. Teachers never see your finances.",
        },
        {
          icon: "History",
          title: "An audit log of every change",
          body: "Who changed what and when, with the value before and after — so you know exactly what happened when accounts differ.",
        },
        {
          icon: "Languages",
          title: "Arabic and English",
          body: "Every screen in right-to-left Arabic and in English. Each user picks their own language.",
        },
        {
          icon: "Smartphone",
          title: "On any device",
          body: "Phone, tablet or computer, right in the browser. No app to ask your team to install.",
        },
        {
          icon: "Globe",
          title: "Your name, your brand",
          body: "A subdomain or your own domain, with your logo on the sign-in page and on every link families receive.",
        },
      ],
    },

    faq: {
      head: {
        eyebrow: "Common questions",
        title: "Before you ask",
      },
      items: [
        {
          q: "Does it suit an academy that is fully online?",
          a: "Yes — that is what it was built for: timetables handle time zones, attendance is marked per lesson, and the books are built from the lessons that actually happened.",
        },
        {
          q: "Do we need to install anything?",
          a: "No. It runs in the browser on phones and computers, and we take care of hosting, updates and backups.",
        },
        {
          q: "Can a teacher see the whole academy?",
          a: "No. A teacher sees only their own timetable, students and pay — never the academy's finances or other teachers' data.",
        },
        {
          q: "Can parents pay online?",
          a: "Yes. If your academy links an XPay payment account, parents pay by card from the invoice link and the payment is recorded automatically.",
        },
        {
          q: "How do we start if we already have data?",
          a: "We start with a call to understand how you work, then set up your academy's account and help you bring in students, teachers and timetables.",
        },
        {
          q: "How much does it cost?",
          a: "It depends on the size of your academy and the modules you need. Request a demo and we'll give you a clear price for your case after a short call.",
        },
      ],
    },

    close: {
      title: "See your academy, organised",
      body: "Leave your details and we'll show you the system running on a case like yours, and answer every question before you decide.",
      points: [
        "A live demo of the real system, not a recording",
        "We help you set up your account and bring in your data",
        "Support throughout your subscription",
      ],
    },
  },

  coursePlatform: {
    hero: {
      title: "Launch your course platform",
      titleAccent: "under your own name",
      subtitle:
        "A complete course website carrying your brand: your students sign up, log in, watch the lessons, take the quizzes and earn a completion certificate — and you never write a line of code.",
      primary: { label: "Request a demo", href: ROUTES.contact },
      secondary: { label: "See what your student sees", href: "#tour" },
      points: [
        "A site on your own subdomain",
        "Video, audio, file and quiz lessons",
        "Certificates and progress tracking",
      ],
    },

    audience: {
      head: {
        eyebrow: "Who it's for",
        title: "Anyone with structured knowledge to teach",
        body: "One platform, very different subjects. What its users have in common is a body of material they want to deliver to students online.",
      },
      groups: [
        {
          title: "Teaching and training",
          items: [
            "Teachers in any subject",
            "Language instructors",
            "Qur'an and Islamic studies teachers",
            "Trainers and workshop leaders",
          ],
        },
        {
          title: "Professional expertise",
          items: [
            "Consultants",
            "Coaches",
            "Technical instructors",
            "Specialists with deep subject knowledge",
          ],
        },
        {
          title: "Content creators",
          items: [
            "Educational content creators",
            "People running channels and learning communities",
            "Small academies starting out online",
          ],
        },
      ],
    },

    tour: {
      head: {
        eyebrow: "What your student sees",
        title: "The whole journey, from your site to the certificate",
        body: "These are captures of the running product, not illustrations.",
      },
      shots: [
        shot(
          "cpSiteHome",
          "A course website home page with the academy's name and logo, a headline, and buttons to browse the courses.",
          "Your home page, with your words and your identity",
        ),
        shot(
          "cpCatalog",
          "A list of published courses, each with a cover image, title, short description and its price or a Free label.",
          "The catalogue — every course with its cover and its price",
        ),
        shot(
          "cpCourse",
          "A course page showing the description and the full contents broken into sections and lessons, with free preview lessons marked.",
          "The course page: the full contents before signing up, with preview lessons",
        ),
        shot(
          "cpPlayer",
          "The lesson player with the lesson list beside it and completed lessons ticked off.",
          "The lesson player — progress is saved, so a student resumes where they stopped",
        ),
        shot(
          "cpQuiz",
          "A quiz screen showing a question, its options and how many questions remain.",
          "A quiz inside the course, graded on the server against a pass mark you set",
        ),
        shot(
          "cpCertificate",
          "A completion certificate carrying the learner's name, the course title, the completion date and a serial number.",
          "A completion certificate with a serial number, issued once every lesson is done",
        ),
      ],
    },

    capabilities: {
      head: {
        eyebrow: "Your dashboard",
        title: "What you do behind the scenes",
        body: "A dashboard separate from your students' site, where you build the content and control who reaches it.",
      },
      items: [
        {
          icon: "BookOpen",
          title: "Build the course",
          body: "Sections and lessons in the order you want, reordered whenever you like, published when ready or kept as a draft until then.",
        },
        {
          icon: "PlayCircle",
          title: "Every kind of lesson",
          body: "Video you upload to the platform, a YouTube link, an audio file, a PDF, a written lesson, or a quiz.",
        },
        {
          icon: "Files",
          title: "Free preview lessons",
          body: "Open as many lessons as you like to any visitor before sign-up, so they decide knowing exactly what they are getting.",
        },
        {
          icon: "Wallet",
          title: "Free and paid courses",
          body: "Set a price per course in your academy's currency, or make it free — in which case a student enrols in one click after signing up.",
        },
        {
          icon: "KeyRound",
          title: "Access codes",
          body: "Generate codes in a batch, choose which courses they open, when they expire and how many times each can be used, then export them to a file.",
        },
        {
          icon: "Users",
          title: "Learner management",
          body: "Everyone who signed up, what they enrolled in and when they were last active — with the ability to block an account or revoke access to a course.",
        },
        {
          icon: "ListChecks",
          title: "Quizzes, graded automatically",
          body: "Multiple-choice and true/false questions with a pass mark and an attempt limit, graded on the server rather than in the student's browser.",
        },
        {
          icon: "Award",
          title: "Completion certificates",
          body: "Issued automatically once every lesson in the course is complete, each carrying a serial number you can look up.",
        },
        {
          icon: "TrendingUp",
          title: "Progress tracking",
          body: "How far each student has got in each course, where they stopped, and how they did on the quizzes.",
        },
        {
          icon: "Palette",
          title: "Edit your own site",
          body: "Home page copy, your introduction, the FAQ, contact details, and your terms and privacy pages — all from inside the dashboard.",
        },
      ],
    },

    workflow: {
      head: {
        eyebrow: "Getting started",
        title: "From the first call to your first student",
      },
      steps: [
        {
          title: "We agree on the details",
          body: "A short call to understand your material and your students, and to show you the system running.",
        },
        {
          title: "We set up your platform",
          body: "We activate your account on a subdomain of your own and set your name, logo and primary colour.",
        },
        {
          title: "You upload your content",
          body: "Build the first course from your dashboard — or we walk through building it with you.",
        },
        {
          title: "You open the doors",
          body: "Publish the course, hand access codes to the students who have paid, and they sign up and start watching.",
        },
      ],
    },

    pricing: {
      kind: "published",
      eyebrow: "Pricing",
      title: "Your branded course platform, at a published annual price",
      body: "One price you know before you start. No cut of your sales, because you collect payment your own way.",
      firstYearLabel: "First year",
      firstYearNote:
        "Covers setting the platform up on your subdomain, configuring your identity, and running both the course dashboard and your students' site in full.",
      renewalLabel: "Annual renewal after that",
      renewalNote:
        "Covers hosting, maintenance, platform updates and technical support for the year.",
      includesHeading: "What the subscription includes",
      includes: [
        "A public course site under your brand on a subdomain of your own",
        "A dashboard for building courses, sections and lessons",
        "Uploading video, audio and files, or linking to YouTube",
        "Quizzes, completion certificates and progress tracking",
        "Access codes, learner management and access control",
        "Arabic and English across the site and the dashboard",
        "Limits on courses, learners and storage according to your plan, agreed with you",
        "Platform updates as they ship, and technical support for the term",
      ],
      ownership:
        "The subscription gives you the right to use the platform, hosted, maintained and supported, for as long as it runs. The platform is software we operate and develop: the subscription does not include handing over source code or transferring ownership of the software. Your teaching content remains yours throughout.",
      cta: { label: "Request a demo", href: ROUTES.contact },
    },

    faq: {
      head: {
        eyebrow: "Questions",
        title: "Before you ask",
      },
      items: [
        {
          q: "Do I need any technical skill?",
          a: "No. You upload lessons and write your site's copy from a ready dashboard; hosting, updates and maintenance are ours.",
        },
        {
          q: "How does a student get into a course?",
          a: "A free course opens in one click once the student signs up. A paid course is opened by an access code you generate in your dashboard and hand over once you have collected payment in whatever way suits you.",
        },
        {
          q: "Do you take a percentage of my sales?",
          a: "No. The annual subscription is all you pay us. Collection happens outside the platform, and the platform's job is to open the course with the code.",
        },
        {
          q: "Can a visitor see anything before signing up?",
          a: "Yes. Mark any lesson as a preview and any visitor can watch it without an account — and the full course contents are visible before they decide.",
        },
        {
          q: "Where is the video stored?",
          a: "You can upload video to the platform, where it is processed and streamed to enrolled students through short-lived links that are no use if shared. If your material is already on YouTube, a lesson can point straight at it.",
        },
        {
          q: "Is the site available in Arabic?",
          a: "Yes — in Arabic laid out right to left, and in English, with the visitor choosing.",
        },
        {
          q: "What happens if I don't renew?",
          a: "The annual renewal is what pays for hosting, maintenance and support; without it the platform stops running at the end of the paid term. Your content stays yours and you can ask us for a copy of it.",
        },
      ],
    },

    close: {
      title: "Tell us about your content, and we'll show you your platform",
      body: "Leave your details and we'll come back with a time to walk you through the system itself.",
      primary: { label: "Request a demo", href: ROUTES.contact },
    },
  },

  academyManagement: {
    hero: {
      title: "Your whole academy",
      titleAccent: "in one system",
      subtitle:
        "Students, families and teachers, timetables, groups and attendance, subscriptions, receipts and payroll, and WhatsApp reminders — instead of scattered files where nobody knows which one is current.",
      primary: { label: "Request a demo", href: ROUTES.contact },
      secondary: { label: "See the screens", href: "#tour" },
      points: [
        "WhatsApp reminders before every lesson",
        "A follow-up link for every parent",
        "Books and payroll built from lessons that happened",
      ],
    },

    audience: {
      head: {
        eyebrow: "Who it's for",
        title: "An academy already running that wants its day organised",
        body: "The system was built for academies teaching remotely: schedules that respect time zones, attendance per lesson, and invoices that follow what actually took place.",
      },
      groups: [
        {
          title: "Kind of academy",
          items: [
            "Qur'an memorisation and Islamic studies academies",
            "Language academies",
            "Online tutoring centres",
          ],
        },
        {
          title: "Who uses it daily",
          items: [
            "Academy owners",
            "Supervisors running schedules and attendance",
            "Whoever handles invoicing and collection",
            "Teachers, each within their own students",
          ],
        },
        {
          title: "Size",
          items: [
            "One teacher and a few dozen students",
            "A team of dozens of teachers",
            "An academy teaching more than one specialisation",
          ],
        },
      ],
    },

    tour: {
      head: {
        eyebrow: "The screens",
        title: "The system as you see it every day",
        body: "Captures of the running product, on a fully populated demo academy.",
      },
      shots: [
        shot(
          "amDashboard",
          "The dashboard showing student and teacher counts, the day's lessons and a summary of the month's finances.",
          "The dashboard — where the academy stands today, on one screen",
        ),
        shot(
          "amStudents",
          "The student list showing names, guardians, the assigned teacher and each student's status, with search and filters.",
          "Students — a record per student, linked to their guardian and teacher",
        ),
        shot(
          "amCalendar",
          "A weekly calendar with the academy's lessons laid out across days and hours.",
          "The weekly schedule — recurring lessons are generated for you",
        ),
        shot(
          "amAttendance",
          "The attendance screen listing the day's lessons and the state of each: attended, absent, or not yet marked.",
          "Attendance — per lesson, with what is still unmarked called out",
        ),
        shot(
          "amInvoices",
          "The invoice list with numbers, guardians, amounts and payment status.",
          "Invoices — built from lessons, with payment status in plain view",
        ),
        shot(
          "amFinancial",
          "The financial statistics screen charting revenue, collected amounts and outstanding balances.",
          "Financial reporting — what came in and what is still owed",
        ),
      ],
    },

    capabilities: {
      head: {
        eyebrow: "Modules",
        title: "What the system covers",
      },
      items: [
        {
          icon: "Users",
          title: "Students, families and teachers",
          body: "A record per student linked to their family and teacher; a family is one account however many children it has, with extra fields you define.",
        },
        {
          icon: "CalendarDays",
          title: "Recurring timetables",
          body: "A weekly timetable per student generates lessons automatically from a start date you set, with rescheduling, cancellation and the reason recorded.",
        },
        {
          icon: "ClipboardCheck",
          title: "Attendance and overdue lessons",
          body: "Attendance for every lesson, and a list of lessons that ended without being marked, so none slips through unrecorded.",
        },
        {
          icon: "GraduationCap",
          title: "Groups",
          body: "A group with one teacher and many students, with its own timetable, register and a monthly, per-lesson or per-course fee.",
        },
        {
          icon: "Wallet",
          title: "Subscriptions and hours packages",
          body: "A monthly subscription of a set number of lessons, an hours package drawn down lesson by lesson, or a free student who never gets an invoice.",
        },
        {
          icon: "Receipt",
          title: "Receipts and treasury",
          body: "A receipt for every payment, a treasury, discounts, a balance per family, and card payment from the invoice link via XPay.",
        },
        {
          icon: "HandCoins",
          title: "Teacher pay",
          body: "Hourly, per student or a fixed salary. Each teacher's statement is built from the lessons they taught, with bonuses and deductions.",
        },
        {
          icon: "MessageCircle",
          title: "WhatsApp reminders and alerts",
          body: "Reminders to students and teachers before and at the start of each lesson, and alerts to your supervision and accounts groups, from your own number.",
        },
        {
          icon: "Smartphone",
          title: "Parent link",
          body: "A private link per family, no password: upcoming and past lessons, approved reports and the balance.",
        },
        {
          icon: "TrendingUp",
          title: "Reports and report cards",
          body: "A report after each lesson with fields you choose, a branded report card for the family, and finance, attendance and teacher reports.",
        },
        {
          icon: "Shield",
          title: "Roles and permissions",
          body: "Ready-made roles for owner, supervisor and teacher, and custom roles you build from your own permissions.",
        },
        {
          icon: "History",
          title: "Audit log",
          body: "Every change recorded: who made it, when, and the value before and after — so you know exactly what happened when figures disagree.",
        },
      ],
    },

    workflow: {
      head: {
        eyebrow: "Getting started",
        title: "From the demo to running the academy on it",
      },
      steps: [
        {
          title: "We learn your academy",
          body: "A call to understand how many students and teachers you have and how you collect payment — and whether the system suits you at all.",
        },
        {
          title: "We set up your account",
          body: "We activate your academy with its identity, currency and time zone, and enter your core data with you.",
        },
        {
          title: "You start operating",
          body: "You create the schedules, teachers mark attendance, and invoices are built from the lessons that took place.",
        },
        {
          title: "You follow the numbers",
          body: "A dashboard and a set of reports showing what is done, what is late, and what has not been collected.",
        },
      ],
    },

    pricing: {
      kind: "quote",
      eyebrow: "Subscription",
      title: "Priced to the size of your academy",
      body: "The number of students and teachers, and which modules you need, differ from one academy to the next, so no single figure fits everyone. Ask for a quote and we'll give you a clear number for your case.",
      includesHeading: "What we need to know to quote",
      includes: [
        "Roughly how many active students you have",
        "How many teachers and staff",
        "How you collect: monthly, or against hour packages",
        "Which modules you actually need",
      ],
      note: "There is no published price for this system, and you won't find a number here that we don't stand behind. The figure comes after a short call.",
      cta: { label: "Request a quote", href: ROUTES.contact },
    },

    faq: {
      head: {
        eyebrow: "Questions",
        title: "Before you ask",
      },
      items: [
        {
          q: "Does it suit an academy that teaches entirely online?",
          a: "Yes — that is the case it was built for: schedules that respect time zones, attendance marked per lesson, and invoices built from the lessons that actually took place.",
        },
        {
          q: "Does each teacher only see their own students?",
          a: "Yes. A teacher sees their schedule, the students assigned to them and their own earnings, and none of the academy's other data or its finances.",
        },
        {
          q: "Where do invoices come from?",
          a: "From the lessons that took place and each student's rate. If a student is on an hour package, the lesson is drawn from the package balance instead of being added to a monthly invoice.",
        },
        {
          q: "Can we change permissions?",
          a: "Yes. The ready-made roles usually cover it, and you can build a custom role that gives someone exactly what they need — without anyone being able to grant a permission they don't hold themselves.",
        },
        {
          q: "Is our data isolated from other clients?",
          a: "Yes. Isolation is enforced inside the database row by row, so every query is confined to your academy by the database itself, not by application code alone.",
        },
        {
          q: "Can we export our data?",
          a: "Yes. Lists and reports export to Excel files from inside the system.",
        },
      ],
    },

    close: {
      title: "See the system on data that looks like yours",
      body: "Leave your details and we'll agree a time to walk through the system running, and answer your questions.",
      primary: { label: "Request a demo", href: ROUTES.contact },
    },
  },

  contact: {
    hero: {
      title: "Talk to the Acadmyq team",
      subtitle:
        "Fill in the form and we'll come back with a time to walk you through the system itself — not a pre-made video, not a slide deck.",
    },
    expect: {
      title: "What happens next",
      items: [
        "We read your request and work out which of the two systems fits.",
        "We contact you on the number or email you left.",
        "We agree a time, show you the system running and answer your questions.",
        "Your details are used to reply to this request only, and are not passed to anyone else.",
      ],
    },
    reach: {
      title: "How to reach us",
      body: "The form is the fastest route to us, and it goes straight to the person who will speak with you.",
    },
  },

  form: {
    title: "Request a demo",
    body: "Leave your details and we'll get back to you. Fields marked * are required.",
    fields: {
      name: "Full name",
      namePlaceholder: "e.g. Ahmed Mahmoud",
      email: "Email",
      emailHint: "If you'd rather we wrote than called.",
      phone: "Phone number",
      phonePlaceholder: "e.g. +20 10 1234 5678",
      country: "Country",
      countryPlaceholder: "Select your country",
      product: "What are you interested in?",
      productOptions: {
        COURSE_PLATFORM: "Course Platform",
        ACADEMY_MANAGEMENT: "Academy Management System",
        UNDECIDED: "Not sure yet",
      },
      role: "What you do",
      rolePlaceholder: "e.g. English teacher, or academy owner",
      message: "Your message",
      messagePlaceholder: "Tell us briefly what you do and what you need.",
      consent: "I agree to be contacted by the Acadmyq team about this request.",
      optional: "optional",
    },
    submit: "Send request",
    submitting: "Sending…",
    success: {
      title: "We've got your request",
      body: "We'll reach out on the details you left to arrange the demo.",
      again: "Send another request",
    },
    errors: {
      generic: "We couldn't send your request. Check the details and try again.",
      rateLimited: "That's several requests in a short time. Please wait a little and try again.",
      network: "We couldn't reach the server. Check your connection and try again.",
      name: "Please enter your full name.",
      phone: "Please enter a phone number we can reach you on.",
      email: "That email address doesn't look right.",
      product: "Please choose what you're interested in.",
      consent: "We need your agreement before we can contact you.",
    },
  },

  privacy: {
    title: "Privacy Policy",
    updatedLabel: "Last updated",
    intro:
      "This policy explains what data Acadmyq collects, why we collect it, how we store it, and what rights you have over it. It is written as plainly as we can manage.",
    sections: [
      {
        heading: "Who we are, and in what capacity we handle data",
        paragraphs: [
          "Acadmyq operates two software systems: a course platform that carries a client's own brand, and a management system for academies.",
          "Your data sits with us in two different capacities. Data about you as a client — your name, contact details and subscription — is data whose purpose we determine. Data about your students and their guardians, which you enter into the system, we store and process on your behalf and on your instructions; you remain responsible for the lawfulness of collecting it and for informing the people it describes.",
        ],
      },
      {
        heading: "What we collect",
        paragraphs: [
          "Demo request details: your name, phone number, email if you leave one, country, the product you're interested in, what you do, your message, and your agreement to be contacted. We record the IP address, browser and time of submission alongside them, to protect the form against automated abuse.",
          "Account data: a user's name, email, role within their academy, and sign-in records.",
          "Data you enter into the system: students, guardians and teachers, schedules and attendance, invoices and payments, and the teaching content you upload.",
          "Operational data: error logs and server logs needed to run and secure the service.",
        ],
      },
      {
        heading: "Cookies",
        paragraphs: [
          "We use no advertising cookies and place no third-party tracking on this marketing site.",
          "We use functional cookies only: a session cookie for anyone who signs in, a cookie holding the language you chose, and a cookie holding your appearance preference inside the dashboard. None of them identifies a visitor who has neither signed in nor changed language.",
        ],
      },
      {
        heading: "Why we use it",
        paragraphs: [
          "To reply to your request and arrange the demo; to run the service you subscribed to; to issue invoices and manage the subscription; to protect the system against automated or abusive use; and to comply with legal obligations.",
          "We do not sell your data, do not share it with advertisers, and do not use your students' data for any purpose of our own.",
        ],
      },
      {
        heading: "Where data is stored and who can reach it",
        paragraphs: [
          "Data is stored on servers we operate with hosting providers, and connections to the system are encrypted over HTTPS.",
          "Each client's data is isolated from every other client's inside the database itself, row by row, so one client's query cannot reach another client's data.",
          "Access on our side is limited to the team members who need it to operate and support the service, and sensitive changes are recorded in an audit trail inside the system.",
        ],
      },
      {
        heading: "How long we keep it",
        paragraphs: [
          "We keep demo request details for as long as they remain relevant to following up on the request, and delete them when you ask us to.",
          "We keep account and usage data for the term of the subscription. After it ends we keep it for a reasonable period so you can retrieve it or ask for a copy, after which it is deleted or anonymised — except for what we must retain for accounting or legal reasons.",
        ],
      },
      {
        heading: "Your rights",
        paragraphs: [
          "You may ask to see your data, to correct it, to have it deleted, to receive a copy of it, or to withdraw your agreement to be contacted.",
          "To make any of those requests, use the contact form on this site or the contact details published on it, if any. We respond within a reasonable time.",
        ],
      },
      {
        heading: "Children",
        paragraphs: [
          "Academy data may include information about minors entered by the client. Responsibility for obtaining a guardian's consent rests with the client who runs the academy, as the controller of that data; we process it on their behalf only.",
        ],
      },
      {
        heading: "Changes to this policy",
        paragraphs: [
          "We may update this policy as the service changes. The date at the top of this page is the date of the last update, and the version published here is the one in force.",
        ],
      },
    ],
  },

  terms: {
    title: "Terms & Conditions",
    updatedLabel: "Last updated",
    intro:
      "These terms govern your use of the Acadmyq platforms. By using the service or subscribing to it, you agree to them.",
    sections: [
      {
        heading: "What the service is",
        paragraphs: [
          "Acadmyq is hosted software: we run the system on our servers and grant you the right to use it for the term of your subscription.",
          "The subscription is not a sale of the software. It does not involve handing over source code, transferring ownership of the software or any part of it, or granting a perpetual licence to use it after the subscription ends.",
        ],
      },
      {
        heading: "Subscription and renewal",
        paragraphs: [
          "The Course Platform subscription is annual: an amount for the first year, then an annual renewal amount thereafter. Both figures are published on the Course Platform page of this site.",
          "The annual renewal covers hosting, maintenance, platform updates and technical support for the year. Not renewing means the platform stops running at the end of the paid term.",
          "The Academy Management subscription is set per client according to size and the modules in use, and is fixed in the agreed quote.",
          "Published prices exclude any taxes or levies imposed by law, and may change for future terms with reasonable notice before the renewal date.",
        ],
      },
      {
        heading: "Your account",
        paragraphs: [
          "You are responsible for keeping your own and your team's sign-in credentials confidential, and for everything done through your account.",
          "You decide what permissions your team holds inside the system, and you are responsible for what the people you authorise do with them.",
        ],
      },
      {
        heading: "Your content and your data",
        paragraphs: [
          "The teaching content you upload, and your academy's and students' data, remain yours. We host and process them to run the service for you, and use them for nothing else.",
          "You confirm that you have the right to publish what you upload, that it infringes nobody else's intellectual property, and that it does not break the law.",
          "You may ask for a copy of your data and content at any time during the subscription, and for a reasonable period after it ends.",
        ],
      },
      {
        heading: "Acceptable use",
        paragraphs: [
          "The service may not be used to publish unlawful content, to attempt to reach another client's data, to damage or disrupt the service, or to resell or rent the system to a third party without a written agreement.",
          "We may suspend an account that breaches the above, with notice where possible, or without notice where continuing would harm other clients.",
        ],
      },
      {
        heading: "Availability and support",
        paragraphs: [
          "We make reasonable efforts to keep the service available, and may take it down briefly for maintenance or updates, which we try to schedule at quiet times.",
          "Technical support covers running the system, answering questions about it and fixing faults. Building features specific to one client is not part of the subscription and is agreed separately.",
        ],
      },
      {
        heading: "Payment and refunds",
        paragraphs: [
          "Subscriptions are paid in advance for the agreed term. Late payment may result in the service being suspended until it is settled.",
          "We do not refund amounts paid for a term already under way, except where the law requires it or where we agree otherwise in writing.",
        ],
      },
      {
        heading: "Ending the subscription",
        paragraphs: [
          "You may end your subscription by not renewing at the end of its term. We may end it in cases of serious breach or non-payment.",
          "On termination the system stops running for you, and we give you a reasonable period to obtain a copy of your data and content before it is deleted.",
        ],
      },
      {
        heading: "Limits of liability",
        paragraphs: [
          "We provide the service as it stands, with the features actually advertised. We do not guarantee that using the system will produce income or any particular commercial result.",
          "We are not liable for indirect or consequential loss, and our liability in any case is limited to what you paid for the service over the period in dispute.",
        ],
      },
      {
        heading: "Changes and governing law",
        paragraphs: [
          "We may update these terms; the version published here is the one in force, and the date at the top of the page is the date of the last update. We notify clients of material changes before they take effect.",
          "These terms are governed by the laws of the Arab Republic of Egypt, and its courts have jurisdiction over any dispute arising from them.",
        ],
      },
    ],
  },

  // English uses the country list's own names, so nothing needs overriding here.
  countryNames: {},
};
