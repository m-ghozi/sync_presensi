# sync_presensi

API & Scheduler untuk sinkronisasi data presensi dari DB VPS (Fingerspot) ke database lokal secara otomatis.

## Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MySQL2
- **Scheduler**: node-cron
- **Config**: dotenv

## Cara Pakai

```bash
# Install dependencies
npm install

# Jalankan server
npm start
```

Server berjalan di `http://localhost:3000`

## Scheduler

Cron job berjalan otomatis setiap **5 menit** untuk sinkronisasi data dari VPS ke lokal.

Untuk mengubah interval, edit di `index.js`:
```js
cron.schedule('*/5 * * * *', ...) // setiap 5 menit
cron.schedule('0 * * * *', ...)   // setiap 1 jam
cron.schedule('0 23 * * *', ...)  // setiap hari jam 23:00
```

## Endpoints

| Method | URL | Keterangan |
|--------|-----|------------|
| GET | `/api/sync` | Sinkronisasi manual semua data |
| GET | `/api/sync/date?date=YYYY-MM-DD` | Sinkronisasi berdasarkan tanggal |

## Environment Variables

Buat file `.env` di root project (lihat `.env.example`):

```env
# Database Lokal
LOCAL_DB_HOST=127.0.0.1
LOCAL_DB_USER=root
LOCAL_DB_PASS=
LOCAL_DB_NAME=nama_database_lokal

# Database VPS (Fingerspot)
VPS_DB_HOST=
VPS_DB_USER=
VPS_DB_PASS=
VPS_DB_NAME=

# App
PORT=3000
```

## Struktur Folder

```
sync_presensi/
├── config/          # Konfigurasi koneksi database
├── controllers/     # Logic sinkronisasi (syncController.js)
├── routes/          # Definisi endpoint API
├── index.js         # Entry point
└── .env             # Environment variables (jangan di-commit!)
```
