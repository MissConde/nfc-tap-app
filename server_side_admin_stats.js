/**
 * GOOGLE APPS SCRIPT - DYNAMIC FEEDBACK EDITION 2026
 */

function doGet(e) {
  const action = e.parameter.action;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName("Users");
  const interSheet = ss.getSheetByName("Interactions");
  const userData = userSheet.getDataRange().getValues();

  // --- NEW: GET DYNAMIC FEEDBACK TEMPLATE ---
  if (action === "getFeedbackTemplate") {
    const configSheet = ss.getSheetByName("FeedbackConfig");
    const configData = configSheet.getDataRange().getValues();
    const template = [];

    for (let i = 1; i < configData.length; i++) {
      template.push({
        id: configData[i][0],      // Column A: ID
        label: configData[i][1],   // Column B: Question
        type: configData[i][2],    // Column C: Type (select, scale, etc)
        options: configData[i][3] ? configData[i][3].toString().split(',').map(s => s.trim()) : [],
        required: configData[i][4] === true || configData[i][4] === "TRUE",
        category: configData[i][5] // Column F: Category
      });
    }
    return jsonResponse(template);
  }

  // --- EXISTING ACTIONS ---
  if (action === 'checkUnique') {
    const field = e.parameter.field;
    const value = (e.parameter.value || "").toLowerCase();
    const colIndex = field === 'alias' ? 2 : 4;
    const exists = userData.some((row, i) => i > 0 && row[colIndex] && row[colIndex].toString().toLowerCase() === value);
    return jsonResponse({ exists: exists });
  }

  if (action === "check") {
    const chipID = e.parameter.id;
    const feedbackSheet = ss.getSheetByName("Feedback");
    const feedbackData = feedbackSheet.getDataRange().getValues();
    let hasGivenFeedback = feedbackData.some((row, i) => i > 0 && row[1] == chipID);

    for (let i = 1; i < userData.length; i++) {
      if (userData[i][0] == chipID) {
        return jsonResponse({
          registered: true,
          alias: userData[i][2],
          role: userData[i][5],
          storedKey: userData[i][1],
          feedbackGiven: hasGivenFeedback
        });
      }
    }
    return jsonResponse({ registered: false });
  }

  if (action === "logDance") return handleLogDance(e.parameter.scannerId, e.parameter.targetId, interSheet, userData);
  if (action === "getHistory") return handleGetHistory(e.parameter.id, interSheet, userData);

  if (action === "confirmManual" || action === "cancelDance") {
    const status = action === "confirmManual" ? "Confirmed" : "Cancelled";
    interSheet.getRange(e.parameter.rowId, 4).setValue(status);
    return jsonResponse({ success: true });
  }
  if (action === 'getAdminStats') {
    return handleGetAdminStats(e);
  }
}

function doPost(e) {
  const params = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (params.action === "register") {
    const userSheet = ss.getSheetByName("Users");
    userSheet.appendRow([
      params.chipID, params.userKey, params.alias,
      params.fullName, params.email, params.role,
      params.consent, params.igUser, new Date()
    ]);
    return ContentService.createTextOutput("User Registered");
  }

  // --- DYNAMIC FEEDBACK SUBMISSION (WITH UPDATE LOGIC) ---
  if (params.action === "submitFeedback") {
    const feedbackSheet = ss.getSheetByName("Feedback");
    const feedbackData = feedbackSheet.getDataRange().getValues();
    const headers = feedbackData[0];

    // Map the incoming params to the correct structure
    const newRow = headers.map(header => {
      if (header === "Timestamp") return new Date();
      if (header === "chipID") return params.chipID;
      return params[header] || "";
    });

    // 1. Search for existing ChipID (Assuming chipID is in Column B / Index 1)
    let existingRowIndex = -1;
    for (let i = 1; i < feedbackData.length; i++) {
      if (feedbackData[i][1] == params.chipID) {
        existingRowIndex = i + 1; // +1 because rows are 1-indexed
        break;
      }
    }

    if (existingRowIndex > -1) {
      // 2. UPDATE existing row
      feedbackSheet.getRange(existingRowIndex, 1, 1, newRow.length).setValues([newRow]);
      return ContentService.createTextOutput("Feedback Updated");
    } else {
      // 3. APPEND new row
      feedbackSheet.appendRow(newRow);
      return ContentService.createTextOutput("Feedback Saved");
    }
  }
}

/**
 * LOGIC HANDLERS
 */

