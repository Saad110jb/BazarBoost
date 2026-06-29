/**
 * BazaarBoost Upload Middleware
 *
 * Provides two named multer instances, each enforcing a strict directory
 * naming architecture that isolates files by tenant and purpose:
 *
 *   PRODUCT IMAGES:
 *     /uploads/stores/:storeId/products/<timestamp>-<random>.<ext>
 *     → Tenant-scoped: a vendor can never overwrite another store's files
 *     → Category-scoped: product images are always separated from receipts
 *
 *   PAYMENT RECEIPTS:
 *     /uploads/stores/:storeId/receipts/<timestamp>-<random>.<ext>
 *     → Per-store isolation for OCR processing and admin review
 *     → Flat (no product sub-folder) since receipts are order/bid level
 *
 * Usage in routes:
 *   import { uploadProductImages, uploadReceipt } from '../middleware/upload.js';
 *
 *   router.post('/products/:id/images', protect, uploadProductImages.array('images', 8), handler);
 *   router.post('/ads/bid',             protect, uploadReceipt.single('receipt'),         handler);
 */

import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// Shared constants
// ─────────────────────────────────────────────────────────────────────────────
const BASE_UPLOAD_DIR = path.join(__dirname, '../uploads');
const ALLOWED_MIME_TYPES = /jpeg|jpg|png|webp/i;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB per file

// ─────────────────────────────────────────────────────────────────────────────
// Helper: deterministic, timestamp-prefixed filename (no collisions)
// ─────────────────────────────────────────────────────────────────────────────
const buildFilename = (file) => {
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  return uniqueSuffix + path.extname(file.originalname).toLowerCase();
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: ensure a directory tree exists before multer tries to write to it
// ─────────────────────────────────────────────────────────────────────────────
const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared file filter — rejects non-image MIME types with a clear error message
// ─────────────────────────────────────────────────────────────────────────────
const imageFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || '');
  // If an extension is present, validate it. Otherwise, rely on the MIME type check.
  const extOk  = ext ? ALLOWED_MIME_TYPES.test(ext) : true;
  const mimeOk = ALLOWED_MIME_TYPES.test(file.mimetype);

  if (extOk && mimeOk) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `File type rejected: "${file.mimetype}". Only JPG, JPEG, PNG, and WebP images are accepted.`
      )
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Storage A: Tenant-Scoped Product Images
//
// Directory convention:
//   /uploads/stores/<storeId>/products/<filename>
//
// storeId is read from req.user.storeId (set by the protect middleware).
// Falls back to 'unknown' if the middleware chain is misconfigured — this
// should never reach production but prevents a silent write to a shared root.
// ─────────────────────────────────────────────────────────────────────────────
const productImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const storeId = req.user?.storeId?.toString() || 'unknown';
    const dir = ensureDir(
      path.join(BASE_UPLOAD_DIR, 'stores', storeId, 'products')
    );
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, buildFilename(file));
  },
});

export const uploadProductImages = multer({
  storage:    productImageStorage,
  limits:     {
    fileSize: MAX_FILE_SIZE_BYTES,
    files:    8,                   // max 8 images per product upload request
  },
  fileFilter: imageFileFilter,
});

// ─────────────────────────────────────────────────────────────────────────────
// Storage B: Tenant-Scoped Payment Receipts
//
// Directory convention:
//   /uploads/stores/<storeId>/receipts/<filename>
//
// Receipts are intentionally stored separately from product images so that:
//   • The OCR service path is predictable and isolated
//   • Admin reviewers can browse per-store receipt folders
//   • A future S3 lifecycle rule can archive/delete receipts independently
// ─────────────────────────────────────────────────────────────────────────────
const receiptStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const storeId = req.user?.storeId?.toString() || 'unknown';
    const dir = ensureDir(
      path.join(BASE_UPLOAD_DIR, 'stores', storeId, 'receipts')
    );
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, buildFilename(file));
  },
});

export const uploadReceipt = multer({
  storage:    receiptStorage,
  limits:     { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  fileFilter: imageFileFilter,
});

// ─────────────────────────────────────────────────────────────────────────────
// Storage C: Store Assets (logo / banner)
//
// Directory convention:
//   /uploads/stores/<storeId>/assets/<filename>
// ─────────────────────────────────────────────────────────────────────────────
const storeAssetStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const storeId = req.user?.activeStoreId?.toString() || req.user?.storeId?.toString() || 'unknown';
    const dir = ensureDir(
      path.join(BASE_UPLOAD_DIR, 'stores', storeId, 'assets')
    );
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Prefix with field name so logo and banner are distinguishable at a glance
    cb(null, `${file.fieldname}-${buildFilename(file)}`);
  },
});

export const uploadStoreAssets = multer({
  storage:    storeAssetStorage,
  limits:     { fileSize: MAX_FILE_SIZE_BYTES, files: 2 },
  fileFilter: imageFileFilter,
});

const complaintStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = ensureDir(
      path.join(BASE_UPLOAD_DIR, 'complaints')
    );
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, buildFilename(file));
  },
});

export const uploadComplaintEvidence = multer({
  storage:    complaintStorage,
  limits:     { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  fileFilter: imageFileFilter,
});


// ─────────────────────────────────────────────────────────────────────────────
// Legacy default export — kept for backward compatibility with existing routes
// that import `upload` directly. Maps to the receipt uploader since that was
// the original use-case of the generic upload middleware.
// ─────────────────────────────────────────────────────────────────────────────
export default uploadReceipt;
