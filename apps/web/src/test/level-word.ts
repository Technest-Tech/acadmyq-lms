/**
 * The text of a `{word, select, GRADE {…} YEAR {…} other {…}}` message for one word: tests read the
 * catalogue raw, and every message naming the classification is such a select (lib/levels.ts). A
 * message that is not a select comes back as it is.
 */
export function forWord(message: string, word: "LEVEL" | "GRADE" | "YEAR" = "LEVEL"): string {
  const prefix = "{word, select, ";
  if (!message.startsWith(prefix)) return message;

  const branches: Record<string, string> = {};
  let i = prefix.length;
  while (i < message.length - 1) {
    while (message[i] === " ") i++;
    let key = "";
    while (message[i] !== " " && message[i] !== "{") key += message[i++];
    while (message[i] === " ") i++;
    const start = i + 1;
    let depth = 0;
    for (; i < message.length; i++) {
      if (message[i] === "{") depth++;
      else if (message[i] === "}" && --depth === 0) break;
    }
    branches[key] = message.slice(start, i);
    i++;
    if (message[i] === "}") break;
  }
  return branches[word] ?? branches.other ?? message;
}
