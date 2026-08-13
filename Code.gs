/**
 * GSA Cricket Premium Member + GCA registration backend (Google Apps Script)
 *
 * Serves:
 *   index.html           — GCA Goa form
 *   gsa-index.html       — GSA Cricket Premium Member form
 *   dashboard.html       — payment screenshot updates
 *
 * WHY ADDING PLAYERS WAS BROKEN
 *   1. Saving this file does NOT update the live form. You must
 *      Deploy → Manage deployments → ✏️ → Version: New version → Deploy.
 *   2. getActiveSpreadsheet() is null on a standalone / wrongly-bound
 *      script, so doPost crashed and no row was written.
 *   3. Manshire rows go to the "Manshire 2026" tab — not the GCA tab.
 *
 * ── UPDATE THE LIVE FORM ─────────────────────────────────────────
 * 1. Sheet → Extensions → Apps Script
 * 2. Replace Code.gs with THIS file, Save
 * 3. Run  authorize  once and approve permissions
 * 4. Deploy → Manage deployments → ✏️ edit → New version → Deploy
 *      Execute as: Me     Who has access: Anyone
 * 5. Open the /exec URL. It MUST say version 2026-08-13-v3
 */

var SCRIPT_VERSION = '2026-08-13-v3';

/** The Google Sheet every registration is written into. */
var SPREADSHEET_ID = '16KE-3Masz0pkS_VA_AVxT20OmAxbJ3Q0HAKajTHSGNA';

var EVENT_NAME  = 'GSA Cricket Premium Member';
var EVENT_DATES = '07 · 08 · 09 September 2026';
var EVENT_VENUE = 'Z3 Sports Ground, Tirupur';

var MANSHIRE_SHEET = 'Manshire 2026';
var MANSHIRE_UPLOADS = 'MANSHIRE Cricket 2026 Uploads';
var GCA_UPLOADS = 'GCA Registration Uploads';
var REG_ID_PREFIX = 'MCC26';

var MAX_DOC_MB   = 2;
var MAX_IMAGE_MB = 2;
var SEND_CONFIRMATION_EMAIL = true;
var SUPPORT_NAME  = 'Junied DX';
var SUPPORT_PHONE = '+91 90613 03300';

var MANSHIRE_HEADERS = [
  'Reg ID', 'Timestamp',
  'Full Name', 'Phone', 'Email', 'DOB', 'Blood Group', 'T-Shirt Size',
  'City', 'Address',
  'Registration Type', 'Firm Name', 'Brand Name', 'GST Number', 'Partner Names',
  'Position', 'Batting', 'Bowling',
  'Payment Status', 'UTR',
  'Profile Photo', 'GST Certificate', 'Partnership Deed',
  'Payment Screenshot', 'Aadhaar Card'
];

var GCA_HEADERS = [
  'Timestamp', 'Full Name', 'Phone', 'DOB', 'Blood Group',
  'Address', 'Station', 'Position', 'Batting', 'Bowling',
  'Registration Type',
  'Distributor Firm', 'Distributor Brand', 'Distributor GST',
  'Retail Store Name', 'Retail GST', 'Retail Configure',
  'Executive Firm', 'Executive Brand',
  'UTR', 'Profile Photo', 'Payment Screenshot', 'Aadhaar Card'
];

var REG_TYPES = ['Proprietorship', 'Partnership'];


