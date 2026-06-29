import express from 'express';
import { generateProductTags } from '../services/taggingService.js';
import { getProductEmbedding, calculateCosineSimilarity } from '../services/recommendationService.js';
import { performOCR } from '../services/ocrService.js';
import upload from '../middleware/upload.js';

const router = express.Router();

// @desc    Sandbox: Tag a product title & description
// @route   POST /api/ai/tag
// @access  Public
router.post('/tag', async (req, res) => {
  const { title, description } = req.body;
  if (!title || !description) {
    return res.status(400).json({ success: false, message: 'Please provide title and description' });
  }

  try {
    const tags = await generateProductTags(title, description);
    res.json({ success: true, tags });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Sandbox: Calculate cosine similarity between two texts
// @route   POST /api/ai/similarity
// @access  Public
router.post('/similarity', async (req, res) => {
  const { textA, textB } = req.body;
  if (!textA || !textB) {
    return res.status(400).json({ success: false, message: 'Please provide textA and textB' });
  }

  try {
    const embedA = await getProductEmbedding(textA);
    const embedB = await getProductEmbedding(textB);
    const similarity = calculateCosineSimilarity(embedA, embedB);

    res.json({
      success: true,
      similarity,
      vectorLength: embedA.length
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Sandbox: OCR a receipt and check fraud status
// @route   POST /api/ai/ocr
// @access  Public
router.post('/ocr', upload.single('receipt'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Please upload a receipt image file' });
  }

  try {
    const ocrResult = await performOCR(req.file.path);
    res.json({
      success: true,
      ocrResult
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
