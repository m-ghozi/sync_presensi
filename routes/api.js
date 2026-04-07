// routes/api.js
const express = require('express');
const router = express.Router();

// Import controller yang sudah kita buat sebelumnya
const syncController = require('../controllers/syncController');

router.get('/sync', syncController.syncData);
router.post('/sync/date', syncController.syncDataByDate);
router.get('/sync/date', syncController.syncDataByDate);

// Export router agar bisa digunakan di index.js
module.exports = router;