/* ══════════════════════════════════════════════════════════════════
   ROUTING
   ══════════════════════════════════════════════════════════════════ */

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var raw = e && e.postData && e.postData.contents;
    if (!raw && e && e.parameter && e.parameter.data) raw = e.parameter.data;
    if (!raw) {
      return jsonOut_({ result: 'error', message: 'Empty request. The form did not send any data.' });
    }

    var d = JSON.parse(raw);

    if (d.action === 'updatePayment') return updatePayment_(d);

    if (isManshirePayload_(d)) return registerManshire_(d);

    return registerGca_(d);
  } catch (err) {
    return jsonOut_({ result: 'error', message: 'Server error: ' + err });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  var sheetOk = '';
  try {
    var ss = getSpreadsheet_();
    sheetOk = ss.getName() + ' / tabs: ' +
      ss.getSheets().map(function (s) { return s.getName(); }).join(', ');
  } catch (err) {
    sheetOk = 'ERROR: ' + err;
  }

  return jsonOut_({
    status : 'Registration endpoint is live',
    version: SCRIPT_VERSION,
    event  : EVENT_NAME,
    sheetId: SPREADSHEET_ID,
    sheet  : sheetOk,
    limits : { documentMB: MAX_DOC_MB, imageMB: MAX_IMAGE_MB },
    actions: ['register', 'updatePayment']
  });
}

function isManshirePayload_(d) {
  var rt = str_(d.regType);
  if (REG_TYPES.indexOf(rt) !== -1) return true;
  if (d.gstNumber || d.gstCert || d.firmName || d.deed) return true;
  return false;
}


/* ══════════════════════════════════════════════════════════════════
   MANSHIRE REGISTER
   ══════════════════════════════════════════════════════════════════ */

function registerManshire_(d) {
  var problem = validateManshire_(d);
  if (problem) return jsonOut_({ result: 'error', message: problem });

  var sheet = getManshireSheet_();
  var regType = str_(d.regType);
  var safeName = safeName_(d.fullName);

  var dup = findRowByPhone_(sheet, d.phone, MANSHIRE_HEADERS.length);
  if (dup.row > 0) {
    return jsonOut_({
      result : 'duplicate',
      message: 'This phone number is already registered (' + dup.regId + '). ' +
               'Call ' + SUPPORT_NAME + ' on ' + SUPPORT_PHONE + ' to change anything.',
      regId  : dup.regId
    });
  }

  var folder = getRegistrantFolder_(MANSHIRE_UPLOADS, safeName);

  var photoUrl   = trySaveFile_(folder, d.photo,      'photo_'   + safeName);
  var gstUrl     = trySaveFile_(folder, d.gstCert,    'gst_'     + safeName);
  var deedUrl    = trySaveFile_(folder, d.deed,       'deed_'    + safeName);
  var ssUrl      = trySaveFile_(folder, d.screenshot, 'payment_' + safeName);
  var aadhaarUrl = trySaveFile_(folder, d.aadhaar,    'aadhaar_' + safeName);

  var regId = nextRegId_(sheet);
  var paymentStatus = (d.screenshot && d.screenshot.data) ? 'Screenshot received' : 'Pending';

  sheet.appendRow([
    regId,
    d.timestamp || new Date().toISOString(),
    d.fullName, txt_(d.phone), d.email, d.dob, d.bloodGroup, d.tshirt,
    d.city, d.address,
    regType, d.firmName, d.brandName, txt_(d.gstNumber),
    regType === 'Partnership' ? (d.partnerNames || '') : '',
    d.position, d.batting, d.bowling,
    paymentStatus, txt_(d.utr),
    photoUrl, gstUrl, deedUrl, ssUrl, aadhaarUrl
  ]);

  formatLastRow_(sheet, MANSHIRE_HEADERS.length);

  if (SEND_CONFIRMATION_EMAIL && d.email) {
    try { sendConfirmation_(d, regId); } catch (mailErr) { /* ignore */ }
  }

  return jsonOut_({ result: 'ok', regId: regId, row: sheet.getLastRow(), tab: MANSHIRE_SHEET });
}

