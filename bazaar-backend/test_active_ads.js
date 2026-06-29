import mongoose from 'mongoose';
import AdBid from './src/models/AdBid.js';

async function run() {
  try {
    await mongoose.connect('mongodb://localhost:27017/bazaarboost');
    console.log("Connected to MongoDB");

    const now = new Date();
    const activeAds = await AdBid.find({
      paymentStatus: 'approved',
      startDate: { $lte: now },
      endDate: { $gte: now }
    });

    console.log(`Found ${activeAds.length} active ads:`);
    for (const ad of activeAds) {
      console.log(`\nAd ID: ${ad._id}`);
      console.log(`Top-level bannerGraphic: "${ad.bannerGraphic}"`);
      console.log(`Top-level textHeader: "${ad.textHeader}"`);
      console.log(`Variants count: ${ad.variants?.length}`);
      if (ad.variants?.length > 0) {
        ad.variants.forEach((v, i) => {
          console.log(`  - Variant ${i}: ID=${v.variantId}, bannerGraphic="${v.bannerGraphic}", textHeader="${v.textHeader}"`);
        });
      }
    }

  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await mongoose.disconnect();
  }
}

run();
