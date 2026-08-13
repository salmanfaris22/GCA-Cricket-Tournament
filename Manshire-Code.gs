/**
 * MANSHIRE 43rd Anniversary — CORPORATE CRICKET CHAMPIONSHIP 2026
 * Premium registration backend (Google Apps Script)
 *
 * Event : 07 · 08 · 09 September 2026
 * Venue : Z3 Sports Ground, Tirupur
 *
 * Front-end served by this endpoint:
 *   manshire-index.html  — the premium public registration form
 *   dashboard.html       — admin dashboard (posts { action:'updatePayment' })
 *
 * WHAT IS NEW IN THIS SCRIPT (vs the old GCA Goa Code.gs)
 *   • Registration types are now  Proprietorship  and  Partnership
 *   • GST Number is MANDATORY and format-checked
 *   • GST Certificate upload is MANDATORY, hard limit 2 MB
 *   • Partnership Deed upload is MANDATORY for Partnership, hard limit 2 MB
 *   • EVERY upload is capped at 2 MB — photo, Aadhaar and payment
 *     screenshot included, not just the documents
 *   • Every registration gets a premium Reg ID (MCC26-0001, MCC26-0002 …)
 *   • Writes to its own sheet tab so the old GCA data is never touched
 *   • Returns real JSON errors the form can display (no more silent failures)
 *
 * ── FIRST-TIME DEPLOY ────────────────────────────────────────────────
 * 1. Open your Google Sheet → Extensions → Apps Script
 * 2. Paste THIS whole file, Save (💾)
 * 3. Run the  authorize  function once and approve the permission prompt
 * 4. Deploy → New deployment → Web app
 *      - Execute as    : Me
 *      - Who has access: Anyone
 * 5. Copy the Web app URL (it ends in /exec) and paste it into
 *    SCRIPT_URL near the bottom of manshire-index.html
 *
 * ── UPDATING AN ALREADY-DEPLOYED SCRIPT ──────────────────────────────
 *    Deploy → Manage deployments → ✏️ edit → Version: New version → Deploy
 *    Editing the existing deployment KEEPS the same /exec URL, so the
 *    HTML files need no changes.
 *
 * Check it worked: open the /exec URL in a browser. The reply must show
 * this version string and list "register" + "updatePayment" under actions.
 */

/* ══════════════════════════════════════════════════════════════════
   CONFIG — the only part you normally need to edit
   ══════════════════════════════════════════════════════════════════ */

var SCRIPT_VERSION = '2026-08-13 · manshire-v2 (all uploads 2 MB)';

var EVENT_NAME  = 'MANSHIRE 43rd Anniversary Corporate Cricket Championship 2026';
var EVENT_DATES = '07 · 08 · 09 September 2026';
var EVENT_VENUE = 'Z3 Sports Ground, Tirupur';

/** Its own tab, so the old GCA Goa registrations stay untouched. */
var SHEET_NAME = 'Manshire 2026';

/** Drive folder that receives every upload. Created on first use. */
var UPLOAD_FOLDER_NAME = 'MANSHIRE Cricket 2026 Uploads';

/** Reg IDs come out as MCC26-0001, MCC26-0002, … */
var REG_ID_PREFIX = 'MCC26';

/** Hard upload ceiling — 2 MB for EVERY file, documents and images alike. */
var MAX_DOC_MB   = 2;    // GST certificate, Partnership deed
var MAX_IMAGE_MB = 2;    // profile photo, Aadhaar, payment screenshot

/** Set to false if you do not want the confirmation email to go out. */
var SEND_CONFIRMATION_EMAIL = true;

/** Support contact printed in the confirmation email. */
var SUPPORT_NAME  = 'Junied DX';
var SUPPORT_PHONE = '+91 90613 03300';

