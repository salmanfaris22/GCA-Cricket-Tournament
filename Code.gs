/**
 * GCA Cricket Tournament Goa 2026 — Registration backend
 *
 * Serves two front-ends:
 *   index.html      — the public registration form (POSTs a new registration)
 *   dashboard.html  — the admin dashboard (POSTs { action: 'updatePayment' }
 *                     to attach a payment screenshot to an existing row)
 *
 * ── UPDATING AN ALREADY-DEPLOYED SCRIPT ──────────────────────────────
 * 1. Open your Google Sheet → Extensions → Apps Script
 * 2. Select all, paste THIS whole file, Save (💾)
 * 3. Deploy → Manage deployments → ✏️ (edit the existing one)
 *      → Version: New version → Deploy
 *    Editing the existing deployment KEEPS the same /exec URL, so
 *    index.html and dashboard.html need no changes.
 * 4. Check it worked: open the /exec URL in a browser. The reply must
 *    list "updatePayment" under actions.
 *
 * ── FIRST-TIME DEPLOY ────────────────────────────────────────────────
 *    Deploy → New deployment → Web app
 *      - Execute as: Me
 *      - Who has access: Anyone
 *    Then paste the Web app URL (ends in /exec) into SHEET_URL in
 *    index.html and SCRIPT_URL in dashboard.html.
 *
 * NOTE: the deploy dialog also shows a "Library URL" that looks like
 *   https://script.google.com/macros/library/d/<scriptId>/<version>
 * That one is only for importing this script into another Apps Script
 * project. It is NOT an endpoint — the pages must use the /exec URL.
 *
 * Uploaded files (profile photo, payment screenshot, Aadhaar) are saved
 * to a Drive folder called "GCA Registration Uploads" and the sheet
 * stores a shareable link to each file.
 */

var SCRIPT_VERSION = '2026-07-29';   // bump when you paste a new copy
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
    var d = JSON.parse(e.postData.contents);

    // The dashboard posts { action: 'updatePayment' } to attach a payment
    // screenshot to an existing registration. Everything else is a new
    // registration coming from the form.
    if (d.action === 'updatePayment') {
      return updatePayment_(d);
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    // Add header row once, if the sheet is empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
    }

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

/**
 * Attaches (or replaces) the payment screenshot of an existing registration,
 * and can also record a UTR reference. Called by dashboard.html.
 *
 * Expects: {
 *   action: 'updatePayment',
 *   rowKey: '<the Timestamp cell of that row>',   // preferred match
 *   phone:  '9061303300',                         // fallback match
 *   utr:    'optional reference',
 *   screenshot: { name, type, data(base64) }      // optional
 * }
 * Returns { result:'ok', url, row } so the dashboard can update in place.
 */
function updatePayment_(d) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return jsonOut_({ result: 'error', message: 'The sheet has no registrations yet.' });
  }

  var head = values[0].map(function (h) { return String(h).trim(); });
  var tsCol    = head.indexOf('Timestamp');
  var nameCol  = head.indexOf('Full Name');
  var phoneCol = head.indexOf('Phone');
  var payCol   = head.indexOf('Payment Screenshot');
  var utrCol   = head.indexOf('UTR');

  if (payCol === -1) {
    return jsonOut_({ result: 'error', message: 'No "Payment Screenshot" column found in the sheet.' });
  }

  var wantKey   = String(d.rowKey || '').trim();
  var wantPhone = digits_(d.phone);
  var target = -1;

  for (var i = 1; i < values.length; i++) {
    if (wantKey && tsCol > -1 && cellKey_(values[i][tsCol]) === wantKey) { target = i; break; }
    if (!wantKey && wantPhone && phoneCol > -1 && digits_(values[i][phoneCol]) === wantPhone) { target = i; break; }
  }
  // Second pass on the phone number when the timestamp did not match
  if (target === -1 && wantPhone && phoneCol > -1) {
    for (var j = 1; j < values.length; j++) {
      if (digits_(values[j][phoneCol]) === wantPhone) { target = j; break; }
    }
  }
  if (target === -1) {
    return jsonOut_({ result: 'error', message: 'That registration was not found in the sheet.' });
  }

  var url = '';
  if (d.screenshot && d.screenshot.data) {
    var who = String(nameCol > -1 ? values[target][nameCol] : 'registrant')
      .replace(/[^\w\- ]+/g, '').trim() || 'registrant';
    url = saveFile_(getUploadFolder_(), d.screenshot, 'payment_' + who);
    sheet.getRange(target + 1, payCol + 1).setValue(url);
  }
  if (utrCol > -1 && d.utr) {
    sheet.getRange(target + 1, utrCol + 1).setValue(txt_(d.utr));
  }

  return jsonOut_({ result: 'ok', url: url, row: target + 1 });
}

/** Timestamps arrive as text or as a Date depending on the cell format. */
function cellKey_(v) {
  if (v instanceof Date) return v.toISOString();
  return String(v == null ? '' : v).trim();
}

/** Keeps only the digits, so 9061303300 and +91 90613 03300 compare equal. */
function digits_(v) {
  var s = String(v == null ? '' : v).replace(/\D/g, '');
  if (s.length === 12 && s.indexOf('91') === 0) s = s.substring(2);
  return s;
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

/**
 * Open the Web app URL in a browser to confirm which version is live.
 * If "actions" does NOT list updatePayment, the deployment is still running
 * the old code — re-deploy (Manage deployments → edit → New version).
 */
function doGet() {
  return jsonOut_({
    status: 'GCA registration endpoint is live',
    version: SCRIPT_VERSION,
    actions: ['register', 'updatePayment']
  });
}