function validateManshire_(d) {
  if (!str_(d.fullName))   return 'Full name is required.';
  if (digits_(d.phone).length !== 10) return 'Enter a valid 10-digit phone number.';
  if (!str_(d.dob))        return 'Date of birth is required.';
  if (!str_(d.bloodGroup)) return 'Blood group is required.';
  if (!str_(d.city))       return 'City is required.';
  if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(str_(d.email))) {
    return 'That email address does not look valid.';
  }

  var regType = str_(d.regType);
  if (REG_TYPES.indexOf(regType) === -1) {
    return 'Choose a registration type: ' + REG_TYPES.join(' or ') + '.';
  }
  if (!str_(d.firmName))  return 'Firm name is required.';
  if (!str_(d.address))   return 'Business address is required.';

  var gst = str_(d.gstNumber).toUpperCase().replace(/\s+/g, '');
  if (!gst) return 'GST number is required.';
  if (!isGstin_(gst)) {
    return 'That GST number is not valid. A GSTIN is 15 characters, e.g. 33ABCDE1234F1Z5.';
  }
  if (!d.gstCert || !d.gstCert.data) return 'The GST certificate upload is required.';
  var gstErr = sizeError_(d.gstCert, MAX_DOC_MB, 'GST certificate');
  if (gstErr) return gstErr;

  if (regType === 'Partnership') {
    if (!d.deed || !d.deed.data) {
      return 'A Partnership registration requires the partnership deed upload.';
    }
    var deedErr = sizeError_(d.deed, MAX_DOC_MB, 'Partnership deed');
    if (deedErr) return deedErr;
  }

  if (!d.aadhaar || !d.aadhaar.data) return 'The Aadhaar card upload is required.';
  var imgChecks = [
    [d.aadhaar,    'Aadhaar card'],
    [d.photo,      'Profile photo'],
    [d.screenshot, 'Payment screenshot']
  ];
  for (var i = 0; i < imgChecks.length; i++) {
    var e2 = sizeError_(imgChecks[i][0], MAX_IMAGE_MB, imgChecks[i][1]);
    if (e2) return e2;
  }

  if (!str_(d.position)) return 'Playing position is required.';
  if (!str_(d.batting))  return 'Batting hand is required.';
  if (!str_(d.bowling))  return 'Bowling hand is required.';

  return '';
}


/* ══════════════════════════════════════════════════════════════════
   GCA REGISTER (old form — index.html)
   ══════════════════════════════════════════════════════════════════ */

function registerGca_(d) {
  if (!str_(d.fullName)) return jsonOut_({ result: 'error', message: 'Full name is required.' });
  if (digits_(d.phone).length !== 10) {
    return jsonOut_({ result: 'error', message: 'Enter a valid 10-digit phone number.' });
  }

  var sheet = getGcaSheet_();
  var safeName = safeName_(d.fullName);

  var photoUrl   = trySaveFile_(getUploadFolder_(GCA_UPLOADS), d.photo,      'photo_'   + safeName);
  var ssUrl      = trySaveFile_(getUploadFolder_(GCA_UPLOADS), d.screenshot, 'payment_' + safeName);
  var aadhaarUrl = trySaveFile_(getUploadFolder_(GCA_UPLOADS), d.aadhaar,    'aadhaar_' + safeName);

  sheet.appendRow([
    d.timestamp || new Date().toISOString(),
    d.fullName, txt_(d.phone), d.dob, d.bloodGroup,
    d.address, d.station, d.position, d.batting, d.bowling,
    d.registrationType,
    d.distFirm, d.distBrand, txt_(d.distGst),
    d.retStore, txt_(d.retGst), d.retConfig,
    d.execFirm, d.execBrand,
    txt_(d.utr), photoUrl, ssUrl, aadhaarUrl
  ]);

  return jsonOut_({ result: 'ok', row: sheet.getLastRow(), tab: sheet.getName() });
}


/* ══════════════════════════════════════════════════════════════════
   UPDATE PAYMENT
   ══════════════════════════════════════════════════════════════════ */

function updatePayment_(d) {
  var ss = getSpreadsheet_();
  var sheets = ss.getSheets();
  var lastErr = 'That registration was not found.';

  for (var s = 0; s < sheets.length; s++) {
    var result = updatePaymentOnSheet_(sheets[s], d);
    if (result.ok) {
      return jsonOut_({ result: 'ok', url: result.url, row: result.row, tab: sheets[s].getName() });
    }
    if (result.message) lastErr = result.message;
  }
  return jsonOut_({ result: 'error', message: lastErr });
}

