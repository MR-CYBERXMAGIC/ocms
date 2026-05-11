const router = require('express').Router({ mergeParams: true });
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const pc = require('../controllers/problemController');
const sc = require('../controllers/submissionController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

router.post('/',                                             requireAuth, pc.addProblem);
router.delete('/:problemId',                                 requireAuth, pc.removeProblem);
router.post('/:problemId/testcases/bulk', requireAuth, upload.single('file'), pc.bulkUploadTestCases);
router.get('/:problemId',                                    pc.getProblemDetail);

// Submission routes (nested under contest + problem)
router.post('/:problemId/submit',      requireAuth, sc.submitSolution);
router.get('/:problemId/submissions',  requireAuth, sc.getProblemSubmissions);

module.exports = router;
