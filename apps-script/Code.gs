/**
 * Forge (R1 workout tracker) — Google Apps Script web app backend.
 *
 * Receives POSTs from the R1 Creation:
 *   action:'log'  -> upsert one row into the "Log" tab (by entry id)
 *   action:'ping' -> health check
 *
 * SETUP
 * 1. Create a Google Sheet. The "Log" tab auto-creates on first write.
 * 2. Extensions > Apps Script, paste this file.
 * 3. Deploy > New deployment > Web app:
 *      Execute as: Me   |   Who has access: Anyone
 *    Copy the /exec URL into src/index.html (WEBHOOK) and test/fetch-test.html.
 *
 * Note: the R1 posts Content-Type text/plain to skip CORS preflight, so we
 * parse e.postData.contents as JSON ourselves.
 */

var HEADERS = ['id', 'date', 'type', 'details', 'totalReps', 'runMin', 'saunaMin', 'weightLbs', 'loggedAt'];

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    switch (body.action) {
      case 'log':  upsertLog(body); break;
      case 'del':  deleteLog(body.id); break;
      case 'ping': break; // health check
      default: return json({ ok: false, error: 'unknown action ' + body.action });
    }
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function upsertLog(b) {
  var sheet = getSheet('Log');
  var row = [b.id, b.date, b.type, b.details, b.reps || 0, b.runMin || 0,
    b.saunaMin || 0, b.weightLbs || '', new Date()];

  // Upsert by entry id (column A) so queue retries never duplicate rows.
  var last = sheet.getLastRow();
  if (last > 1) {
    var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (ids[i][0] === b.id) {
        sheet.getRange(i + 2, 1, 1, row.length).setValues([row]);
        return;
      }
    }
  }
  sheet.appendRow(row);
}

function deleteLog(id) {
  var sheet = getSheet('Log');
  var last = sheet.getLastRow();
  if (last < 2) return;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (ids[i][0] === id) sheet.deleteRow(i + 2);
  }
}

function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