function updatePaymentOnSheet_(sheet, d) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: false };

  var head = values[0].map(function (h) { return String(h).trim(); });
  var idCol    = head.indexOf('Reg ID');
  var tsCol    = head.indexOf('Timestamp');
  var nameCol  = head.indexOf('Full Name');
  var phoneCol = head.indexOf('Phone');
  var payCol   = head.indexOf('Payment Screenshot');
  var utrCol   = head.indexOf('UTR');
  var statCol  = head.indexOf('Payment Status');
  if (payCol === -1) return { ok: false };

  var wantId    = str_(d.regId).toUpperCase();
  var wantKey   = str_(d.rowKey);
  var wantPhone = digits_(d.phone);
  var target = -1;

  for (var i = 1; i < values.length && target === -1; i++) {
    if (wantId && idCol > -1 && String(values[i][idCol]).trim().toUpperCase() === wantId) target = i;
    else if (wantKey && tsCol > -1 && cellKey_(values[i][tsCol]) === wantKey) target = i;
  }
  if (target === -1 && wantPhone && phoneCol > -1) {
    for (var j = 1; j < values.length; j++) {
      if (digits_(values[j][phoneCol]) === wantPhone) { target = j; break; }
    }
  }
  if (target === -1) return { ok: false };

  var url = '';
  var folderName = sheet.getName() === MANSHIRE_SHEET ? MANSHIRE_UPLOADS : GCA_UPLOADS;
  if (d.screenshot && d.screenshot.data) {
    var tooBig = sizeError_(d.screenshot, MAX_IMAGE_MB, 'Payment screenshot');
    if (tooBig) return { ok: false, message: tooBig };

    var who = safeName_(nameCol > -1 ? values[target][nameCol] : 'registrant');
    url = saveFile_(getRegistrantFolder_(folderName, who), d.screenshot, 'payment_' + who);
    sheet.getRange(target + 1, payCol + 1).setValue(url);
    if (statCol > -1) sheet.getRange(target + 1, statCol + 1).setValue('Screenshot received');
  }
  if (utrCol > -1 && d.utr) {
    sheet.getRange(target + 1, utrCol + 1).setValue(txt_(d.utr));
  }
  return { ok: true, url: url, row: target + 1 };
}


/* ══════════════════════════════════════════════════════════════════
   SHEET ACCESS — always open the known spreadsheet by ID
   ══════════════════════════════════════════════════════════════════ */

function getSpreadsheet_() {
  if (SPREADSHEET_ID) {
    try {
      return SpreadsheetApp.openById(SPREADSHEET_ID);
    } catch (err) {
      throw new Error('Cannot open spreadsheet ' + SPREADSHEET_ID + ' — ' + err);
    }
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  throw new Error('No spreadsheet connected. Paste SPREADSHEET_ID at the top of Code.gs.');
}

function getManshireSheet_() {
  var ss = getSpreadsheet_();
  var first = ss.getSheets()[0];
  var firstHead = first.getLastRow() > 0 ? String(first.getRange(1, 1).getValue()).trim() : '';
  // Dashboard reads the first tab — write there when it already has Manshire headers.
  var sheet = firstHead === 'Reg ID' ? first : ss.getSheetByName(MANSHIRE_SHEET);
  if (!sheet) sheet = ss.insertSheet(MANSHIRE_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(MANSHIRE_HEADERS);
    var head = sheet.getRange(1, 1, 1, MANSHIRE_HEADERS.length);
    head.setBackground('#0b2452').setFontColor('#f5c542').setFontWeight('bold')
        .setVerticalAlignment('middle');
    sheet.setRowHeight(1, 34);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 100);
    sheet.setColumnWidth(3, 190);
    sheet.setColumnWidth(10, 260);
  }
  return sheet;
}

