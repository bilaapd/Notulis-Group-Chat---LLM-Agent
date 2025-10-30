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
let meetingStartMarkers = {};

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

// Processing array text to history
async function processMessagesToHistory(messages, userCache) {
    try {
        const promises = messages.map(async (msg) => {
            const contact = await msg.getContact();
            const userId = msg.author || msg.from;
            const senderName = userCache[userId] || contact.pushname || contact.name || userId;
            return `${senderName}: ${msg.body}`;
        });

        const chatHistory = await Promise.all(promises);
        return chatHistory.join('\n');

    } catch (e) {
        error("Error di processMessagesToHistory:", e);
        return null;
    }
}

// Processing the chat history
async function buildChatHistory(chat, limit) {
    try {
        const messages = await chat.fetchMessages({ limit: limit + 1 });
        const relevantMessages = messages.slice(0, -1); // Buang pesan perintah

        if (relevantMessages.length === 0) {
            return null;
        }

        return await processMessagesToHistory(relevantMessages, userCache);

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
Ini penting agar namamu dikenali dengan benar di dalam rangkuman.

Ketik: \`!register <NamaPanggilanKamu>\`
Contoh: \`!register Budi\`

---

### 🚀 Alur Rapat (Cara Terbaik)

1. *MULAI:* Ketik \`!mulaiRapat\` untuk menandai dimulainya rapat.  
2. *SELESAI:* Ketik \`!rangkum\` untuk mengakhiri rapat & mendapatkan rangkuman lengkap.

---

### 🆘 Fitur Darurat (Jika Lupa)

* *Lupa \`!mulaiRapat\`?*  
  - *Scroll ke atas* ke pesan awal rapat.  
  - *Reply* pesan itu dan ketik: \`!mulaiDariSini\`  
  - Saya akan menganggap rapat dimulai dari pesan yang kamu reply.

* *Salah Pencet?*  
  - Ketik \`!batalRapat\` untuk membatalkan penanda rapat yang aktif.

---

### 🛠️ Daftar Perintah Lengkap

Perintah utama saya sekarang "pintar". Mereka akan bekerja secara berbeda tergantung apakah rapat sedang aktif atau tidak.

1. *!rangkum [jumlah_opsional]*  
   ➤ *Jika rapat aktif:* Merangkum *SELURUH RAPAT* (dari \`!mulaiRapat\` sampai sekarang) dan otomatis mengakhiri rapat.  
   ➤ *Jika tidak ada rapat:* Merangkum <jumlah> pesan terakhir secara manual.  
   *(Otomatis tersimpan ke Google Sheets)*  
   Contoh manual: \`!rangkum 50\`

2. *!tugas [jumlah_opsional]*  
   ➤ *Jika rapat aktif:* Mengekstrak tugas dari *SELURUH RAPAT* (rapat tetap berjalan).  
   ➤ *Jika tidak ada rapat:* Mengekstrak tugas dari <jumlah> pesan terakhir.  
   *(Otomatis tersimpan ke Google Sheets)*  
   Contoh manual: \`!tugas 30\`

3. *!voting [jumlah_opsional]*  
   ➤ *Jika rapat aktif:* Menganalisis *SELURUH RAPAT* untuk membuat 1 poll (rapat tetap berjalan).  
   ➤ *Jika tidak ada rapat:* Membuat poll dari <jumlah> pesan terakhir.  
   Contoh manual: \`!voting 20\`

---

### 🧠 Fitur Lainnya

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

        // Mark new started meeting marker when user forget
        else if (userMessage === '!mulaiDariSini') {
            log("Menerima perintah !mulaiDariSini");
            
            if (!message.hasQuotedMsg) {
                await message.reply("❌ *Perintah salah!*\nKamu harus *me-reply* (membalas) sebuah pesan untuk menandai titik awal rapat.");
                return;
            }

            const quotedMsg = await message.getQuotedMessage();
            const chatId = chat.id._serialized;

            if (meetingStartMarkers[chatId]) {
                await message.reply("⚠️ *Peringatan:*\nRapat lain sedang aktif. Saya akan menimpanya dengan penanda baru dari pesan yang kamu reply.");
            }

            meetingStartMarkers[chatId] = quotedMsg.timestamp; 
            
            const startDate = new Date(quotedMsg.timestamp * 1000);
            const formattedDate = startDate.toLocaleString('id-ID', { 
                hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'long' 
            });

            await message.reply(`🫡 *Rapat resmi dimulai (secara retroaktif)!*\n\nSaya akan mencatat semua pesan *setelah*:\n"${quotedMsg.body}"\n(pada ${formattedDate})\n\nKetik \`!rangkum\`/\`!tugas\`/\`!voting\` untuk mengakhiri rapat.`);
        }

        // Start meeting
        else if (userMessage === '!mulaiRapat') {
            log("Menerima perintah !mulaiRapat");
            const chatId = chat.id._serialized;
            
            if (meetingStartMarkers[chatId]) {
                await message.reply("⚠️ *Rapat lain sudah aktif.*\nKetik `!batalRapat` dulu jika ingin memulai yang baru dari awal.");
                return; 
            }

            meetingStartMarkers[chatId] = message.timestamp; 
            
            await message.reply("🫡 *Rapat resmi dimulai!* \nSaya akan mencatat semua pesan dari titik ini. Ketik `!rangkum` untuk mendapatkan rangkuman dan mengakhiri rapat. Anda juga dapat melakukan perintah \`!tugas\` dan \`!voting\`.");
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
        else if (userMessage.startsWith('!rangkum')) {
            const chatId = chat.id._serialized;
            const startTimestamp = meetingStartMarkers[chatId];

            if (startTimestamp) {
                log("Menerima perintah !rangkum (Mode Rapat Aktif)");
                await message.reply("Siap! Rapat sedang aktif. Saya rangkum dulu ya... 📜\nIni mungkin butuh waktu jika diskusinya panjang.");
                
                try {
                    const allMessages = await chat.fetchMessages({ limit: 1000 }); 

                    // Filter message from markers
                    const meetingMessages = allMessages.filter(msg => 
                        msg.timestamp >= startTimestamp && msg.id._serialized !== message.id._serialized
                    );

                    if (meetingMessages.length === 0) {
                        await message.reply("Tidak ada pesan yang tercatat sejak rapat dimulai.");
                        delete meetingStartMarkers[chatId]; 
                        return;
                    }
                    
                    if (meetingMessages.length >= 999) {
                         await message.reply("⚠️ *Peringatan:* Diskusi ini sangat panjang (> 1000 pesan). Saya hanya akan merangkum 1000 pesan terakhir sejak rapat dimulai.");
                    }

                    meetingMessages.reverse(); 

                    const CHUNK_SIZE = 100;
                    let intermediateSummaries = [];

                    log(`Memulai proses chunking untuk ${meetingMessages.length} pesan...`);

                    // Summarize per chunks
                    for (let i = 0; i < meetingMessages.length; i += CHUNK_SIZE) {
                        const chunk = meetingMessages.slice(i, i + CHUNK_SIZE);
                        const historyText = await processMessagesToHistory(chunk, userCache); // Pastikan kamu punya fungsi ini
                        
                        if (historyText) {
                            const summaryPrompt = `
                            Ini adalah bagian ke-${Math.floor(i / CHUNK_SIZE) + 1} dari transkrip rapat. 
                            Tolong rangkum poin-poin penting dari transkrip ini.

                            TRANSKRIP BAGIAN INI:
                            ---
                            ${historyText}
                            ---

                            RANGKUMAN BAGIAN INI:
                            `;
                            const interimSummary = await getLLMResponse(summaryPrompt);
                            intermediateSummaries.push(interimSummary);
                        }
                    }

                    log("Semua chunk selesai. Membuat rangkuman final...");

                    // Combine all chunks' summary
                    let finalSummaryText = "";
                    
                    if (intermediateSummaries.length === 1) {
                        finalSummaryText = intermediateSummaries[0];
                    } else {
                        const combinedSummaries = intermediateSummaries.join("\n\n---\n\n");
                        const finalPrompt = `
                        Anda adalah Notulis Rapat. Di bawah ini adalah beberapa rangkuman parsial dari sebuah rapat yang panjang. 
                        Tugas Anda adalah menggabungkan semua rangkuman ini menjadi SATU rangkuman akhir yang koheren dan lengkap.

                        RANGKUMAN PARSIAL:
                        ---
                        ${combinedSummaries}
                        ---

                        RANGKUMAN FINAL RAPAT:
                        `;
                        finalSummaryText = await getLLMResponse(finalPrompt);
                    }

                    const formattedSummaryWA = formatForWA(finalSummaryText);
                    const formattedSummarySheets = formatForSheets(finalSummaryText);
                    
                    const logged = await logSummaryToSheet(formattedSummarySheets);
                    let finalReply = `*--- RANGKUMAN RAPAT ---*\n\nTotal ${meetingMessages.length} pesan dianalisis.\n\n${formattedSummaryWA}`;

                    if (logged) {
                        finalReply += "\n\n(✅ Berhasil diarsipkan ke Google Sheets!) \nLink Google Sheets: [link kamu]";
                    } else {
                        finalReply += "\n\n(⚠️ Gagal mengarsipkan ke Google Sheets.)";
                    }
                    
                    await message.reply(finalReply);

                    delete meetingStartMarkers[chatId];

                } catch (err) {
                    error("Error besar di !rangkum (Mode Rapat):", err);
                    await message.reply("Maaf, terjadi kesalahan besar saat memproses rangkuman rapat. Penanda rapat *tidak* dihapus, coba lagi.");
                }

            } else {
                log("Menerima perintah !rangkum (Mode Manual)"); // When there's no active meeting
                
                const limitStr = userMessage.substring(9).trim(); 
                
                if (!limitStr) {
                    await message.reply("Saya tidak tahu harus merangkum dari mana.\n\nCoba salah satu:\n1. Ketik `!rangkum 50` (untuk 50 pesan terakhir).\n2. Gunakan `!mulaiRapat` di awal rapat. Atau gunakan `!mulaiDariSini` untuk menandai awal rapat.");
                    return;
                }
                
                const limit = parseInt(limitStr);

                if (isNaN(limit) || limit <= 0 || limit > 100) {
                    message.reply("Format salah. Coba `!rangkum 50` (maks 100).");
                    return; 
                }

                await message.reply(`Siap! Saya akan baca ${limit} pesan terakhir... 📜`);
                try {
                    const historyText = await buildChatHistory(chat, limit);

                    if (!historyText || (chatHistory && chatHistory.length === 0)) { 
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

                    const formattedSummaryWA = formatForWA(summary);
                    const formattedSummarySheets = formatForSheets(summary);

                    const logged = await logSummaryToSheet(formattedSummarySheets);
                    let finalReply = formattedSummaryWA; 

                    if (logged) {
                        finalReply += "\n\n(✅ Berhasil diarsipkan ke Google Sheets!) \nLink Google Sheets: https://docs.google.com/spreadsheets/d/1q3nesDRyfdz9mAhk4o574RKi9BHzGeD7IhArCyV56Xs/edit?usp=sharing";
                    } else {
                        finalReply += "\n\n(⚠️ Gagal mengarsipkan ke Google Sheets.)";
                    }
                
                    await message.reply(finalReply);

                } catch (error) {
                    error("Error saat fetchMessages (di !rangkum manual):", error);
                    message.reply("Maaf, saya gagal membaca riwayat chat.");
                }
            }
        }

        // To do list
        else if (userMessage.startsWith('!tugas')) {
            const chatId = chat.id._serialized;
            const startTimestamp = meetingStartMarkers[chatId];

            if (startTimestamp) {
                log("Menerima perintah !tugas (Mode Rapat Aktif)");
                await message.reply(`Siap! Saya cari *daftar tugas* dari rapat yang sedang berjalan... 📝`);

                try {
                    const allMessages = await chat.fetchMessages({ limit: 500 });
                    
                    const meetingMessages = allMessages.filter(msg => 
                        msg.timestamp >= startTimestamp && msg.id._serialized !== message.id._serialized
                    );

                    if (meetingMessages.length === 0) {
                        await message.reply("Belum ada pesan untuk dianalisis tugasnya.");
                        return;
                    }
                    
                    meetingMessages.reverse(); 

                    const CHUNK_SIZE = 100;
                    let intermediateTasks = [];

                    for (let i = 0; i < meetingMessages.length; i += CHUNK_SIZE) {
                        const chunk = meetingMessages.slice(i, i + CHUNK_SIZE);
                        const historyText = await processMessagesToHistory(chunk, userCache);
                        
                        if (historyText) {
                            const taskPrompt = `
                            Anda adalah asisten Notulis Rapat yang sangat teliti.
                            Fokus Anda HANYA pada TUGAS.
                            TRANSKRIP OBROLAN (BAGIAN KE-${Math.floor(i / CHUNK_SIZE) + 1}):
                            ---
                            ${historyText}
                            ---
                            Ekstrak SEMUA action items (tugas) dari transkrip bagian ini.
                            Jika TIDAK ADA TUGAS, jawab "Tidak ada tugas."
                            DAFTAR TUGAS BAGIAN INI:
                            `;
                            const interimTasks = await getLLMResponse(taskPrompt);
                            if (!interimTasks.toLowerCase().includes("tidak ada tugas")) {
                                intermediateTasks.push(interimTasks);
                            }
                        }
                    }

                    let finalTaskText = "";
                    if (intermediateTasks.length === 0) {
                        finalTaskText = "Tidak ada tugas atau action item yang ditemukan dalam rapat ini.";
                    } else if (intermediateTasks.length === 1) {
                        finalTaskText = intermediateTasks[0];
                    } else {
                        const combinedTasks = intermediateTasks.join("\n- "); 
                        const finalPrompt = `
                        Berikut adalah kumpulan daftar tugas dari beberapa bagian rapat.
                        Tolong gabungkan dan rapikan menjadi satu daftar tugas akhir.
                        Hilangkan poin duplikat jika ada.

                        KUMPULAN TUGAS:
                        - ${combinedTasks}

                        DAFTAR TUGAS FINAL (RAPIKAN):
                        `;
                        finalTaskText = await getLLMResponse(finalPrompt);
                    }
                    
                    const formattedTasksWA = formatForWA(finalTaskText);
                    const formattedTasksSheets = formatForSheets(finalTaskText);

                    const logged = await logToSheet(formattedTasksSheets);
                    let finalReply = formattedTasksWA;

                    if (logged) {
                        finalReply += "\n\n(✅ Berhasil dicatat ke Google Sheets!) \nLink Google Sheets: [link kamu]";
                    } else {
                        finalReply += "\n\n(⚠️ Gagal mencatat ke Google Sheets.)";
                    }
                    await message.reply(finalReply);
                } catch (err) {
                    error("Error besar di !tugas (Mode Rapat):", err);
                    await message.reply("Maaf, terjadi kesalahan besar saat memproses daftar tugas.");
                }

            } else {
                log("Menerima perintah !tugas (Mode Manual)");
                
                const limitStr = userMessage.substring(7).trim(); 
                
                if (!limitStr) {
                    await message.reply("Saya tidak tahu harus mencari tugas dari mana.\n\nCoba salah satu:\n1. Ketik `!tugas 30` (untuk 30 pesan terakhir).\n2. Gunakan `!mulaiRapat` di awal rapat. Atau gunakan `!mulaiDariSini` untuk menandai awal rapat.");
                    return;
                }

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
        }

        // Voting: create poll on whatsapp
        else if (userMessage.startsWith('!voting')) {
            const chatId = chat.id._serialized;
            const startTimestamp = meetingStartMarkers[chatId];

            if (startTimestamp) {
                log("Menerima perintah !voting (Mode Rapat Aktif)");
                await message.reply(`Oke! Saya analisis *seluruh rapat* untuk mencari topik voting... 🔍`);

                try {
                    const allMessages = await chat.fetchMessages({ limit: 500 });
                    const meetingMessages = allMessages.filter(msg => 
                        msg.timestamp >= startTimestamp && msg.id._serialized !== message.id._serialized
                    );

                    if (meetingMessages.length < 3) { 
                        await message.reply("Tidak ada diskusi yang cukup untuk dibuat voting dalam rapat ini.");
                        return; 
                    }
                    
                    if (meetingMessages.length >= 499) {
                         await message.reply("⚠️ *Peringatan:* Diskusi ini sangat panjang (> 500 pesan). Saya hanya akan menganalisis 500 pesan terakhir.");
                    }
                    
                    meetingMessages.reverse(); 

                    const CHUNK_SIZE = 100; 
                    let intermediateDebates = [];

                    log(`Memulai proses chunking (voting) untuk ${meetingMessages.length} pesan...`);

                    for (let i = 0; i < meetingMessages.length; i += CHUNK_SIZE) {
                        const chunk = meetingMessages.slice(i, i + CHUNK_SIZE);
                        const historyText = await processMessagesToHistory(chunk, userCache);
                        
                        if (historyText) {
                            const debateFinderPrompt = `
                            Anda adalah analis debat. Baca transkrip ini.
                            Identifikasi topik-topik perdebatan utama yang bisa dijadikan voting.
                            Contoh: "Makan siang di mana? (Opsi: Padang, Warteg)"
                            Jika tidak ada, jawab "Tidak ada debat."

                            TRANSKRIP BAGIAN INI:
                            ---
                            ${historyText}
                            ---

                            TOPIK DEBAT YANG DITEMUKAN (jika ada):
                            `;
                            const interimDebate = await getLLMResponse(debateFinderPrompt);
                            if (!interimDebate.toLowerCase().includes("tidak ada debat")) {
                                intermediateDebates.push(interimDebate);
                            }
                        }
                    }

                    if (intermediateDebates.length === 0) {
                        await message.reply("Tidak ada topik voting yang jelas ditemukan dalam diskusi rapat.");
                        return;
                    }

                    log("Semua chunk selesai. Membuat voting final...");

                    const combinedDebates = intermediateDebates.join("\n\n---\n\n");
                    
                    const finalProposalPrompt = `
                    Anda adalah Notulis Rapat yang bisa mengambil keputusan.
                    Di bawah ini adalah kumpulan topik-topik debat yang ditemukan dari sebuah rapat panjang:
                    ---
                    ${combinedDebates}
                    ---

                    Tugas Anda:
                    1.  Pilih SATU topik yang paling penting / paling belum selesai / paling butuh keputusan.
                    2.  Buat JSON untuk poll tersebut.

                    Format jawaban Anda HANYA sebagai JSON string yang valid.
                    Struktur JSON harus:
                    {
                      "question": "PERTANYAAN_VOTING",
                      "options": ["OPSI_1", "OPSI_2", "OPSI_3"]
                    }
                    
                    Jika tidak ada yang bisa divoting, kembalikan:
                    { "error": "Tidak ada topik voting yang jelas ditemukan." }

                    BERIKAN HANYA JSON STRING:
                    `;
                    
                    const llmJsonOutput = await getLLMResponse(finalProposalPrompt);
                    log("Menerima output JSON dari LLM (Rapat):", llmJsonOutput);

                    try {
                        let cleanedJson = llmJsonOutput.replace(/```json/g, '').replace(/```/g, '').trim();
                        const pollData = JSON.parse(cleanedJson);

                        if (pollData.error) {
                            await message.reply(pollData.error); return;
                        }
                        if (!pollData.question || !pollData.options || pollData.options.length < 2) {
                            throw new Error("Format JSON dari LLM tidak valid.");
                        }
                        
                        const poll = new Poll(pollData.question, pollData.options);
                        await message.reply(poll); 
                    } catch (parseError) {
                        error("Gagal parse JSON dari LLM:", parseError, "Output LLM:", llmJsonOutput);
                        await message.reply("Otak saya bingung... Saya tidak bisa mengubah diskusi rapat itu menjadi poll.");
                    }
                } catch (err) {
                    error("Error besar di !voting (Mode Rapat):", err);
                    await message.reply("Maaf, terjadi kesalahan besar saat memproses voting.");
                }

            } else {
                log("Menerima perintah !voting (Mode Manual)");
                
                const limitStr = userMessage.substring(8).trim(); 
                
                if (!limitStr) {
                    await message.reply("Saya tidak tahu harus membuat voting dari mana.\n\nCoba salah satu:\n1. Ketik `!voting 20` (untuk 20 pesan terakhir).\n2. Gunakan `!mulaiRapat` di awal rapat. Atau gunakan `!mulaiDariSini` untuk menandai awal rapat.");
                    return;
                }

                const limit = parseInt(limitStr);

                if (isNaN(limit) || limit <= 0 || limit > 50) { 
                    await message.reply("Format salah. Coba `!voting 20` (maks 50).");
                    return; 
                }

                await message.reply(`Oke! Saya analisis ${limit} pesan terakhir untuk dibuat *voting*... 🔍`);

                try {
                    const historyText = await buildChatHistory(chat, limit);

                    if (!historyText) {
                        await message.reply("Tidak ada pesan untuk dianalisis (selain perintahmu).");
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

                    const llmJsonOutput = await getLLMResponse(proposalPrompt);
                    log("Menerima output JSON dari LLM (Manual):", llmJsonOutput);

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
                        
                        const poll = new Poll(pollData.question, pollData.options);
                        await message.reply(poll); 

                    } catch (parseError) {
                        error("Gagal parse JSON dari LLM:", parseError, "Output LLM:", llmJsonOutput);
                        await message.reply("Otak saya bingung... Saya tidak bisa mengubah diskusi itu menjadi poll.");
                    }

                } catch (error) {
                    error("Error saat fetchMessages (di !voting manual):", error);
                    await message.reply("Maaf, saya gagal menganalisis voting dari riwayat chat.");
                }
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

        // For removing markers
        else if (userMessage === '!batalRapat') {
            log("Menerima perintah !batalRapat");
            const chatId = chat.id._serialized;

            if (meetingStartMarkers[chatId]) {
                delete meetingStartMarkers[chatId];
                await message.reply("Sip! Penanda rapat telah dibatalkan. Rapat tidak lagi aktif.");
            } else {
                await message.reply("Tidak ada rapat yang sedang aktif.");
            }
        }
    }
});

client.initialize();