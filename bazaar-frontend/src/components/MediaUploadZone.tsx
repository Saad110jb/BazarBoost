"use client";
/**
 * MediaUploadZone
 *
 * Self-contained drag-and-drop image upload section.
 * Designed to be inserted between the Stock fields and the AI Auto-Tagging
 * box inside the Add New Product modal.
 *
 * Features:
 *   • Drag-over visual state (border turns solid purple, glow ring)
 *   • Multi-file selection (up to 8 images)
 *   • Instant local preview thumbnails via URL.createObjectURL()
 *   • Per-thumbnail "×" delete button (visible on hover)
 *   • Click-to-set-primary (one active primary at a time, shown with ★ badge)
 *   • "Set as Primary" purple overlay on non-primary thumbs on hover
 *   • File validation: only JPG/PNG/WebP, max 5 MB each
 *   • Error state resets the drop zone border to red
 */

import { useRef, useState, useCallback } from "react";
import { UploadCloud, X, Star, Image as ImageIcon, AlertCircle } from "lucide-react";

export interface PreviewImage {
  file: File;
  previewUrl: string;
  isPrimary: boolean;
}

interface Props {
  images: PreviewImage[];
  onChange: (images: PreviewImage[]) => void;
  maxFiles?: number;
  maxSizeMB?: number;
}

const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const DEFAULT_MAX   = 8;
const DEFAULT_MB    = 5;

