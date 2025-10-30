// tests/sheetsTool.test.js

const { 
    logToSheet, 
    logSummaryToSheet, 
    loadUserRegistry, 
    registerUser 
} = require('../src/sheetsTool');

// --- "Tipu" Jest (Mocking 'googleapis') ---
// INI BAGIAN YANG BERUBAH
jest.mock('googleapis', () => {
    // 1. Kita HARUS definisikan mock-nya DI DALAM factory ini
    const mockAppend = jest.fn();
    const mockGet = jest.fn();

    return {
        google: {
            auth: {
                GoogleAuth: jest.fn(() => ({})), // Pura-pura auth berhasil
            },
            sheets: jest.fn(() => ({
                spreadsheets: {
                    values: {
                        append: mockAppend, // 2. Gunakan mock-nya
                        get: mockGet,       // 3. Gunakan mock-nya
                    },
                },
            })),
        },
        // 4. Kita "ekspor" mock-nya agar bisa diakses di tes
        __mockAppend: mockAppend,
        __mockGet: mockGet,
    };
});

// --- Ambil referensi mock-nya DARI MOCK YANG SUDAH JADI ---
// INI JUGA BERUBAH
const { __mockAppend: mockAppend, __mockGet: mockGet } = require('googleapis');

// --- Setup Sebelum Tiap Tes ---
beforeEach(() => {
    mockAppend.mockClear();
    mockGet.mockClear();
    mockGet.mockReset(); // Penting untuk reset data 'get'
});

let consoleLogSpy, consoleErrorSpy;

beforeEach(() => {
    // Sembunyikan 'console.log'
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    // Sembunyikan 'console.error'
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // ... (kode 'beforeEach' yang lama biarkan saja)
    mockAppend.mockClear();
    mockGet.mockClear();
    mockGet.mockReset();
});

afterEach(() => {
    // Kembalikan 'console.log' ke normal setelah tes
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
});

// --- Mulai Tes ---
// (BAGIAN describe(...) KE BAWAH SAMA PERSIS, TIDAK PERLU DIUBAH)
describe('sheetsTool.js (Google Sheets Tools)', () => {

    // Test Case 3: logToSheet (Fitur !tugas)
    test('logToSheet harus memanggil "append" dengan range "Sheet1"', async () => {
        mockAppend.mockResolvedValue({ status: 200 }); // Pura-pura sukses

        const taskText = "Budi: Bikin slide";
        await logToSheet(taskText);

        expect(mockAppend).toHaveBeenCalledTimes(1);
        
        expect(mockAppend).toHaveBeenCalledWith(expect.objectContaining({
        range: 'Tugas!A:B', 

            resource: {
                values: [[expect.any(String), taskText]], // Cek datanya benar
            },
        }));
    });

    // Test Case 4: logSummaryToSheet (Fitur !rangkum)
    test('logSummaryToSheet harus memanggil "append" dengan range "Rangkuman"', async () => {
        mockAppend.mockResolvedValue({ status: 200 }); 

        const summaryText = "Rapatnya bahas slide";
        await logSummaryToSheet(summaryText);

        expect(mockAppend).toHaveBeenCalledTimes(1);
        expect(mockAppend).toHaveBeenCalledWith(expect.objectContaining({
            range: 'Rangkuman!A:B', // <-- Ini yang kita tes
        }));
    });

    // Test Case 5: registerUser (Fitur !register)
    test('registerUser harus memanggil "append" dengan range "UserRegistry"', async () => {
        mockAppend.mockResolvedValue({ status: 200 }); 

        await registerUser("id_budi", "Budi");

        expect(mockAppend).toHaveBeenCalledTimes(1);
        expect(mockAppend).toHaveBeenCalledWith(expect.objectContaining({
            range: 'UserRegistry!A:B', // <-- Ini yang kita tes
            resource: {
                values: [["id_budi", "Budi"]],
            },
        }));
    });

    // Test Case 6: loadUserRegistry (Fitur Startup Cache)
    test('loadUserRegistry harus memuat dan mem-format data user dengan benar', async () => {
        // Pura-pura 'get' mengembalikan data dari GSheets
        const mockSheetData = {
            data: {
                values: [
                    ['111@lid', 'Budi'],
                    ['222@lid', 'Ani'],
                    ['333@lid'], // Data rusak (sengaja)
                ]
            }
        };
        mockGet.mockResolvedValue(mockSheetData);

        const userCache = await loadUserRegistry();

        // Harapannya:
        expect(mockGet).toHaveBeenCalledWith(expect.objectContaining({
            range: 'UserRegistry!A2:B', // <-- Cek dia skip header
        }));
        
        // Cek hasilnya jadi objek
        expect(userCache).toEqual({
            '111@lid': 'Budi',
            '222@lid': 'Ani',
        });
        // Cek data yang rusak tidak ikut
        expect(userCache['333@lid']).toBeUndefined();
    });

});