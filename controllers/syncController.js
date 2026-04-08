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
            (id, shift, jam_datang, status, keterlambatan, durasi, keterangan, photo) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        // Mendukung pulang di hari yang berbeda: cari baris terakhir yang belum ada jam_pulangnya
        const queryUpdatePulang = `
            UPDATE rekap_presensi 
            SET jam_pulang = ? 
            WHERE id = ? AND jam_datang <= ? AND (jam_pulang IS NULL OR jam_pulang = '0000-00-00 00:00:00' OR jam_pulang = '')
            ORDER BY jam_datang DESC
            LIMIT 1
        `;

        const [keterlambatanRows] = await connectionLocal.execute('SELECT toleransi, terlambat1, terlambat2 FROM set_keterlambatan LIMIT 1');
        const setKeterlambatan = keterlambatanRows.length > 0 ? keterlambatanRows[0] : { toleransi: 0, terlambat1: 0, terlambat2: 0 };
        
        const [jamMasukRows] = await connectionLocal.execute('SELECT shift, jam_masuk FROM jam_masuk');
        const jamMasukMap = {};
        for(let j of jamMasukRows) {
             jamMasukMap[j.shift] = j.jam_masuk;
        }

        let successCount = 0;
        const pegawaiCache = {};
        const shiftCache = {};

        for (const row of dataVps) {
            let parsedData;
            try {
                parsedData = JSON.parse(row.original_data);
            } catch (e) {
                continue;
            }

            if (parsedData.type !== 'attlog' || !parsedData.data) continue;

            const pinKaryawan = parsedData.data.pin;
            
            // Cek id pegawai berdasarkan NIK (pin)
            let pegawaiId = pegawaiCache[pinKaryawan];
            if (pegawaiId === undefined) {
                const [pegawaiRows] = await connectionLocal.execute('SELECT id FROM pegawai WHERE nik = ?', [pinKaryawan]);
                if (pegawaiRows.length > 0) {
                    pegawaiId = pegawaiRows[0].id;
                    pegawaiCache[pinKaryawan] = pegawaiId;
                } else {
                    pegawaiCache[pinKaryawan] = null;
                }
            }

            if (!pegawaiId) {
                console.log(`[INFO] Pegawai dengan NIK/PIN ${pinKaryawan} tidak ditemukan di database lokal. Mengabaikan data absen.`);
                continue;
            }

            const waktuScan = parsedData.data.scan;
            const statusScan = parsedData.data.status_scan;

            // Ekstrak tanggal saja (YYYY-MM-DD) dari waktuScan (YYYY-MM-DD HH:MM:SS)
            const tanggalScan = waktuScan.split(' ')[0];
            const [scanYear, scanMonth, scanDay] = tanggalScan.split('-');
            const dayColumn = `h${parseInt(scanDay, 10)}`;

            const jadwalKey = `${pegawaiId}_${scanYear}_${scanMonth}`;
            let jadwalBulanIni = shiftCache[jadwalKey];

            if (jadwalBulanIni === undefined) {
                const [jadwalRows] = await connectionLocal.execute(
                    'SELECT * FROM jadwal_pegawai WHERE id = ? AND tahun = ? AND bulan = ?',
                    [pegawaiId, scanYear, scanMonth]
                );
                if (jadwalRows.length > 0) {
                    jadwalBulanIni = jadwalRows[0];
                    shiftCache[jadwalKey] = jadwalBulanIni;
                } else {
                    shiftCache[jadwalKey] = null;
                }
            }

            let shift = 'Pagi'; // Default fallback
            if (shiftCache[jadwalKey]) {
                const shiftValue = shiftCache[jadwalKey][dayColumn];
                if (shiftValue !== undefined && shiftValue !== null && shiftValue !== '') {
                    shift = shiftValue;
                }
            }

            let status = 'Tepat Waktu';
            let keterlambatan = '00:00:00';

            if (jamMasukMap[shift]) {
                const shiftJamMasuk = jamMasukMap[shift];
                const scanTime = new Date(waktuScan.replace(' ', 'T')).getTime();
                const shiftTime = new Date(`${tanggalScan}T${shiftJamMasuk}`).getTime();
                
                const diffMs = scanTime - shiftTime;
                if (diffMs > 0) {
                    const diffMins = Math.floor(diffMs / 60000);
                    
                    if (diffMins > 0 && diffMins <= setKeterlambatan.toleransi) {
                        status = 'Terlambat Toleransi';
                    } else if (diffMins > setKeterlambatan.toleransi && diffMins <= setKeterlambatan.terlambat1) {
                        status = 'Terlambat I';
                    } else if (diffMins > setKeterlambatan.terlambat1) {
                        status = 'Terlambat II';
                    }
                    
                    const h = Math.floor(diffMs / 3600000);
                    const m = Math.floor((diffMs % 3600000) / 60000);
                    const s = Math.floor((diffMs % 60000) / 1000);
                    keterlambatan = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
                }
            }

            let durasi = '00:00:00';
            let keterangan = 'Sinkronisasi Otomatis';
            let photo = '';

            if (statusScan === 0) {
                // LOGIKA: ABSEN MASUK
                const [insertResult] = await connectionLocal.execute(queryInsertMasuk, [
                    pegawaiId,
                    shift,
                    waktuScan, // jam_datang
                    status,
                    keterlambatan,
                    durasi,
                    keterangan,
                    photo
                ]);
                
                if (insertResult.affectedRows > 0) {
                    console.log(`[DEBUG] Insert MASUK sukses untuk PIN: ${pinKaryawan} pada ${waktuScan}`);
                    successCount++;
                } else {
                    console.log(`[DEBUG] Insert MASUK diabaikan (sudah ada / data master PIN ${pinKaryawan} tidak aktif di tabel pegawai) pada ${waktuScan}`);
                }

            } else if (statusScan === 1) {
                // LOGIKA: ABSEN PULANG
                // Cari baris absen masuk terakhir yang belum ditutup, meskipun beda hari
                const [updateResult] = await connectionLocal.execute(queryUpdatePulang, [
                    waktuScan,   // SET jam_pulang
                    pegawaiId,   // WHERE id
                    waktuScan    // AND jam_datang <= ?
                ]);

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

async function syncDataByDate(req, res) {
    let connectionLocal;
    let connectionVps;

    // Ambil tanggal dari query string atau body request
    const targetDate = req.query.date || req.body.date;

    if (!targetDate) {
        return res.status(400).json({ error: 'Parameter date (YYYY-MM-DD) diperlukan.' });
    }

    try {
        connectionLocal = await localPool.getConnection();
        connectionVps = await vpsPool.getConnection();

        // 1. Tarik data dari VPS berdasarkan tanggal scan di dalam payload JSON
        const queryVps = `SELECT cloud_id, type, created_at, original_data 
                          FROM t_log 
                          WHERE type = 'attlog' 
                          AND JSON_UNQUOTE(JSON_EXTRACT(original_data, '$.data.scan')) LIKE ?
                          ORDER BY created_at ASC`;

        const [dataVps] = await connectionVps.execute(queryVps, [`${targetDate}%`]);

        if (dataVps.length === 0) {
            console.log(`[${new Date().toLocaleString()}] INFO: Tidak ada data log untuk tanggal ${targetDate}.`);
            if (res) return res.status(200).json({ message: `Tidak ada data untuk tanggal ${targetDate}.` });
            return;
        }

        await connectionLocal.beginTransaction();

        const queryInsertMasuk = `
            INSERT IGNORE INTO rekap_presensi 
            (id, shift, jam_datang, status, keterlambatan, durasi, keterangan, photo) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        // Mendukung pulang di hari yang berbeda: cari baris terakhir yang belum ada jam_pulangnya
        const queryUpdatePulang = `
            UPDATE rekap_presensi 
            SET jam_pulang = ? 
            WHERE id = ? AND jam_datang <= ? AND (jam_pulang IS NULL OR jam_pulang = '0000-00-00 00:00:00' OR jam_pulang = '')
            ORDER BY jam_datang DESC
            LIMIT 1
        `;

        const [keterlambatanRows] = await connectionLocal.execute('SELECT toleransi, terlambat1, terlambat2 FROM set_keterlambatan LIMIT 1');
        const setKeterlambatan = keterlambatanRows.length > 0 ? keterlambatanRows[0] : { toleransi: 0, terlambat1: 0, terlambat2: 0 };
        
        const [jamMasukRows] = await connectionLocal.execute('SELECT shift, jam_masuk FROM jam_masuk');
        const jamMasukMap = {};
        for(let j of jamMasukRows) {
             jamMasukMap[j.shift] = j.jam_masuk;
        }

        let successCount = 0;
        const pegawaiCache = {};
        const shiftCache = {};

        for (const row of dataVps) {
            let parsedData;
            try {
                parsedData = JSON.parse(row.original_data);
            } catch (e) {
                continue;
            }

            if (parsedData.type !== 'attlog' || !parsedData.data) continue;

            const pinKaryawan = parsedData.data.pin;

            // Cek id pegawai berdasarkan NIK (pin)
            let pegawaiId = pegawaiCache[pinKaryawan];
            if (pegawaiId === undefined) {
                const [pegawaiRows] = await connectionLocal.execute('SELECT id FROM pegawai WHERE nik = ?', [pinKaryawan]);
                if (pegawaiRows.length > 0) {
                    pegawaiId = pegawaiRows[0].id;
                    pegawaiCache[pinKaryawan] = pegawaiId;
                } else {
                    pegawaiCache[pinKaryawan] = null;
                }
            }

            if (!pegawaiId) {
                console.log(`[INFO] Pegawai dengan NIK/PIN ${pinKaryawan} tidak ditemukan di database lokal. Mengabaikan data absen.`);
                continue;
            }

            const waktuScan = parsedData.data.scan;
            const statusScan = parsedData.data.status_scan;

            // Ekstrak tanggal saja (YYYY-MM-DD) dari waktuScan (YYYY-MM-DD HH:MM:SS)
            const tanggalScan = waktuScan.split(' ')[0];
            const [scanYear, scanMonth, scanDay] = tanggalScan.split('-');
            const dayColumn = `h${parseInt(scanDay, 10)}`;

            const jadwalKey = `${pegawaiId}_${scanYear}_${scanMonth}`;
            let jadwalBulanIni = shiftCache[jadwalKey];

            if (jadwalBulanIni === undefined) {
                const [jadwalRows] = await connectionLocal.execute(
                    'SELECT * FROM jadwal_pegawai WHERE id = ? AND tahun = ? AND bulan = ?',
                    [pegawaiId, scanYear, scanMonth]
                );
                if (jadwalRows.length > 0) {
                    jadwalBulanIni = jadwalRows[0];
                    shiftCache[jadwalKey] = jadwalBulanIni;
                } else {
                    shiftCache[jadwalKey] = null;
                }
            }

            let shift = 'Pagi'; // Default fallback
            if (shiftCache[jadwalKey]) {
                const shiftValue = shiftCache[jadwalKey][dayColumn];
                if (shiftValue !== undefined && shiftValue !== null && shiftValue !== '') {
                    shift = shiftValue;
                }
            }

            let status = 'Tepat Waktu';
            let keterlambatan = '00:00:00';

            if (jamMasukMap[shift]) {
                const shiftJamMasuk = jamMasukMap[shift];
                const scanTime = new Date(waktuScan.replace(' ', 'T')).getTime();
                const shiftTime = new Date(`${tanggalScan}T${shiftJamMasuk}`).getTime();
                
                const diffMs = scanTime - shiftTime;
                if (diffMs > 0) {
                    const diffMins = Math.floor(diffMs / 60000);
                    
                    if (diffMins > 0 && diffMins <= setKeterlambatan.toleransi) {
                        status = 'Terlambat Toleransi';
                    } else if (diffMins > setKeterlambatan.toleransi && diffMins <= setKeterlambatan.terlambat1) {
                        status = 'Terlambat I';
                    } else if (diffMins > setKeterlambatan.terlambat1) {
                        status = 'Terlambat II';
                    }
                    
                    const h = Math.floor(diffMs / 3600000);
                    const m = Math.floor((diffMs % 3600000) / 60000);
                    const s = Math.floor((diffMs % 60000) / 1000);
                    keterlambatan = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
                }
            }

            let durasi = '00:00:00';
            let keterangan = 'Sinkronisasi Otomatis (By Date)';
            let photo = '';

            if (statusScan === 0) {
                // LOGIKA: ABSEN MASUK
                const [insertResult] = await connectionLocal.execute(queryInsertMasuk, [
                    pegawaiId,
                    shift,
                    waktuScan, // jam_datang
                    status,
                    keterlambatan,
                    durasi,
                    keterangan,
                    photo
                ]);
                
                if (insertResult.affectedRows > 0) {
                    console.log(`[DEBUG] Insert MASUK sukses untuk PIN: ${pinKaryawan} pada ${waktuScan}`);
                    successCount++;
                } else {
                    console.log(`[DEBUG] Insert MASUK diabaikan (sudah ada / data master PIN ${pinKaryawan} tidak ada di tabel pegawai) pada ${waktuScan}`);
                }

            } else if (statusScan === 1) {
                // LOGIKA: ABSEN PULANG
                // Cari baris absen masuk terakhir yang belum ditutup, meskipun beda hari
                const [updateResult] = await connectionLocal.execute(queryUpdatePulang, [
                    waktuScan,   // SET jam_pulang
                    pegawaiId,   // WHERE id
                    waktuScan    // AND jam_datang <= ?
                ]);

                if (updateResult.affectedRows > 0) {
                    successCount++;
                } else {
                    console.log(`[INFO] Karyawan ${pinKaryawan} absen pulang tanggal ${tanggalScan} tapi tidak ada data absen masuknya.`);
                }
            }
        }

        await connectionLocal.commit();
        console.log(`[${new Date().toLocaleString()}] SUKSES: ${successCount} baris data disinkronisasi untuk tanggal ${targetDate}.`);

        if (res) return res.status(200).json({ message: 'Sukses', count: successCount, date: targetDate });

    } catch (error) {
        if (connectionLocal) await connectionLocal.rollback();
        console.error(`[ERROR]:`, error.message);
        if (res) return res.status(500).json({ error: error.message });
    } finally {
        if (connectionLocal) connectionLocal.release();
        if (connectionVps) connectionVps.release();
    }
}

module.exports = { syncData, syncDataByDate };