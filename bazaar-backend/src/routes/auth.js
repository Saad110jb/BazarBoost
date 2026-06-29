import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Store from '../models/Store.js';
import AdminSession from '../models/AdminSession.js';
import { protect } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { logActivity } from '../services/auditService.js';
import { uploadStoreAssets } from '../middleware/upload.js';

const router = express.Router();

import ShopperProfile from '../models/ShopperProfile.js';
import VendorProfile from '../models/VendorProfile.js';

const getPermissionsFromProfile = (role, profile) => {
  if (role === 'vendor') {
    return ["EDIT_INVENTORY", "PROCESS_ORDERS", "MANAGE_COUPONS", "LIVE_CHAT", "MANAGE_ADS", "EDIT_SLUG", "VIEW_BILLING"];
  }
  if (role === 'storeAdmin') {
    const perms = [];
    if (profile.permissions?.manageProducts) {
      perms.push("EDIT_INVENTORY", "PROCESS_ORDERS");
    }
    if (profile.permissions?.manageChats) {
      perms.push("LIVE_CHAT");
    }
    if (profile.permissions?.manageSettings) {
      perms.push("MANAGE_COUPONS");
    }
    if (profile.permissions?.manageAds) {
      perms.push("MANAGE_ADS");
    }
    return perms;
  }
  return [];
};

const resolveProfiles = async (user) => {
  let shopperProfile = await ShopperProfile.findOne({ userId: user._id });
  if (!shopperProfile) {
    shopperProfile = await ShopperProfile.create({
      userId: user._id,
      cart: user.cart || []
    });
    user.shopperProfile = shopperProfile._id;
  }

  let vendorProfile = await VendorProfile.findOne({ userId: user._id });
  if (!vendorProfile && (user.role === 'vendor' || user.role === 'storeAdmin')) {
    vendorProfile = await VendorProfile.create({
      userId: user._id,
      storeId: user.storeId,
      activeStoreId: user.storeId,
      permissions: user.permissions || {
        manageProducts: true,
        manageChats: true,
        manageAds: false,
        manageSettings: false
      },
      shift: user.shift || 'none'
    });
    user.vendorProfile = vendorProfile._id;
  }

  if (user.isModified('shopperProfile') || user.isModified('vendorProfile')) {
    await user.save();
  }

  return { shopperProfile, vendorProfile };
};

