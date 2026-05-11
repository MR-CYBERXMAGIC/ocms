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

// SSE — open to anyone with the contest in view
router.get('/:id/events', cc.sseHandler);

// Manager routes — all protected by requireAuth + requireManager
router.get(   '/:id/manager/submissions',                requireAuth, cc.requireManager, cc.getManagerSubmissions);
router.get(   '/:id/manager/submissions/:submissionId',  requireAuth, cc.requireManager, cc.getManagerSubmission);
router.get(   '/:id/manager/stats',                      requireAuth, cc.requireManager, cc.getManagerStats);
router.get(   '/:id/manager/participants',               requireAuth, cc.requireManager, cc.getParticipants);
router.patch( '/:id/manager/participants/:userId/block', requireAuth, cc.requireManager, cc.toggleBlockParticipant);
router.delete('/:id/manager/participants/:userId',       requireAuth, cc.requireManager, cc.removeParticipant);
router.patch( '/:id',                                    requireAuth, cc.requireManager, cc.updateContest);
router.post(  '/:id/end',                                requireAuth, cc.requireManager, cc.endContest);

module.exports = router;
