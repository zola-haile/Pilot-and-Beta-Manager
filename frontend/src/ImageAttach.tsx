import { useState } from "react";
import { assetUrl } from "./api";

// Shared file-attachment logic for composers: click-to-pick, drag & drop, and
// paste. Any file type is accepted (images preview as thumbnails, other files as
// named chips). Files are held as data URLs — the API accepts those directly —
// capped at `max`.

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  data: string; // data URL
}

// A posted attachment as returned by the API.
export interface AttachmentRef {
  id: string;
  url: string;
  name: string | null;
  mime: string | null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random());

function isImage(mime: string | null | undefined, url?: string): boolean {
  if (mime) return mime.startsWith("image/");
  return !!url && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url);
}

export function useImageAttach(max = 6) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);

  async function addFiles(list: FileList | File[] | null | undefined) {
    const arr = Array.from(list ?? []);
    if (arr.length === 0) return;
    const added = await Promise.all(
      arr.map(async (f) => ({
        id: newId(),
        name: f.name || "file",
        mime: f.type || "application/octet-stream",
        data: await readFileAsDataUrl(f),
      }))
    );
    setFiles((prev) => [...prev, ...added].slice(0, max));
  }
  function remove(i: number) {
    setFiles((prev) => prev.filter((_, j) => j !== i));
  }
  function clear() {
    setFiles([]);
  }

  // What to send to the API: data URL + original filename.
  const payload = files.map((f) => ({ data: f.data, name: f.name }));

  // Spread onto the element that should accept dropped files. Only reacts to file
  // drags so it never hijacks other drag-and-drop (e.g. the triage board).
  const dropzoneProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      setDragging(false);
      void addFiles(e.dataTransfer.files);
    },
  };

  // Spread onto a textarea/input to accept pasted screenshots or files.
  const pasteProps = {
    onPaste: (e: React.ClipboardEvent) => {
      const pasted = Array.from(e.clipboardData.files);
      if (pasted.length > 0) {
        e.preventDefault();
        void addFiles(pasted);
      }
    },
  };

  return { files, payload, count: files.length, dragging, addFiles, remove, clear, dropzoneProps, pasteProps, max };
}

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

// The "Attach" pill with a hidden file input (any file type).
export function AttachButton({
  onFiles,
  label = "Attach",
}: {
  onFiles: (files: FileList) => void;
  label?: string;
}) {
  return (
    <label className="chat-attach" title="Attach files — drag & drop, paste, or click">
      <input
        type="file"
        multiple
        onChange={(e) => {
          if (e.target.files) onFiles(e.target.files);
          e.target.value = ""; // allow re-picking the same file
        }}
      />
      <span>{label}</span>
    </label>
  );
}

// Composer previews: image thumbnails + named chips for other files, each removable.
export function AttachmentPreviews({
  files,
  onRemove,
}: {
  files: Attachment[];
  onRemove: (i: number) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className="thumb-row" style={{ marginTop: 8 }}>
      {files.map((f, i) =>
        isImage(f.mime) ? (
          <div key={f.id} className="thumb">
            <img src={f.data} alt="" />
            <button type="button" className="remove" onClick={() => onRemove(i)}>×</button>
          </div>
        ) : (
          <div key={f.id} className="file-chip">
            <FileIcon />
            <span className="file-chip__name" title={f.name}>{f.name}</span>
            <button type="button" className="file-chip__remove" onClick={() => onRemove(i)}>×</button>
          </div>
        )
      )}
    </div>
  );
}

// Display of posted attachments: image thumbnails link to the full image; other
// files are download links (the server forces a safe download for those).
export function AttachmentList({ items }: { items: AttachmentRef[] }) {
  if (items.length === 0) return null;
  return (
    <div className="thumb-row">
      {items.map((it) =>
        isImage(it.mime, it.url) ? (
          <div key={it.id} className="thumb">
            <a href={assetUrl(it.url)} target="_blank" rel="noreferrer">
              <img src={assetUrl(it.url)} alt={it.name ?? "attachment"} />
            </a>
          </div>
        ) : (
          <a
            key={it.id}
            className="file-chip file-chip--link"
            href={assetUrl(it.url)}
            target="_blank"
            rel="noreferrer"
            download={it.name ?? undefined}
          >
            <FileIcon />
            <span className="file-chip__name" title={it.name ?? "file"}>{it.name ?? "Download file"}</span>
          </a>
        )
      )}
    </div>
  );
}

// A translucent "Drop files here" overlay, shown while a file drag is over the
// dropzone. Render inside a position:relative container that has dropzoneProps.
export function DropOverlay({ show, max }: { show: boolean; max: number }) {
  if (!show) return null;
  return (
    <div className="drop-overlay" aria-hidden="true">
      Drop files to attach (up to {max})
    </div>
  );
}