function handleLogDance(scannerId, targetId, interSheet, userData) {
  const now = new Date();
  const data = interSheet.getDataRange().getValues();
  const sessionId = Utilities.formatDate(now, "GMT+1", "yyyy-MM-dd");

  // --- CHECK IF TARGET IS REGISTERED ---
  let targetExists = false;
  // Start at i=1 to skip header
  for (let i = 1; i < userData.length; i++) {
    if (userData[i][0] == targetId) {
      targetExists = true;
      break;
    }
  }

  // If the target ID is not in our Users sheet, block the dance
  if (!targetExists) {
    return jsonResponse({ success: false, status: "Unregistered" });
  }
  // ------------------------------------------

  let reverseMatchRow = -1;
  let duplicateRow = -1;

  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    const rowScanner = row[1];
    const rowTarget = row[2];
    const rowStatus = row[3];
    const rowTime = new Date(row[0]);
    const timeDiff = (now - rowTime) / 1000 / 60; // Difference in minutes

    // 1. THE HANDSHAKE (They scanned me in the last 10 mins)
    if (rowScanner == targetId && rowTarget == scannerId && rowStatus == "Pending" && timeDiff <= 10) {
      reverseMatchRow = i + 1;
      break;
    }

    // 2. THE DUPLICATE (I already scanned them in the last 10 mins)
    if (rowScanner == scannerId && rowTarget == targetId && rowStatus == "Pending" && timeDiff <= 10) {
      duplicateRow = i + 1;
      break;
    }
  }

  if (reverseMatchRow > -1) {
    interSheet.getRange(reverseMatchRow, 4).setValue("Confirmed");
    return jsonResponse({ success: true, status: "Confirmed" });
  }

  if (duplicateRow > -1) {
    interSheet.getRange(duplicateRow, 1).setValue(now);
    return jsonResponse({ success: true, status: "Pending", message: "Duplicate suppressed" });
  }

  // 3. NEW DANCE (First time tapping, OR more than 10 mins since last attempt)
  interSheet.appendRow([now, scannerId, targetId, "Pending", sessionId]);
  return jsonResponse({ success: true, status: "Pending" });
}

function handleGetHistory(myId, interSheet, userData) {
  const interData = interSheet.getDataRange().getValues();
  const history = [];
  const aliasMap = {};
  for (let i = 1; i < userData.length; i++) { aliasMap[userData[i][0]] = userData[i][2]; }

  for (let i = interData.length - 1; i >= 1; i--) {
    const row = interData[i];
    if (row[3] === "Cancelled") continue;

    if (row[1] == myId || row[2] == myId) {
      const partnerId = (row[1] == myId) ? row[2] : row[1];
      history.push({
        rowId: i + 1,
        timestamp: row[0],
        partnerAlias: aliasMap[partnerId] || "Unknown",
        status: row[3],
        isTarget: (row[2] == myId)
      });
    }
  }
  return jsonResponse(history);
}

/**
 * ADMIN STATS HANDLER
 * Merged logic for "Interactions" sheet and correct column mapping.
 */