/** Column order of the sheet. Changing this re-labels an empty sheet only. */
var HEADERS = [
  'Reg ID', 'Timestamp',
  'Full Name', 'Phone', 'Email', 'DOB', 'Blood Group', 'T-Shirt Size',
  'City', 'Address',
  'Registration Type', 'Firm Name', 'Brand Name', 'GST Number', 'Partner Names',
  'Position', 'Batting', 'Bowling',
  'Payment Status', 'UTR',
  'Profile Photo', 'GST Certificate', 'Partnership Deed',
  'Payment Screenshot', 'Aadhaar Card'
];

var REG_TYPES = ['Proprietorship', 'Partnership'];


/* ══════════════════════════════════════════════════════════════════
   ROUTING
   ══════════════════════════════════════════════════════════════════ */

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut_({ result: 'error', message: 'Empty request.' });
    }

    var d = JSON.parse(e.postData.contents);

    if (d.action === 'updatePayment') return updatePayment_(d);

    return register_(d);
  } catch (err) {
    return jsonOut_({ result: 'error', message: 'Server error: ' + err });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Open the Web app URL in a browser to confirm which version is live.
 * If the version below is not the one you just pasted, the deployment is
 * still serving old code — re-deploy (Manage deployments → edit → New version).
 */
function doGet() {
  return jsonOut_({
    status : 'MANSHIRE Corporate Cricket 2026 registration endpoint is live',
    event  : EVENT_NAME,
    dates  : EVENT_DATES,
    venue  : EVENT_VENUE,
    version: SCRIPT_VERSION,
    sheet  : SHEET_NAME,
    limits : { documentMB: MAX_DOC_MB, imageMB: MAX_IMAGE_MB },
    actions: ['register', 'updatePayment']
  });
}


/* ══════════════════════════════════════════════════════════════════
   REGISTER — a new entry from manshire-index.html
   ══════════════════════════════════════════════════════════════════ */

function register_(d) {
  // ── 1. Validate before touching Drive or the sheet ────────────────
  var problem = validateRegistration_(d);
  if (problem) return jsonOut_({ result: 'error', message: problem });

  var sheet = getSheet_();
  var regType = String(d.regType || '').trim();
  var safeName = safeName_(d.fullName);

  // ── 2. Reject a same-phone duplicate rather than silently doubling ─
  var dup = findRowByPhone_(sheet, d.phone);
  if (dup.row > 0) {
    return jsonOut_({
      result : 'duplicate',
      message: 'This phone number is already registered (' + dup.regId + '). ' +
               'Call ' + SUPPORT_NAME + ' on ' + SUPPORT_PHONE + ' to change anything.',
      regId  : dup.regId
    });
  }

  // ── 3. Save the uploads ───────────────────────────────────────────
  // A per-registrant sub-folder keeps Drive readable when hundreds enter.
  var folder = getRegistrantFolder_(safeName);

  var photoUrl   = trySaveFile_(folder, d.photo,      'photo_'      + safeName);
  var gstUrl     = trySaveFile_(folder, d.gstCert,    'gst_'        + safeName);
  var deedUrl    = trySaveFile_(folder, d.deed,       'deed_'       + safeName);
  var ssUrl      = trySaveFile_(folder, d.screenshot, 'payment_'    + safeName);
  var aadhaarUrl = trySaveFile_(folder, d.aadhaar,    'aadhaar_'    + safeName);

  // ── 4. Write the row ──────────────────────────────────────────────
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

  formatLastRow_(sheet);

  // ── 5. Best-effort confirmation email — never fails the signup ────
  if (SEND_CONFIRMATION_EMAIL && d.email) {
    try { sendConfirmation_(d, regId); } catch (mailErr) { /* ignore */ }
  }

  return jsonOut_({ result: 'ok', regId: regId, row: sheet.getLastRow() });
}


/**
 * Every rule the form enforces is re-checked here, because a browser can
 * always be bypassed. Returns an error string, or '' when the entry is good.
 */
function validateRegistration_(d) {
  // Personal
  if (!str_(d.fullName))   return 'Full name is required.';
  if (digits_(d.phone).length !== 10) return 'Enter a valid 10-digit phone number.';
  if (!str_(d.dob))        return 'Date of birth is required.';
  if (!str_(d.bloodGroup)) return 'Blood group is required.';
  if (!str_(d.city))       return 'City is required.';
  if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(str_(d.email))) {
    return 'That email address does not look valid.';
  }

  // Registration type
  var regType = str_(d.regType);
  if (REG_TYPES.indexOf(regType) === -1) {
    return 'Choose a registration type: ' + REG_TYPES.join(' or ') + '.';
  }
  if (!str_(d.firmName))  return 'Firm name is required.';
  if (!str_(d.address))   return 'Business address is required.';

  // GST — mandatory number AND mandatory certificate, both of them
  var gst = str_(d.gstNumber).toUpperCase().replace(/\s+/g, '');
  if (!gst) return 'GST number is required.';
  if (!isGstin_(gst)) {
    return 'That GST number is not valid. A GSTIN is 15 characters, e.g. 33ABCDE1234F1Z5.';
  }
  if (!d.gstCert || !d.gstCert.data) {
    return 'The GST certificate upload is required.';
  }
  var gstErr = sizeError_(d.gstCert, MAX_DOC_MB, 'GST certificate');
  if (gstErr) return gstErr;

  // Partnership deed — mandatory for Partnership only
  if (regType === 'Partnership') {
    if (!d.deed || !d.deed.data) {
      return 'A Partnership registration requires the partnership deed upload.';
    }
    var deedErr = sizeError_(d.deed, MAX_DOC_MB, 'Partnership deed');
    if (deedErr) return deedErr;
  }

  // Aadhaar + images
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

  // Cricket
  if (!str_(d.position)) return 'Playing position is required.';
  if (!str_(d.batting))  return 'Batting hand is required.';
  if (!str_(d.bowling))  return 'Bowling hand is required.';

  return '';
}