function getGcaSheet_() {
  var ss = getSpreadsheet_();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName() === MANSHIRE_SHEET) continue;
    if (sheets[i].getLastRow() === 0) continue;
    var first = String(sheets[i].getRange(1, 1).getValue()).trim();
    if (first === 'Timestamp' || first === 'Full Name') return sheets[i];
  }
  var fallback = sheets[0];
  if (fallback.getName() === MANSHIRE_SHEET && sheets.length > 1) fallback = sheets[1];
  if (fallback.getLastRow() === 0) fallback.appendRow(GCA_HEADERS);
  return fallback;
}

function formatLastRow_(sheet, colCount) {
  try {
    var r = sheet.getLastRow();
    if (r % 2 === 0) sheet.getRange(r, 1, 1, colCount).setBackground('#f6f8fb');
    sheet.getRange(r, 1).setFontWeight('bold').setFontColor('#0b2452');
  } catch (err) { /* cosmetic */ }
}

function nextRegId_(sheet) {
  var last = sheet.getLastRow();
  var max = 0;
  if (last > 1) {
    var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      var m = /(\d+)\s*$/.exec(String(ids[i][0]));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  var n = String(max + 1);
  while (n.length < 4) n = '0' + n;
  return REG_ID_PREFIX + '-' + n;
}

function findRowByPhone_(sheet, phone, colCount) {
  var want = digits_(phone);
  if (!want) return { row: -1, regId: '' };
  var last = sheet.getLastRow();
  if (last < 2) return { row: -1, regId: '' };

  var width = colCount || sheet.getLastColumn();
  var head = sheet.getRange(1, 1, 1, width).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var phoneCol = head.indexOf('Phone');
  var idCol    = head.indexOf('Reg ID');
  if (phoneCol === -1) return { row: -1, regId: '' };

  var rows = sheet.getRange(2, 1, last - 1, width).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (digits_(rows[i][phoneCol]) === want) {
      return { row: i + 2, regId: idCol > -1 ? String(rows[i][idCol]) : '' };
    }
  }
  return { row: -1, regId: '' };
}


/* ══════════════════════════════════════════════════════════════════
   DRIVE
   ══════════════════════════════════════════════════════════════════ */

function getUploadFolder_(folderName) {
  var it = DriveApp.getFoldersByName(folderName);
  return it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
}

function getRegistrantFolder_(rootName, safeName) {
  var root = getUploadFolder_(rootName);
  var it = root.getFoldersByName(safeName);
  return it.hasNext() ? it.next() : root.createFolder(safeName);
}

function trySaveFile_(folder, fileObj, baseName) {
  if (!fileObj || !fileObj.data) return '';
  try {
    return saveFile_(folder, fileObj, baseName);
  } catch (err) {
    return 'UPLOAD FAILED: ' + err;
  }
}

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
  } catch (shareErr) { /* Workspace may block link sharing */ }
  return file.getUrl();
}


/* ══════════════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════════════ */

function base64Bytes_(data) {
  var s = String(data || '').replace(/\s+/g, '');
  if (!s) return 0;
  var pad = s.slice(-2) === '==' ? 2 : (s.slice(-1) === '=' ? 1 : 0);
  return Math.floor(s.length * 3 / 4) - pad;
}

function sizeError_(fileObj, maxMb, label) {
  if (!fileObj || !fileObj.data) return '';
  var bytes = base64Bytes_(fileObj.data);
  if (bytes > maxMb * 1024 * 1024) {
    return label + ' is ' + (bytes / 1048576).toFixed(1) + ' MB. ' +
           'The limit is ' + maxMb + ' MB — please compress it and try again.';
  }
  return '';
}

function isGstin_(v) {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(String(v || '').toUpperCase());
}

function str_(v) {
  return String(v == null ? '' : v).trim();
}

