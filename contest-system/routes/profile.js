const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { getMe }       = require('../controllers/profileController');

router.get('/me', requireAuth, getMe);

module.exports = router;
