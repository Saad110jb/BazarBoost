/**
 * Product Images Route
 *
 * Handles multi-image upload, primary flag management, reordering,
 * and deletion for product image arrays.
 *
 * All writes enforce the schema rules:
 *   • exactly one isPrimary=true per product
 *   • images stored under /uploads/stores/:storeId/products/
 *   • displayOrder values are normalised (0-based, no gaps) after mutations
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_UPLOAD_DIR = path.join(__dirname, '../uploads');
import Product from '../models/Product.js';
import { protect } from '../middleware/auth.js';
import { uploadProductImages } from '../middleware/upload.js';
import { verifyTenantAccess } from '../middleware/rbac.js';
import { extractProductForeground } from '../services/aiImageService.js';

const router = express.Router({ mergeParams: true }); // inherits :productId from parent

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Build the public-facing URL from the local file path
// ─────────────────────────────────────────────────────────────────────────────
const toPublicUrl = (filePath) =>
  '/' + filePath.replace(/\\/g, '/').replace(/^\.\//, '');

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Re-normalise displayOrder values after any array mutation.
// Sorts existing images by their current displayOrder, then reassigns
// sequential 0-based integers so there are never gaps or duplicates.
// ─────────────────────────────────────────────────────────────────────────────
const normaliseOrder = (images) => {
  images
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .forEach((img, idx) => {
      img.displayOrder = idx;
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Verify the authenticated vendor owns the product
// ─────────────────────────────────────────────────────────────────────────────
const assertOwnership = (product, userId) => {
  if (product.vendorId.toString() !== userId.toString()) {
    const err = new Error('Not authorised to modify this product');
    err.status = 403;
    throw err;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc    GET all images for a product (with primary/gallery split)
// @route   GET /api/products/:productId/images
// @access  Public
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId).select('images title');
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const sorted = product.images.slice().sort((a, b) => a.displayOrder - b.displayOrder);
    const primary = sorted.find((img) => img.isPrimary) || sorted[0] || null;
    const gallery = sorted.filter((img) => !img.isPrimary);

    res.json({
      success: true,
      total:   sorted.length,
      primary,
      gallery,
      all:     sorted,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Upload one or more images to a product
//          Files are stored at /uploads/stores/:storeId/products/<filename>
//          The first uploaded image is auto-marked isPrimary if no images exist.
//          Subsequent uploads default to gallery (isPrimary=false).
// @route   POST /api/products/:productId/images
// @access  Private (Vendor — must own the product)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/',
  protect,
  verifyTenantAccess,
  uploadProductImages.array('images', 8),
  async (req, res) => {
    try {
      const product = await Product.findById(req.params.productId);
      if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found' });
      }
      assertOwnership(product, req.user._id);

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: 'No image files received' });
      }

      // Determine the next displayOrder position based on existing images
      const currentMaxOrder = product.images.reduce(
        (max, img) => Math.max(max, img.displayOrder),
        -1
      );

      // Determine if we need to auto-set a primary (no existing primary)
      const hasExistingPrimary = product.images.some((img) => img.isPrimary);

      const storeId = req.user.activeStoreId || req.user.storeId || product.storeId.toString();

      const newImages = [];
      let index = 0;
      for (const file of req.files) {
        // Run simulated local AI background removal container
        const processedUrl = await extractProductForeground(file.path, storeId);
        
        const isFirst = index === 0 && !hasExistingPrimary;
        newImages.push({
          url:          processedUrl,
          isPrimary:    isFirst,          // First upload is primary only if none exists
          displayOrder: currentMaxOrder + 1 + index,
          altText:      req.body.altText || product.title,
          uploadedAt:   new Date(),
        });
        index++;
      }

      product.images.push(...newImages);
      normaliseOrder(product.images);    // tighten order after push
      await product.save();              // pre-save hook re-validates isPrimary count

      // Broadcast real-time image sync event to dashboards
      if (global.io) {
        global.io.to(`store:${product.storeId.toString()}`).emit('product_image_synced', {
          productId: product._id.toString(),
          images: product.images
        });
      }

      res.status(201).json({
        success: true,
        message: `${newImages.length} image(s) uploaded and processed successfully`,
        uploaded: newImages,
        total:    product.images.length,
      });
    } catch (error) {
      if (error.status === 403) {
        return res.status(403).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Promote an image to primary (thumbnail) — demotes all others
// @route   PUT /api/products/:productId/images/:imageId/primary
// @access  Private (Vendor)
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:imageId/primary', protect, verifyTenantAccess, async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    assertOwnership(product, req.user._id);

    const targetImage = product.images.id(req.params.imageId);
    if (!targetImage) {
      return res.status(404).json({ success: false, message: 'Image not found in this product' });
    }

    // Demote ALL images first (clean slate)
    product.images.forEach((img) => { img.isPrimary = false; });

    // Promote the target
    targetImage.isPrimary    = true;
    targetImage.displayOrder = 0; // Primary is always the first in visual sequence

    // Push all other images down by 1 in displayOrder
    product.images
      .filter((img) => img._id.toString() !== req.params.imageId)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .forEach((img, idx) => { img.displayOrder = idx + 1; });

    await product.save();

    res.json({
      success: true,
      message: `Image promoted to primary thumbnail`,
      primary: targetImage,
      gallery: product.images.filter((img) => !img.isPrimary),
    });
  } catch (error) {
    if (error.status === 403) {
      return res.status(403).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Reorder gallery images by providing an ordered array of imageIds
//          The primary image is always kept at displayOrder=0 and excluded.
// @route   PUT /api/products/:productId/images/reorder
// @access  Private (Vendor)
// Body:    { orderedIds: ["imageId1", "imageId2", "imageId3", ...] }
// ─────────────────────────────────────────────────────────────────────────────
router.put('/reorder', protect, verifyTenantAccess, async (req, res) => {
  const { orderedIds } = req.body;

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'orderedIds must be a non-empty array of image IDs',
    });
  }

  try {
    const product = await Product.findById(req.params.productId);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    assertOwnership(product, req.user._id);

    // Validate that all supplied IDs actually exist on this product
    const productImageIds = product.images.map((img) => img._id.toString());
    const invalid = orderedIds.filter((id) => !productImageIds.includes(id));
    if (invalid.length > 0) {
      return res.status(400).json({
        success: false,
        message: `These image IDs do not belong to this product: ${invalid.join(', ')}`,
      });
    }

    // Keep primary at 0; assign gallery images the positions from orderedIds (1-based)
    const primary = product.images.find((img) => img.isPrimary);
    if (primary) primary.displayOrder = 0;

    orderedIds.forEach((id, idx) => {
      const img = product.images.id(id);
      if (img && !img.isPrimary) {
        img.displayOrder = idx + 1; // start at 1; 0 is reserved for primary
      }
    });

    await product.save();

    const sorted = product.images.slice().sort((a, b) => a.displayOrder - b.displayOrder);
    res.json({
      success: true,
      message: 'Gallery reordered successfully',
      images:  sorted,
    });
  } catch (error) {
    if (error.status === 403) {
      return res.status(403).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Update altText for a specific image
// @route   PATCH /api/products/:productId/images/:imageId
// @access  Private (Vendor)
// Body:    { altText: "Blue variant from the left angle" }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:imageId', protect, verifyTenantAccess, async (req, res) => {
  const { altText } = req.body;

  try {
    const product = await Product.findById(req.params.productId);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    assertOwnership(product, req.user._id);

    const image = product.images.id(req.params.imageId);
    if (!image) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }

    if (altText !== undefined) image.altText = altText.slice(0, 200); // enforce maxlength
    await product.save();

    res.json({ success: true, message: 'Image metadata updated', image });
  } catch (error) {
    if (error.status === 403) {
      return res.status(403).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Delete a specific image from a product
//          Removes the physical file and the array entry.
//          If the deleted image was primary, auto-promotes the next image.
// @route   DELETE /api/products/:productId/images/:imageId
// @access  Private (Vendor)
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:imageId', protect, verifyTenantAccess, async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    assertOwnership(product, req.user._id);

    const image = product.images.id(req.params.imageId);
    if (!image) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }

    const wasPrimary = image.isPrimary;

    // Delete physical file from disk (non-blocking; log error but don't fail the request)
    const urlPath = image.url.startsWith('/') ? image.url.substring(1) : image.url;
    const relativeFromUploads = urlPath.startsWith('uploads/') ? urlPath.substring('uploads/'.length) : urlPath;
    const physicalPath = path.join(BASE_UPLOAD_DIR, relativeFromUploads);
    fs.unlink(physicalPath, (err) => {
      if (err) {
        console.warn(`[ProductImages] Could not delete physical file "${physicalPath}": ${err.message}`);
      }
    });

    // Remove the sub-document from the array
    product.images.pull({ _id: req.params.imageId });

    // If the removed image was primary, promote the new first image (if any exist)
    if (wasPrimary && product.images.length > 0) {
      normaliseOrder(product.images);
      product.images[0].isPrimary = true;
      console.log(`[ProductImages] Primary deleted — auto-promoted new primary for "${product.title}"`);
    } else {
      normaliseOrder(product.images);
    }

    await product.save();

    res.json({
      success: true,
      message: wasPrimary && product.images.length > 0
        ? 'Primary image deleted. Next image auto-promoted to primary.'
        : 'Image deleted successfully.',
      remaining: product.images.length,
    });
  } catch (error) {
    if (error.status === 403) {
      return res.status(403).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
