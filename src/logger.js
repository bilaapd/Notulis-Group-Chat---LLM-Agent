const fs = require('fs');
const path = require('path');

const logDirectory = path.join(__dirname, '../logs');
const logFilePath = path.join(logDirectory, 'bot.log');

if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory, { recursive: true });
}

function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [INFO] ${message}`;

    console.log(message); 

    fs.appendFile(logFilePath, logMessage + '\n', (err) => {
        if (err) {
            console.error('Gagal menulis ke file log:', err);
        }
    });
}

function error(message, errObject) {
    const timestamp = new Date().toISOString();
    const errorMessage = `[${timestamp}] [ERROR] ${message}`;

    console.error(message, errObject || '');

    let fileErrorMessage = errorMessage;
    if (errObject && errObject.stack) {
        fileErrorMessage += `\n${errObject.stack}`;
    }

    fs.appendFile(logFilePath, fileErrorMessage + '\n', (err) => {
        if (err) {
            console.error('Gagal menulis ke file log ERROR:', err);
        }
    });
}

module.exports = {
    log,
    error
};