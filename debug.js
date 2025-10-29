// WAJIB ADA DI BARIS PALING ATAS
// Untuk membaca file .env
require('dotenv').config();

// Impor "otak" kita dari src/llm.js
const { getLLMResponse } = require('./src/llm');

// Ini adalah fungsi 'main' untuk menjalankan tes
async function runTest() {
    console.log("Menjalankan mode debug...");

    // --- GANTI INI DENGAN PERTANYAANMU ---
    const testPrompt = "Siapa presiden pertama Indonesia?";
    // ------------------------------------

    console.log(`Mengirim prompt tes: "${testPrompt}"`);

    // Panggil "otak" secara langsung
    const response = await getLLMResponse(testPrompt);

    console.log("\n--- HASIL DARI LLM ---");
    console.log(response);
    console.log("------------------------");
    console.log("Debug selesai.");
}

// Jalankan fungsi tes
runTest();