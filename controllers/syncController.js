const { localPool, vpsPool } = require('../config/database');

async function syncData(req, res) {
    let connectionLocal;
    let connectionVps;

    try {
        connectionLocal = await localPool.getConnection();
        connectionVps = await vpsPool.getConnection();

        // 1. Tarik data hari ini dari VPS
        const today = new Date().toISOString().split('T')[0];
        const queryVps = `SELECT cloud_id, type, created_at, original_data 
                          FROM t_log 
                          WHERE created_at >= ? 
                          ORDER BY created_at ASC`;

        const [dataVps] = await connectionVps.execute(queryVps, [`${today} 00:00:00`]);

        if (dataVps.length === 0) {
            console.log(`[${new Date().toLocaleString()}] INFO: Tidak ada data log baru.`);
            if (res) return res.status(200).json({ message: 'Tidak ada data baru hari ini.' });
            return;
        }

        await connectionLocal.beginTransaction();

        const queryInsertMasuk = `
            INSERT IGNORE INTO rekap_presensi 
            (id, shift, jam_datang, status, keterlambatan, durasi, keterangan) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        const queryUpdatePulang = `
            UPDATE rekap_presensi 
            SET jam_pulang = ? 
            WHERE id = ? AND DATE(jam_datang) = ?
        `;

        let successCount = 0;

        for (const row of dataVps) {
            let parsedData;
            try {
                parsedData = JSON.parse(row.original_data);
            } catch (e) {
                continue;
            }

            if (parsedData.type !== 'attlog' || !parsedData.data) continue;

            const pinKaryawan = parsedData.data.pin;
            const waktuScan = parsedData.data.scan;
            const statusScan = parsedData.data.status_scan;

            // Ekstrak tanggal saja (YYYY-MM-DD) dari waktuScan (YYYY-MM-DD HH:MM:SS)
            const tanggalScan = waktuScan.split(' ')[0];

            let shift = 'Pagi';
            let status = 'Hadir';
            let keterlambatan = '00:00:00';
            let durasi = '00:00:00';
            let keterangan = 'Sinkronisasi Otomatis';

            if (statusScan === 0) {
                // LOGIKA: ABSEN MASUK
                await connectionLocal.execute(queryInsertMasuk, [
                    pinKaryawan,
                    shift,
                    waktuScan, // jam_datang
                    status,
                    keterlambatan,
                    durasi,
                    keterangan
                ]);
                successCount++;

            } else if (statusScan === 1) {
                // LOGIKA: ABSEN PULANG
                // Kita update baris yang ID-nya sama, dan tanggal jam_datang-nya sama dengan hari ini
                const [updateResult] = await connectionLocal.execute(queryUpdatePulang, [
                    waktuScan,   // SET jam_pulang
                    pinKaryawan, // WHERE id
                    tanggalScan  // AND DATE(jam_datang)
                ]);

                // Jika affectedRows > 0, berarti data masuknya ditemukan dan berhasil diupdate
                if (updateResult.affectedRows > 0) {
                    successCount++;
                } else {
                    console.log(`[INFO] Karyawan ${pinKaryawan} absen pulang tanggal ${tanggalScan} tapi tidak ada data absen masuknya.`);
                }
            }
        }

        await connectionLocal.commit();
        console.log(`[${new Date().toLocaleString()}] SUKSES: ${successCount} baris data disinkronisasi.`);

        if (res) return res.status(200).json({ message: 'Sukses', count: successCount });

    } catch (error) {
        if (connectionLocal) await connectionLocal.rollback();
        console.error(`[ERROR]:`, error.message);
        if (res) return res.status(500).json({ error: error.message });
    } finally {
        if (connectionLocal) connectionLocal.release();
        if (connectionVps) connectionVps.release();
    }
}

module.exports = { syncData };