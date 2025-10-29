// WAJIB ADA DI BARIS PALING ATAS
// Untuk membaca file .env
require('dotenv').config(); 

const { Client, LocalAuth, Poll } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Impor "otak" kita
const { getLLMResponse } = require('./llm');

console.log("Mulai menjalankan bot...");

const client = new Client({
    authStrategy: new LocalAuth() 
});

client.on('qr', (qr) => {
    console.log("QR CODE DITERIMA, silakan scan:");
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Bot sudah siap dan terhubung!');
});

// ... (kode di atas, 'dotenv', 'whatsapp-web.js', 'llm.js', dll. biarkan saja) ...

client.on('message', async (message) => {
    const chat = await message.getChat();

    if (chat.isGroup) {
        const userMessage = message.body;

        // --- FITUR LAMA: TANYA JAWAB (BIARKAN) ---
        if (userMessage.startsWith('!tanya ')) {
            console.log("Menerima perintah !tanya");
            const question = userMessage.substring(7);
            message.reply('Otak saya sedang berpikir... 🧠 Mohon tunggu sebentar.');
            const answer = await getLLMResponse(question);
            message.reply(answer);
        }

        // --- FITUR BARU: MEMBACA HISTORY (TOOL #1) ---
        else if (userMessage.startsWith('!rangkum ')) {
            console.log("Menerima perintah !rangkum");

            // Ambil angkanya, misal "!rangkum 50" -> ambil "50"
            const limitStr = userMessage.substring(9); 
            const limit = parseInt(limitStr);

            // Validasi input
            if (isNaN(limit) || limit <= 0 || limit > 100) {
                message.reply("Format salah. Coba `!rangkum 50` (maks 100).");
                return; // Hentikan eksekusi
            }

            await message.reply(`Siap! Saya akan baca ${limit} pesan terakhir... 📜`);

            try {
                // Ini dia "TOOL" nya!
                // fetchMessages mengambil pesan, termasuk pesan trigger. 
                // Kita ambil limit + 1 agar pesan "!rangkum" tidak ikut.
                const messages = await chat.fetchMessages({ limit: limit + 1 });

                // Kita ambil semua pesan KECUALI pesan trigger (!rangkum)
                const chatHistory = messages
                    .slice(0, -1) // Hapus pesan terakhir (pesan "!rangkum")
                    .map(msg => `${msg.author || msg.from}: ${msg.body}`); // Format jadi "Pengirim: Isi Pesan"

                const historyText = chatHistory.join('\n');

                // DEBUG: Tampilkan di konsol
                console.log("--- HISTORY YANG BERHASIL DIBACA ---");
                console.log(historyText);
                console.log("-----------------------------------");

                // Respon sukses (BELUM DIKIRIM KE LLM)
                // --- LOGIKA BARU UNTUK MERANGKUM ---

                // Validasi jika tidak ada chat (misal grup baru)
                if (chatHistory.length === 0) {
                    await message.reply("Tidak ada pesan untuk dirangkum (selain perintahmu).");
                    return; // Hentikan eksekusi
                }

                console.log("Mengirim transkrip ke LLM untuk dirangkum...");

                // Ini adalah "Prompt Engineering" pertama kita!
                // Kita beritahu LLM perannya dan apa yang harus dilakukan.
                const summaryPrompt = `
                Anda adalah Notulis Rapat yang cerdas dan efisien. 
                Berikut adalah transkrip obrolan dari grup WhatsApp. Pesan yang lebih baru ada di bagian bawah.

                Tugas Anda adalah merangkum obrolan ini dengan jelas. Fokus pada:
                1.  Poin-poin penting yang didiskusikan.
                2.  Keputusan yang telah dibuat (jika ada).
                3.  Action items atau tugas (siapa harus melakukan apa).

                TRANSKRIP OBROLAN:
                ---
                ${historyText}
                ---

                RANGKUMAN POIN PENTING:
                `;

                // Panggil "otak" dengan prompt yang sudah kita buat
                const summary = await getLLMResponse(summaryPrompt);

                // Kirim hasil rangkuman
                await message.reply(summary);

                // --- AKHIR DARI LOGIKA BARU ---

            } catch (error) {
                console.error("Error saat fetchMessages:", error);
                message.reply("Maaf, saya gagal membaca riwayat chat.");
            }
        }
        // --- FITUR PAMUNGKAS: MEMBUAT POLL (TOOL #3) ---
        else if (userMessage.startsWith('!voting ')) {
            console.log("Menerima perintah !voting");

            const limitStr = userMessage.substring(8); // potong '!voting '
            const limit = parseInt(limitStr);

            if (isNaN(limit) || limit <= 0 || limit > 50) { // Batasi 50 agar tidak terlalu berat
                await message.reply("Format salah. Coba `!voting 20` (maks 50).");
                return; 
            }

            await message.reply(`Oke! Saya analisis ${limit} pesan terakhir untuk dibuat *voting*... 🔍`);

            try {
                const messages = await chat.fetchMessages({ limit: limit + 1 });

                const chatHistory = messages
                    .slice(0, -1) 
                    .map(msg => `${msg.author || msg.from}: ${msg.body}`);

                const historyText = chatHistory.join('\n');

                if (chatHistory.length < 3) { // Butuh minimal 3 pesan untuk didiskusikan
                    await message.reply("Tidak ada diskusi yang cukup untuk dibuat voting.");
                    return; 
                }

                console.log("Mengirim transkrip ke LLM untuk ekstraksi VOTING...");

                // Ini adalah "Prompt Engineering" PALING CANGGIH kita.
                // Kita akan memaksa LLM mengembalikan JSON!
                const proposalPrompt = `
                Anda adalah Notulis Rapat yang bisa mengambil keputusan.
                Baca transkrip obrolan di bawah ini.

                Tugas Anda:
                1.  Identifikasi SATU pertanyaan utama yang sedang diperdebatkan (misal: "Makan di mana?", "Deadline kapan?").
                2.  Ekstrak 2-5 opsi jawaban dari diskusi tersebut.

                Format jawaban Anda HANYA sebagai JSON string yang valid.
                Struktur JSON harus:
                {
                  "question": "PERTANYAAN_VOTING",
                  "options": ["OPSI_1", "OPSI_2", "OPSI_3"]
                }

                Jika tidak ada topik voting yang jelas, kembalikan:
                { "error": "Tidak ada topik voting yang jelas ditemukan dalam diskusi." }

                TRANSKRIP OBROLAN:
                ---
                ${historyText}
                ---

                BERIKAN HANYA JSON STRING:
                `;

                // Panggil "otak" dengan prompt VOTING
                const llmJsonOutput = await getLLMResponse(proposalPrompt);

                console.log("Menerima output JSON dari LLM:", llmJsonOutput);

                // --- BAGIAN BARU: PARSING JSON & MEMBUAT POLL ---
                try {
                    // Bersihkan output LLM (kadang LLM menambah ```json ... ```)
                    let cleanedJson = llmJsonOutput.replace(/```json/g, '').replace(/```/g, '').trim();

                    const pollData = JSON.parse(cleanedJson);

                    // Cek jika LLM bilang error
                    if (pollData.error) {
                        await message.reply(pollData.error);
                        return;
                    }

                    // Validasi data
                    if (!pollData.question || !pollData.options || pollData.options.length < 2) {
                        throw new Error("Format JSON dari LLM tidak valid.");
                    }

                    // INI DIA "TANGAN" AGENT-NYA!
                    // Kita buat Poll sungguhan
                    const poll = new Poll(pollData.question, pollData.options);

                    await message.reply(poll); // Kirim poll ke grup

                } catch (parseError) {
                    console.error("Gagal parse JSON dari LLM:", parseError, "Output LLM:", llmJsonOutput);
                    await message.reply("Otak saya bingung... Saya tidak bisa mengubah diskusi itu menjadi poll.");
                }
                // --- AKHIR BAGIAN PARSING ---

            } catch (error) {
                console.error("Error saat fetchMessages (di !voting):", error);
                await message.reply("Maaf, saya gagal menganalisis voting dari riwayat chat.");
            }
        }

        else if (userMessage === '!testpoll') {
            console.log("Menerima perintah DEBUG !testpoll");

            try {
                await message.reply("Siap, mengirim poll tes...");

                // Kita buat poll palsu (hardcoded)
                const testPoll = new Poll(
                    "Ini Judul Tes Poll",     // Judul
                    ["Opsi A", "Opsi B", "Opsi C"] // Pilihan
                );

                // Langsung kirim
                await message.reply(testPoll);

            } catch (error) {
                console.error("Error saat !testpoll:", error);
                await message.reply("Gagal mengirim poll tes.");
            }
        }
    }
});

client.initialize();