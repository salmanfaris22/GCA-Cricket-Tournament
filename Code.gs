/**
 * GCA Cricket Tournament Goa 2026 — Registration backend
 *
 * SETUP:
 * 1. Open your Google Sheet → Extensions → Apps Script
 * 2. Delete any existing code, paste THIS whole file
 * 3. Save (💾)
 * 4. Deploy → New deployment → Web app
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 5. Copy the Web app URL (ends in /exec) and paste it into
 *    index.html (the SHEET_URL variable in submitForm).
 *
 * Uploaded files (profile photo, payment screenshot, Aadhaar) are saved
 * to a Drive folder called "GCA Registration Uploads" and the sheet
 * stores a shareable link to each file.
 */

var UPLOAD_FOLDER_NAME = 'GCA Registration Uploads';

var HEADERS = [
  'Timestamp', 'Full Name', 'Phone', 'DOB', 'Blood Group',
  'Address', 'Station', 'Position', 'Batting', 'Bowling',
  'Registration Type',
  'Distributor Firm', 'Distributor Brand', 'Distributor GST',
  'Retail Store Name', 'Retail GST', 'Retail Configure',
  'Executive Firm', 'Executive Brand',
  'UTR', 'Profile Photo', 'Payment Screenshot', 'Aadhaar Card'
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    // Add header row once, if the sheet is empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
    }

    var d = JSON.parse(e.postData.contents);
    var safeName = (d.fullName || 'registrant').replace(/[^\w\- ]+/g, '').trim() || 'registrant';

    // Save uploads, but never let a Drive problem drop the registration.
    // If Drive isn't authorized yet, the cell records the error instead.
    var photoUrl   = trySaveFile_(d.photo,      'photo_' + safeName);
    var ssUrl      = trySaveFile_(d.screenshot, 'payment_' + safeName);
    var aadhaarUrl = trySaveFile_(d.aadhaar,    'aadhaar_' + safeName);

    sheet.appendRow([
      d.timestamp, d.fullName, txt_(d.phone), d.dob, d.bloodGroup,
      d.address, d.station, d.position, d.batting, d.bowling,
      d.registrationType,
      d.distFirm, d.distBrand, txt_(d.distGst),
      d.retStore, txt_(d.retGst), d.retConfig,
      d.execFirm, d.execBrand,
      txt_(d.utr), photoUrl, ssUrl, aadhaarUrl
    ]);

    return jsonOut_({ result: 'ok' });
  } catch (err) {
    return jsonOut_({ result: 'error', message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** Returns the shared upload folder, creating it on first use. */
function getUploadFolder_() {
  var it = DriveApp.getFoldersByName(UPLOAD_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(UPLOAD_FOLDER_NAME);
}

/** Wrapper that never throws — returns '' when empty, or 'UPLOAD FAILED: …'. */
function trySaveFile_(fileObj, baseName) {
  if (!fileObj || !fileObj.data) return '';
  try {
    return saveFile_(getUploadFolder_(), fileObj, baseName);
  } catch (err) {
    return 'UPLOAD FAILED: ' + err;
  }
}

/**
 * Decodes a { name, type, data(base64) } object to a Drive file and
 * returns a viewable link. Returns '' when no file was provided.
 */
function saveFile_(folder, fileObj, baseName) {
  if (!fileObj || !fileObj.data) return '';

  var bytes = Utilities.base64Decode(fileObj.data);
  var mime = fileObj.type || 'application/octet-stream';
  var ext = fileObj.name && fileObj.name.indexOf('.') > -1
    ? fileObj.name.substring(fileObj.name.lastIndexOf('.'))
    : '';
  var blob = Utilities.newBlob(bytes, mime, baseName + ext);

  var file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (shareErr) {
    // Some domains restrict link sharing; the file is still saved.
  }
  return file.getUrl();
}

/**
 * RUN THIS ONCE from the editor (select "authorize" → Run) to grant the
 * Spreadsheet + Drive permissions. Approve the prompt that appears. After
 * that, uploads from the live form will save correctly.
 */
function authorize() {
  SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var folder = getUploadFolder_();
  Logger.log('Authorized. Upload folder ready: ' + folder.getName());
}

/**
 * Forces a value to be stored as plain text so Google Sheets doesn't treat
 * a leading +, =, -, or @ as a formula (e.g. "+91…" phone numbers).
 */
function txt_(val) {
  if (val === null || val === undefined || val === '') return '';
  var s = String(val);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Lets you open the Web app URL in a browser to confirm it's live
function doGet() {
  return jsonOut_({ status: 'GCA registration endpoint is live' });
}
