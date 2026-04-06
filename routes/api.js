// routes/api.js
const express = require('express');
const router = express.Router();

// Import controller yang sudah kita buat sebelumnya
const syncController = require('../controllers/syncController');

router.get('/sync', syncController.syncData);

// Export router agar bisa digunakan di index.js
module.exports = router;