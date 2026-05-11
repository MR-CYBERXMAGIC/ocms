const router = require('express').Router();
const { register, login, logout, me, updateMe, deleteMe } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

router.post('/register',  register);
router.post('/login',     login);
router.post('/logout',    logout);
router.get('/me',         me);
router.patch('/me',       requireAuth, updateMe);
router.delete('/me',      requireAuth, deleteMe);

module.exports = router;
