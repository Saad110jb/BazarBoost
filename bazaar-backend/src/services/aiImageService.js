import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_UPLOAD_DIR = path.join(__dirname, '../uploads');

// Helper to convert absolute or relative file path to public URL starting with /uploads
const toPublicUrl = (filePath) => {
  const normalized = filePath.replace(/\\/g, '/');
  const uploadsIdx = normalized.indexOf('uploads/');
  return uploadsIdx !== -1 ? '/' + normalized.substring(uploadsIdx) : '/' + normalized.replace(/^\.\//, '');
};

/**
 * Simulates a locally hosted ML image segmentation pipeline.
 * Intercepts messy smartphone uploads, isolates the foreground product item,
 * converts the background to transparent, exports a web-optimized PNG,
 * and deletes the raw smartphone upload file.
 * 
 * @param {string} rawFilePath - Absolute/relative path to the original raw uploaded file
 * @param {string} storeId - Tenant Store ID for directory scoping
 * @returns {Promise<string>} - Public url path of the background-removed PNG file
 */
export const extractProductForeground = async (rawFilePath, storeId) => {
  console.log(`[AI Foreground Isolation] Intercepted raw photo: "${rawFilePath}" for Store: ${storeId}`);
  
  // 1. Simulate ML container inference delay
  await new Promise(resolve => setTimeout(resolve, 600));

  try {
    if (!fs.existsSync(rawFilePath)) {
      throw new Error(`Original raw file not found at: ${rawFilePath}`);
    }

    const fileExt = path.extname(rawFilePath);
    const baseName = path.basename(rawFilePath, fileExt);

    // 2. Generate sanitized timestamp naming convention for transparent PNG export
    const cleanPngName = `bgremoved-${baseName}-${Date.now()}.png`;

    // 3. Ensure the dedicated tenant product storage directory exists
    const storeProductsDir = path.join(BASE_UPLOAD_DIR, 'stores', storeId, 'products');
    if (!fs.existsSync(storeProductsDir)) {
      fs.mkdirSync(storeProductsDir, { recursive: true });
    }

    const pngDestPath = path.join(storeProductsDir, cleanPngName);

    // 4. Convert isolated product output to PNG
    // Copy the original binary contents to the PNG path (simulating high-contrast object isolation)
    fs.copyFileSync(rawFilePath, pngDestPath);
    console.log(`[AI Foreground Isolation] Isolated foreground and exported PNG: "${pngDestPath}"`);

    // 5. Delete raw messy smartphone upload to preserve server storage
    fs.unlinkSync(rawFilePath);
    console.log(`[AI Foreground Isolation] Cleaned up messy raw file: "${rawFilePath}"`);

    // 6. Convert file system path to public relative URL format
    const publicUrl = toPublicUrl(pngDestPath);
    return publicUrl;
  } catch (error) {
    console.error(`[AI Foreground Isolation Error] Background removal failed:`, error.message);
    
    // Graceful fallback: if processing fails, return the original raw file URL if it still exists
    const fallbackUrl = toPublicUrl(rawFilePath);
    return fallbackUrl;
  }
};
