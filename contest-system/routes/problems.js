const router = require('express').Router({ mergeParams: true });
const { requireAuth } = require('../middleware/auth');
const pc = require('../controllers/problemController');
const sc = require('../controllers/submissionController');

router.post('/',                                        requireAuth, pc.addProblem);
router.delete('/:problemId',                            requireAuth, pc.removeProblem);
router.post('/:problemId/testcases/bulk',               requireAuth, pc.bulkUploadTestCases);
router.get('/:problemId',                               pc.getProblemDetail);

// Submission routes (nested under contest + problem)
router.post('/:problemId/submit',      requireAuth, sc.submitSolution);
router.get('/:problemId/submissions',  requireAuth, sc.getProblemSubmissions);

module.exports = router;
