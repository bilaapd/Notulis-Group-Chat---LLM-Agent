// tests/llm.test.js

const { getLLMResponse } = require('../src/llm');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- "Tipu" Jest ---
// Kita mock seluruh library-nya
jest.mock('@google/generative-ai', () => {
    // Siapkan fungsi mock yang bisa kita mata-matai
    const mockGenerateContent = jest.fn();
    const mockGetGenerativeModel = jest.fn(() => ({
        generateContent: mockGenerateContent,
    }));
    
    // Kembalikan struktur class palsu
    return {
        GoogleGenerativeAI: jest.fn(() => ({
            getGenerativeModel: mockGetGenerativeModel,
        })),
        // Simpan referensi ke mock-nya agar bisa kita atur di tes
        __mockGenerateContent: mockGenerateContent, 
    };
});

// --- Setup Sebelum Tiap Tes ---
// Kita harus 'reset' mock-nya setiap kali
beforeEach(() => {
    // Bersihkan history panggilan
    require('@google/generative-ai').__mockGenerateContent.mockClear();
    // Reset implementasi default
    require('@google/generative-ai').__mockGenerateContent.mockReset();
});

// ... (setelah semua require)

// --- Siapkan Mata-mata untuk membungkam console ---
let consoleLogSpy, consoleErrorSpy;

beforeEach(() => {
    // Sembunyikan 'console.log'
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    // Sembunyikan 'console.error'
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // ... (kode 'beforeEach' yang lama biarkan saja)
    require('@google/generative-ai').__mockGenerateContent.mockClear();
    require('@google/generative-ai').__mockGenerateContent.mockReset();
});

afterEach(() => {
    // Kembalikan 'console.log' ke normal setelah tes
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
});


// --- Mulai Tes ---

describe('getLLMResponse (src/llm.js)', () => {

    // Test Case 1: Skenario Sukses
    test('harus mengembalikan teks respon saat API sukses', async () => {
        // Atur agar 'generateContent' pura-pura berhasil
        const mockGenerateContent = require('@google/generative-ai').__mockGenerateContent;
        mockGenerateContent.mockResolvedValue({
            response: {
                text: () => 'Ini adalah respon sukses.',
            },
        });

        const prompt = 'Halo!';
        const response = await getLLMResponse(prompt);

        // Harapannya:
        expect(response).toBe('Ini adalah respon sukses.');
        expect(mockGenerateContent).toHaveBeenCalledWith(prompt);
    });

    // Test Case 2: Skenario Gagal
    test('harus mengembalikan pesan error kustom saat API gagal (fetch failed)', async () => {
        // Atur agar 'generateContent' pura-pura error
        const mockGenerateContent = require('@google/generative-ai').__mockGenerateContent;
        mockGenerateContent.mockRejectedValue(new Error('Fetch failed'));

        const prompt = 'Halo!';
        const response = await getLLMResponse(prompt);

        // Harapannya:
        expect(response).toBe("Maaf, terjadi kesalahan saat menghubungi 'otak' saya.");
    });
});