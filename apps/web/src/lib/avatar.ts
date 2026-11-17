/**
 * A person's initials on a coloured disc, the same wherever a name leads a card (a bill, a family's
 * dues): two letters, and a colour that is always the same for the same name.
 */
const AVATAR_TONES = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-indigo-500",
  "bg-teal-500",
];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const ini = parts
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return ini || "?";
}

export function avatarTone(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length]!;
}
