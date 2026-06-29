import { pipeline } from '@xenova/transformers';

let classifierPipeline = null;
let isModelLoading = false;
let modelLoadFailed = false;

// Standard candidate categories for local vendor marketplace
const STANDARD_CATEGORIES = [
  'electronics', 
  'clothing & apparel', 
  'home & kitchen', 
  'groceries & food', 
  'beauty & personal care', 
  'toys & games', 
  'automotive', 
  'books & stationery',
  'services'
];

// Fallback keyword dictionaries for instant offline categorization
const KEYWORD_MAP = {
  'electronics': ['phone', 'laptop', 'tv', 'headphone', 'charger', 'computer', 'screen', 'cable', 'speaker', 'audio', 'usb', 'camera'],
  'clothing & apparel': ['shirt', 't-shirt', 'pants', 'shoes', 'dress', 'socks', 'jacket', 'hat', 'coat', 'apparel', 'bag', 'backpack'],
  'home & kitchen': ['chair', 'table', 'sofa', 'plate', 'knife', 'bed', 'lamp', 'pillow', 'cooker', 'pan', 'fridge', 'furniture', 'decor'],
  'groceries & food': ['apple', 'milk', 'bread', 'coffee', 'tea', 'egg', 'meat', 'rice', 'pasta', 'juice', 'cheese', 'snack', 'vegetable', 'fruit'],
  'beauty & personal care': ['shampoo', 'soap', 'lotion', 'perfume', 'makeup', 'brush', 'cream', 'lipstick', 'skincare'],
  'toys & games': ['board game', 'toy', 'doll', 'puzzle', 'card', 'action figure', 'console'],
  'automotive': ['car', 'tire', 'oil', 'wiper', 'brake', 'engine', 'bike', 'motorcycle'],
  'books & stationery': ['book', 'pen', 'notebook', 'pencil', 'marker', 'novel', 'magazine'],
  'services': ['plumbing', 'electrician', 'cleaning', 'tutor', 'delivery', 'repair', 'lesson', 'massage']
};

/**
 * Initializes the Zero-Shot Classification pipeline.
 * Runs asynchronously and fails gracefully.
 */
const initClassifier = async () => {
  if (classifierPipeline || isModelLoading || modelLoadFailed) return;
  
  isModelLoading = true;
  try {
    console.log('Loading local AI tagging model (Xenova/mobilebert-uncased-mnli)...');
    // Using a tiny mobile-optimized model for local deployment (~90MB)
    classifierPipeline = await pipeline('zero-shot-classification', 'Xenova/mobilebert-uncased-mnli');
    console.log('AI tagging model loaded successfully.');
    isModelLoading = false;
  } catch (error) {
    console.error('Failed to load local AI model. Using keyword-based classifier instead:', error.message);
    modelLoadFailed = true;
    isModelLoading = false;
  }
};

/**
 * Automatically tag products based on their title and description.
 * 
 * @param {string} title - Product Title
 * @param {string} description - Product Description
 * @returns {Promise<string[]>} - List of predicted tags/categories
 */
export const generateProductTags = async (title, description) => {
  const cleanTitle = title || '';
  const cleanDesc = description || '';
  if (!cleanTitle && !cleanDesc) {
    return ['general merchandise'];
  }
  const textToClassify = `${cleanTitle}. ${cleanDesc}`;
  
  // Proactively start loading model in background if not already loaded
  initClassifier().catch(() => {});

  // If pipeline is loaded and didn't fail, use actual local AI inference
  if (classifierPipeline) {
    try {
      console.log('Running local AI classification...');
      const result = await classifierPipeline(textToClassify, STANDARD_CATEGORIES);
      
      // Filter categories with a confidence score > 0.35
      const tags = [];
      for (let i = 0; i < result.labels.length; i++) {
        if (result.scores[i] > 0.35) {
          tags.push(result.labels[i]);
        }
      }
      // Guarantee at least the top label is returned
      if (tags.length === 0 && result.labels.length > 0) {
        tags.push(result.labels[0]);
      }
      return tags;
    } catch (err) {
      console.error('Inference error, falling back to keywords:', err.message);
    }
  }

  // Fallback Rule-Based classifier (Fast, offline-friendly, zero overhead)
  console.log('Running fallback keyword-based tagging classifier...');
  const normalizedText = textToClassify.toLowerCase();
  const matchedCategories = [];

  for (const [category, keywords] of Object.entries(KEYWORD_MAP)) {
    for (const keyword of keywords) {
      if (normalizedText.includes(keyword)) {
        matchedCategories.push(category);
        break; // matched this category, move to next
      }
    }
  }

  // Default tag if nothing matches
  if (matchedCategories.length === 0) {
    matchedCategories.push('general merchandise');
  }

  return matchedCategories;
};
