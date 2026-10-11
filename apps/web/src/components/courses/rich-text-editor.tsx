"use client";

import Image from "@tiptap/extension-image";
import Youtube from "@tiptap/extension-youtube";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code2,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Loader2,
  Minus,
  Quote,
  Redo2,
  SquarePlay,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Field, inputClass } from "@/components/courses/form-bits";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { confirmMediaUploaded, requestMediaUpload, uploadFileToTarget } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * An uploaded image remembers its media-asset id. The API stores the id and re-signs the URL on
 * every read (docs/lms/12 §3), so the `src` in the editor is only ever for display — a local object
 * URL right after upload, a fresh signed URL after a reload.
 */
const BlogImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      mediaId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-media-id"),
        renderHTML: (attrs: { mediaId?: string | null }) =>
          attrs.mediaId ? { "data-media-id": attrs.mediaId } : {},
      },
    };
  },
});

/**
 * The blog's writing surface (docs/lms/12): Tiptap with the StarterKit plus images and YouTube.
 *
 * Deliberately a SMALL toolbar — headings, emphasis, lists, quote, code, link, image, video. A
 * course creator writing an article needs those; font pickers and colour wheels are how a blog ends
 * up looking like a ransom note. Every block carries `dir="auto"` (`textDirection`), so an Arabic
 * paragraph and an English one sit correctly in the same post.
 *
 * Uncontrolled: `initialHtml` seeds it once and `onChange` reports every edit. The parent remounts
 * it (via `key`) to load a different post.
 */
