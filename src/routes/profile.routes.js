const express = require('express');
const router = express.Router();

const validateProfileUrl = require('../middleware/validateProfileUrl');
const apiKey = require('../middleware/apiKey');
const profileService = require('../services/profileService');
const logger = require('../logger');

router.post('/profile', apiKey, validateProfileUrl, async (req, res, next) => {
  const { url } = req.body;
  const startedAt = Date.now();

  try {
    const data = await profileService.getProfile(url);
    logger.info('profile scrape succeeded', {
      requestId: req.id,
      url,
      durationMs: Date.now() - startedAt,
    });
    res.json({
      success: true,
      data,
      meta: { scrapedAt: new Date().toISOString(), sourceUrl: url },
    });
  } catch (err) {
    next(err); // -> errorHandler.js
  }
});

module.exports = router;
