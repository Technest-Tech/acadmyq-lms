/**
 * Fetch an image and inline it as a data URI.
 *
 * `html2canvas` taints the canvas on any cross-origin image, and an academy's logo is served from
 * the API host — so a remote `<img src>` inside a capture tree produces a blank download rather than
 * a visible error. A failure here is not an error state: callers fall back to their own ornament,
 * which is never uglier than a broken image.
 */
export async function inlineImage(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
