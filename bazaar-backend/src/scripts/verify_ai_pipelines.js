/**
 * verify_ai_pipelines.js
 *
 * Automated verification script to test the accuracy, boundaries, and fallbacks
 * of the three local offline AI pipelines:
 *   1. OCR Receipt Fraud Extraction Heuristics (Tesseract parse logic + Regex + Fraud checks)
 *   2. AI Copywriter Product Auto-Tagging (Zero-shot classification + Keyword fallback)
 *   3. Vector Search Matching and Cosine Similarity (feature-extraction + Math validation)
 */

import { performOCR } from '../services/ocrService.js';
import { generateProductTags } from '../services/taggingService.js';
import { getProductEmbedding, calculateCosineSimilarity, getRecommendations } from '../services/recommendationService.js';

async function run() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' BazaarBoost — Local AI Pipeline Verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let passedTests = 0;
  let failedTests = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passedTests++;
    } else {
      console.log(`  ❌ [FAIL] ${message}`);
      failedTests++;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Test OCR Receipt Parsing & Fraud Heuristics
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('1. Testing OCR Receipt Parsing & Fraud Heuristics...');
  
  try {
    // Test Case 1.1: Fallback template parsing
    const result1 = await performOCR('non_existent_receipt.png'); // Triggers fallback template
    console.log("DEBUG result1:", result1);
    assert(result1.detectedAmount === 250, 'Fallback parser should extract amount 250');
    assert(result1.referenceNumber === 'TXN8271892019A', 'Fallback parser should extract Ref ID TXN8271892019A');
    assert(result1.detectedBank === 'Bank Of Commerce', 'Fallback parser should extract Bank name');
    assert(result1.isSuspectedFake === false, 'Fallback parser should treat valid receipt as clean');

    // Test Case 1.1b: Non-demo OCR failure
    const result1b = await performOCR('random_unrecognized_upload.png'); // Triggers failure block
    assert(result1b.isSuspectedFake === true, 'Failed non-demo OCR should naturally flag receipt as suspect');
    assert(result1b.confidenceScore === 0, 'Failed non-demo OCR should report 0 confidence');

    // Test Case 1.2: Regex Reference Number Isolation
    // Simulate regex extraction from ocrService (Ref No parser)
    const refRegex = /(?:ref|reference|txn|tx|id|trans)\s*(?:no|number|#)?[:.\-\s]*([a-zA-Z0-9]{8,20})/i;
    
    const textA = 'Transfer Success Ref: TXN998271829A Amount $50.00';
    const matchA = textA.match(refRegex);
    assert(matchA && matchA[1] === 'TXN998271829A', 'Regex should extract TXN998271829A from standard colon text');

    const textB = 'txn no TXN001928374 Date 2026-06-12';
    const matchB = textB.match(refRegex);
    assert(matchB && matchB[1] === 'TXN001928374', 'Regex should extract TXN001928374 from txn no text');

    // Test Case 1.3: Fraud Heuristic Checks
    const successKeywords = ['success', 'complete', 'done', 'approved', 'paid', 'transferred', 'sent'];
    const transactionKeywords = ['receipt', 'transaction', 'transfer', 'bank', 'payment', 'transfer details', 'account'];

    const checkFraud = (rawText, confidence) => {
      const normalized = rawText.toLowerCase();
      const hasSuccess = successKeywords.some(kw => normalized.includes(kw));
      const hasTxn = transactionKeywords.some(kw => normalized.includes(kw));
      return (!hasSuccess || !hasTxn || confidence < 40);
    };

    assert(checkFraud('Pending request for payment transfer', 95) === true, 'Fraud check should flag receipt missing success keywords');
    assert(checkFraud('Success completed for premium items', 90) === true, 'Fraud check should flag receipt missing standard bank keywords');
    assert(checkFraud('Success transaction transfer receipt complete', 35) === true, 'Fraud check should flag low confidence scans (< 40%) as suspect');
    assert(checkFraud('Receipt transfer success details complete bank payment successful', 85) === false, 'Fraud check should approve clean, complete high-confidence text');
  } catch (err) {
    console.error('Error in OCR test section:', err);
    failedTests++;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Test AI Copywriter Product Auto-Tagging
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n2. Testing AI Copywriter Product Auto-Tagging (Keywords & Classifiers)...');
  
  try {
    // Testing keyword mapping boundaries
    const tagPhone = await generateProductTags('Samsung Galaxy S24 Ultra Phone', '12GB RAM, 512GB Storage, Android mobile smartphone');
    assert(tagPhone.includes('electronics'), `Tagging "Samsung Galaxy Phone" should yield "electronics". Got: ${JSON.stringify(tagPhone)}`);

    const tagShirt = await generateProductTags('Mens Cotton Casual Shirt', 'Slim fit button down collar shirt');
    assert(tagShirt.includes('clothing & apparel'), `Tagging "Mens Cotton Shirt" should yield "clothing & apparel". Got: ${JSON.stringify(tagShirt)}`);

    const tagTea = await generateProductTags('Organic Jasmine Green Tea', 'Loose leaf healthy organic green tea from mountains');
    assert(tagTea.includes('groceries & food'), `Tagging "Jasmine Green Tea" should yield "groceries & food". Got: ${JSON.stringify(tagTea)}`);

    const tagPan = await generateProductTags('Non-Stick Frying Pan', '12 inch ceramic nonstick cooker pan for cooking');
    assert(tagPan.includes('home & kitchen'), `Tagging "Non-Stick Frying Pan" should yield "home & kitchen". Got: ${JSON.stringify(tagPan)}`);

    const tagPlumb = await generateProductTags('Emergency Plumbing Service', 'Fixing leaking pipes and kitchen sink repairs');
    assert(tagPlumb.includes('services'), `Tagging "Emergency Plumbing" should yield "services". Got: ${JSON.stringify(tagPlumb)}`);

    const tagDefault = await generateProductTags('Obscure widget', 'No matching keywords');
    assert(tagDefault.includes('general merchandise'), `Tagging item with no keywords should default to "general merchandise". Got: ${JSON.stringify(tagDefault)}`);
  } catch (err) {
    console.error('Error in Tagging test section:', err);
    failedTests++;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Test Vector Search & Cosine Similarity Math
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n3. Testing Vector Search & Cosine Similarity Math...');

  try {
    // Test Case 3.1: Cosine Similarity of identical vectors is exactly 1.0
    // (Vectors must be normalized to unit length, which recommendationService ensures)
    const vecA = [0.5, 0.5, 0.5, 0.5]; // unit length = sqrt(0.25+0.25+0.25+0.25) = 1.0
    const simIdentical = calculateCosineSimilarity(vecA, vecA);
    assert(Math.abs(simIdentical - 1.0) < 1e-6, `Cosine similarity of identical vectors should equal 1.0. Got: ${simIdentical}`);

    // Test Case 3.2: Cosine Similarity of orthogonal vectors is exactly 0.0
    const vecB = [1.0, 0.0, 0.0, 0.0];
    const vecC = [0.0, 1.0, 0.0, 0.0];
    const simOrthogonal = calculateCosineSimilarity(vecB, vecC);
    assert(simOrthogonal === 0.0, `Cosine similarity of orthogonal vectors should equal 0.0. Got: ${simOrthogonal}`);

    // Test Case 3.3: Embedding generation fallback robustness
    const embedding = await getProductEmbedding('Wireless Headphone Audio Speaker');
    assert(embedding.length === 384, `Embedding generator should output exactly 384 dimensions. Got length: ${embedding.length}`);
    
    // Check normalization: sum of squares should equal 1.0
    const magnitudeSq = embedding.reduce((sum, val) => sum + val * val, 0);
    assert(Math.abs(magnitudeSq - 1.0) < 1e-4, `Output embeddings should be normalized to unit length. Magnitude squared: ${magnitudeSq}`);

    // Test Case 3.4: Jaccard fallback ranking
    const mockTarget = { _id: '1', title: 'Target Headphone', aiTags: ['electronics', 'audio'] };
    const mockList = [
      { _id: '2', title: 'Wireless Speaker', aiTags: ['electronics', 'audio'] }, // Perfect Jaccard match
      { _id: '3', title: 'Leather Shoes', aiTags: ['clothing'] },                // 0 Jaccard match
      { _id: '4', title: 'Kitchen Blender', aiTags: ['home & kitchen'] }         // 0 Jaccard match
    ];

    const recs = getRecommendations(mockTarget, mockList, 2);
    assert(recs.length === 2, 'Should return exactly requested limit of recommendations');
    assert(recs[0]._id === '2', 'Wireless Speaker should rank first due to matching electronics/audio tags');
  } catch (err) {
    console.error('Error in Vector Math test section:', err);
    failedTests++;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Report Summary
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' AI Pipeline Test Summary');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Passed Tests: ${passedTests}`);
  console.log(`  Failed Tests: ${failedTests}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run();
