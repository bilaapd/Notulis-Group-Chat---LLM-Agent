# Chatat - Bot Notulen Rapat pada Group Chat WhatsApp 🤖

Notulis Agent adalah sebuah LLM Agent cerdas yang terintegrasi dengan WhatsApp. Dibuat menggunakan `whatsapp-web.js` dan Google Gemini, bot ini berfungsi sebagai asisten notulensi yang dapat membaca riwayat obrolan, merangkum diskusi, mengekstrak daftar tugas, dan membuat voting secara otomatis.

## ✨ Fitur Utama

Bot ini diaktifkan dengan perintah di dalam grup WhatsApp:

* `!help`: Menampilkan menu bantuan dan panduan *onboarding*.
* `!register <Nama>`: Mendaftarkan nama permanen untuk ID WhatsApp-mu agar dikenal oleh bot.
* `!rangkum <jumlah>`: Merangkum `<jumlah>` pesan terakhir dan mengarsipkannya ke Google Sheets.
* `!tugas <jumlah>`: Mengekstrak daftar tugas (action items) dari `<jumlah>` pesan terakhir dan menyimpannya ke Google Sheets.
* `!voting <jumlah>`: Secara ajaib menganalisis perdebatan di `<jumlah>` pesan terakhir dan membuat Poll WhatsApp interaktif.
* `!tanya <pertanyaan>`: Mengajukan pertanyaan apa pun ke otak LLM (Gemini).

## 🚀 Setup & Menjalankan Bot

Ikuti langkah-langkah ini untuk menjalankan bot di komputermu.

### 1. Prerequisites

* [Node.js](https://nodejs.org/) (v18 atau lebih baru direkomendasikan).
* Akun Google dengan akses ke [Google AI Studio](https://aistudio.google.com/app/apikey) (untuk Gemini) dan [Google Cloud Console](https://console.cloud.google.com/) (untuk Google Sheets).
* Nomor WhatsApp (sangat disarankan menggunakan nomor sekunder/baru untuk development).

### 2. Instalasi

1.  Clone repositori ini:
    ```bash
    git clone [https://github.com/username/repo-name.git](https://github.com/username/repo-name.git)
    cd repo-name
    ```

2.  Install semua dependensi:
    ```bash
    npm install
    ```

### 3. Konfigurasi (Penting!)

Bot ini membutuhkan beberapa kunci rahasia untuk berfungsi.

**A. Kunci API Gemini (LLM)**

1.  Salin file `.env.example` menjadi `.env`:
    ```bash
    cp .env.example .env
    ```
2.  Buka file `.env` dan masukkan API Key kamu dari [Google AI Studio](https://aistudio.google.com/app/apikey).
    ```env
    GEMINI_API_KEY=XXXXXXXXXXXXXXXXXXXXXX
    ```

**B. Kredensial Google Sheets (Pencatatan)**

Bot ini menggunakan Google Service Account (bukan OAuth) agar tidak perlu login per user.

1.  Ikuti panduan di [Google Cloud Console](https://console.cloud.google.com/) untuk membuat **Service Account** baru.
2.  Aktifkan **Google Drive API** dan **Google Sheets API** untuk proyekmu.
3.  Buat **kunci JSON** untuk Service Account tersebut dan unduh filenya.
4.  Ganti nama file JSON itu menjadi `credentials.json` dan letakkan di *root* folder proyek.
5.  **PENTING:** File `credentials.json` sudah ada di `.gitignore` dan **tidak boleh** di-upload ke GitHub.

**C. Setup Google Sheets**

Bot ini butuh 2 file Google Sheets:

1.  **File Publik (Tugas & Rangkuman):**
    * Buat file Google Sheet baru (misal: "Arsip Notulen Bot").
    * Ganti nama tab pertama menjadi `Sheet1` (untuk Tugas) dan buat tab baru bernama `Rangkuman`.
    * Klik "Bagikan" (Share) dan undang `client_email` dari file `credentials.json`-mu sebagai **Editor**.
    * Salin ID Spreadsheet (dari URL) dan masukkan ke `TASKS_SPREADSHEET_ID` di `src/sheetsTool.js`.

2.  **File Rahasia (Database User):**
    * Buat file Google Sheet **baru** (misal: "Bot Admin Registry").
    * Ganti nama tab pertama menjadi `UserRegistry`.
    * Klik "Bagikan" (Share) dan undang `client_email` yang sama sebagai **Editor**.
    * Salin ID Spreadsheet (dari URL) dan masukkan ke `ADMIN_SPREADSHEET_ID` di `src/sheetsTool.js`.

### 4. Menjalankan Bot

1.  Jalankan perintah start:
    ```bash
    npm start
    ```
    (atau `node src/index.js`)

2.  Terminal akan menampilkan QR code. Scan QR code tersebut menggunakan aplikasi WhatsApp di HP-mu (dari menu "Perangkat Tertaut" / "Linked Devices").

3.  Setelah terhubung, bot akan online dan siap menerima perintah di grup.

## 📸 Demo

### Proses Scan QR Code

Terminal akan menampilkan QR code seperti ini untuk login.

`[Gambar/GIF dari terminal yang menampilkan QR Code]`

### Contoh Percakapan

Berikut adalah contoh penggunaan fitur-fitur utama bot di dalam grup WhatsApp.

**Demo Fitur `!register` dan `!help`:**
`[Screenshot percakapan !help dan !register]`

**Demo Fitur `!tugas` (dengan output Google Sheets):**
`[Screenshot percakapan !tugas dan screenshot Google Sheet yang terisi]`

**Demo Fitur `!voting` (Membuat Poll Otomatis):**
`[GIF yang menunjukkan obrolan perdebatan, lalu bot membuat Poll interaktif]`
