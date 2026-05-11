const router = require('express').Router();
const { getUsers, getUser } = require('../controllers/userController');

router.get('/',           getUsers);
router.get('/:username',  getUser);

module.exports = router;
