// index.js
const express = require('express');
const cron = require('node-cron');

// Import rute dan controller
const apiRoutes = require('./routes/api');
const syncController = require('./controllers/syncController');

const app = express();
const PORT = process.env.PORT;

// Middleware agar Express bisa membaca JSON (opsional untuk fitur ke depannya)
app.use(express.json());

// Daftarkan rute API
// Semua endpoint di dalam file api.js akan memiliki awalan '/api'
app.use('/api', apiRoutes);

// Menjalankan Server
app.listen(PORT, () => {
    console.log(`🚀 Server berjalan dengan baik di http://localhost:${PORT}`);
    console.log('⏳ Scheduler siap beroperasi...');

    // ==========================================
    // PENGATURAN CRON JOB (Otomatisasi)
    // ==========================================
    // Kode '*/5 * * * *' artinya script akan dijalankan setiap 5 menit.
    // Jika ingin setiap 1 jam, ganti menjadi '0 * * * *'
    // Jika ingin setiap hari jam 23:00, ganti menjadi '0 23 * * *'
    
    cron.schedule('*/5 * * * *', () => {
        console.log(`\n[${new Date().toLocaleString()}] 🔄 Memulai sinkronisasi otomatis via Cron Job...`);
        
        // Memanggil fungsi syncData dari controller
        // Kita kirimkan parameter (null, null) karena eksekusi ini tidak berasal dari HTTP Request browser
        syncController.syncData(null, null);
    });
});