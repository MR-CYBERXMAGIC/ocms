const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const sc = require('../controllers/submissionController');

router.get('/:submissionId',        requireAuth, sc.getSubmission);
router.get('/:submissionId/status', sc.getSubmissionStatus);

module.exports = router;
