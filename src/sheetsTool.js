const { google } = require('googleapis');

// Spreadsheet ID
const TASKS_SPREADSHEET_ID = '1q3nesDRyfdz9mAhk4o574RKi9BHzGeD7IhArCyV56Xs';
const ADMIN_SPREADSHEET_ID = '1PKp0xuNMDGm177oCgLIqrL3gDxv01jOop8YcIs9of28';

const KEY_FILE_PATH = './credentials.json';

const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

async function loadUserRegistry() {
    console.log("Memuat User Registry dari Google Sheets...");
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: ADMIN_SPREADSHEET_ID, 
            range: 'UserRegistry!A2:B', 
        });

        const rows = response.data.values;
        const userCache = {};

        if (rows && rows.length) {
            rows.forEach(row => {
                const userId = row[0];
                const userName = row[1];
                if (userId && userName) {
                    userCache[userId] = userName;
                }
            });
        }
        console.log(`Berhasil memuat ${Object.keys(userCache).length} user.`);
        return userCache;
    } catch (error) {
        console.error("Gagal memuat User Registry:", error);
        return {}; 
    }
}

// Function for save name and id user to Spreadsheet
async function registerUser(userId, userName) {
    console.log(`Mencoba mendaftarkan user: ${userId} as ${userName}`);
    try {
        const newRow = [userId, userName];

        await sheets.spreadsheets.values.append({
            spreadsheetId: ADMIN_SPREADSHEET_ID, 
            range: 'UserRegistry!A:B',
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [newRow],
            },
        });
        console.log("Berhasil mendaftarkan user.");
        return true;
    } catch (error) {
        console.error("Gagal mendaftarkan user:", error);
        return false;
    }
}

// Function to put summary and task to Spreadsheet
async function appendToSheet(sheetName, text, label) {
    console.log(`Mencoba mencatat ${label.toUpperCase()} ke Google Sheets...`);
    try {
        const newRow = [
            new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
            text,
        ];

        await sheets.spreadsheets.values.append({
            spreadsheetId: TASKS_SPREADSHEET_ID,
            range: `${sheetName}!A:B`, 
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [newRow],
            },
        });

        console.log(`Berhasil mencatat ${label} ke Google Sheets.`);
        return true;

    } catch (error) {
        console.error(`Error saat menulis ${label} ke Google Sheets:`, error);
        return false;
    }
}

const logToSheet = (taskText) => appendToSheet('Tugas', taskText, 'TUGAS');
const logSummaryToSheet = (summaryText) => appendToSheet('Rangkuman', summaryText, 'RANGKUMAN');

module.exports = { loadUserRegistry, registerUser, logToSheet, logSummaryToSheet };