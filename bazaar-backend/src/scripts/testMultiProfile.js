import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Store from '../models/Store.js';
import ShopperProfile from '../models/ShopperProfile.js';
import VendorProfile from '../models/VendorProfile.js';

// Setup Mock helper matches auth.js logic
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

async function test() {
  try {
    await mongoose.connect('mongodb://localhost:27017/bazaarboost');
    console.log("Connected to MongoDB for testing.");

    // Clean up past runs
    const email = 'testprofile@bazaar.com';
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      await ShopperProfile.deleteMany({ userId: existingUser._id });
      await VendorProfile.deleteMany({ userId: existingUser._id });
      await Store.deleteMany({ vendorId: existingUser._id });
      await User.deleteOne({ _id: existingUser._id });
      console.log("Cleaned up existing test user profile records.");
    }

    // Step 1: Create a brand new user with default 'shopper' role
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('password123', salt);
    
    const user = await User.create({
      name: 'Test MultiProfile User',
      email,
      password: hashedPassword,
      role: 'shopper'
    });
    console.log(`Created test User with ID: ${user._id}`);

    // Step 2: Resolve profiles on registration/login
    console.log("Resolving profiles (expecting ShopperProfile only, VendorProfile null)...");
    const { shopperProfile, vendorProfile } = await resolveProfiles(user);
    
    if (shopperProfile && !vendorProfile) {
      console.log("✅ Success: ShopperProfile created, VendorProfile is null.");
    } else {
      throw new Error(`Failed profile check. Shopper: ${!!shopperProfile}, Vendor: ${!!vendorProfile}`);
    }

    // Verify token generation as shopper
    const shopperToken = await generateToken(user);
    const decodedShopper = jwt.verify(shopperToken, process.env.JWT_SECRET || 'bazaarboost_secret_key_2026_local');
    
    if (decodedShopper.role === 'shopper' && decodedShopper.activeRole === 'Customer') {
      console.log("✅ Success: JWT role is shopper, activeRole is Customer.");
    } else {
      throw new Error(`Invalid JWT: ${JSON.stringify(decodedShopper)}`);
    }

    // Step 3: Switch role to 'vendor' (simulate POST /api/auth/role/switch)
    console.log("Simulating role switch to 'vendor'...");
    let target = 'vendor';
    
    // Resolve profiles again
    const profiles = await resolveProfiles(user);
    let vProf = profiles.vendorProfile;
    
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
      console.log(`Provisioned VendorProfile: ${vProf._id}`);
    }

    let store = await Store.findOne({ vendorId: user._id });
    if (!store) {
      store = await Store.create({
        vendorId: user._id,
        name: `${user.name}'s Shop`,
        slug: 'test-multiprofile-shop',
        wallet: { balancePKR: 0 }
      });
      console.log(`Provisioned Store dynamically: ${store._id}`);
    }

    if (!vProf.storeId) {
      vProf.storeId = store._id;
      vProf.activeStoreId = store._id;
      await vProf.save();
    }

    // Generate token with vendor override
    const vendorToken = await generateToken(user, null, target);
    const decodedVendor = jwt.verify(vendorToken, process.env.JWT_SECRET || 'bazaarboost_secret_key_2026_local');

    if (decodedVendor.role === 'vendor' && decodedVendor.activeRole === 'Vendor' && decodedVendor.activeStoreId === store._id.toString()) {
      console.log("✅ Success: JWT role switched to vendor, activeRole is Vendor, storeId is resolved.");
    } else {
      throw new Error(`Invalid switch JWT: ${JSON.stringify(decodedVendor)}`);
    }

    // Step 4: Verify Cart Separation
    console.log("Verifying cart operations on ShopperProfile...");
    const shopperProfileDoc = await ShopperProfile.findOne({ userId: user._id });
    
    // Create a dummy product ID
    const dummyProductId = new mongoose.Types.ObjectId();
    shopperProfileDoc.cart = [{ productId: dummyProductId, quantity: 3 }];
    await shopperProfileDoc.save();

    const loadedShopperProf = await ShopperProfile.findOne({ userId: user._id });
    if (loadedShopperProf.cart.length === 1 && loadedShopperProf.cart[0].quantity === 3) {
      console.log("✅ Success: Cart items successfully saved and read from ShopperProfile.");
    } else {
      throw new Error("Cart verification failed.");
    }

    // Cleanup
    await ShopperProfile.deleteMany({ userId: user._id });
    await VendorProfile.deleteMany({ userId: user._id });
    await Store.deleteMany({ vendorId: user._id });
    await User.deleteOne({ _id: user._id });
    console.log("Successfully cleaned up test database entries.");
    console.log("\n✨ All tests passed successfully! ✨");

  } catch (error) {
    console.error("❌ Test failed:", error.message);
  } finally {
    await mongoose.disconnect();
  }
}

test();