function handleGetAdminStats(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName("Users");
  const interSheet = ss.getSheetByName("Interactions");
  const fbSheet = ss.getSheetByName("Feedback");

  // 1. Total Registered
  const totalDancers = userSheet.getLastRow() - 1; // Subtract header

  // 2. Scan Logs (for Activity & Density)
  // Optimization: Read last 2000 rows only to prevent slow execution
  const LOG_LIMIT = 2000;
  const lastRow = interSheet.getLastRow();
  let logData = [];
  if (lastRow > 1) {
    const startRow = Math.max(2, lastRow - LOG_LIMIT + 1);
    // Cols A-D (Time, Scanner, Target, Status)
    logData = interSheet.getRange(startRow, 1, lastRow - startRow + 1, 4).getValues();
  }

  const activeSet = new Set();
  const topDancersMap = {};
  const recentDances = [];
  let dancesOnDensity = 0;

  // Thresholds
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - (60 * 60 * 1000));

  // Need a quick ID->Alias Map for the Feed
  // Fetch columns A (ID) and C (Alias) from Users
  const userRaw = userSheet.getRange(2, 1, totalDancers, 6).getValues(); // Get A to F (Role is F/5)
  const aliasMap = {};
  const roleMap = {};
  let leaderCount = 0;

  userRaw.forEach(r => {
    // r[0]=ID, r[2]=Alias, r[5]=Role
    aliasMap[r[0]] = r[2];
    roleMap[r[0]] = r[5];
    if (r[5] === 'Leader') leaderCount++;
  });

  // Process Logs (Reverse order for recency)
  let feedCount = 0;

  for (let i = logData.length - 1; i >= 0; i--) {
    const row = logData[i];
    const time = new Date(row[0]);
    const scanner = row[1];
    const target = row[2];
    const status = row[3];

    // Skip cancelled
    if (status === "Cancelled") continue;

    // Active Dancers (Unique IDs seen in logs)
    activeSet.add(scanner);
    activeSet.add(target);

    // Top Dancers Count
    if (status === "Confirmed") {
      topDancersMap[scanner] = (topDancersMap[scanner] || 0) + 1;
      topDancersMap[target] = (topDancersMap[target] || 0) + 1;

      // Density (Last 60 mins, confirmed only?) 
      // Let's count Pending too as "Activity" or just Confirmed? 
      // Usually "Activity" implies people trying. Let's count all non-cancelled.
      if (time > oneHourAgo) {
        dancesOnDensity++;
      }

      // Recent Feed (Show confirmed pairings)
      if (feedCount < 5) {
        const name1 = aliasMap[scanner] || "Unknown";
        const name2 = aliasMap[target] || "Unknown";
        recentDances.push({
          time: Utilities.formatDate(time, Session.getScriptTimeZone(), "HH:mm"),
          pair: `${name1} & ${name2}`
        });
        feedCount++;
      }
    } else {
      // Count Pending for density? Yes.
      if (time > oneHourAgo) dancesOnDensity++;

      // REMOVED: Do not show Pending dances in the feed
    }
  }

  // 3. Role Ratio
  const percentLeaders = totalDancers > 0 ? Math.round((leaderCount / totalDancers) * 100) : 0;

  // 4. Top Dancers Sort
  let sortedDancers = Object.keys(topDancersMap).map(id => {
    return {
      alias: aliasMap[id] || "Unknown",
      role: roleMap[id] || "-",
      count: topDancersMap[id]
    };
  }).sort((a, b) => b.count - a.count).slice(0, 5);

  // 5. Feedback Vibe
  let avgVibe = 0;
  let feedbackCount = 0; // Initialize securely outside the block

  if (fbSheet.getLastRow() > 1) {
    // Determine which column is "Average Rating"
    // Usually we grab the whole range and check headers or just guess?
    // Let's assume the question ID is 'overall_vibe' or 'q1'.
    // Better: Just grab all data and look for the specific column if possible.
    // Simplifying: Grab Column E (index 4) assuming it's the 1-5 Star Rating.
    // ADJUST THIS INDEX BASED ON YOUR FORM CONFIG!
    const data = fbSheet.getDataRange().getValues();
    // Use header row to find "Overall" or just use Col 5 roughly
    // Let's assume Col index 4 (5th visible col) is the rating.
    let sum = 0;
    let count = 0;
    for (let i = 1; i < data.length; i++) {
      // Look for any number 1-5 in the row?
      // Let's try row[4]
      let val = parseInt(data[i][4]);
      // Fallback: search row for number
      if (isNaN(val)) val = data[i].find(c => !isNaN(c) && c >= 1 && c <= 5);

      if (val) { sum += val; count++; }
    }
    avgVibe = count > 0 ? (sum / count).toFixed(1) : "N/A";
    feedbackCount = count; // Export count
  }

  const result = {
    totalDancers: totalDancers,
    activeDancers: activeSet.size,
    percentLeaders: percentLeaders,
    avgVibe: avgVibe,
    feedbackCount: feedbackCount,
    dancesLastHour: dancesOnDensity,
    recentDances: recentDances,
    topDancers: sortedDancers
  };

  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function handleAdminSearch(e) {
  const query = e.parameter.query.toLowerCase();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Users");
  const data = sheet.getDataRange().getValues();
  // [ID, Key, Alias, FullName, Email, Role, Consent, IG, Time]

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    // Search in Alias (2) or FullName (3)
    const alias = String(row[2]).toLowerCase();
    const realName = String(row[3]).toLowerCase();

    if (alias.includes(query) || realName.includes(query)) {
      return ContentService.createTextOutput(JSON.stringify({
        found: true,
        alias: row[2],
        realName: row[3],
        email: row[4],
        role: row[5],
        chipId: row[0]
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  return ContentService.createTextOutput(JSON.stringify({ found: false })).setMimeType(ContentService.MimeType.JSON);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}