/* ══════════════════════════════════════════════════════════════════
   UPDATE PAYMENT — called by dashboard.html
   ══════════════════════════════════════════════════════════════════ */

/**
 * Attaches (or replaces) the payment screenshot of an existing registration
 * and can also record a UTR reference.
 *
 * Expects: {
 *   action:'updatePayment',
 *   regId:'MCC26-0007',                       // best match
 *   rowKey:'<the Timestamp cell of that row>',// fallback match
 *   phone:'9061303300',                       // last-resort match
 *   utr:'optional reference',
 *   screenshot:{ name, type, data(base64) }   // optional
 * }
 */
function updatePayment_(d) {
  var sheet = getSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return jsonOut_({ result: 'error', message: 'No registrations in the sheet yet.' });
  }

  var head = values[0].map(function (h) { return String(h).trim(); });
  var idCol    = head.indexOf('Reg ID');
  var tsCol    = head.indexOf('Timestamp');
  var nameCol  = head.indexOf('Full Name');
  var phoneCol = head.indexOf('Phone');
  var payCol   = head.indexOf('Payment Screenshot');
  var utrCol   = head.indexOf('UTR');
  var statCol  = head.indexOf('Payment Status');

  if (payCol === -1) {
    return jsonOut_({ result: 'error', message: 'No "Payment Screenshot" column in the sheet.' });
  }

  var wantId    = str_(d.regId).toUpperCase();
  var wantKey   = str_(d.rowKey);
  var wantPhone = digits_(d.phone);
  var target = -1;

  for (var i = 1; i < values.length && target === -1; i++) {
    if (wantId  && idCol > -1 && String(values[i][idCol]).trim().toUpperCase() === wantId) target = i;
    else if (wantKey && tsCol > -1 && cellKey_(values[i][tsCol]) === wantKey) target = i;
  }
  if (target === -1 && wantPhone && phoneCol > -1) {
    for (var j = 1; j < values.length; j++) {
      if (digits_(values[j][phoneCol]) === wantPhone) { target = j; break; }
    }
  }
  if (target === -1) {
    return jsonOut_({ result: 'error', message: 'That registration was not found.' });
  }

  var url = '';
  if (d.screenshot && d.screenshot.data) {
    var tooBig = sizeError_(d.screenshot, MAX_IMAGE_MB, 'Payment screenshot');
    if (tooBig) return jsonOut_({ result: 'error', message: tooBig });

    var who = safeName_(nameCol > -1 ? values[target][nameCol] : 'registrant');
    url = saveFile_(getRegistrantFolder_(who), d.screenshot, 'payment_' + who);
    sheet.getRange(target + 1, payCol + 1).setValue(url);
    if (statCol > -1) sheet.getRange(target + 1, statCol + 1).setValue('Screenshot received');
  }
  if (utrCol > -1 && d.utr) {
    sheet.getRange(target + 1, utrCol + 1).setValue(txt_(d.utr));
  }

  return jsonOut_({ result: 'ok', url: url, row: target + 1 });
}


