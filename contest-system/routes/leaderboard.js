const router             = require('express').Router({ mergeParams: true });
const { requireAuth }    = require('../middleware/auth');
const { getLeaderboard } = require('../controllers/leaderboardController');

router.get('/', requireAuth, getLeaderboard);

module.exports = router;