function digits_(v) {
  var s = String(v == null ? '' : v).replace(/\D/g, '');
  if (s.length === 12 && s.indexOf('91') === 0) s = s.substring(2);
  if (s.length === 11 && s.indexOf('0') === 0)  s = s.substring(1);
  return s;
}

function cellKey_(v) {
  if (v instanceof Date) return v.toISOString();
  return String(v == null ? '' : v).trim();
}

function safeName_(v) {
  return String(v || 'registrant').replace(/[^\w\- ]+/g, '').trim() || 'registrant';
}

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


/* ══════════════════════════════════════════════════════════════════
   EMAIL
   ══════════════════════════════════════════════════════════════════ */

function sendConfirmation_(d, regId) {
  var html =
    '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;background:#f4f6fa;padding:26px">' +
      '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e3e8f0">' +
        '<div style="background:linear-gradient(135deg,#0b2452,#16346e);padding:26px 24px;text-align:center">' +
          '<div style="color:#f5c542;font-size:12px;letter-spacing:3px;font-weight:700">GSA CRICKET</div>' +
          '<div style="color:#fff;font-size:23px;font-weight:800;margin-top:6px">Premium Member Registration</div>' +
        '</div>' +
        '<div style="padding:26px 24px;color:#1f2937;font-size:15px;line-height:1.65">' +
          '<p style="margin:0 0 14px">Hello <b>' + esc_(d.fullName) + '</b>,</p>' +
          '<p style="margin:0 0 16px">Your registration has been received.</p>' +
          '<div style="background:#fff9e6;border:1px solid #f0d278;border-radius:10px;padding:14px;text-align:center;margin:0 0 18px">' +
            '<div style="font-size:12px;color:#7a6320;letter-spacing:1.5px">YOUR REGISTRATION ID</div>' +
            '<div style="font-size:26px;font-weight:800;color:#0b2452;letter-spacing:2px">' + esc_(regId) + '</div>' +
          '</div>' +
          '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
            row_('Dates', EVENT_DATES) +
            row_('Venue', EVENT_VENUE) +
            row_('Registered as', esc_(d.regType) + ' — ' + esc_(d.firmName)) +
            row_('GST', esc_(d.gstNumber)) +
          '</table>' +
          '<p style="margin:18px 0 0;font-size:13px;color:#6b7280">' +
            'Payment support: <b>' + SUPPORT_NAME + '</b> · ' + SUPPORT_PHONE +
          '</p>' +
        '</div>' +
      '</div>' +
    '</div>';

  MailApp.sendEmail({
    to      : d.email,
    subject : 'Registration confirmed — ' + regId + ' · GSA Cricket Premium Member',
    htmlBody: html
  });
}

function row_(k, v) {
  return '<tr>' +
    '<td style="padding:7px 0;color:#6b7280;width:130px">' + k + '</td>' +
    '<td style="padding:7px 0;color:#111827;font-weight:600">' + v + '</td>' +
  '</tr>';
}

function esc_(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


/* ══════════════════════════════════════════════════════════════════
   RUN ONCE FROM THE EDITOR
   ══════════════════════════════════════════════════════════════════ */

function authorize() {
  var ss = getSpreadsheet_();
  var manshire = getManshireSheet_();
  var gca = getGcaSheet_();
  var folder = getUploadFolder_(MANSHIRE_UPLOADS);
  var mailQuota = SEND_CONFIRMATION_EMAIL ? MailApp.getRemainingDailyQuota() : 'disabled';

  Logger.log('Authorized.');
  Logger.log('Spreadsheet     : ' + ss.getName() + ' (' + ss.getId() + ')');
  Logger.log('Manshire tab    : ' + manshire.getName());
  Logger.log('GCA tab         : ' + gca.getName());
  Logger.log('Upload folder   : ' + folder.getName());
  Logger.log('Next Reg ID     : ' + nextRegId_(manshire));
  Logger.log('Email quota     : ' + mailQuota);
}