/* ══════════════════════════════════════════════════════════════════
   SHEET HELPERS
   ══════════════════════════════════════════════════════════════════ */

/** Returns the event's own tab, creating and styling it on first use. */
function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    var head = sheet.getRange(1, 1, 1, HEADERS.length);
    head.setBackground('#0b2452')
        .setFontColor('#f5c542')
        .setFontWeight('bold')
        .setVerticalAlignment('middle');
    sheet.setRowHeight(1, 34);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 100);   // Reg ID
    sheet.setColumnWidth(3, 190);   // Full Name
    sheet.setColumnWidth(10, 260);  // Address
  }
  return sheet;
}

/** Light zebra striping so the sheet stays readable as it fills up. */
function formatLastRow_(sheet) {
  try {
    var r = sheet.getLastRow();
    if (r % 2 === 0) {
      sheet.getRange(r, 1, 1, HEADERS.length).setBackground('#f6f8fb');
    }
    sheet.getRange(r, 1).setFontWeight('bold').setFontColor('#0b2452');
  } catch (err) { /* cosmetic only */ }
}

/** MCC26-0001, MCC26-0002 … derived from the highest ID already present. */
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

/** Finds an existing registration by phone. Returns { row, regId }. */
function findRowByPhone_(sheet, phone) {
  var want = digits_(phone);
  if (!want) return { row: -1, regId: '' };

  var last = sheet.getLastRow();
  if (last < 2) return { row: -1, regId: '' };

  var head = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var phoneCol = head.indexOf('Phone');
  var idCol    = head.indexOf('Reg ID');
  if (phoneCol === -1) return { row: -1, regId: '' };

  var rows = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (digits_(rows[i][phoneCol]) === want) {
      return { row: i + 2, regId: idCol > -1 ? String(rows[i][idCol]) : '' };
    }
  }
  return { row: -1, regId: '' };
}


/* ══════════════════════════════════════════════════════════════════
   DRIVE HELPERS
   ══════════════════════════════════════════════════════════════════ */

