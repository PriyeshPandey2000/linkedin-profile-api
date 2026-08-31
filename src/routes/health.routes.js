const express = require('express');
const router = express.Router();

// Cheap liveness check -- does NOT touch LinkedIn, just confirms the Node
// process is up and responding. Suitable for uptime monitoring / load
// balancer health checks without burning a LinkedIn request every ping.
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
