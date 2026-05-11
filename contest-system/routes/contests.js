const router          = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const cc              = require('../controllers/contestController');

router.get('/',               cc.listContests);
router.post('/',              requireAuth, cc.createContest);
router.get('/:id',            cc.getContest);
router.post('/:id/join',      requireAuth, cc.joinContest);
router.get('/:id/problems',   cc.getContestProblems);

// Leaderboard sub-router (mergeParams: true → inherits :id)
router.use('/:id/leaderboard', require('./leaderboard'));

// Problem sub-router (mergeParams: true → inherits :id)
router.use('/:id/problems', require('./problems'));

// Manager routes — all protected by requireAuth + requireManager
router.get( '/:id/manager/submissions',                requireAuth, cc.requireManager, cc.getManagerSubmissions);
router.get( '/:id/manager/submissions/:submissionId',  requireAuth, cc.requireManager, cc.getManagerSubmission);
router.get( '/:id/manager/stats',                      requireAuth, cc.requireManager, cc.getManagerStats);
router.patch('/:id',                                   requireAuth, cc.requireManager, cc.updateContest);
router.post( '/:id/end',                               requireAuth, cc.requireManager, cc.endContest);

module.exports = router;