/** The root upload folder, created on first use. */
function getUploadFolder_() {
  var it = DriveApp.getFoldersByName(UPLOAD_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(UPLOAD_FOLDER_NAME);
}

/** A per-registrant sub-folder inside the root upload folder. */
function getRegistrantFolder_(safeName) {
  var root = getUploadFolder_();
  var it = root.getFoldersByName(safeName);
  return it.hasNext() ? it.next() : root.createFolder(safeName);
}

/** Never throws — returns '' when empty, or 'UPLOAD FAILED: …' in the cell. */
function trySaveFile_(folder, fileObj, baseName) {
  if (!fileObj || !fileObj.data) return '';
  try {
    return saveFile_(folder, fileObj, baseName);
  } catch (err) {
    return 'UPLOAD FAILED: ' + err;
  }
}

/**
 * Decodes a { name, type, data(base64) } object to a Drive file and returns
 * a viewable link. Returns '' when no file was provided.
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
    // Some Workspace domains block link sharing; the file is still saved.
  }
  return file.getUrl();
}


/* ══════════════════════════════════════════════════════════════════
   SIZE + FORMAT HELPERS
   ══════════════════════════════════════════════════════════════════ */

/**
 * Real byte size of a base64 payload, without decoding it.
 * 4 base64 chars carry 3 bytes; trailing '=' padding carries none.
 */
function base64Bytes_(data) {
  var s = String(data || '').replace(/\s+/g, '');
  if (!s) return 0;
  var pad = s.slice(-2) === '==' ? 2 : (s.slice(-1) === '=' ? 1 : 0);
  return Math.floor(s.length * 3 / 4) - pad;
}

/** Returns an error string when the file is over the limit, else ''. */
function sizeError_(fileObj, maxMb, label) {
  if (!fileObj || !fileObj.data) return '';
  var bytes = base64Bytes_(fileObj.data);
  if (bytes > maxMb * 1024 * 1024) {
    return label + ' is ' + (bytes / 1048576).toFixed(1) + ' MB. ' +
           'The limit is ' + maxMb + ' MB — please compress it and try again.';
  }
  return '';
}

/** Standard 15-character GSTIN shape: 33ABCDE1234F1Z5 */
function isGstin_(v) {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(String(v || '').toUpperCase());
}

function str_(v) {
  return String(v == null ? '' : v).trim();
}

/** Keeps only digits, so 9061303300 and +91 90613 03300 compare equal. */
function digits_(v) {
  var s = String(v == null ? '' : v).replace(/\D/g, '');
  if (s.length === 12 && s.indexOf('91') === 0) s = s.substring(2);
  if (s.length === 11 && s.indexOf('0') === 0)  s = s.substring(1);
  return s;
}

/** Timestamps arrive as text or as a Date depending on the cell format. */
function cellKey_(v) {
  if (v instanceof Date) return v.toISOString();
  return String(v == null ? '' : v).trim();
}

/** A Drive-safe, sheet-safe version of a person's name. */
function safeName_(v) {
  return String(v || 'registrant').replace(/[^\w\- ]+/g, '').trim() || 'registrant';
}

/**
 * Forces a value to be stored as plain text so Sheets does not read a leading
 * +, =, -, or @ as a formula (e.g. "+91…" phone numbers).
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


/* ══════════════════════════════════════════════════════════════════
   CONFIRMATION EMAIL
   ══════════════════════════════════════════════════════════════════ */

function sendConfirmation_(d, regId) {
  var html =
    '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;background:#f4f6fa;padding:26px">' +
      '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;' +
                  'border:1px solid #e3e8f0">' +
        '<div style="background:linear-gradient(135deg,#0b2452,#16346e);padding:26px 24px;text-align:center">' +
          '<div style="color:#f5c542;font-size:12px;letter-spacing:3px;font-weight:700">MANSHIRE · 43RD ANNIVERSARY</div>' +
          '<div style="color:#fff;font-size:23px;font-weight:800;margin-top:6px">Corporate Cricket Championship 2026</div>' +
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
    subject : 'Registration confirmed — ' + regId + ' · Corporate Cricket Championship 2026',
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
   RUN-ONCE SETUP
   ══════════════════════════════════════════════════════════════════ */

/**
 * RUN THIS ONCE from the editor (select "authorize" → Run) to grant the
 * Spreadsheet + Drive + Mail permissions. Approve the prompt that appears.
 * After that, uploads from the live form will save correctly.
 */
function authorize() {
  var sheet = getSheet_();
  var folder = getUploadFolder_();

  // Touching MailApp here makes Google ask for the mail scope now, rather
  // than silently skipping the first confirmation email later.
  var mailQuota = SEND_CONFIRMATION_EMAIL ? MailApp.getRemainingDailyQuota() : 'disabled';

  Logger.log('Authorized.');
  Logger.log('Sheet tab ready : ' + sheet.getName());
  Logger.log('Upload folder   : ' + folder.getName());
  Logger.log('Next Reg ID     : ' + nextRegId_(sheet));
  Logger.log('Email quota     : ' + mailQuota);
}
