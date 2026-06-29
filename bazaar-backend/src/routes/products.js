import express from 'express';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import Store from '../models/Store.js';
import AdBid from '../models/AdBid.js';
import { protect } from '../middleware/auth.js';
import { generateProductTags } from '../services/taggingService.js';
import { getProductEmbedding, getRecommendations, calculateCosineSimilarity } from '../services/recommendationService.js';
import productImagesRouter from './productImages.js'; // Multi-image management sub-router

import { verifyTenantAccess, requirePermission } from '../middleware/rbac.js';
import { logActivity } from '../services/auditService.js';

const router = express.Router();

// Mount the images sub-router — handles all /api/products/:productId/images/* endpoints
router.use('/:productId/images', productImagesRouter);

router.get('/', async (req, res) => {
  try {
    const products = await Product.find({ isDeleted: { $ne: true } }).populate('storeId', 'name slug isActive productVisibilityLimited');
    const visibleProducts = products.filter(p => p.storeId && p.storeId.isActive !== false && p.storeId.productVisibilityLimited !== true);
    res.json({ success: true, count: visibleProducts.length, products: visibleProducts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Export catalog metrics with sales/ad spend aggregations
// @route   GET /api/products/store/:storeId/export
// @access  Private (Vendor or Store Admin)
router.get('/store/:storeId/export', protect, verifyTenantAccess, async (req, res) => {
  try {
    const { limit, offset } = req.query;
    const storeId = req.params.storeId;

    // Find all products for the store (not deleted)
    let query = Product.find({ storeId, isDeleted: { $ne: true } });
    
    // Support offset parameters for pagination
    if (offset !== undefined) {
      query = query.skip(parseInt(offset, 10) || 0);
    }
    if (limit !== undefined) {
      query = query.limit(parseInt(limit, 10) || 0);
    }

    const products = await query.lean();

    // Aggregations:
    // 1. Total Units Sold & Gross Revenue per product from completed orders
    const completedOrders = await Order.find({ storeId, status: 'completed' }).lean();
    
    // 2. Cumulative Ad Spend per product from approved bids
    const store = await Store.findById(storeId).select('vendorId').lean();
    const vendorId = store?.vendorId;
    const adBids = await AdBid.find({ vendorId, paymentStatus: 'approved' }).lean();

    const toPKR = (v) => Math.round(parseFloat(v) * 100) / 100;

    // Map metrics for each product
    const metrics = products.map(product => {
      const prodIdStr = product._id.toString();

      // Total units sold & revenue
      let totalUnitsSold = 0;
      let grossRevenue = 0;
      completedOrders.forEach(order => {
        (order.items || []).forEach(item => {
          if (item.productId && item.productId.toString() === prodIdStr) {
            totalUnitsSold += item.quantity || 0;
            grossRevenue += (item.price || 0) * (item.quantity || 0);
          }
        });
      });

      // Cumulative ad wallet budget spent
      let cumulativeAdSpend = 0;
      adBids.forEach(bid => {
        if (bid.productId && bid.productId.toString() === prodIdStr) {
          cumulativeAdSpend += bid.bidAmount || 0;
        }
      });

      const liveStockStatus = product.stock === 0 
        ? 'Out of Stock' 
        : product.stock < 5 
          ? 'Low Stock' 
          : 'In Stock';

      return {
        productId: prodIdStr,
        name: product.title,
        liveStockStatus,
        stock: product.stock,
        basePrice: product.price,
        totalUnitsSold,
        grossRevenueContributed: toPKR(grossRevenue),
        cumulativeAdWalletBudgetSpent: toPKR(cumulativeAdSpend)
      };
    });

    res.json({ success: true, count: metrics.length, metrics });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get products by store ID
// @route   GET /api/products/store/:storeId
// @access  Public
router.get('/store/:storeId', async (req, res) => {
  try {
    const products = await Product.find({ storeId: req.params.storeId, isDeleted: { $ne: true } }).populate('storeId', 'name slug isActive productVisibilityLimited');
    const visibleProducts = products.filter(p => p.storeId && p.storeId.isActive !== false && p.storeId.productVisibilityLimited !== true);
    res.json({ success: true, count: visibleProducts.length, products: visibleProducts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Full Search Recommendation System (Semantic + Autocomplete + Personalized)
// @route   GET /api/products/search/recommendations
// @access  Public (Optional Auth for Personalization)
router.get('/search/recommendations', async (req, res) => {
  const { q = '', limit = '10' } = req.query;
  const limitNum = parseInt(limit, 10) || 10;
  const queryStr = q.trim().toLowerCase();

  try {
    // 1. Fetch all visible products and active stores
    const allStores = await Store.find({ isActive: true, productVisibilityLimited: { $ne: true } }).select('name slug logo');
    const storeMap = {};
    allStores.forEach(s => { storeMap[s._id.toString()] = s; });

    const allProducts = await Product.find({ isDeleted: { $ne: true } }).lean();
    const visibleProducts = allProducts.filter(p => storeMap[p.storeId?.toString()]);

    let rankedProducts = [];
    let matchingStores = [];
    let matchingTags = [];
    let autocomplete = [];

    // 2. Matching Stores
    if (queryStr) {
      matchingStores = allStores.filter(s => 
        s.name.toLowerCase().includes(queryStr) || 
        s.slug.toLowerCase().includes(queryStr)
      ).slice(0, 3);
    }

    // 3. Autocomplete suggestions & matching tags
    const tagsSet = new Set();
    const suggestionsSet = new Set();

    visibleProducts.forEach(p => {
      // Collect tags
      (p.aiTags || []).forEach(t => {
        if (t.toLowerCase().includes(queryStr)) {
          tagsSet.add(t);
        }
      });
      
      // Auto-suggestions based on matching titles
      if (p.title.toLowerCase().includes(queryStr)) {
        suggestionsSet.add(p.title);
      }
    });

    matchingTags = Array.from(tagsSet).slice(0, 5);
    autocomplete = Array.from(suggestionsSet).slice(0, 6);

    // 4. Semantic Vector Search + Keyword matching
    if (queryStr) {
      // Generate Dense Vector Embedding for the search query
      const queryVector = await getProductEmbedding(queryStr);

      const scored = visibleProducts.map(p => {
        let semanticScore = 0;
        let keywordScore = 0;

        // Semantic calculation
        if (queryVector && queryVector.length > 0 && p.embedding && p.embedding.length > 0) {
          semanticScore = calculateCosineSimilarity(queryVector, p.embedding);
        }

        // Keyword calculations (Exact title matches and substring boosts)
        const titleLower = p.title.toLowerCase();
        const descLower = p.description ? p.description.toLowerCase() : '';
        const tagsLower = (p.aiTags || []).map(t => t.toLowerCase());

        if (titleLower.includes(queryStr)) {
          keywordScore += 0.5;
          if (titleLower.startsWith(queryStr)) keywordScore += 0.3; // start-of-title boost
        }
        if (descLower.includes(queryStr)) {
          keywordScore += 0.2;
        }
        if (tagsLower.some(t => t.includes(queryStr))) {
          keywordScore += 0.3;
        }

        // Final composite relevancy rank
        const compositeScore = (semanticScore * 0.6) + (keywordScore * 0.4);

        return { product: p, score: compositeScore };
      });

      // Sort descending
      rankedProducts = scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limitNum)
        .map(item => ({
          ...item.product,
          storeId: storeMap[item.product.storeId.toString()], // populate manually
          searchRelevanceScore: Math.round(item.score * 100)
        }));
    } else {
      // If no query, return top products
      rankedProducts = visibleProducts
        .slice(0, limitNum)
        .map(p => ({
          ...p,
          storeId: storeMap[p.storeId.toString()]
        }));
    }

    // 5. Personalized Recommendations (if shopper token is present)
    let personalized = [];
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const jwt = (await import('jsonwebtoken')).default;
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'bazaar_secret');
        if (decoded && decoded.id) {
          const ShopperProfile = (await import('../models/ShopperProfile.js')).default;
          const shopperProfile = await ShopperProfile.findOne({ userId: decoded.id }).lean();
          
          if (shopperProfile && shopperProfile.cart && shopperProfile.cart.length > 0) {
            const cartProductIds = shopperProfile.cart.map(c => c.productId?.toString());
            const targetProd = visibleProducts.find(p => cartProductIds.includes(p._id.toString()));
            if (targetProd) {
              personalized = getRecommendations(targetProd, visibleProducts, 5, 'paired')
                .map(p => ({ ...p, storeId: storeMap[p.storeId.toString()] }));
            }
          }
        }
      } catch (err) {
        console.log('[Search recommendations personalization skipped]', err.message);
      }
    }

    if (personalized.length === 0 && visibleProducts.length > 0) {
      personalized = visibleProducts
        .slice(0, 5)
        .map(p => ({ ...p, storeId: storeMap[p.storeId.toString()] }));
    }

    res.json({
      success: true,
      query: q,
      products: rankedProducts,
      stores: matchingStores,
      tags: matchingTags,
      autocomplete,
      personalized
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate('storeId', 'name slug bankDetails');
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Create a product (Vendor / Store Admin with EDIT_INVENTORY)
// @route   POST /api/products
// @access  Private
router.post('/', protect, verifyTenantAccess, requirePermission('EDIT_INVENTORY'), async (req, res) => {
  if (req.user.role !== 'vendor' && req.user.role !== 'storeAdmin') {
    return res.status(403).json({ success: false, message: 'Only vendors or authorized store staff can create products' });
  }

  const { title, description, price, stock, images } = req.body;

  if (!title || !description || price === undefined) {
    return res.status(400).json({ success: false, message: 'Product title, description, and price are required' });
  }

  try {
    // 1. Run local AI classification to auto-tag product
    console.log(`Auto-tagging product: "${title}"`);
    const aiTags = await generateProductTags(title, description);
    
    // 2. Generate local dense vector embedding for recommendations
    console.log(`Generating embedding for: "${title}"`);
    const combinedText = `${title}. ${description}. Tags: ${aiTags.join(', ')}`;
    const embedding = await getProductEmbedding(combinedText);

    // 3. Create the database record
    const product = await Product.create({
      storeId: req.user.activeStoreId,
      vendorId: req.user._id,
      title,
      description,
      price,
      stock: stock || 10,
      stockBalance: stock || 10,
      status: 'ACTIVE',
      images: images || [],
      aiTags,
      embedding,
    });

    res.status(201).json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get recommendations for a product
// @route   GET /api/products/:id/recommendations
// @access  Public
router.get('/:id/recommendations', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const { strategy = 'viewed', limit = 4 } = req.query;
    const limitNum = parseInt(limit, 10) || 4;

    const allProducts = await Product.find({ isDeleted: { $ne: true } });
    // Compute local recommendations using embeddings / cosine similarity and specified strategy
    const recommendations = getRecommendations(product, allProducts, limitNum, strategy);

    res.json({ success: true, count: recommendations.length, recommendations });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Bulk update products (Vendor / Store Admin with EDIT_INVENTORY)
// @route   PUT /api/products/bulk
// @access  Private
router.put('/bulk', protect, verifyTenantAccess, requirePermission('EDIT_INVENTORY'), async (req, res) => {
  const { updates } = req.body;
  if (!Array.isArray(updates)) {
    return res.status(400).json({ success: false, message: 'Updates must be an array of product modifications' });
  }

  try {
    const updatedProducts = [];
    const userStoreId = req.user.activeStoreId || req.user.storeId;

    for (const update of updates) {
      if (!update._id) continue;
      const product = await Product.findById(update._id);
      if (!product) continue;

      // Enforce strict tenant store boundary isolation
      if (product.storeId.toString() !== userStoreId.toString()) {
        continue;
      }

      if (update.title !== undefined && update.title !== product.title) {
        const oldTitle = product.title;
        product.title = update.title;
        await logActivity(product.storeId, req.user._id, req.user.name, 'PRODUCT_UPDATE', `Changed product title from "${oldTitle}" to "${product.title}".`);
      }
      if (update.price !== undefined && parseFloat(update.price) !== product.price) {
        const oldPrice = product.price;
        product.price = parseFloat(update.price);
        await logActivity(product.storeId, req.user._id, req.user.name, 'PRODUCT_UPDATE', `Changed "${product.title}" price from Rs. ${oldPrice} to Rs. ${product.price}.`);
      }
      if (update.stock !== undefined && parseInt(update.stock) !== product.stock) {
        const oldStock = product.stock;
        product.stock = parseInt(update.stock);
        await logActivity(product.storeId, req.user._id, req.user.name, 'PRODUCT_UPDATE', `Changed "${product.title}" stock from ${oldStock} to ${product.stock}.`);
      }
      if (update.variantSpecs !== undefined && update.variantSpecs !== product.variantSpecs) {
        const oldSpecs = product.variantSpecs || 'None';
        product.variantSpecs = update.variantSpecs;
        await logActivity(product.storeId, req.user._id, req.user.name, 'PRODUCT_UPDATE', `Changed "${product.title}" variant specifications from "${oldSpecs}" to "${product.variantSpecs}".`);
      }

      await product.save(); // Triggers pre-save (isLowStock evaluation) & post-save (Socket.IO notification)
      updatedProducts.push(product);
    }

    res.json({ success: true, count: updatedProducts.length, products: updatedProducts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Schedule a product flash sale (Vendor / Store Admin with EDIT_INVENTORY)
// @route   PUT /api/products/:id/flash-sale
// @access  Private
router.put('/:id/flash-sale', protect, verifyTenantAccess, requirePermission('EDIT_INVENTORY'), async (req, res) => {
  const { salePrice, expiresAt, isActive } = req.body;
  
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // Enforce store owner/staff bounds
    const userStoreId = req.user.activeStoreId || req.user.storeId;
    if (product.storeId.toString() !== userStoreId.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied: Unauthorized product modification' });
    }

    product.flashSale = {
      salePrice: salePrice ? parseFloat(salePrice) : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      isActive: isActive === true
    };

    await product.save(); // Triggers save (database post-save triggers socket update alert)
    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Delete a product (Vendor/Store Admin soft-delete, Platform Admin soft/hard-delete)
// @route   DELETE /api/products/:id
// @access  Private
router.delete('/:id', protect, verifyTenantAccess, async (req, res) => {
  try {
    const product = req.loadedProduct || await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const isPlatformAdmin = req.user.role === 'admin';
    const forceHardDelete = isPlatformAdmin && req.query.force === 'true';

    if (forceHardDelete) {
      // Hard Delete
      await Product.findByIdAndDelete(product._id);

      try {
        const { broadcastVendorDashboardMetrics } = await import('../config/socketHandler.js');
        await broadcastVendorDashboardMetrics(product.storeId, 'DELETE', product._id);
      } catch (err) {
        console.error('Error broadcasting vendor dashboard metrics in product hard delete:', err);
      }

      // System Audit Logging to security audit stream (dispatch notification to admins)
      try {
        const { dispatchNotification } = await import('../services/notificationService.js');
        await dispatchNotification('SYSTEM_AUDIT', {
          type: 'PRODUCT_HARD_DELETE',
          description: `Product "${product.title}" (ID: ${product._id}) was hard deleted by admin ${req.user.name} due to guidelines violation.`,
          meta: {
            productId: product._id.toString(),
            title: product.title,
            storeId: product.storeId.toString(),
            deletedBy: req.user.name,
            deletedByEmail: req.user.email
          }
        });
      } catch (err) {
        console.error('[Delete Notification Error]', err.message);
      }

      // Local activity log
      await logActivity(
        product.storeId,
        req.user._id,
        req.user.name,
        'PRODUCT_HARD_DELETE',
        `Hard deleted product "${product.title}" (ID: ${product._id}) for guidelines violation.`
      );

      return res.json({ success: true, message: 'Product hard deleted successfully and logged to audit trail.' });
    } else {
      // Soft Delete
      product.isDeleted = true;
      await product.save();

      // Local activity log
      await logActivity(
        product.storeId,
        req.user._id,
        req.user.name,
        'PRODUCT_SOFT_DELETE',
        `Soft deleted product "${product.title}".`
      );

      return res.json({ success: true, message: 'Product soft deleted and archived successfully.' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
