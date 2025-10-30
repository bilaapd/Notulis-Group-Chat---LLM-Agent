require('dotenv').config(); 

const { Client, LocalAuth, Poll } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const { getLLMResponse } = require('./llm');
const { loadUserRegistry, registerUser, logToSheet, logSummaryToSheet } = require('./sheetsTool');
const { log, error } = require('./logger');

// Formatting
function formatForWA(text) {
    return text.replace(/\*\*/g, '*');
}

function formatForSheets(text) {
    return text.replace(/\*\*/g, ''); 
}

let userCache = {};

log("Mulai menjalankan bot...");

const client = new Client({
    authStrategy: new LocalAuth() 
});

client.on('qr', (qr) => {
    console.log("QR CODE DITERIMA, silakan scan:");
    qrcode.generate(qr, { small: true });
});

// Load user from google spreadsheet
client.on('ready', async () => { 
    log('Bot sudah siap dan terhubung!');

    console.log("Memuat memori (User Cache)...");
    userCache = await loadUserRegistry();
    log(`Memori berhasil dimuat! ${Object.keys(userCache).length} user terdaftar.`);
});

// Processing the chat history
async function buildChatHistory(chat, limit) {
    try {
        const messages = await chat.fetchMessages({ limit: limit + 1 });

        const promises = messages
            .slice(0, -1)
            .map(async (msg) => {
                const contact = await msg.getContact();
                const userId = msg.author || msg.from;

                const senderName = userCache[userId] || contact.pushname || contact.name || userId;
                return `${senderName}: ${msg.body}`;
            });

        const chatHistory = await Promise.all(promises);

        if (chatHistory.length === 0) {
            return null; 
        }

        return chatHistory.join('\n'); 

    } catch (error) {
        error("Error di buildChatHistory:", error);
        return null; 
    }
}