export function RichTextEditor({
  initialHtml,
  onChange,
  disabled = false,
  placeholder,
}: {
  initialHtml: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const editor = useEditor({
    // Next renders this on the server first; Tiptap must wait for the browser.
    immediatelyRender: false,
    editable: !disabled,
    textDirection: "auto",
    extensions: [
      StarterKit.configure({
        // The post title is the page's H1; the body's outline starts at H2.
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
        },
      }),
      BlogImage,
      Youtube.configure({ nocookie: true, modestBranding: true, rel: 0 }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: initialHtml,
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
    editorProps: {
      attributes: {
        class:
          "blog-prose prose prose-neutral dark:prose-invert max-w-none min-h-[22rem] px-4 py-5 sm:px-6 focus:outline-none",
      },
    },
  });

  return (
    <div className="bg-card overflow-hidden rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
      {editor !== null && !disabled && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}

// ── toolbar ──────────────────────────────────────────────────────────────────

function Toolbar({ editor }: { editor: Editor }) {
  const t = useTranslations("blog.editor");
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"link" | "youtube" | null>(null);

  // Tiptap 3 does not re-render on every transaction; subscribe to exactly what the buttons show.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      code: e.isActive("codeBlock"),
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  /** Upload through the LMS media pipeline (reserve → PUT → confirm), then drop it in. */
  async function insertImage(file: File) {
    setUploadError(null);
    setUploading(0);
    try {
      const { mediaAssetId, upload } = await requestMediaUpload({
        filename: file.name,
        content_type: file.type || "image/jpeg",
        kind: "IMAGE",
        size_bytes: file.size,
      });
      await uploadFileToTarget(upload, file, setUploading);
      await confirmMediaUploaded(mediaAssetId);
      editor
        .chain()
        .focus()
        .insertContent({
          type: "image",
          attrs: { src: URL.createObjectURL(file), alt: "", mediaId: mediaAssetId },
        })
        .run();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : t("uploadFailed"));
    } finally {
      setUploading(null);
    }
  }

  const chain = () => editor.chain().focus();

  return (
    <div className="bg-muted/40 sticky top-0 z-10 border-b backdrop-blur">
      <div className="no-scrollbar flex items-center gap-0.5 overflow-x-auto px-2 py-1.5">
        <ToolButton
          Icon={Undo2}
          label={t("undo")}
          disabled={!state.canUndo}
          onClick={() => chain().undo().run()}
        />
        <ToolButton
          Icon={Redo2}
          label={t("redo")}
          disabled={!state.canRedo}
          onClick={() => chain().redo().run()}
        />
        <Divider />
        <ToolButton
          Icon={Heading2}
          label={t("heading2")}
          active={state.h2}
          onClick={() => chain().toggleHeading({ level: 2 }).run()}
        />
        <ToolButton
          Icon={Heading3}
          label={t("heading3")}
          active={state.h3}
          onClick={() => chain().toggleHeading({ level: 3 }).run()}
        />
        <Divider />
        <ToolButton
          Icon={Bold}
          label={t("bold")}
          active={state.bold}
          onClick={() => chain().toggleBold().run()}
        />
        <ToolButton
          Icon={Italic}
          label={t("italic")}
          active={state.italic}
          onClick={() => chain().toggleItalic().run()}
        />
        <ToolButton
          Icon={UnderlineIcon}
          label={t("underline")}
          active={state.underline}
          onClick={() => chain().toggleUnderline().run()}
        />
        <ToolButton
          Icon={Strikethrough}
          label={t("strike")}
          active={state.strike}
          onClick={() => chain().toggleStrike().run()}
        />
        <Divider />
        <ToolButton
          Icon={List}
          label={t("bulletList")}
          active={state.bullet}
          onClick={() => chain().toggleBulletList().run()}
        />
        <ToolButton
          Icon={ListOrdered}
          label={t("orderedList")}
          active={state.ordered}
          onClick={() => chain().toggleOrderedList().run()}
        />
        <ToolButton
          Icon={Quote}
          label={t("quote")}
          active={state.quote}
          onClick={() => chain().toggleBlockquote().run()}
        />
        <ToolButton
          Icon={Code2}
          label={t("codeBlock")}
          active={state.code}
          onClick={() => chain().toggleCodeBlock().run()}
        />
        <ToolButton
          Icon={Minus}
          label={t("divider")}
          onClick={() => chain().setHorizontalRule().run()}
        />
        <Divider />
        <ToolButton
          Icon={Link2}
          label={t("link")}
          active={state.link}
          onClick={() => setDialog("link")}
        />
        {state.link && (
          <ToolButton
            Icon={Link2Off}
            label={t("unlink")}
            onClick={() => chain().extendMarkRange("link").unsetLink().run()}
          />
        )}
        <ToolButton
          Icon={uploading !== null ? Loader2 : ImagePlus}
          label={t("image")}
          disabled={uploading !== null}
          spin={uploading !== null}
          onClick={() => fileRef.current?.click()}
        />
        <ToolButton Icon={SquarePlay} label={t("youtube")} onClick={() => setDialog("youtube")} />

        {uploading !== null && (
          <span className="text-muted-foreground ms-1 shrink-0 text-xs tabular-nums">
            {uploading}%
          </span>
        )}
      </div>

      {uploadError && (
        <p className="text-destructive border-t px-3 py-1.5 text-xs" role="alert">
          {uploadError}
        </p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void insertImage(file);
        }}
      />

      {dialog === "link" && (
        <UrlDialog
          title={t("linkTitle")}
          label={t("linkUrl")}
          placeholder="https://"
          initial={state.href}
          onClose={() => setDialog(null)}
          onSubmit={(url) => {
            if (url === "") {
              chain().extendMarkRange("link").unsetLink().run();
            } else {
              chain().extendMarkRange("link").setLink({ href: url }).run();
            }
            return true;
          }}
        />
      )}

      {dialog === "youtube" && (
        <UrlDialog
          title={t("youtubeTitle")}
          label={t("youtubeUrl")}
          placeholder="https://www.youtube.com/watch?v=…"
          invalidMessage={t("youtubeInvalid")}
          onClose={() => setDialog(null)}
          // `setYoutubeVideo` refuses anything that is not a YouTube URL — the dialog stays open and
          // says so rather than silently inserting nothing.
          onSubmit={(url) => url !== "" && chain().setYoutubeVideo({ src: url }).run()}
        />
      )}
    </div>
  );
}

function ToolButton({
  Icon,
  label,
  onClick,
  active = false,
  disabled = false,
  spin = false,
}: {
  Icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  spin?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
        "focus-visible:ring-ring/60 focus-visible:ring-2 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-40",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
      )}
    >
      <Icon className={cn("size-4", spin && "animate-spin")} aria-hidden />
    </button>
  );
}

function Divider() {
  return <span className="bg-border mx-1 h-5 w-px shrink-0" aria-hidden />;
}

/** One URL in, one action out. `onSubmit` returns false to keep the dialog open (invalid input). */
function UrlDialog({
  title,
  label,
  placeholder,
  initial = "",
  invalidMessage,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  placeholder: string;
  initial?: string;
  invalidMessage?: string;
  onClose: () => void;
  onSubmit: (url: string) => boolean;
}) {
  const t = useTranslations("blog.editor");
  const [url, setUrl] = useState(initial);
  const [invalid, setInvalid] = useState(false);

  function submit() {
    if (onSubmit(url.trim())) onClose();
    else setInvalid(true);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={submit}>{t("apply")}</Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={label} hint={invalid ? invalidMessage : undefined}>
          <input
            className={inputClass}
            value={url}
            dir="ltr"
            autoFocus
            inputMode="url"
            placeholder={placeholder}
            onChange={(e) => {
              setUrl(e.target.value);
              setInvalid(false);
            }}
          />
        </Field>
      </form>
    </Modal>
  );
}
