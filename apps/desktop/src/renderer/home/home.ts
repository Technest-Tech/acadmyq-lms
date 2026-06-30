// The native "Join a meeting" home screen (Zoom-style). This is a MEETING-ONLY app — it never shows
// the AcademIQ dashboard. Join → main loads the chrome-free /r/<code> meeting; Sign in → /login.

declare global {
  interface Window {
    academiqHome?: { join(input: string): void; signIn(): void };
  }
}

const input = document.getElementById("meeting") as HTMLInputElement;
const joinBtn = document.getElementById("join") as HTMLButtonElement;
const signinBtn = document.getElementById("signin") as HTMLButtonElement;
const err = document.getElementById("err") as HTMLDivElement;

function join(): void {
  const value = input.value.trim();
  if (!value) {
    err.textContent = "Enter a meeting link or code.";
    input.focus();
    return;
  }
  err.textContent = "";
  joinBtn.disabled = true;
  joinBtn.textContent = "Joining…";
  window.academiqHome?.join(value);
}

joinBtn.addEventListener("click", join);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") join();
});
signinBtn.addEventListener("click", () => window.academiqHome?.signIn());

input.focus();

export {};