client.on('message', async (message) => {
    const chat = await message.getChat();

    if (chat.isGroup) {
        const userMessage = message.body;

        // Fitur help
        if (userMessage === '!help') {
            log("Menerima perintah !help");

            const helpMessage = `
Halo! Saya *Notulis Agent*, asisten rapatmu. 🤖

Untuk awalan penggunaan, *tolong register namamu dulu ya!*
Ini penting agar namamu dikenali dengan benar di dalam rangkuman dan daftar tugas.

Ketik: \`!register <NamaPanggilanKamu>\`
Contoh: \`!register Budi\`

---

Setelah kamu terdaftar, ini adalah daftar perintah yang bisa kamu gunakan:

*FITUR UTAMA (NOTULENSI)*
1. *!rangkum <jumlah>*
   Merangkum <jumlah> pesan terakhir.
   ➤ Hasilnya juga otomatis diarsipkan ke *Google Sheets*.
   Contoh: \`!rangkum 50\`

2. *!tugas <jumlah>*
   Mengekstrak daftar tugas (action items) dari <jumlah> pesan terakhir.
   ➤ Otomatis disimpan ke *Google Sheets*.
   Contoh: \`!tugas 30\`

3. *!voting <jumlah>*
   Membuat poll/voting otomatis dari <jumlah> pesan terakhir yang berisi perdebatan.
   Contoh: \`!voting 20\`

*FITUR LAINNYA*
4. *!tanya <pertanyaan>*
   Tanya apa saja ke "otak" LLM saya.
   Contoh: \`!tanya apa itu blockchain?\`

5. *!help*
   Menampilkan pesan bantuan ini.
    `;
            await message.reply(helpMessage.trim()); 
        }
        
        // For regist user
        else if (userMessage.startsWith('!register ')) {
            log("Menerima perintah !register");

            const userName = userMessage.substring(10).trim();
            const userId = message.author || message.from;

            if (!userName) {
                await message.reply("Format salah. Coba `!register NamaPanggilanKamu` (tanpa spasi).");
                return;
            }

            await message.reply(`Mencoba mendaftarkan kamu sebagai *${userName}*...`);

            const success = await registerUser(userId, userName);

            if (success) {
                userCache[userId] = userName; 
                await message.reply(`Berhasil! Mulai sekarang, kamu akan dipanggil *${userName}* oleh bot.`);
            } else {
                await message.reply("Maaf, terjadi kesalahan saat mendaftar ke database rahasia.");
            }
        }

        else if (userMessage.startsWith('!debug_history ')) {
            log("Menerima perintah DEBUG !debug_history");
            
            const limitStr = userMessage.substring(15).trim();
            const limit = parseInt(limitStr);

            if (isNaN(limit) || limit <= 0 || limit > 50) {
                await message.reply("Format salah. Coba `!debug_history 5` (maks 50).");
                return;
            }

            await message.reply(`Siap, mengambil transkrip mentah ${limit} pesan terakhir... 🛠️`);
            
            const historyText = await buildChatHistory(chat, limit);

            if (!historyText) {
                await message.reply("Tidak ada history untuk ditampilkan.");
                return; 
            }

            const debugReply = `
--- HASIL TRANSKRIP MENTAH ---
\`\`\`${historyText}\`\`\`
            `;
            
            await message.reply(debugReply.trim());
        }
        
        else if (userMessage.startsWith('!tanya ')) {
            log("Menerima perintah !tanya");
            const question = userMessage.substring(7);
            message.reply('Otak saya sedang berpikir... 🧠 Mohon tunggu sebentar.');
            const answer = await getLLMResponse(question);

            const formattedAnswer = formatForWA(answer);
            await message.reply(formattedAnswer);
        }
        
        // Summarize 
        else if (userMessage.startsWith('!rangkum ')) {
            log("Menerima perintah !rangkum");

            const limitStr = userMessage.substring(9); 
            const limit = parseInt(limitStr);

            if (isNaN(limit) || limit <= 0 || limit > 100) {
                message.reply("Format salah. Coba `!rangkum 50` (maks 100).");
                return; 
            }

            await message.reply(`Siap! Saya akan baca ${limit} pesan terakhir... 📜`);

            try {
                const historyText = await buildChatHistory(chat, limit);

                if (!historyText) {
                    await message.reply("Tidak ada pesan untuk dirangkum (selain perintahmu).");
                    return;
                }

                console.log("--- HISTORY YANG BERHASIL DIBACA ---");
                console.log(historyText);
                console.log("-----------------------------------");

                if (chatHistory.length === 0) {
                    await message.reply("Tidak ada pesan untuk dirangkum (selain perintahmu).");
                    return; 
                }

                log("Mengirim transkrip ke LLM untuk dirangkum...");

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

                const summary = await getLLMResponse(summaryPrompt);

                // Formatting summary
                const formattedSummaryWA = formatForWA(summary);
                const formattedSummarySheets = formatForSheets(summary);

                // Send to Spreadsheet
                const logged = await logSummaryToSheet(formattedSummarySheets);
                let finalReply = formattedSummaryWA; 

                if (logged) {
                    finalReply += "\n\n(✅ Berhasil diarsipkan ke Google Sheets!) \nLink Google Sheets: https://docs.google.com/spreadsheets/d/1q3nesDRyfdz9mAhk4o574RKi9BHzGeD7IhArCyV56Xs/edit?usp=sharing";
                } else {
                    finalReply += "\n\n(⚠️ Gagal mengarsipkan ke Google Sheets.)";
                }
            
                await message.reply(finalReply);

            } catch (error) {
                error("Error saat fetchMessages:", error);
                message.reply("Maaf, saya gagal membaca riwayat chat.");
            }
        }

        else if (userMessage.startsWith('!tugas ')) {
            log("Menerima perintah !tugas");

            const limitStr = userMessage.substring(7); 
            const limit = parseInt(limitStr);

            if (isNaN(limit) || limit <= 0 || limit > 100) {
                await message.reply("Format salah. Coba `!tugas 30` (maks 100).");
                return; 
            }

            await message.reply(`Siap! Saya cari *daftar tugas* dari ${limit} pesan terakhir... 📝`);

            try {
                const historyText = await buildChatHistory(chat, limit);

                if (!historyText) {
                    await message.reply("Tidak ada pesan untuk dirangkum (selain perintahmu).");
                    return; 
                }

                if (chatHistory.length === 0) {
                    await message.reply("Tidak ada pesan untuk dianalisis.");
                    return; 
                }

                log("Mengirim transkrip ke LLM untuk ekstraksi TUGAS...");

                const actionItemPrompt = `
                Anda adalah asisten Notulis Rapat yang sangat teliti.
                Fokus Anda HANYA pada TUGAS.

                TRANSKRIP OBROLAN:
                ---
                ${historyText}
                ---

                Tugas Anda:
                Ekstrak SEMUA action items (tugas) dari transkrip di atas.
                Tuliskan siapa yang bertanggung jawab dan apa tugasnya.
                Format jawaban sebagai daftar poin (bullet points).
                Jika TIDAK ADA TUGAS, jawab "Tidak ada tugas atau action item yang ditemukan."

                DAFTAR TUGAS:
                `;

                const tasks = await getLLMResponse(actionItemPrompt);
                const formattedTasks = formatForWA(tasks);
                const formattedTasksSheets = formatForSheets(tasks);

                // Send to Spreadsheet
                const logged = await logToSheet(formattedTasksSheets);

                let finalReply = formattedTasks; 

                if (logged) {
                    finalReply += "\n\n(✅ Berhasil dicatat ke Google Sheets!) \nLink Google Sheets: https://docs.google.com/spreadsheets/d/1q3nesDRyfdz9mAhk4o574RKi9BHzGeD7IhArCyV56Xs/edit?usp=sharing";
                } else {
                    finalReply += "\n\n(⚠️ Gagal mencatat ke Google Sheets.)";
                }

                await message.reply(finalReply);

            } catch (error) {
                error("Error saat fetchMessages (di !tugas):", error);
                await message.reply("Maaf, saya gagal menganalisis tugas dari riwayat chat.");
            }
        }

        // Voting: create poll on whatsapp
        else if (userMessage.startsWith('!voting ')) {
            log("Menerima perintah !voting");

            const limitStr = userMessage.substring(8); 
            const limit = parseInt(limitStr);

            if (isNaN(limit) || limit <= 0 || limit > 50) { 
                await message.reply("Format salah. Coba `!voting 20` (maks 50).");
                return; 
            }

            await message.reply(`Oke! Saya analisis ${limit} pesan terakhir untuk dibuat *voting*... 🔍`);

            try {
                const historyText = await buildChatHistory(chat, limit);

            if (!historyText) {
                await message.reply("Tidak ada pesan untuk dirangkum (selain perintahmu).");
                return; 
            }

                if (chatHistory.length < 3) { 
                    await message.reply("Tidak ada diskusi yang cukup untuk dibuat voting.");
                    return; 
                }

                log("Mengirim transkrip ke LLM untuk ekstraksi VOTING...");

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

                // Get response (json type)
                const llmJsonOutput = await getLLMResponse(proposalPrompt);

                log("Menerima output JSON dari LLM:", llmJsonOutput);

                try {
                    let cleanedJson = llmJsonOutput.replace(/```json/g, '').replace(/```/g, '').trim();

                    const pollData = JSON.parse(cleanedJson);

                    if (pollData.error) {
                        await message.reply(pollData.error);
                        return;
                    }

                    if (!pollData.question || !pollData.options || pollData.options.length < 2) {
                        throw new Error("Format JSON dari LLM tidak valid.");
                    }
                    
                    // Create poll
                    const poll = new Poll(pollData.question, pollData.options);

                    await message.reply(poll); 

                } catch (parseError) {
                    error("Gagal parse JSON dari LLM:", parseError, "Output LLM:", llmJsonOutput);
                    await message.reply("Otak saya bingung... Saya tidak bisa mengubah diskusi itu menjadi poll.");
                }

            } catch (error) {
                error("Error saat fetchMessages (di !voting):", error);
                await message.reply("Maaf, saya gagal menganalisis voting dari riwayat chat.");
            }
        }

        // Debug for creating polling on Whatsapp
        else if (userMessage === '!testpoll') {
            log("Menerima perintah DEBUG !testpoll");

            try {
                await message.reply("Siap, mengirim poll tes...");

                const testPoll = new Poll(
                    "Ini Judul Tes Poll",
                    ["Opsi A", "Opsi B", "Opsi C"]
                );

                await message.reply(testPoll);

            } catch (error) {
                error("Error saat !testpoll:", error);
                await message.reply("Gagal mengirim poll tes.");
            }
        }
    }
});

client.initialize();