export default function MediaUploadZone({
  images,
  onChange,
  maxFiles = DEFAULT_MAX,
  maxSizeMB = DEFAULT_MB,
}: Props) {
  const inputRef    = useRef<HTMLInputElement>(null);
  const [dragging, setDragging]   = useState(false);
  const [error,    setError]      = useState("");

  // ── Validation ─────────────────────────────────────────────────────────────
  const validate = (files: File[]): { valid: File[]; errors: string[] } => {
    const valid: File[] = [];
    const errors: string[] = [];
    for (const f of files) {
      if (!ALLOWED_TYPES.includes(f.type)) {
        errors.push(`"${f.name}" is not an accepted image type (JPG, PNG, WebP).`);
      } else if (f.size > maxSizeMB * 1024 * 1024) {
        errors.push(`"${f.name}" exceeds the ${maxSizeMB} MB limit.`);
      } else {
        valid.push(f);
      }
    }
    return { valid, errors };
  };

  // ── Merge new files into the preview list ───────────────────────────────────
  const mergeFiles = useCallback(
    (newFiles: File[]) => {
      setError("");
      const { valid, errors } = validate(newFiles);
      if (errors.length) {
        setError(errors[0]);
        return;
      }

      const remaining = maxFiles - images.length;
      if (valid.length > remaining) {
        setError(`Maximum ${maxFiles} images allowed. Only ${remaining} slot(s) left.`);
        valid.splice(remaining);
        if (valid.length === 0) return;
      }

      const newPreviews: PreviewImage[] = valid.map((file, idx) => ({
        file,
        previewUrl: URL.createObjectURL(file),
        isPrimary:  images.length === 0 && idx === 0, // auto-primary if list was empty
      }));

      const merged = [...images, ...newPreviews];

      // Ensure there is always exactly one primary
      const hasPrimary = merged.some((img) => img.isPrimary);
      if (!hasPrimary && merged.length > 0) merged[0].isPrimary = true;

      onChange(merged);
    },
    [images, maxFiles, onChange]
  );

  // ── Delete a thumbnail ──────────────────────────────────────────────────────
  const deleteImage = (idx: number) => {
    const next = images.filter((_, i) => i !== idx);
    // Revoke the object URL to avoid memory leaks
    URL.revokeObjectURL(images[idx].previewUrl);
    // If the deleted item was primary, promote the new first
    if (images[idx].isPrimary && next.length > 0) next[0].isPrimary = true;
    onChange(next);
    setError("");
  };

  // ── Set a thumbnail as primary ──────────────────────────────────────────────
  const setPrimary = (idx: number) => {
    const next = images.map((img, i) => ({ ...img, isPrimary: i === idx }));
    onChange(next);
  };

  // ── Drag handlers ───────────────────────────────────────────────────────────
  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setDragging(true);  };
  const onDragLeave = ()                    => setDragging(false);
  const onDrop      = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    mergeFiles(Array.from(e.dataTransfer.files));
  };
  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) mergeFiles(Array.from(e.target.files));
    e.target.value = ""; // reset so the same file can be re-added after deletion
  };

  const slotsFull = images.length >= maxFiles;

  return (
    <div>
      {/* Label row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <ImageIcon size={13} style={{ color: "#a855f7" }} />
          Product Media
        </label>
        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
          {images.length}/{maxFiles} images · max {maxSizeMB} MB each
        </span>
      </div>

      {/* Drop Zone */}
      {!slotsFull && (
        <div
          id="media-drop-zone"
          className={`upload-zone${dragging ? " drag-over" : ""}${error ? " has-error" : ""}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Upload product images"
          onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={onFileInput}
            tabIndex={-1}
          />

          {/* Zone content */}
          <div style={{ pointerEvents: "none" }}>
            <div style={{
              width: 44, height: 44, borderRadius: "50%",
              background: dragging ? "rgba(124,58,237,0.18)" : "rgba(124,58,237,0.08)",
              border: `1.5px solid rgba(124,58,237,${dragging ? "0.5" : "0.2"})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 0.75rem",
              transition: "all 0.2s",
            }}>
              <UploadCloud size={22} style={{ color: dragging ? "#a855f7" : "var(--text-muted)", transition: "color 0.2s" }} />
            </div>

            <p style={{ fontSize: "0.85rem", fontWeight: 600, color: dragging ? "#a855f7" : "var(--text-secondary)", marginBottom: "0.25rem", transition: "color 0.2s" }}>
              {dragging ? "Release to upload" : "Drag & drop images here"}
            </p>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              or <span style={{ color: "#a855f7", fontWeight: 600 }}>browse files</span>
              &nbsp;· JPG, PNG, WebP · up to {maxFiles} images
            </p>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div style={{
          display: "flex", alignItems: "center", gap: "0.4rem",
          marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--danger)"
        }}>
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {/* Thumbnail Preview Grid */}
      {images.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.75rem", marginBottom: "0.4rem" }}>
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
              Click a thumbnail to set as <span style={{ color: "#a855f7", fontWeight: 700 }}>★ Primary</span> (shown first on storefront)
            </span>
          </div>

          <div className="image-preview-grid">
            {images.map((img, i) => (
              <div
                key={img.previewUrl}
                id={`preview-thumb-${i}`}
                className={`image-preview-item${img.isPrimary ? " is-primary" : ""}`}
                onClick={() => !img.isPrimary && setPrimary(i)}
                title={img.isPrimary ? "Primary thumbnail" : "Click to set as primary"}
              >
                {/* Thumbnail image */}
                <img
                  src={img.previewUrl}
                  alt={`Product preview ${i + 1}`}
                  draggable={false}
                />

                {/* Set-as-primary hover overlay (non-primary only) */}
                {!img.isPrimary && (
                  <div className="preview-set-primary-overlay">
                    Set as Primary
                  </div>
                )}

                {/* Primary badge */}
                {img.isPrimary && (
                  <div className="preview-primary-badge">
                    ★ Primary
                  </div>
                )}

                {/* Delete ×  button */}
                <button
                  id={`preview-delete-${i}`}
                  className="preview-delete-btn"
                  onClick={(e) => { e.stopPropagation(); deleteImage(i); }}
                  aria-label={`Remove image ${i + 1}`}
                  title="Remove image"
                >
                  <X size={10} />
                </button>
              </div>
            ))}

            {/* "Add more" slot if there's still capacity */}
            {!slotsFull && (
              <div
                className="image-preview-item"
                style={{ border: "2px dashed var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "0.25rem", cursor: "pointer" }}
                onClick={() => inputRef.current?.click()}
                title={`Add more images (${maxFiles - images.length} remaining)`}
              >
                <span style={{ fontSize: "1.3rem", color: "var(--text-muted)", lineHeight: 1 }}>+</span>
                <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", textAlign: "center", lineHeight: 1.3 }}>
                  {maxFiles - images.length} left
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
