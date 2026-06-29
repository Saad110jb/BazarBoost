import { pipeline } from '@xenova/transformers';

let embedPipeline = null;
let isModelLoading = false;
let modelLoadFailed = false;

/**
 * Initializes the feature-extraction pipeline for embeddings.
 */
const initEmbedder = async () => {
  if (embedPipeline || isModelLoading || modelLoadFailed) return;
  
  isModelLoading = true;
  try {
    console.log('Loading local AI embedding model (Xenova/all-MiniLM-L6-v2)...');
    // ~90MB sentence-transformers model
    embedPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('AI embedding model loaded successfully.');
    isModelLoading = false;
  } catch (error) {
    console.error('Failed to load local embedding model. Using Jaccard fallback:', error.message);
    modelLoadFailed = true;
    isModelLoading = false;
  }
};

/**
 * Generates a dense vector embedding for a product.
 * 
 * @param {string} text - The product text content (title + description + tags)
 * @returns {Promise<number[]>} - High-dimensional vector array (384 float values)
 */
export const getProductEmbedding = async (text) => {
  const cleanText = text || '';
  // Try loading pipeline
  initEmbedder().catch(() => {});

  if (embedPipeline) {
    try {
      console.log('Computing text embedding locally...');
      const output = await embedPipeline(cleanText, { pooling: 'mean', normalize: true });
      // output.data is a Float32Array, convert it to a standard JS Array
      return Array.from(output.data);
    } catch (err) {
      console.error('Embedding generation failed, falling back:', err.message);
    }
  }

  // Fallback: Generate a pseudo-embedding based on character counts/hash 
  // to prevent Mongoose schema errors, combined with token fallback
  console.log('Generating fallback mock vector...');
  const vector = new Array(384).fill(0);
  const words = cleanText.toLowerCase().match(/\w+/g) || [];
  
  // Distribute word hash values across the 384 dimensions
  words.forEach(word => {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = (hash << 5) - hash + word.charCodeAt(i);
      hash |= 0;
    }
    const index = Math.abs(hash) % 384;
    vector[index] += 1;
  });

  // Normalize the mock vector
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    return vector.map(val => val / magnitude);
  }
  
  // Return dummy normalized vector if text is empty
  vector[0] = 1.0;
  return vector;
};

/**
 * Calculates cosine similarity between two normalized vectors.
 * Since the vectors generated above are normalized to unit length, 
 * the cosine similarity is simply their dot product.
 * 
 * @param {number[]} vecA - Vector A
 * @param {number[]} vecB - Vector B
 * @returns {number} - Cosine similarity score (between -1 and 1)
 */
export const calculateCosineSimilarity = (vecA, vecB) => {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  
  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }
  return dotProduct;
};

/**
 * Helper to check if two tags are complementary.
 */
const isComplementary = (tagA, tagB) => {
  if (!tagA || !tagB) return false;
  const a = tagA.toLowerCase();
  const b = tagB.toLowerCase();
  const complementaryMap = {
    'electronics': ['audio', 'home & kitchen'],
    'audio': ['electronics', 'home & kitchen'],
    'clothing & apparel': ['beauty & personal care', 'toys & games'],
    'beauty & personal care': ['clothing & apparel'],
    'groceries & food': ['home & kitchen'],
    'home & kitchen': ['groceries & food', 'electronics'],
    'toys & games': ['clothing & apparel']
  };
  return complementaryMap[a]?.includes(b) || complementaryMap[b]?.includes(a);
};

/**
 * Ranks a list of products relative to a target product.
 * Handles fallbacks if embeddings are missing.
 * 
 * @param {object} targetProduct - The reference product
 * @param {object[]} productList - All products in database
 * @param {number} limit - Maximum recommendations to return
 * @param {string} strategy - Recommendation strategy: 'viewed' (substitutes) or 'paired' (complementary)
 * @returns {object[]} - Sorted list of recommended products with similarity scores
 */
export const getRecommendations = (targetProduct, productList, limit = 5, strategy = 'viewed') => {
  const targetVector = targetProduct.embedding;
  const targetTags = targetProduct.aiTags || [];

  const scoredProducts = productList
    .filter(prod => prod._id.toString() !== targetProduct._id.toString())
    .map(prod => {
      let score = 0;
      
      // If both have vector embeddings, use local cosine similarity
      if (targetVector && targetVector.length > 0 && prod.embedding && prod.embedding.length > 0) {
        score = calculateCosineSimilarity(targetVector, prod.embedding);
      } else {
        // Fallback similarity: Jaccard similarity on product tags + keyword intersection
        const prodTags = prod.aiTags || [];
        const intersection = targetTags.filter(x => prodTags.includes(x));
        const union = Array.from(new Set([...targetTags, ...prodTags]));
        
        score = union.length > 0 ? (intersection.length / union.length) : 0;

        // Apply dynamic boost for matching words in titles
        const targetTitleWords = targetProduct.title.toLowerCase().split(' ');
        const prodTitleWords = prod.title.toLowerCase().split(' ');
        const matchingWords = targetTitleWords.filter(w => prodTitleWords.includes(w) && w.length > 3);
        score += matchingWords.length * 0.1;
      }

      // Apply strategy heuristics
      if (strategy === 'paired') {
        const targetPrimaryTag = targetTags[0];
        const prodPrimaryTag = prod.aiTags?.[0];
        
        // If they share the exact same primary tag, demote direct substitutes
        if (targetPrimaryTag && prodPrimaryTag && targetPrimaryTag === prodPrimaryTag) {
          score -= 0.35;
        }
        
        // Boost complementary categories
        if (isComplementary(targetPrimaryTag, prodPrimaryTag)) {
          score += 0.25;
        }
      } else {
        // strategy === 'viewed' (default): we prioritize same category
        const targetPrimaryTag = targetTags[0];
        const prodPrimaryTag = prod.aiTags?.[0];
        if (targetPrimaryTag && prodPrimaryTag && targetPrimaryTag === prodPrimaryTag) {
          score += 0.15; // boost exact category match
        }
      }

      return { product: prod, score };
    });

  // Sort descending by score
  return scoredProducts
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.product);
};
