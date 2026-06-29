import DynamicTakeRate from '../models/DynamicTakeRate.js';

/**
 * Resolves the dynamic take-rate for a given store and order categories.
 * 
 * @param {Object} store - The store Mongoose document or object
 * @param {Array<string>|string} orderCategories - The category or categories of products in the checkout order
 * @returns {Promise<number>} The resolved take-rate percent (defaulting to 5 if no rules match)
 */
export async function resolveTakeRate(store, orderCategories) {
  if (!store) {
    return 5;
  }

  try {
    // Fetch all active rules, sorted by priority descending
    const rules = await DynamicTakeRate.find({ isActive: true }).sort({ priority: -1 });

    // Normalize orderCategories to an array of lowercase strings
    let categoriesList = [];
    if (Array.isArray(orderCategories)) {
      categoriesList = orderCategories.map(cat => (cat || '').toLowerCase().trim());
    } else if (typeof orderCategories === 'string') {
      categoriesList = [orderCategories.toLowerCase().trim()];
    }

    const storeGmv = store.wallet?.totalSpentPKR || 0;
    const storeCreditScore = store.creditScoreOverride;
    const storeDebtZone = store.debtZone || 'active';

    for (const rule of rules) {
      const { conditions, takeRatePercent } = rule;
      let matched = true;

      // 1. Sales Volume Tier conditions
      if (conditions.salesVolumeTierMin !== null && conditions.salesVolumeTierMin !== undefined) {
        if (storeGmv < conditions.salesVolumeTierMin) {
          matched = false;
        }
      }
      if (conditions.salesVolumeTierMax !== null && conditions.salesVolumeTierMax !== undefined) {
        if (storeGmv > conditions.salesVolumeTierMax) {
          matched = false;
        }
      }

      // 2. Credit Score conditions
      if (conditions.creditScoreMin !== null && conditions.creditScoreMin !== undefined) {
        if (storeCreditScore === null || storeCreditScore === undefined || storeCreditScore < conditions.creditScoreMin) {
          matched = false;
        }
      }
      if (conditions.creditScoreMax !== null && conditions.creditScoreMax !== undefined) {
        if (storeCreditScore === null || storeCreditScore === undefined || storeCreditScore > conditions.creditScoreMax) {
          matched = false;
        }
      }

      // 3. Debt Zone conditions
      if (conditions.debtZones && conditions.debtZones.length > 0) {
        if (!conditions.debtZones.includes(storeDebtZone)) {
          matched = false;
        }
      }

      // 4. Category Match condition
      if (conditions.categoryMatch && conditions.categoryMatch.trim() !== '') {
        const queryPattern = conditions.categoryMatch.toLowerCase().trim();
        const matchesCategory = categoriesList.some(cat => cat.includes(queryPattern));
        if (!matchesCategory) {
          matched = false;
        }
      }

      if (matched) {
        return takeRatePercent;
      }
    }
  } catch (error) {
    console.error('[resolveTakeRate Error] Failed to resolve dynamic take-rate, falling back to 5%:', error);
  }

  // Fallback to default 5%
  return 5;
}
