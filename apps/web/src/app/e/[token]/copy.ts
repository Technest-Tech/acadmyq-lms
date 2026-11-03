/**
 * The enrolment page's words. Deliberately NOT next-intl, like the parent page: the language is
 * the VISITOR's choice (`?lang=`), not the staff locale cookie that drives the app.
 */
export type Lang = "ar" | "en";

/** The visitor's language choice, remembered by the switch on the page. */
export const ENROL_LANG_COOKIE = "enrol_lang";

export function isLang(value: unknown): value is Lang {
  return value === "ar" || value === "en";
}

/** Saturday first, as a centre's week runs; the ints are 0 = Sunday … 6 = Saturday (class_group_slots). */
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5] as const;

export const COPY = {
  ar: {
    otherLang: "English",
    defaultTitle: "التسجيل في المركز",
    defaultIntro: "سجّل بيانات الطالب وسنتصل بك لتحديد حصة تحديد المستوى.",
    closedTitle: "التسجيل مغلق حاليًا",
    closedBody: "نعتذر، لا نستقبل طلبات تسجيل جديدة الآن. تابعنا لمعرفة موعد فتح التسجيل.",
    student: "اسم الطالب",
    studentPlaceholder: "الاسم الكامل",
    guardian: "اسم ولي الأمر",
    guardianPlaceholder: "اختياري",
    phone: "رقم الهاتف (واتساب)",
    phonePlaceholder: "1012345678",
    email: "البريد الإلكتروني",
    age: "العمر",
    agePlaceholder: "اختياري",
    subject: "المادة / الكورس المطلوب",
    subjectPick: "اختر…",
    subjectOther: "أخرى",
    subjectOtherPlaceholder: "اكتب المادة المطلوبة",
    level: "المستوى / الصف الحالي",
    levelPlaceholder: "مثال: الصف الرابع، مبتدئ…",
    days: "الأيام المناسبة",
    time: "الوقت المناسب",
    message: "ملاحظات",
    messagePlaceholder: "أي شيء تريد أن نعرفه",
    weekdays: { 6: "السبت", 0: "الأحد", 1: "الاثنين", 2: "الثلاثاء", 3: "الأربعاء", 4: "الخميس", 5: "الجمعة" } as Record<number, string>,
    submit: "إرسال طلب التسجيل",
    sending: "جارٍ الإرسال…",
    required: "هذا الحقل مطلوب",
    phoneInvalid: "أدخل رقم هاتف صحيحًا",
    tooMany: "تم إرسال طلبات كثيرة من هذا الجهاز. حاول بعد قليل.",
    failed: "لم يُرسَل الطلب. حاول مرة أخرى.",
    successTitle: "تم استلام طلبك",
    successDefault: "شكرًا لك! سنتصل بك قريبًا لتحديد موعد حصة تحديد المستوى.",
    another: "تسجيل طالب آخر",
    privacy: "بياناتك تُستخدم للتواصل معك بخصوص التسجيل فقط.",
  },
  en: {
    otherLang: "العربية",
    defaultTitle: "Register at the centre",
    defaultIntro: "Tell us about the student and we will call you to arrange a placement lesson.",
    closedTitle: "Registration is closed",
    closedBody: "Sorry, we are not taking new registrations right now. Follow us for when it reopens.",
    student: "Student name",
    studentPlaceholder: "Full name",
    guardian: "Parent / guardian name",
    guardianPlaceholder: "Optional",
    phone: "Phone (WhatsApp)",
    phonePlaceholder: "1012345678",
    email: "Email",
    age: "Age",
    agePlaceholder: "Optional",
    subject: "Subject / course wanted",
    subjectPick: "Pick one…",
    subjectOther: "Other",
    subjectOtherPlaceholder: "Type the subject",
    level: "Current level / grade",
    levelPlaceholder: "e.g. Grade 4, beginner…",
    days: "Days that suit you",
    time: "Time that suits you",
    message: "Notes",
    messagePlaceholder: "Anything you want us to know",
    weekdays: { 6: "Sat", 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri" } as Record<number, string>,
    submit: "Send registration",
    sending: "Sending…",
    required: "This field is required",
    phoneInvalid: "Enter a valid phone number",
    tooMany: "Too many requests from this device. Try again in a little while.",
    failed: "The request was not sent. Please try again.",
    successTitle: "We received your request",
    successDefault: "Thank you! We will call you soon to arrange a placement lesson.",
    another: "Register another student",
    privacy: "Your details are used only to contact you about this registration.",
  },
} as const satisfies Record<Lang, unknown>;
