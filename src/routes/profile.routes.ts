import express from 'express';
import type { Request, Response, NextFunction } from 'express';

import validateProfileUrl from '../middleware/validateProfileUrl';
import apiKey from '../middleware/apiKey';
import { profileService } from '../services/profileService';
import { logger } from '../logger';

const router = express.Router();

router.post('/profile', apiKey, validateProfileUrl, async (req: Request, res: Response, next: NextFunction) => {
  const body = req.body as { url: string };
  const { url } = body;
  const startedAt = Date.now();

  try {
    const { data, scrapedAt, cached } = await profileService.getProfile(url);
    logger.info('profile scrape succeeded', {
      requestId: req.id,
      url,
      cached,
      durationMs: Date.now() - startedAt,
    });
    res.json({
      success: true,
      data,
      meta: {
        scrapedAt: new Date(scrapedAt).toLocaleString('en-US', {
          dateStyle: 'medium',
          timeStyle: 'medium',
        }),
        cached,
        sourceUrl: url,
      },
    });
  } catch (err) {
    next(err); // -> errorHandler.ts
  }
});

export default router;