const generateToken = async (user, activeStoreOverride = null, roleOverride = null) => {
  const activeRoleContext = roleOverride || user.role;
  const tenantStores = [];
  let activeStoreId = activeStoreOverride;

  let permissions = [];
  if (activeRoleContext === 'vendor' || activeRoleContext === 'storeAdmin') {
    const vendorProfile = await VendorProfile.findOne({ userId: user._id });
    if (vendorProfile) {
      if (activeRoleContext === 'vendor') {
        const stores = await Store.find({ vendorId: user._id });
        stores.forEach(s => tenantStores.push(s._id.toString()));
        if (stores.length > 0 && !activeStoreId) {
          activeStoreId = vendorProfile.activeStoreId ? vendorProfile.activeStoreId.toString() : stores[0]._id.toString();
        }
      } else if (activeRoleContext === 'storeAdmin' && vendorProfile.storeId) {
        tenantStores.push(vendorProfile.storeId.toString());
        activeStoreId = vendorProfile.storeId.toString();
      }
      permissions = getPermissionsFromProfile(activeRoleContext, vendorProfile);
    }
  } else if (activeRoleContext === 'admin') {
    permissions = ["ALL_ACCESS"];
  }

  let activeRoleString = 'Customer';
  if (activeRoleContext === 'vendor' || activeRoleContext === 'storeAdmin') {
    activeRoleString = 'Vendor';
  } else if (activeRoleContext === 'admin') {
    activeRoleString = 'Admin';
  }

  return jwt.sign(
    {
      id: user._id,
      role: activeRoleContext,
      activeRole: activeRoleString,
      tenantStores,
      activeStoreId,
      permissions,
      isTempPassword: !!user.isTempPassword,
    },
    process.env.JWT_SECRET || 'bazaarboost_secret_key_2026_local',
    { expiresIn: '30d' }
  );
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
router.post('/register', async (req, res) => {
  const { name, email, password, role, storeName } = req.body;

  try {
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role: role || 'shopper',
    });

    // If role is vendor, automatically create a store
    if (user.role === 'vendor') {
      const generatedSlug = (storeName || `${name}'s Shop`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');

      // Double check slug uniqueness
      let uniqueSlug = generatedSlug;
      let count = 1;
      while (await Store.findOne({ slug: uniqueSlug })) {
        uniqueSlug = `${generatedSlug}-${count}`;
        count++;
      }

      const store = await Store.create({
        vendorId: user._id,
        name: storeName || `${name}'s Shop`,
        slug: uniqueSlug,
        wallet: {
          balancePKR:        0,
          totalDepositedPKR: 0,
          totalSpentPKR:     0,
        },
      });

      user.storeId = store._id;
      await user.save();
    }

    // Resolve profiles
    await resolveProfiles(user);

    res.status(201).json({
      success: true,
      token: await generateToken(user),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
        isTempPassword: !!user.isTempPassword,
        permissions: user.permissions,
        shift: user.shift
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Authenticate user & get token
// @route   POST /api/auth/login
// @access  Public
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // Lazily resolve profiles on login
    await resolveProfiles(user);

    res.json({
      success: true,
      token: await generateToken(user),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
        isTempPassword: !!user.isTempPassword,
        permissions: user.permissions,
        shift: user.shift
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get user profile
// @route   GET /api/auth/me
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    await resolveProfiles(user);
    const populatedUser = await User.findById(req.user._id)
      .select('-password')
      .populate('shopperProfile')
      .populate('vendorProfile');
    res.json({ success: true, user: populatedUser });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Update store settings (Vendors / Store Admin with MANAGE_COUPONS)
// @route   PUT /api/auth/store/settings
// @access  Private
router.put('/store/settings', protect, requirePermission('MANAGE_COUPONS'), async (req, res) => {
  if (req.user.role !== 'vendor' && req.user.role !== 'storeAdmin') {
    return res.status(403).json({ success: false, message: 'Only vendors or authorized store staff can update settings' });
  }

  const { 
    name, slug, description, primaryColor, backgroundColor, textColor, 
    bankName, accountName, accountNumber,
    originCity, warehouseAddress, vacationMode, businessHours 
  } = req.body;

  try {
    const storeId = req.user.role === 'storeAdmin' ? req.user.activeStoreId : req.user.storeId;
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    // Slug edit restriction for staff accounts
    if (slug && slug !== store.slug) {
      if (req.user.role === 'storeAdmin') {
        return res.status(403).json({ success: false, message: 'Security Alert: Store staff are not authorized to modify the storefront URL slug' });
      }

      const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
      const existing = await Store.findOne({ slug: cleanSlug });
      if (existing && existing._id.toString() !== store._id.toString()) {
        return res.status(400).json({ success: false, message: 'Store URL slug already in use. Please select a unique slug.' });
      }
      store.slug = cleanSlug;
    }

    if (name) store.name = name;
    if (description !== undefined) store.description = description;
    
    // Theme colors
    if (primaryColor) store.theme.primaryColor = primaryColor;
    if (backgroundColor) store.theme.backgroundColor = backgroundColor;
    if (textColor) store.theme.textColor = textColor;

    // Bank Details
    if (bankName) store.bankDetails.bankName = bankName;
    if (accountName) store.bankDetails.accountName = accountName;
    if (accountNumber) store.bankDetails.accountNumber = accountNumber;

    // Logistics & Operating Details
    if (originCity) store.originCity = originCity;
    if (warehouseAddress !== undefined) store.warehouseAddress = warehouseAddress;
    if (vacationMode !== undefined) store.vacationMode = vacationMode;
    if (businessHours) {
      store.businessHours = {
        monday: { ...store.businessHours.monday, ...businessHours.monday },
        tuesday: { ...store.businessHours.tuesday, ...businessHours.tuesday },
        wednesday: { ...store.businessHours.wednesday, ...businessHours.wednesday },
        thursday: { ...store.businessHours.thursday, ...businessHours.thursday },
        friday: { ...store.businessHours.friday, ...businessHours.friday },
        saturday: { ...store.businessHours.saturday, ...businessHours.saturday },
        sunday: { ...store.businessHours.sunday, ...businessHours.sunday }
      };
    }

    await store.save();
    res.json({ success: true, store });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Upload store logo / banner assets
// @route   POST /api/auth/store/upload-assets
// @access  Private (Vendor / Store Admin with MANAGE_COUPONS)
router.post('/store/upload-assets', protect, requirePermission('MANAGE_COUPONS'), uploadStoreAssets.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'banner', maxCount: 1 }
]), async (req, res) => {
  try {
    const storeId = req.user.role === 'storeAdmin' ? req.user.activeStoreId : req.user.storeId;
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    const normalizePath = (p) => {
      const normalized = p.replace(/\\/g, '/');
      const idx = normalized.indexOf('uploads/');
      return idx !== -1 ? '/' + normalized.substring(idx) : '/' + normalized;
    };

    if (req.files) {
      if (req.files.logo && req.files.logo[0]) {
        store.logo = normalizePath(req.files.logo[0].path);
      }
      if (req.files.banner && req.files.banner[0]) {
        store.banner = normalizePath(req.files.banner[0].path);
      }
      await store.save();
    }

    res.json({ success: true, store });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get store details by slug
// @route   GET /api/auth/store/slug/:slug
// @access  Public
router.get('/store/slug/:slug', async (req, res) => {
  try {
    const store = await Store.findOne({ slug: req.slug || req.params.slug }).populate('vendorId', 'status');
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    // Store suspension check
    if (store.isActive === false) {
      return res.status(403).json({ success: false, message: 'Store is suspended' });
    }

    // Vendor owner status check
    if (!store.vendorId || store.vendorId.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Store is suspended' });
    }

    res.json({ success: true, store });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Switch operational store context
// @route   POST /api/auth/store/switch
// @access  Private (Vendor)
router.post('/store/switch', protect, async (req, res) => {
  const { storeId } = req.body;
  if (!storeId) {
    return res.status(400).json({ success: false, message: 'storeId is required' });
  }

  if (req.user.role === 'storeAdmin') {
    return res.status(403).json({ success: false, message: 'Access denied: Store staff are not authorized to switch store contexts' });
  }

  try {
    if (!req.user.tenantStores.includes(storeId)) {
      return res.status(403).json({ success: false, message: 'You do not have access to this store context' });
    }

    const token = await generateToken(req.user, storeId);

    res.json({ success: true, token, activeStoreId: storeId });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Create a new store profile under same vendor
// @route   POST /api/auth/store/create
// @access  Private (Vendor)
router.post('/store/create', protect, async (req, res) => {
  if (req.user.role !== 'vendor') {
    return res.status(403).json({ success: false, message: 'Only vendors can create store profiles' });
  }

  const { storeName } = req.body;
  if (!storeName) {
    return res.status(400).json({ success: false, message: 'Store Name is required' });
  }

  try {
    const generatedSlug = storeName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');

    let uniqueSlug = generatedSlug;
    let count = 1;
    while (await Store.findOne({ slug: uniqueSlug })) {
      uniqueSlug = `${generatedSlug}-${count}`;
      count++;
    }

    const store = await Store.create({
      vendorId: req.user._id,
      name: storeName,
      slug: uniqueSlug,
      wallet: {
        balancePKR:        0,
        totalDepositedPKR: 0,
        totalSpentPKR:     0,
      },
    });

    const stores = await Store.find({ vendorId: req.user._id });
    const tenantStores = stores.map(s => s._id.toString());

    const token = await generateToken(req.user, store._id.toString());

    res.status(201).json({
      success: true,
      message: 'New store profile created successfully',
      store,
      token,
      activeStoreId: store._id.toString()
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Provision store staff / sub-account
// @route   POST /api/auth/staff/invite
// @access  Private (Vendor)
router.post('/staff/invite', protect, async (req, res) => {
  if (req.user.role !== 'vendor') {
    return res.status(403).json({ success: false, message: 'Only vendors can provision staff' });
  }

  const { name, email, permissions, shift } = req.body;
  if (!name || !email) {
    return res.status(400).json({ success: false, message: 'Name and email are required' });
  }

  try {
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'User with this email already exists' });
    }

    // Step 1: Temp Password Generation
    const tempPassword = Math.random().toString(36).substring(2, 10);
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(tempPassword, salt);

    // Step 2: Database Injection & Binds
    const staff = await User.create({
      name,
      email,
      password: hashedPassword,
      role: 'storeAdmin',
      storeId: req.user.activeStoreId, // Link to vendor's currently active store
      permissions: permissions || {
        manageProducts: true,
        manageChats: true,
        manageAds: false,
        manageSettings: false
      },
      shift: shift || 'none',
      isTempPassword: true
    });

    // Step 3: Response Output
    res.status(201).json({
      success: true,
      message: 'Staff member created successfully',
      tempPassword,
      staff: {
        id: staff._id,
        name: staff.name,
        email: staff.email,
        role: staff.role,
        storeId: staff.storeId,
        permissions: staff.permissions,
        shift: staff.shift,
        isTempPassword: true
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get all staff members for active store
// @route   GET /api/auth/staff
// @access  Private (Vendor)
router.get('/staff', protect, async (req, res) => {
  if (req.user.role !== 'vendor') {
    return res.status(403).json({ success: false, message: 'Only vendors can manage staff list' });
  }

  try {
    const staffList = await User.find({
      storeId: req.user.activeStoreId,
      role: 'storeAdmin'
    }).select('-password');

    res.json({ success: true, count: staffList.length, staff: staffList });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Remove staff member
// @route   DELETE /api/auth/staff/:id
// @access  Private (Vendor)
router.delete('/staff/:id', protect, async (req, res) => {
  if (req.user.role !== 'vendor') {
    return res.status(403).json({ success: false, message: 'Only vendors can remove staff' });
  }

  try {
    const staff = await User.findOne({
      _id: req.params.id,
      storeId: req.user.activeStoreId,
      role: 'storeAdmin'
    });

    if (!staff) {
      return res.status(404).json({ success: false, message: 'Staff member not found in this store' });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Staff member removed successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get all stores owned by logged-in vendor
// @route   GET /api/auth/stores
// @access  Private (Vendor)
router.get('/stores', protect, async (req, res) => {
  if (req.user.role !== 'vendor') {
    return res.status(403).json({ success: false, message: 'Only vendors can list stores' });
  }
  try {
    const stores = await Store.find({ vendorId: req.user._id });
    res.json({ success: true, count: stores.length, stores });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Setup permanent password for first-time login
// @route   PUT /api/auth/profile/setup-password
// @access  Private
router.put('/profile/setup-password', protect, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'New password must be at least 6 characters long' });
  }

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.isTempPassword = false;
    await user.save();

    const token = await generateToken(user);

    res.json({
      success: true,
      message: 'Password activated successfully. Full access granted.',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
        isTempPassword: false,
        permissions: user.permissions,
        shift: user.shift
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Switch active operational role
// @route   POST /api/auth/role/switch
// @access  Private
router.post('/role/switch', protect, async (req, res) => {
  const { targetRole } = req.body;
  if (!targetRole || !['shopper', 'vendor'].includes(targetRole)) {
    return res.status(400).json({ success: false, message: 'Invalid target role. Must be shopper or vendor.' });
  }

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    let target = targetRole;
    if (target === 'vendor' && user.role === 'storeAdmin') {
      target = 'storeAdmin';
    }

    // Ensure profiles exist
    const { shopperProfile, vendorProfile } = await resolveProfiles(user);

    // If target is vendor, and user doesn't have a vendorProfile, or store, provision it dynamically
    if (target === 'vendor') {
      let vProf = vendorProfile;
      if (!vProf) {
        // Create VendorProfile
        vProf = await VendorProfile.create({
          userId: user._id,
          permissions: {
            manageProducts: true,
            manageChats: true,
            manageAds: false,
            manageSettings: false
          },
          shift: 'none'
        });
        user.vendorProfile = vProf._id;
        await user.save();
      }

      // If they don't have an associated Store yet, provision one dynamically
      let store = await Store.findOne({ vendorId: user._id });
      if (!store) {
        const generatedSlug = `${user.name}'s Shop`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)+/g, '');

        let uniqueSlug = generatedSlug;
        let count = 1;
        while (await Store.findOne({ slug: uniqueSlug })) {
          uniqueSlug = `${generatedSlug}-${count}`;
          count++;
        }

        store = await Store.create({
          vendorId: user._id,
          name: `${user.name}'s Shop`,
          slug: uniqueSlug,
          wallet: {
            balancePKR: 0,
            totalDepositedPKR: 0,
            totalSpentPKR: 0,
          },
        });
      }

      // Bind store context
      if (!vProf.storeId) {
        vProf.storeId = store._id;
        vProf.activeStoreId = store._id;
        await vProf.save();
      }
    }

    // Generate token with roleOverride = target
    const token = await generateToken(user, null, target);

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: target,
        isTempPassword: !!user.isTempPassword,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get logged-in user's cart
// @route   GET /api/auth/cart
// @access  Private
router.get('/cart', protect, async (req, res) => {
  try {
    let shopperProfile = await ShopperProfile.findOne({ userId: req.user._id }).populate({
      path: 'cart.productId',
      populate: { path: 'storeId', select: 'name slug' }
    });

    if (!shopperProfile) {
      const user = await User.findById(req.user._id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      const profiles = await resolveProfiles(user);
      shopperProfile = await ShopperProfile.findById(profiles.shopperProfile._id).populate({
        path: 'cart.productId',
        populate: { path: 'storeId', select: 'name slug' }
      });
    }

    res.json({ success: true, cart: shopperProfile.cart || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Sync/Save logged-in user's cart
// @route   PUT /api/auth/cart
// @access  Private
router.put('/cart', protect, async (req, res) => {
  const { cart } = req.body;
  if (!Array.isArray(cart)) {
    return res.status(400).json({ success: false, message: 'Cart must be an array of items' });
  }

  try {
    let shopperProfile = await ShopperProfile.findOne({ userId: req.user._id });
    if (!shopperProfile) {
      const user = await User.findById(req.user._id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      const profiles = await resolveProfiles(user);
      shopperProfile = profiles.shopperProfile;
    }

    shopperProfile.cart = cart.map(item => ({
      productId: item.productId,
      quantity: item.quantity || 1
    }));

    await shopperProfile.save();
    res.json({ success: true, cart: shopperProfile.cart });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    SuperAdmin Default Login
// @route   POST /api/auth/gatekeeper-login
// @access  Public
router.post('/gatekeeper-login', async (req, res) => {
  const { email, password } = req.body;

  // 1. Validation checking on inputs (masks)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email address format' });
  }

  if (!password || password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
  }

  try {
    // 2. Fetch User matching role: 'admin'
    const admin = await User.findOne({ email, role: 'admin' });
    if (!admin) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (admin.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Account is suspended. Please contact platform operators.' });
    }

    // 3. Compare hashed passwords
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // 4. Concurrent Login Tracking
    // Get current IP address
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    
    // Find active session for this admin
    const activeSession = await AdminSession.findOne({ adminId: admin._id });
    if (activeSession) {
      if (activeSession.ipAddress !== ipAddress) {
        // SECURITY ALERT: Concurrent login detected from a different IP address.
        // Trigger platform-wide protection event: suspend admin user and clear all sessions.
        admin.status = 'inactive';
        await admin.save();
        await AdminSession.deleteMany({ adminId: admin._id });

        console.error(`[SECURITY ALERT] Concurrent SuperAdmin login detected from different IP: ${ipAddress} (Previous: ${activeSession.ipAddress}). Admin account suspended!`);
        return res.status(403).json({
          success: false,
          securityAlert: true,
          message: 'Security Alert: Concurrent login from different IP detected. SuperAdmin account suspended. Manual database reactivation required.'
        });
      }
    }

    // 5. Global Payload Signing
    // Sign JWT token with max 2 hours expiration
    const token = jwt.sign(
      {
        id: admin._id,
        role: admin.role,
        tenantStores: ['GLOBAL'],
        permissions: ['ALL_ACCESS']
      },
      process.env.JWT_SECRET || 'bazaarboost_secret_key_2026_local',
      { expiresIn: '2h' }
    );

    // Save active session
    if (activeSession) {
      // Refresh token if IP matches
      activeSession.token = token;
      activeSession.createdAt = new Date();
      await activeSession.save();
    } else {
      await AdminSession.create({
        adminId: admin._id,
        ipAddress,
        token
      });
    }

    // Platform audit log: record successful gatekeeper login
    try {
      await logActivity(
        null,
        admin._id,
        admin.name,
        'ADMIN_LOGIN',
        `SuperAdmin ${admin.name} (${admin.email}) authenticated successfully. IP: ${ipAddress}`,
        { scope: 'platform', ipAddress, targetModel: 'AdminSession' }
      );
    } catch (auditErr) {
      console.error('[Auth Audit Error]', auditErr.message);
    }

    res.json({
      success: true,
      token,
      user: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
