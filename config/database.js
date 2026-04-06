require('dotenv').config();
const mysql = require('mysql2/promise');

// Membuat Pool Koneksi untuk Database Lokal
const localPool = mysql.createPool({
    host: process.env.LOCAL_DB_HOST,
    user: process.env.LOCAL_DB_USER,
    password: process.env.LOCAL_DB_PASS,
    database: process.env.LOCAL_DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Membuat Pool Koneksi untuk Database VPS
const vpsPool = mysql.createPool({
    host: process.env.VPS_DB_HOST,
    user: process.env.VPS_DB_USER,
    password: process.env.VPS_DB_PASS,
    database: process.env.VPS_DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test Koneksi (Opsional, tapi bagus untuk memastikan koneksi awal berhasil)
async function testConnection() {
    try {
        const connectionLocal = await localPool.getConnection();
        console.log('✅ Berhasil terhubung ke Database Lokal');
        connectionLocal.release(); // Kembalikan koneksi ke pool

        const connectionVps = await vpsPool.getConnection();
        console.log('✅ Berhasil terhubung ke Database VPS');
        connectionVps.release();
    } catch (error) {
        console.error('❌ Gagal terhubung ke database:', error.message);
    }
}

// Jalankan test koneksi saat file ini dipanggil
testConnection();

// Export kedua pool agar bisa digunakan di file controller nanti
module.exports = {
    localPool,
    vpsPool
};