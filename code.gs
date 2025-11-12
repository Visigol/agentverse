/**
 * @fileoverview Main server-side script for the BoltVerse Attendance & Production App.
 * Refactored for a standalone web app architecture to read from multiple spreadsheets.
 * @version 8.1 (Consolidated Config - Complete)
 */

// =================================================================================
// --- CENTRALIZED CONFIGURATION (SIMPLIFIED) ---
// =================================================================================
// INSTRUCTIONS: Replace the placeholder IDs with your actual Google Spreadsheet IDs.
const CONFIG = {
  // Spreadsheet containing agent/manager lists, logs, and general settings
  ATTENDANCE: {
    ID: '1-3UfwCsL9dc3brmTCxYpbqfuCeDGEvSIz-Cfm_iqoYI',
    SHEETS: {
      AGENT_LOG: "AgentLog",
      CASE_LOG: "CaseLog",
      AGENTS: "Agents",
      NEXT_WEEK_APPLICATIONS: "NextWeekApplications",
      SUGGESTED_SCHEDULE: "SuggestedSchedule",
      MANAGERS: "Managers",
      REQUESTS: "Requests",
      IMPORTANT_LINKS: "Important Links",
      VERSION_CONFIG: "UpdateConfig",
      IMPORTANT_LINKS_MANAGER: "Important Links Manager"
    }
  },
  // Spreadsheet containing the main production/case data (THE TARGET)
  PRODUCTION: {
    ID: '1AaJmBfDpZnk0J1A4WbInEPuspUyae5jXm42SyQIaJn8',
    SHEETS: {
      AVAILABLE_CASES: "Main Tasks",
      // --- ADDITIONS START ---
      // Add the names of the log sheets as they will appear in your TARGET spreadsheet.
      ESCALATION_LOGS: "Escalation Logs",
      PAUSING_LOGS: "Pausing Logs",
      COOPERATION_LOGS: "Cooperation Logs"
      // --- ADDITIONS END ---
    }
  },
  // Source spreadsheet for the daily case sync
  SOURCE_DATA: {
    ID: '1AaJmBfDpZnk0J1A4WbInEPuspUyae5jXm42SyQIaJn8', // This was the hardcoded ID
    SHEETS: {
      MAIN_TASKS: "Main Tasks",
      // --- ADDITIONS START ---
      // Add the names of the log sheets as they appear in your SOURCE spreadsheet.
      ESCALATION_LOGS: "Escalation Logs",
      PAUSING_LOGS: "Pausing Logs",
      COOPERATION_LOGS: "Cooperation Logs"
      // --- ADDITIONS END ---
    },
    // --- ADDITIONS START ---
    // This new block is essential. It tells the script which column contains the
    // unique ID for each record in each source sheet.
    PRIMARY_KEYS: {
      "Main Tasks": "Main Task ID",
      "Escalation Logs": "Log ID",
      "Cooperation Logs": "Log ID",
      "Pausing Logs": "ID"
    }
    // --- ADDITIONS END ---
  },
   DRIVE_FOLDER_ID: '1WXiYBNDjxw7DK5L-K2JJlW6nOTpnlFfQ'
};

// IMPORTANT: Manually update this version number in the script before deploying a new version.
const SCRIPT_APP_VERSION = "8.1";

// Constant for converting Sheets duration values (which are Date objects relative to epoch) to seconds.
const SPREADSHEET_EPOCH_OFFSET_MS = new Date('1899-12-30T00:00:00').getTime();

// Fallback if Managers sheet is not found or has issues
const MANAGER_EMAILS_FALLBACK = ["manager1@example.com", "your.manager.email@example.com"];

// =================================================================================
// --- WEB APP ROUTER ---
// =================================================================================

function doGet(e) {
  let userEmail = null;
  try {
    userEmail = Session.getActiveUser().getEmail();
  }
  catch (err) {
    Logger.log("Could not get active user email in doGet: " + err);
  }

  // Check if the user is a manager
  if (userEmail && isUserManager_(userEmail)) {
    // If the URL asks for the 'production' page, show it.
    if (e.parameter.page === 'production') {
      return HtmlService.createHtmlOutputFromFile('production')
        .setTitle('Production Dashboard')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
    // --- ADD THIS BLOCK ---
    else if (e.parameter.page === 'cases') {
      return HtmlService.createHtmlOutputFromFile('cases')
        .setTitle('Case Management')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
    // --- END ADDITION ---
    else if (e.parameter.page === 'schedule-dashboard') {
        return HtmlService.createHtmlOutputFromFile('ScheduleDashboard.html')
            .setTitle('Schedule Efficiency Dashboard')
            .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } else if (e.parameter.page === 'manager-review') {
        return HtmlService.createHtmlOutputFromFile('ManagerReview.html')
            .setTitle('Manager Schedule Review')
            .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } else if (e.parameter.page === 'query_engine') {
        return HtmlService.createHtmlOutputFromFile('QueryBuilderUI.html')
            .setTitle('Dynamic Query Engine')
            .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } else {
      // Otherwise, show the default manager homepage.
      return HtmlService.createTemplateFromFile('manager').evaluate()
        .setTitle('Manager Dashboard')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
  } else {
    // If not a manager, route to the correct page, evaluating it as a template.
    if (e.parameter.page === 'production') {
      return HtmlService.createTemplateFromFile('production').evaluate()
        .setTitle('Production Dashboard')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } else if (e.parameter.page === 'cases') {
      return HtmlService.createTemplateFromFile('cases').evaluate()
        .setTitle('Case Management')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } else if (e.parameter.page === 'agent-schedule') {
        return HtmlService.createHtmlOutputFromFile('AgentSchedule.html')
            .setTitle('Agent Schedule Application')
            .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } else if (e.parameter.page === 'query_engine') {
        return HtmlService.createHtmlOutputFromFile('QueryBuilderUI.html')
            .setTitle('Dynamic Query Engine')
            .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } else {
      // Default to the agent index page.
      return HtmlService.createTemplateFromFile('index').evaluate()
        .setTitle('Agent Status Tracker')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
  }
}

function createSheetWithData(data, headers, fileName) {
  if (!data || !Array.isArray(data) || data.length === 0) {
    throw new Error("No data provided to create the sheet.");
  }
  if (!headers || !Array.isArray(headers) || headers.length === 0) {
    throw new Error("No column headers were specified for the export.");
  }

  try {
    const spreadsheetName = fileName || `Query Result - ${new Date().toLocaleString()}`;
    const newSs = SpreadsheetApp.create(spreadsheetName);
    const sheet = newSs.getSheets()[0];
    sheet.setName("Result Data");

    const rows = data.map(obj => headers.map(header => obj[header]));
    const outputData = [headers, ...rows];

    sheet.getRange(1, 1, outputData.length, headers.length).setValues(outputData);

    headers.forEach((_, i) => {
      sheet.autoResizeColumn(i + 1);
    });

    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");

    return newSs.getUrl();

  } catch (e) {
    Logger.log(`Error in createSheetWithData: ${e.toString()}`);
    throw new Error("Failed to create the spreadsheet. " + e.message);
  }
}

// =================================================================================
// --- HELPER & UTILITY FUNCTIONS ---
// =================================================================================

function isUserManager_(email) {
  if (!email) return false;
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const managerSheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.MANAGERS);
    if (!managerSheet) {
      Logger.log(`Sheet "${CONFIG.ATTENDANCE.SHEETS.MANAGERS}" not found. Using fallback list.`);
      return MANAGER_EMAILS_FALLBACK.includes(email.trim().toLowerCase());
    }
    const managerEmails = managerSheet.getRange("A2:A" + managerSheet.getLastRow()).getValues()
      .flat().map(e => e.toString().trim().toLowerCase()).filter(Boolean);
    return managerEmails.includes(email.trim().toLowerCase());
  } catch (e) {
    Logger.log("Error checking manager status: " + e + ". Falling back to hardcoded list.");
    return MANAGER_EMAILS_FALLBACK.includes(email.trim().toLowerCase());
  }
}

/**
 * Logs a detailed correction request from the agent's attendance log, including the proposed new timestamp.
 */
function logCorrectionRequest(originalLogData, reason, newTimestampStr) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const sheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.REQUESTS);
    if (!sheet) {
      throw new Error(`Sheet '${CONFIG.ATTENDANCE.SHEETS.REQUESTS}' not found.`);
    }

    const userEmail = Session.getActiveUser().getEmail();
    const approvalStatus = "Waiting to be Approved";
    const newTimestamp = new Date(newTimestampStr); // Convert string to Date object for storage

    // Appends a new row in the new, detailed format
    sheet.appendRow([
      userEmail,                // A: Agent Email
      originalLogData.timestamp,// B: Original Timestamp
      originalLogData.action,   // C: Original Action
      originalLogData.sessionId,// D: Original Session ID
      reason,                   // E: Reason for Correction
      approvalStatus,           // F: Status
      "",                       // G: Reviewed By
      newTimestamp              // H: Corrected Timestamp
    ]);

    return "Correction request submitted successfully!";

  } catch (e) {
    console.error("logCorrectionRequest Error: " + e.toString());
    throw new Error("Could not submit request. " + e.message);
  }
}

// =================================================================================
// --- DATA & HELPER FUNCTIONS ---
// =================================================================================

/**
 * Fetches important links for the main agent dashboard.
 * @returns {Array<Object>} An array of link objects.
 */
function getImportantLinks() {
  Logger.log("--- Starting getImportantLinks ---");
  try {
    const spreadsheetId = CONFIG.ATTENDANCE.ID;
    const sheetName = CONFIG.ATTENDANCE.SHEETS.IMPORTANT_LINKS;
    Logger.log(`Attempting to open Spreadsheet ID: ${spreadsheetId}`);

    const ss = SpreadsheetApp.openById(spreadsheetId);
    Logger.log("Spreadsheet opened successfully.");

    Logger.log(`Attempting to get sheet named: "${sheetName}"`);
    const sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      Logger.log(`ERROR: Sheet "${sheetName}" was not found.`);
      return [];
    }
    Logger.log(`Sheet "${sheetName}" found successfully.`);

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      Logger.log("Sheet has no data rows (only header or is empty).");
      return [];
    }

    const dataRange = sheet.getRange(2, 1, lastRow - 1, 4);
    const rawData = dataRange.getValues();
    Logger.log(`Found ${rawData.length} rows of data.`);
    // Logger.log(`Raw data from sheet: ${JSON.stringify(rawData)}`); // Optional: Uncomment to see the actual data

    const links = rawData.map(row => ({
      category: row[0],
      name: row[1],
      url: row[2],
      description: row[3]
    })).filter(link => link.category && link.name && link.url);

    Logger.log(`Processed and filtered ${links.length} valid links.`);
    Logger.log("--- Finished getImportantLinks ---");
    return links;

  } catch (e) {
    Logger.log(`CRITICAL ERROR in getImportantLinks: ${e.toString()}`);
    throw new Error("Could not fetch Important Links. " + e.message);
  }
}


/**
 * Gets important links specifically for managers.
 */
function getManagerImportantLinks() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const sheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.IMPORTANT_LINKS_MANAGER);
    if (!sheet) {
      console.warn(`Sheet '${CONFIG.ATTENDANCE.SHEETS.IMPORTANT_LINKS_MANAGER}' not found, returning empty array.`);
      return [];
    }
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
    return data.map(row => ({
      category: row[0],
      name: row[1],
      url: row[2],
      description: row[3]
    })).filter(link => link.category && link.name && link.url);
  } catch (e) {
    console.error("getManagerImportantLinks Error: " + e.toString());
    throw new Error("Could not fetch Manager Important Links. " + e.message);
  }
}


function getVersionDetails() {
  Logger.log("--- Starting getVersionDetails ---");
  try {
    const spreadsheetId = CONFIG.ATTENDANCE.ID;
    const sheetName = CONFIG.ATTENDANCE.SHEETS.VERSION_CONFIG;
    Logger.log(`Attempting to open Spreadsheet ID: ${spreadsheetId}`);

    const ss = SpreadsheetApp.openById(spreadsheetId);
    Logger.log("Spreadsheet opened successfully.");

    Logger.log(`Attempting to get sheet named: "${sheetName}"`);
    const versionSheet = ss.getSheetByName(sheetName);

    if (!versionSheet) {
      Logger.log(`ERROR: Config sheet "${sheetName}" not found.`);
      return { runningVersion: SCRIPT_APP_VERSION, error: `Config sheet "${sheetName}" not found.` };
    }
    Logger.log(`Sheet "${sheetName}" found successfully.`);

    const data = versionSheet.getRange("A2:B" + Math.max(2, versionSheet.getLastRow())).getValues();
    Logger.log(`Found ${data.length} rows of config data.`);
    // Logger.log(`Raw config data: ${JSON.stringify(data)}`); // Optional: Uncomment to see the data

    const config = Object.fromEntries(data.filter(row => row[0]).map(row => [row[0].toString().trim(), row[1] ? row[1].toString().trim() : ""]));
    Logger.log(`Processed config object: ${JSON.stringify(config)}`);

    Logger.log("--- Finished getVersionDetails ---");
    return {
      runningVersion: SCRIPT_APP_VERSION,
      latestAdvertisedVersion: config['LatestVersion'] || SCRIPT_APP_VERSION,
      updateURL: config['LatestVersionURL'] || "",
      updateFeatures: config['LatestFeatures'] || "N/A",
      error: null
    };
  } catch (e) {
    Logger.log(`CRITICAL ERROR in getVersionDetails: ${e.message}`);
    return { runningVersion: SCRIPT_APP_VERSION, error: `Error fetching version details: ${e.message}` };
  }
}


// --- VERSION INFO FUNCTIONS ---
function fetchVersionInformation() {
    google.script.run
        .withSuccessHandler(handleVersionDetailsResponse)
        .withFailureHandler(handleVersionDetailsError)
        .getVersionDetails();
}

function handleVersionDetailsResponse(versionInfo) {
    const versionDisplayEl = document.getElementById('scriptVersionDisplay');
    const statusMsgEl = document.getElementById('versionStatusMessage');
    const updateNotificationEl = document.getElementById('updateNotificationArea');
    const updateButtonEl = document.getElementById('updateButton');
    const featuresDisplayEl = document.getElementById('updateFeaturesDisplay');
    const versionErrorEl = document.getElementById('versionError');
    if (!versionDisplayEl || !statusMsgEl || !updateNotificationEl) return;

    versionErrorEl.style.display = 'none';
    if (versionInfo && versionInfo.error) {
        versionDisplayEl.textContent = "Error";
        updateNotificationEl.style.display = 'none';
        versionErrorEl.textContent = versionInfo.error;
        versionErrorEl.style.display = 'block';
        return;
    }
    if (versionInfo && versionInfo.runningVersion) {
        versionDisplayEl.textContent = versionInfo.runningVersion;
        const running = parseFloat(versionInfo.runningVersion);
        const latest = parseFloat(versionInfo.latestAdvertisedVersion);
        if (!isNaN(running) && !isNaN(latest) && versionInfo.latestAdvertisedVersion && versionInfo.updateURL && running < latest) {
            updateNotificationEl.style.display = 'block';
            featuresDisplayEl.textContent = versionInfo.updateFeatures || "No features listed.";
            updateButtonEl.onclick = () => promptForUpdate(versionInfo.updateURL, versionInfo.updateFeatures);
        } else {
            statusMsgEl.textContent = "Up to date.";
            updateNotificationEl.style.display = 'none';
        }
    } else {
        versionDisplayEl.textContent = "N/A";
        versionErrorEl.textContent = "Could not retrieve version info.";
        versionErrorEl.style.display = 'block';
    }
}

function handleVersionDetailsError(error) {
    console.error("Error fetching version details:", error);
    document.getElementById('scriptVersionDisplay').textContent = "Error";
    document.getElementById('versionError').textContent = "Failed to check for updates.";
    document.getElementById('versionError').style.display = 'block';
}

function promptForUpdate(newUrl, features) {
    if (!newUrl) { alert("Update URL is not configured."); return; }
    window.open(newUrl, '_blank');
    const bookmarkShortcut = navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Cmd+D' : 'Ctrl+D';
    let alertMessage = "A new version has opened in a new tab.\n\n";
    if (features) { alertMessage += "New features:\n- " + features.replace(/,\s*/g, "\n- ") + "\n\n"; }
    alertMessage += "Please bookmark the new page (try " + bookmarkShortcut + ") and remove your old bookmark.";
    alert(alertMessage);
}
/**
 * Fetches a list of all agents (email and name) to populate dropdowns.
 */
function getAllAgents() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const sheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.AGENTS);
    if (!sheet || sheet.getLastRow() < 2) {
      return []; // Return empty if no sheet or no agents
    }
    // Reads Column A (Email) and Column B (Name)
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();

    return data
      .map(row => ({ email: row[0], name: row[1] }))
      .filter(agent => agent.email); // Filter out any empty rows
  } catch (e) {
    Logger.log("Error in getAllAgents: " + e.toString());
    return []; // Return empty on error
  }
}

/**
 * Fetches the attendance log for a specific agent selected by the manager.
 */
function getLogForSelectedAgent(agentEmail, dateRange) {
  try {
    if (!agentEmail) {
      throw new Error("No agent email provided.");
    }
    const startDate = new Date(dateRange.startDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(dateRange.endDate);
    endDate.setHours(23, 59, 59, 999);

    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const sheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.AGENT_LOG);
    if (!sheet) {
      throw new Error("AgentLog sheet not found.");
    }

    const allData = sheet.getDataRange().getValues();
    allData.shift(); // Remove headers

    const agentLogs = allData.filter(row => {
      const rowEmail = (row[1] || "").toString().trim().toLowerCase();
      if (rowEmail !== agentEmail.toLowerCase()) {
        return false;
      }
      const timestamp = row[0] instanceof Date ? row[0] : new Date(row[0]);
      return timestamp >= startDate && timestamp <= endDate;
    });

    return agentLogs.map(row => {
      const timestamp = row[0] instanceof Date ? row[0] : new Date(row[0]);
      return {
        timestamp: timestamp.toISOString(),
        action: row[3],
        sessionId: row[4]
      };
    }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  } catch (e) {
    Logger.log("Error in getLogForSelectedAgent: " + e.toString());
    throw new Error("Failed to retrieve attendance log. " + e.message);
  }
}




/**
 * Fetches the current agent's pending correction requests for their UI.
 */
function getPendingRequests() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const sheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.REQUESTS);
    if (!sheet) return [];

    const userEmail = Session.getActiveUser().getEmail();
    const allData = sheet.getDataRange().getValues();
    allData.shift(); // Remove header row

    const userRequests = allData.filter(row => {
      const requestAgentEmail = row[0]; // Agent Email in Column A
      const status = row[5]; // Status in Column F
      return requestAgentEmail === userEmail && status === "Waiting to be Approved";
    });

    return userRequests.map(row => {
      const correctedTimestamp = row[7] instanceof Date ? Utilities.formatDate(row[7], Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss") : "N/A";
      const originalTimestamp = row[1] instanceof Date ? Utilities.formatDate(row[1], Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss") : row[1];

      return {
        sessionId: row[3],          // Original Session ID from Column D
        originalAction: row[2],     // Original Action from Column C
        originalTimestamp: originalTimestamp, // Original Timestamp from Column B
        correctedTimestamp: correctedTimestamp // Corrected Timestamp from Column H
      };
    });

  } catch (e) {
    console.error("getPendingRequests Error: " + e.toString());
    throw new Error("Could not fetch pending requests. " + e.message);
  }
}

// =================================================================================
// --- AGENT-FACING FUNCTIONS ---
// =================================================================================

function getInitialAgentState() {
  Logger.log("--- Starting getInitialAgentState ---");
  let agentEmail = "Unknown";
  try {
    const activeUser = Session.getActiveUser();
    agentEmail = activeUser ? activeUser.getEmail() : "Unknown";
    Logger.log(`Step 1: User identified as ${agentEmail}`);

    if (!agentEmail || agentEmail === "Unknown") {
      Logger.log("ERROR: No active user or email found.");
      return { ..._getFallbackStateForAgent(agentEmail, ""), error: "Could not retrieve agent email." };
    }

    const agentName = getAgentName_(agentEmail);
    Logger.log(`Step 2: Agent name found: ${agentName}`);

    const state = _determineCurrentAgentState(agentEmail, agentName);
    Logger.log(`Step 3: Final state determined: ${JSON.stringify(state)}`);
    Logger.log("--- Finished getInitialAgentState successfully ---");
    return state;

  } catch (e) {
    Logger.log(`CRITICAL ERROR in getInitialAgentState for ${agentEmail}: ${e.toString()} at stack: ${e.stack}`);
    return { ..._getFallbackStateForAgent(agentEmail, getAgentName_(agentEmail)), error: `ERROR: Could not fetch initial state: ${e.message}` };
  }
}

function logAgentAction(actionType) {
  let agentEmail = ""; let agentName = "";
  try {
    agentEmail = Session.getActiveUser().getEmail();
    agentName = getAgentName_(agentEmail);
    Logger.log(`logAgentAction called by ${agentEmail} for action: ${actionType}`);

    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const agentLogSheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.AGENT_LOG);
    if (!agentLogSheet) return { ..._getFallbackStateForAgent(agentEmail, agentName), error: `Sheet "${CONFIG.ATTENDANCE.SHEETS.AGENT_LOG}" not found.`, messageType: "error" };

    const timestamp = new Date();
    let sessionIdToLog = null;
    let currentStateBeforeAction = _determineCurrentAgentState(agentEmail, agentName);
    Logger.log(`State before action ${actionType} for ${agentEmail}: ${JSON.stringify(currentStateBeforeAction)}`);

    if (actionType === "Start Work") {
      if (currentStateBeforeAction.isWorking) return { ...currentStateBeforeAction, error: "Already in an active work session. 'End Work' first.", messageType: "error" };
      sessionIdToLog = agentEmail + "_" + timestamp.getTime();
    } else {
      if (!currentStateBeforeAction.isWorking) return { ...currentStateBeforeAction, error: "Must 'Start Work' first.", messageType: "error" };
      sessionIdToLog = currentStateBeforeAction.currentSessionId;
      if (!sessionIdToLog) {
        Logger.log(`CRITICAL: isWorking true but no currentSessionId for ${agentEmail} before ${actionType}`);
        return { ...currentStateBeforeAction, error: "State inconsistency - no active session ID. 'End Work' & 'Start Work' again.", messageType: "error" };
      }
      if (actionType === "Start Break") {
        if (currentStateBeforeAction.isOnBreak) return { ...currentStateBeforeAction, error: "Already on a break.", messageType: "error" };
        if (currentStateBeforeAction.isInMeeting) return { ...currentStateBeforeAction, error: "Cannot start break while in a meeting.", messageType: "error" };
      } else if (actionType === "End Break") {
        if (!currentStateBeforeAction.isOnBreak) return { ...currentStateBeforeAction, error: "Not currently on a break.", messageType: "error" };
      } else if (actionType === "Start Meeting") {
        if (currentStateBeforeAction.isInMeeting) return { ...currentStateBeforeAction, error: "Already in a meeting.", messageType: "error" };
        if (currentStateBeforeAction.isOnBreak) return { ...currentStateBeforeAction, error: "Cannot start meeting while on break.", messageType: "error" };
      } else if (actionType === "End Meeting") {
        if (!currentStateBeforeAction.isInMeeting) return { ...currentStateBeforeAction, error: "Not currently in a meeting.", messageType: "error" };
      }
    }

    agentLogSheet.appendRow([timestamp, agentEmail, agentName, actionType, sessionIdToLog]);
    Logger.log(`Logged Agent Action to Sheet: ${agentEmail}, ${actionType}, Session: ${sessionIdToLog}`);

    const newState = _determineCurrentAgentState(agentEmail, agentName);
    Logger.log(`New state after action ${actionType} for ${agentEmail}: ${JSON.stringify(newState)}`);
    return { ...newState, message: `Action "${actionType}" logged.`, messageType: "success" };
  } catch (e) {
    Logger.log(`Error in logAgentAction for ${agentEmail}, action ${actionType}: ${e.toString()} Stack: ${e.stack}`);
    return { ..._getFallbackStateForAgent(agentEmail, agentName), error: `Could not log agent action: ${e.message}`, messageType: "error" };
  }
}

function logCaseAction(actionType, caseId, caseDetails) {
  let agentEmail = ""; let agentName = "";
  try {
    agentEmail = Session.getActiveUser().getEmail();
    agentName = getAgentName_(agentEmail);
    Logger.log(`logCaseAction called by ${agentEmail} for action: ${actionType}, Case ID: ${caseId}`);
    let currentState = _determineCurrentAgentState(agentEmail, agentName);

    if (!currentState.isWorking || currentState.isOnBreak || currentState.isInMeeting) {
      return { ...currentState, error: "Must be working (not on break/meeting) to manage cases.", messageType: "error" };
    }
    if (!currentState.currentSessionId) return { ...currentState, error: "No active work session for case logging.", messageType: "error" };

    const ssAttendance = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const caseLogSheet = ssAttendance.getSheetByName(CONFIG.ATTENDANCE.SHEETS.CASE_LOG);
    if (!caseLogSheet) return { ...currentState, error: `Sheet "${CONFIG.ATTENDANCE.SHEETS.CASE_LOG}" not found.`, messageType: "error" };

    const timestamp = new Date();
    const trimmedCaseId = caseId ? caseId.toString().trim() : "";

    if (!trimmedCaseId && (actionType === "Start Case" || actionType === "Start Returned Case" || actionType === "Finish Case" || actionType === "Escalate Case")) {
      return { ...currentState, error: "Case ID cannot be empty for this action.", messageType: "error" };
    }

    const existingOpenCase = currentState.agentOpenCases.find(c => c.caseId === trimmedCaseId);

    if (actionType === "Start Case") {
      // Allow starting a new case even if others are open by this agent.
    } else if (actionType === "Start Returned Case") {
      if (!existingOpenCase) return { ...currentState, error: `Case ${trimmedCaseId} not found in your handling list to resume.`, messageType: "error" };
      if (!existingOpenCase.isEscalated) return { ...currentState, error: `Case ${trimmedCaseId} is not marked as escalated.`, messageType: "error" };
    } else if (actionType === "Finish Case" || actionType === "Escalate Case") {
      if (!existingOpenCase) return { ...currentState, error: `Case ${trimmedCaseId} not found in your handling list.`, messageType: "error" };
      if (actionType === "Escalate Case" && existingOpenCase.isEscalated) {
        return { ...currentState, error: `Case ${trimmedCaseId} is already escalated.`, messageType: "error" };
      }
    } else {
      return { ...currentState, error: `Unknown case action: ${actionType}`, messageType: "error" };
    }

    caseLogSheet.appendRow([timestamp, agentEmail, agentName, trimmedCaseId, actionType, caseDetails || "", currentState.currentSessionId]);
    Logger.log(`Logged Case Action to Sheet: ${agentEmail}, ${actionType}, Case: ${trimmedCaseId}, Session: ${currentState.currentSessionId}`);

    if (actionType === "Finish Case" || actionType === "Escalate Case" || actionType === "Start Returned Case") {
      const ssProduction = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
      const availableCasesSheet = ssProduction.getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
      if (availableCasesSheet) {
        const data = availableCasesSheet.getDataRange().getValues();
        const header = data.length > 0 ? data[0].map(h => h.toString().trim().toLowerCase()) : [];
        const caseIdColIndex = header.indexOf("main task id");
        const statusColIndex = header.indexOf("status");
        if (caseIdColIndex !== -1 && statusColIndex !== -1) {
          for (let i = 1; i < data.length; i++) {
            if (data[i][caseIdColIndex] && data[i][caseIdColIndex].toString().trim() === trimmedCaseId) {
              let newStatus = "";
              if (actionType === "Finish Case") newStatus = "Finished";
              else if (actionType === "Escalate Case") newStatus = "Escalated";
              else if (actionType === "Start Returned Case") newStatus = "In Progress";
              if (newStatus) {
                availableCasesSheet.getRange(i + 1, statusColIndex + 1).setValue(newStatus);
                Logger.log(`Updated status of Case ID ${trimmedCaseId} to "${newStatus}" in ${CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES}.`);
              }
              break;
            }
          }
        } else { Logger.log(`Could not find 'Main Task ID' or 'Status' column in ${CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES}.`); }
      }
    }

    const newState = _determineCurrentAgentState(agentEmail, agentName);
    return { ...newState, message: `Case action "${actionType}" for [${trimmedCaseId}] logged.`, messageType: "success" };
  } catch (e) {
    Logger.log(`Error in logCaseAction for ${agentEmail}, action ${actionType}, case ${caseId}: ${e.toString()} Stack: ${e.stack}`);
    return { ..._getFallbackStateForAgent(agentEmail, agentName), error: `Could not log case action: ${e.message}`, messageType: "error" };
  }
}

function _getFallbackStateForAgent(agentEmail, agentName) {
  return {
    agentEmail: agentEmail || "Unknown", agentName: agentName || (agentEmail ? agentEmail.split('@')[0] : ""),
    isWorking: false, isOnBreak: false, isInMeeting: false,
    currentSessionId: null,
    workSessionActualStartTimeISO: null,
    totalCompletedBreakDurationInSessionSeconds: 0,
    totalCompletedMeetingDurationInSessionSeconds: 0,
    currentBreakStartTimeISO: null,
    currentMeetingStartTimeISO: null,
    agentOpenCases: [],
  };
}

function _determineCurrentAgentState(agentEmail, agentName) {
  Logger.log("--- Starting _determineCurrentAgentState ---");
  const state = _getFallbackStateForAgent(agentEmail, agentName);

  try {
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const agentLogSheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.AGENT_LOG);
    if (!agentLogSheet) {
      Logger.log(`ERROR: Sheet "${CONFIG.ATTENDANCE.SHEETS.AGENT_LOG}" not found. Returning fallback state.`);
      return state;
    }
    Logger.log("AgentLog sheet found successfully.");

    // --- Part 1: Determine current work/break/meeting status ---
    const agentLogAllData = agentLogSheet.getDataRange().getValues();
    Logger.log(`Read ${agentLogAllData.length} total rows from AgentLog.`);

    const agentEntries = agentLogAllData
      .filter(row => row[1] && String(row[1]).trim().toLowerCase() === agentEmail.toLowerCase())
      .map(row => ({
        timestamp: new Date(row[0]),
        action: row[3] ? String(row[3]).trim() : "",
        sessionId: row[4] ? String(row[4]).trim() : ""
      }))
      .sort((a, b) => a.timestamp - b.timestamp);

    Logger.log(`Found ${agentEntries.length} log entries for this agent.`);

    if (agentEntries.length > 0) {
      let lastStartWork = null;
      for (let i = agentEntries.length - 1; i >= 0; i--) {
        if (agentEntries[i].action === "Start Work") {
          lastStartWork = agentEntries[i];
          break;
        }
        if (agentEntries[i].action === "End Work") {
          Logger.log("Found a recent 'End Work' record. Agent is not working.");
          return state; // Agent is not working
        }
      }

      if (lastStartWork) {
        Logger.log(`Active session found: ${lastStartWork.sessionId}`);
        state.isWorking = true;
        state.currentSessionId = lastStartWork.sessionId;

        let totalBreakMs = 0;
        let totalMeetingMs = 0;
        let lastBreakStart = null;
        let lastMeetingStart = null;
        let lastAction = "";

        const sessionEntries = agentEntries.filter(e => e.sessionId === state.currentSessionId);
        state.workSessionActualStartTimeISO = sessionEntries[0].timestamp.toISOString();

        sessionEntries.forEach(entry => {
          if (entry.action === "Start Break") lastBreakStart = entry.timestamp;
          if (entry.action === "End Break" && lastBreakStart) {
            totalBreakMs += (entry.timestamp.getTime() - lastBreakStart.getTime());
            lastBreakStart = null;
          }
          if (entry.action === "Start Meeting") lastMeetingStart = entry.timestamp;
          if (entry.action === "End Meeting" && lastMeetingStart) {
            totalMeetingMs += (entry.timestamp.getTime() - lastMeetingStart.getTime());
            lastMeetingStart = null;
          }
          lastAction = entry.action;
        });

        state.totalCompletedBreakDurationInSessionSeconds = Math.round(totalBreakMs / 1000);
        state.totalCompletedMeetingDurationInSessionSeconds = Math.round(totalMeetingMs / 1000);

        if (lastAction === "Start Break") {
          state.isOnBreak = true;
          state.currentBreakStartTimeISO = lastBreakStart.toISOString();
        }
        if (lastAction === "Start Meeting") {
          state.isInMeeting = true;
          state.currentMeetingStartTimeISO = lastMeetingStart.toISOString();
        }
      }
    }

    // --- Part 2: Determine currently open cases ---
    const caseLogSheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.CASE_LOG);
    if (caseLogSheet) {
      Logger.log("CaseLog sheet found. Processing open cases.");
      const caseLogAllData = caseLogSheet.getDataRange().getValues();
      const agentAllCaseEvents = caseLogAllData
        .filter(row => row[1] && String(row[1]).trim().toLowerCase() === agentEmail.toLowerCase() && row[3])
        .map(row => ({
          caseId: String(row[3]).trim(),
          action: row[4] ? String(row[4]).trim() : ""
        }));

      const casesStatusMap = new Map();
      agentAllCaseEvents.forEach(event => {
        let status = casesStatusMap.get(event.caseId) || {};
        if (event.action === "Start Case" || event.action === "Start Returned Case") {
          status = { isFinished: false, isEscalated: false };
        }
        if (event.action === "Escalate Case") status.isEscalated = true;
        if (event.action === "Finish Case") status.isFinished = true;
        casesStatusMap.set(event.caseId, status);
      });

      casesStatusMap.forEach((status, caseId) => {
        if (!status.isFinished) {
          state.agentOpenCases.push({ caseId: caseId, isEscalated: status.isEscalated });
        }
      });
      Logger.log(`Found ${state.agentOpenCases.length} open cases for this agent.`);
    } else {
      Logger.log(`Warning: Sheet "${CONFIG.ATTENDANCE.SHEETS.CASE_LOG}" not found. Cannot determine open cases.`);
    }

  } catch (e) {
    Logger.log(`CRITICAL ERROR in _determineCurrentAgentState for ${agentEmail}: ${e.toString()} at stack: ${e.stack}`);
  }

  Logger.log("--- Finished _determineCurrentAgentState ---");
  return state;
}

function getAgentName_(email) {
  if (!email) return "";
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const agentsSheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.AGENTS);
    if (!agentsSheet) { return email.split('@')[0]; }
    const data = agentsSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString().trim().toLowerCase() === email.trim().toLowerCase()) {
        return data[i][1] || email.split('@')[0];
      }
    }
  } catch (e) { Logger.log(`Error in getAgentName_ for ${email}: ${e.toString()}`); }
  return email.split('@')[0];
}

function getActiveUserEmailForDisplay() {
  try { return Session.getActiveUser().getEmail(); }
  catch (e) { return null; }
}

// =================================================================================
// --- MANAGER-FACING FUNCTIONS ---
// =================================================================================

/**
 * Fetches all correction requests that are 'Waiting to be Approved' for the manager view.
 */
function getPendingApprovalRequests() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const sheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.REQUESTS);
    if (!sheet) return [];

    const allData = sheet.getDataRange().getValues();
    allData.shift();
    const pendingRequests = [];

    allData.forEach((row, index) => {
      const status = row[5];
      if (String(status).trim().toLowerCase() === 'waiting to be approved') {
        const rowNumber = index + 2;

        const formatDate = (dateValue) => {
            // --- CHANGE IS HERE ---
            // Send the full ISO string to preserve milliseconds
            return dateValue instanceof Date ? dateValue.toISOString() : dateValue;
        };

        pendingRequests.push({
          rowNumber: rowNumber,
          agent: row[0],
          originalTimestamp: formatDate(row[1]),
          originalAction: row[2],
          sessionId: row[3],
          requestedTimestamp: formatDate(row[7]),
          reason: row[4]
        });
      }
    });
    return pendingRequests;
  } catch (e) {
    console.error("getPendingApprovalRequests Error: " + e.toString());
    throw new Error("Could not fetch approval requests. " + e.message);
  }
}


/**
 * Applies a manager-approved correction to the AgentLog and updates the request status.
 * @param {number} requestRowNumber The row number of the request in the 'Requests' sheet.
 * @returns {string} A success message.
 */
function applyCorrection(requestRowNumber) {
  try {
    const managerEmail = Session.getActiveUser().getEmail();

    // --- Step 1: Get the request details from the Requests sheet ---
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const requestsSheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.REQUESTS);
    if (!requestsSheet) throw new Error("Requests sheet not found.");

    const requestData = requestsSheet.getRange(requestRowNumber, 1, 1, 8).getValues()[0];
    const agentEmail = requestData[0];
    const originalTimestamp = new Date(requestData[1]);
    const originalAction = requestData[2];
    const correctedTimestamp = new Date(requestData[7]); // The new timestamp is in column H

    if (isNaN(correctedTimestamp.getTime())) {
      throw new Error("Invalid corrected date format in the request.");
    }

    // --- Step 2: Find and update the original entry in the AgentLog ---
    const agentLogSheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.AGENT_LOG);
    if (!agentLogSheet) throw new Error("AgentLog sheet not found.");

    const logData = agentLogSheet.getDataRange().getValues();
    let rowUpdated = false;
    for (let i = 1; i < logData.length; i++) {
      const row = logData[i];
      const rowTimestamp = new Date(row[0]);
      const rowEmail = row[1];
      const rowAction = row[3];

      // Find the specific row by matching email, action, and the exact original timestamp
      if (rowEmail === agentEmail && rowAction === originalAction && rowTimestamp.getTime() === originalTimestamp.getTime()) {
        agentLogSheet.getRange(i + 1, 1).setValue(correctedTimestamp); // Update Timestamp in Column A
        rowUpdated = true;
        break;
      }
    }

    if (!rowUpdated) {
      throw new Error("Could not find the original log entry to update. It may have been modified already.");
    }

    // --- Step 3: Update the request status to show it's completed ---
    requestsSheet.getRange(requestRowNumber, 6).setValue("Approved"); // Status in Column F (CORRECTED from "Applied")
    requestsSheet.getRange(requestRowNumber, 7).setValue(managerEmail); // Reviewed By in Column G

    return `Correction for ${agentEmail} has been successfully applied.`;

  } catch (e) {
    Logger.log("Error in applyCorrection: " + e.toString());
    throw new Error("Failed to apply correction. " + e.message);
  }
}



/**
 * Updates the status of a specific request in the sheet.
 * @param {number} rowNumber The actual row number in the sheet to update.
 * @param {string} newStatus The new status, e.g., "Approved" or "Denied".
 * @returns {string} A success message.
 */
function updateRequestStatus(rowNumber, newStatus) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const sheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.REQUESTS);
    if (!sheet) {
      throw new Error("Sheet 'Requests' not found.");
    }

    const managerEmail = Session.getActiveUser().getEmail();

    // Update the 'Approval Type' column (E) and 'By who' column (F)
    sheet.getRange(rowNumber, 5).setValue(newStatus);
    sheet.getRange(rowNumber, 6).setValue(managerEmail);

    return `Request #${rowNumber} has been successfully updated to '${newStatus}'.`;

  } catch (e) {
    console.error("updateRequestStatus Error: " + e.toString());
    throw new Error("Failed to update the request status. " + e.message);
  }
}


// =================================================================================
// --- REPORTING FUNCTIONS ---
// =================================================================================

/**
 * Gets a specific agent's completed cases for the day from the Production sheet.
 */
function getAgentSummaryFromAvailableCases(agentEmail, dateStr) {
  if (!agentEmail || !dateStr) return [];

  try {
    const targetDate = new Date(dateStr);
    const dayStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const dayEnd = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59, 999);

    const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
    const casesSheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
    if (!casesSheet) throw new Error(`Sheet "${CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES}" not found.`);

    const data = casesSheet.getDataRange().getValues();
    const headers = data.shift().map(h => h.toString().trim().toLowerCase());

    const emailCol = headers.indexOf("useremail");
    const caseIdCol = headers.indexOf("main task id");
    const accountNameCol = headers.indexOf("account name");
    const statusCol = headers.indexOf("status");
    const startTimeCol = headers.indexOf("main task start date/time");
    const endTimeCol = headers.indexOf("main task end date/time");
    const escalationCol = headers.indexOf("stored escalation duration");

    if ([emailCol, caseIdCol, endTimeCol].includes(-1)) {
      throw new Error("Required columns (useremail, main task id, main task end date/time) not found in " + CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES + " sheet.");
    }

    const agentCases = data.filter(row => {
      const rowAgentEmail = (row[emailCol] || "").toString().trim().toLowerCase();
      if (rowAgentEmail !== agentEmail.toLowerCase()) return false;

      const endTime = row[endTimeCol] ? new Date(row[endTimeCol]) : null;
      return endTime && !isNaN(endTime.getTime()) && endTime >= dayStart && endTime <= dayEnd;
    }).map(row => {
      const startTime = startTimeCol !== -1 && row[startTimeCol] ? new Date(row[startTimeCol]) : null;
      const endTime = new Date(row[endTimeCol]);
      let durationSeconds = null;
      if (startTime && !isNaN(startTime.getTime())) {
        const grossDurationSeconds = Math.round((endTime.getTime() - startTime.getTime()) / 1000);

        const escalationDurationValue = escalationCol !== -1 ? row[escalationCol] : 0;
        let escalationSeconds = 0;
        if (escalationDurationValue) {
            if (escalationDurationValue instanceof Date) {
                escalationSeconds = (escalationDurationValue.getTime() - SPREADSHEET_EPOCH_OFFSET_MS) / 1000;
            } else if (!isNaN(parseFloat(escalationDurationValue))) {
                escalationSeconds = parseFloat(escalationDurationValue) * 86400;
            }
        }
        durationSeconds = grossDurationSeconds - escalationSeconds;
      }
      return {
        caseId: row[caseIdCol],
        accountName: accountNameCol > -1 ? row[accountNameCol] : 'N/A',
        startTimeISO: startTime ? startTime.toISOString() : null,
        finishTimeISO: endTime.toISOString(),
        durationSeconds: durationSeconds,
        status: statusCol > -1 ? row[statusCol] : 'N/A'
      };
    });

    return agentCases;
  } catch (e) {
    Logger.log(`Error in getAgentSummaryFromAvailableCases: ${e.message}`);
    throw e;
  }
}

/**
 * A fast function that gets the real-time status of agents for the "Active Agents" box.
 */
function getActiveAgentStatuses() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const agentsSheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.AGENTS);
    if (!agentsSheet) throw new Error(`Sheet "${CONFIG.ATTENDANCE.SHEETS.AGENTS}" not found.`);
    const agentList = agentsSheet.getRange("A2:B" + agentsSheet.getLastRow()).getValues();

    const agentLogSheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.AGENT_LOG);
    if (!agentLogSheet) return [];

    const agentLogData = agentLogSheet.getDataRange().getValues();

    const lastActions = new Map();
    // Iterate backwards for efficiency
    for (let i = agentLogData.length - 1; i >= 1; i--) {
      const row = agentLogData[i];
      const email = (row[1] || "").toString().trim().toLowerCase();
      // Once we find the latest action for an agent, we don't need to look for them again
      if (email && !lastActions.has(email)) {
        lastActions.set(email, {
          action: row[3],
          timestamp: new Date(row[0]).toISOString()
        });
      }
    }

    return agentList.map(row => {
      const email = row[0];
      const name = row[1] || (email ? email.split('@')[0] : '');
      if (!email) return null;

      const lastState = lastActions.get(email.toLowerCase());
      if (lastState && lastState.action !== 'End Work') {
        let statusDetail = "Working";
        if (lastState.action === "Start Break") statusDetail = "On Break";
        else if (lastState.action === "Start Meeting") statusDetail = "In Meeting";

        // Find the start time of the current session
        let sessionStartTime = null;
        if (lastState.action === 'Start Work') {
          sessionStartTime = lastState.timestamp;
        } else {
          // If the last action isn't 'Start Work', we need to find the preceding 'Start Work'
          for (let i = agentLogData.length - 1; i >= 1; i--) {
            const row = agentLogData[i];
            const rowEmail = (row[1] || "").toString().trim().toLowerCase();
            const action = row[3];
            if (rowEmail === email.toLowerCase() && action === 'Start Work') {
              sessionStartTime = new Date(row[0]).toISOString();
              // We need to ensure this isn't an old session
              let sessionEnded = false;
              for (let j = i + 1; j < agentLogData.length; j++) {
                const subsequentRow = agentLogData[j];
                const subsequentEmail = (subsequentRow[1] || "").toString().trim().toLowerCase();
                if (subsequentEmail === email.toLowerCase() && subsequentRow[3] === 'End Work') {
                  sessionEnded = true;
                  break;
                }
              }
              if (!sessionEnded) {
                break; // Found the start of the current, active session
              }
            }
          }
        }

        return {
          agentName: name,
          statusDetail: statusDetail,
          sessionStartTime: sessionStartTime
        };
      }
      return null;
    }).filter(Boolean); // Remove null entries
  } catch (e) {
    Logger.log(`Error in getActiveAgentStatuses: ${e.message}`);
    return [{ agentName: "Error", statusDetail: e.message }];
  }
}

/**
 * A fast function that gets the real-time status of inactive agents.
 */
function getInactiveAgentStatuses() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const agentsSheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.AGENTS);
    if (!agentsSheet) throw new Error(`Sheet "${CONFIG.ATTENDANCE.SHEETS.AGENTS}" not found.`);
    const agentList = agentsSheet.getRange("A2:B" + agentsSheet.getLastRow()).getValues();

    const agentLogSheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.AGENT_LOG);
    if (!agentLogSheet) return [];

    const agentLogData = agentLogSheet.getDataRange().getValues();
    const lastActions = new Map();

    for (let i = agentLogData.length - 1; i >= 1; i--) {
      const row = agentLogData[i];
      const email = (row[1] || "").toString().trim().toLowerCase();
      if (email && !lastActions.has(email)) {
        lastActions.set(email, { action: row[3], timestamp: new Date(row[0]) });
      }
    }

    return agentList.map(row => {
      const email = row[0];
      const name = row[1] || (email ? email.split('@')[0] : '');
      if (!email) return null;

      const lastState = lastActions.get(email.toLowerCase());
      if (!lastState || lastState.action === 'End Work') {
        const statusDetail = lastState ? `Ended Work at ${lastState.timestamp.toLocaleString()}` : 'No recent activity';
        return { agentName: name, statusDetail: statusDetail };
      }
      return null;
    }).filter(Boolean);

  } catch (e) {
    Logger.log(`Error in getInactiveAgentStatuses: ${e.message}`);
    return [{ agentName: "Error", statusDetail: e.message }];
  }
}

/**
 * Gets attendance data for the initial manager dashboard load.
 */
function getManagerAttendanceSummary(startDateStr, endDateStr) {
  if (!endDateStr) endDateStr = startDateStr;
  const rangeStart = new Date(startDateStr);
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(endDateStr);
  rangeEnd.setHours(23, 59, 59, 999);
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const agentsSheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.AGENTS);
    if (!agentsSheet) throw new Error(`Sheet "${CONFIG.ATTENDANCE.SHEETS.AGENTS}" not found.`);
    const agentList = agentsSheet.getRange("A2:A" + agentsSheet.getLastRow()).getValues().flat().filter(Boolean);

    const agentLogSheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.AGENT_LOG);
    const logData = agentLogSheet ? agentLogSheet.getDataRange().getValues() : [];

    const logsByAgent = {};
    logData.slice(1).forEach(row => {
      const email = (row[1] || "").toString().trim().toLowerCase();
      const entryDate = new Date(row[0]);
      if (email && entryDate >= rangeStart && entryDate <= rangeEnd) {
        if (!logsByAgent[email]) logsByAgent[email] = [];
        logsByAgent[email].push({ timestamp: entryDate, action: String(row[3]).trim() });
      }
    });

    return agentList.map(agentEmail => {
      const email = agentEmail.toLowerCase();
      const summary = {
        agentEmail: agentEmail,
        agentName: getAgentName_(agentEmail), // Uses helper function
        totalWorkDurationSeconds: 0,
        totalBreakDurationSeconds: 0,
        totalMeetingDurationSeconds: 0,
      };

      const agentEntries = logsByAgent[email] || [];
      if (agentEntries.length === 0) return summary;
      agentEntries.sort((a, b) => a.timestamp - b.timestamp);

      let sessionWorkMs = 0, sessionBreakMs = 0, sessionMeetingMs = 0;
      let activityStartTime = null, currentActivityType = null;

      for (const entry of agentEntries) {
        if (activityStartTime) {
          const duration = entry.timestamp.getTime() - activityStartTime.getTime();
          if (currentActivityType === "WORK") sessionWorkMs += duration;
          else if (currentActivityType === "BREAK") sessionBreakMs += duration;
          else if (currentActivityType === "MEETING") sessionMeetingMs += duration;
        }
        if (entry.action.includes("Start")) {
          activityStartTime = entry.timestamp;
          if (entry.action === "Start Work") currentActivityType = "WORK";
          else if (entry.action === "Start Break") currentActivityType = "BREAK";
          else if (entry.action === "Start Meeting") currentActivityType = "MEETING";
        } else if (entry.action.includes("End")) {
          if (entry.action === "End Break" || entry.action === "End Meeting") {
            activityStartTime = entry.timestamp;
            currentActivityType = "WORK";
          } else if (entry.action === "End Work") {
            activityStartTime = null;
            currentActivityType = null;
          }
        }
      }

      summary.totalWorkDurationSeconds = Math.round(sessionWorkMs / 1000);
      summary.totalBreakDurationSeconds = Math.round(sessionBreakMs / 1000);
      summary.totalMeetingDurationSeconds = Math.round(sessionMeetingMs / 1000);
      return summary;
    });
  } catch (e) {
    Logger.log("Error in getManagerAttendanceSummary: " + e.toString());
    return [];
  }
}

/**
 * The "heavy lifter" function called ON-DEMAND to get detailed case logs.
 */
function getAgentCasesForDateRange(agentEmail, startDateStr, endDateStr) {
  if (!agentEmail || !startDateStr) return [];
  if (!endDateStr) endDateStr = startDateStr;

  try {
    const rangeStart = new Date(startDateStr);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(endDateStr);
    rangeEnd.setHours(23, 59, 59, 999);

    const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
    const casesSheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
    if (!casesSheet) throw new Error(`Sheet "${CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES}" not found.`);

    const data = casesSheet.getDataRange().getValues();
    if (data.length < 1) return [];

    const headers = data.shift().map(h => h.toString().trim().toLowerCase());
    const emailCol = headers.indexOf("useremail");
    const caseIdCol = headers.indexOf("main task id");
    const accountNameCol = headers.indexOf("account name");
    const statusCol = headers.indexOf("status");
    const startTimeCol = headers.indexOf("main task start date/time");
    const endTimeCol = headers.indexOf("main task end date/time");

    if ([emailCol, caseIdCol, startTimeCol, endTimeCol, accountNameCol].includes(-1)) {
      throw new Error("A core column (like useremail, main task id, account name, or a date) was not found.");
    }

    const agentCases = [];
    data.forEach((row) => {
      const rowAgentEmail = (row[emailCol] || "").toString().trim().toLowerCase();
      if (rowAgentEmail === agentEmail.toLowerCase()) {
        const startTime = row[startTimeCol] ? new Date(row[startTimeCol]) : null;
        const endTime = row[endTimeCol] ? new Date(row[endTimeCol]) : null;

        if (startTime && endTime && !isNaN(startTime.getTime()) && !isNaN(endTime.getTime()) && startTime < rangeEnd && endTime > rangeStart) {
          agentCases.push({
            caseId: row[caseIdCol],
            accountName: row[accountNameCol] || "N/A",
            startTime: startTime,
            endTime: endTime,
            status: row[statusCol] || "N/A",
            idleTimeBeforeThisCaseSeconds: 0
          });
        }
      }
    });

    agentCases.sort((a, b) => a.startTime - b.startTime);

    return agentCases.map((currentCase, index, array) => {
      if (index > 0) {
        const previousCase = array[index - 1];
        const idleTimeMs = currentCase.startTime.getTime() - previousCase.endTime.getTime();
        currentCase.idleTimeBeforeThisCaseSeconds = idleTimeMs > 0 ? Math.round(idleTimeMs / 1000) : 0;
      }
      return {
        caseId: currentCase.caseId,
        accountName: currentCase.accountName,
        startTimeISO: currentCase.startTime.toISOString(),
        endTimeISO: currentCase.endTime.toISOString(),
        status: currentCase.status,
        idleTimeBeforeThisCaseSeconds: currentCase.idleTimeBeforeThisCaseSeconds
      };
    });

  } catch (e) {
    Logger.log(`Error in getAgentCasesForDateRange: ${e.message}`);
    return [];
  }
}

/**
 * Calculates and ranks agent performance for a leaderboard.
 */
function getLeaderboardData(startDateStr, endDateStr) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
    const caseSheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
    if (!caseSheet) throw new Error(`Required sheet '${CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES}' not found.`);

    const startDate = new Date(startDateStr);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(endDateStr);
    endDate.setHours(23, 59, 59, 999);

    const agentData = {};

    const caseValues = caseSheet.getDataRange().getValues();
    const headers = caseValues.shift().map(h => h.toString().trim().toLowerCase());

    // Define column names to look for
    const COLS = {
        EMAIL: "useremail",
        STATUS: "status",
        START_TIME: "main task start date/time",
        END_TIME: "main task end date/time",
        PAUSE: "stored pause duration",
        ESCALATION: "stored escalation duration",
        STORED_AHT: "stored agent handling time"
    };

    // Map header names to their column index
    const headerMap = {};
    Object.keys(COLS).forEach(key => {
        headerMap[key] = headers.indexOf(COLS[key]);
    });

    caseValues.forEach(row => {
      const endTimeValue = row[headerMap.END_TIME];
      if (!endTimeValue) return;
      const endTime = new Date(endTimeValue);
      const caseStatus = row[headerMap.STATUS];

      if (caseStatus === 'Completed' && endTime >= startDate && endTime <= endDate) {
        const agentEmail = row[headerMap.EMAIL];
        if (!agentEmail) return;

        if (!agentData[agentEmail]) {
          agentData[agentEmail] = { name: agentEmail, totalCases: 0, totalHandlingTime: 0 };
        }

        let handlingTimeSeconds = 0;
        const storedAhtValue = headerMap.STORED_AHT > -1 ? row[headerMap.STORED_AHT] : null;

        if (storedAhtValue) {
            if (storedAhtValue instanceof Date) {
                handlingTimeSeconds = (storedAhtValue.getTime() - SPREADSHEET_EPOCH_OFFSET_MS) / 1000;
            } else if (!isNaN(parseFloat(storedAhtValue))) {
                handlingTimeSeconds = parseFloat(storedAhtValue) * 86400;
            }
        } else {
            const startTime = new Date(row[headerMap.START_TIME]);
            const pauseDuration = (parseFloat(row[headerMap.PAUSE]) || 0) * 86400;
            const escalationDuration = (parseFloat(row[headerMap.ESCALATION]) || 0) * 86400;
            const grossDuration = (endTime - startTime) / 1000;
            handlingTimeSeconds = grossDuration - pauseDuration - escalationDuration;
        }

        agentData[agentEmail].totalCases++;
        agentData[agentEmail].totalHandlingTime += handlingTimeSeconds > 0 ? handlingTimeSeconds : 0;
      }
    });

    const leaderboard = Object.values(agentData).map(agent => {
      const avgHandlingTime = agent.totalCases > 0 ? agent.totalHandlingTime / agent.totalCases : 0;
      return {
        agentName: agent.name,
        totalCases: agent.totalCases,
        avgHandlingTime: avgHandlingTime,
      };
    });

    leaderboard.sort((a, b) => b.totalCases - a.totalCases);
    return leaderboard.map((agent, index) => ({ ...agent, rank: index + 1 }));

  } catch (e) {
    console.error("getLeaderboardData Error: " + e.toString());
    throw new Error("Could not generate leaderboard data. Check script logs for details. " + e.message);
  }
}


/**
 * Fetches all completed case details for a specific agent within a date range.
 */
function getCaseDetailsForAgent(agentEmail, startDateStr, endDateStr) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
    const caseSheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
    if (!caseSheet) throw new Error(`Required sheet '${CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES}' not found.`);

    const startDate = new Date(startDateStr);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(endDateStr);
    endDate.setHours(23, 59, 59, 999);

    const caseDetails = [];

    const caseValues = caseSheet.getDataRange().getValues();
    const headers = caseValues.shift().map(h => h.toString().trim().toLowerCase());

    const COLS = {
        EMAIL: "useremail",
        STATUS: "status",
        START_TIME: "main task start date/time",
        END_TIME: "main task end date/time",
        PAUSE: "stored pause duration",
        ESCALATION: "stored escalation duration",
        CASE_ID: "main task id",
        ACCOUNT_NAME: "account name",
        STORED_AHT: "stored agent handling time"
    };

    const headerMap = {};
    Object.keys(COLS).forEach(key => {
        headerMap[key] = headers.indexOf(COLS[key]);
    });

    caseValues.forEach((row, index) => {
      const caseAgent = row[headerMap.EMAIL];
      if (!caseAgent || caseAgent.toLowerCase() !== agentEmail.toLowerCase()) return;

      const endTimeValue = row[headerMap.END_TIME];
      if (!endTimeValue) return;
      const endTime = new Date(endTimeValue);
      const caseStatus = row[headerMap.STATUS];

      if (caseStatus === 'Completed' && endTime >= startDate && endTime <= endDate) {
        const startTime = new Date(row[headerMap.START_TIME]);
        const pauseDuration = (parseFloat(row[headerMap.PAUSE]) || 0) * 86400; // in seconds
        const escalationDuration = (parseFloat(row[headerMap.ESCALATION]) || 0) * 86400; // in seconds

        let handlingTimeSeconds = 0;
        const storedAhtValue = row[headerMap.STORED_AHT];
        if (storedAhtValue) {
            if (storedAhtValue instanceof Date) {
                handlingTimeSeconds = (storedAhtValue.getTime() - SPREADSHEET_EPOCH_OFFSET_MS) / 1000;
            } else if (!isNaN(parseFloat(storedAhtValue))) {
                handlingTimeSeconds = parseFloat(storedAhtValue) * 86400;
            }
        }

        caseDetails.push({
          caseId: row[headerMap.CASE_ID],
          accountName: row[headerMap.ACCOUNT_NAME],
          handlingTime: handlingTimeSeconds > 0 ? handlingTimeSeconds : 0,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          pauseDuration: pauseDuration,
          escalationDuration: escalationDuration,
          uniqueId: `case-detail-${index}`
        });
      }
    });

    return caseDetails;

  } catch (e) {
    console.error("getCaseDetailsForAgent Error: " + e.toString());
    throw new Error("Could not fetch case details. " + e.message);
  }
}

/**
 * Scans production data to find operational anomalies within a given date range.
 * @param {string} startDateStr The start date in 'YYYY-MM-DD' format.
 * @param {string} endDateStr The end date in 'YYYY-MM-DD' format.
 * @returns {Array<Object>} An array of anomaly objects found.
 */
function getAnomalies(startDateStr, endDateStr) {
  const anomalies = [];
  try {
    // --- 1. SETUP DATE RANGE ---
    let startDate, endDate;
    if (startDateStr && endDateStr) {
      startDate = new Date(startDateStr);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(endDateStr);
      endDate.setHours(23, 59, 59, 999);
    } else {
      // Default to today
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date();
      endDate.setHours(23, 59, 59, 999);
    }

    const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);

    // --- 2. READ ALL NECESSARY SHEETS ONCE ---
    const mainTaskSheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
    const pauseLogSheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.PAUSING_LOGS);
    const escalationLogSheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.ESCALATION_LOGS);

    const mainTaskData = mainTaskSheet ? mainTaskSheet.getDataRange().getValues() : [];
    const pauseLogData = pauseLogSheet ? pauseLogSheet.getDataRange().getValues() : [];
    const escalationLogData = escalationLogSheet ? escalationLogSheet.getDataRange().getValues() : [];

    if (mainTaskData.length < 2) return [{ caseId: "N/A", type: "Info", details: "No main task data to analyze." }];

    // --- 3. PROCESS MAIN TASK SHEET ANOMALIES ---
    const mainHeaders = mainTaskData.shift();
    const mainCaseIdIdx = mainHeaders.indexOf('Main Task ID');
    const startTimeIdx = mainHeaders.indexOf('Main Task Start Date/Time');
    const endTimeIdx = mainHeaders.indexOf('Main Task End Date/Time');
    const handlingTimeIdx = mainHeaders.indexOf('Stored Agent Handling Time');
    const pauseDurationIdx = mainHeaders.indexOf('Stored Pause Duration');
    const escalationDurationIdx = mainHeaders.indexOf('Stored Escalation Duration');

    mainTaskData.forEach(row => {
      const caseId = row[mainCaseIdIdx];
      const startTime = row[startTimeIdx] instanceof Date ? row[startTimeIdx] : null;

      // Filter rows that are not within the selected date range
      if (!startTime || startTime < startDate || startTime > endDate) {
        return;
      }

      const endTime = row[endTimeIdx] instanceof Date ? row[endTimeIdx] : null;

      // Anomaly: Invalid Timestamps
      if (startTime && endTime && endTime < startTime) {
        anomalies.push({
          caseId: caseId,
          type: "Invalid Timestamps",
          details: `End time (${endTime.toLocaleString()}) is before start time (${startTime.toLocaleString()}).`
        });
      }

      // Anomaly: Excessive Handling Time & Negative Durations
      const durationFields = [
        { name: 'Handling Time', index: handlingTimeIdx, limit: 28800 }, // 8 hours
        { name: 'Pause Duration', index: pauseDurationIdx, limit: null },
        { name: 'Escalation Duration', index: escalationDurationIdx, limit: null }
      ];

      durationFields.forEach(field => {
        const durationValue = row[field.index];
        // In-line serialization logic to correctly interpret sheet durations
        let durationSeconds = 0;
        if (durationValue instanceof Date) {
            durationSeconds = Math.round((durationValue.getTime() - SPREADSHEET_EPOCH_OFFSET_MS) / 1000);
        } else if (durationValue !== '' && !isNaN(parseFloat(durationValue))) {
            // Use parseFloat to handle numbers that might be stored as strings.
            durationSeconds = Math.round(parseFloat(durationValue) * 86400);
        }

        if (durationSeconds < 0) {
            anomalies.push({
              caseId: caseId,
              type: "Negative Duration",
              details: `${field.name} is negative: ${durationSeconds.toFixed(2)}s.`
            });
          }
          if (field.limit && durationSeconds > field.limit) {
            anomalies.push({
              caseId: caseId,
              type: "Excessive Duration",
              details: `${field.name} of ${(durationSeconds / 3600).toFixed(2)}h exceeds the 8-hour limit.`
            });
          }
      });
    });

    // --- 4. PROCESS LOG-BASED ANOMALIES ---
    const pauseHeaders = pauseLogData.length > 1 ? pauseLogData.shift() : null;
    const escHeaders = escalationLogData.length > 1 ? escalationLogData.shift() : null;

    if (pauseHeaders) {
        const pauseCaseIdIdx = pauseHeaders.indexOf('Related Case ID');
        const pauseStartIdx = pauseHeaders.indexOf('Pause Start Time');
        const pauseEndIdx = pauseHeaders.indexOf('Pause End Time');

        // Short Pause Anomaly
        pauseLogData.forEach(row => {
            const startTime = row[pauseStartIdx] instanceof Date ? row[pauseStartIdx] : null;
            if (!startTime || startTime < startDate || startTime > endDate) return;

            const endTime = row[pauseEndIdx] instanceof Date ? row[pauseEndIdx] : null;
            if (startTime && endTime) {
                const durationSeconds = (endTime.getTime() - startTime.getTime()) / 1000;
                if (durationSeconds > 0 && durationSeconds < 5) {
                    anomalies.push({
                        caseId: row[pauseCaseIdIdx],
                        type: "Short Pause",
                        details: `A pause of only ${durationSeconds.toFixed(2)} seconds was recorded.`
                    });
                }
            }
        });
    }

    // Concurrent Events Anomaly
    if (pauseHeaders && escHeaders && pauseLogData.length > 0 && escalationLogData.length > 0) {
        const pauseCaseIdIdx = pauseHeaders.indexOf('Related Case ID');
        const pauseStartIdx = pauseHeaders.indexOf('Pause Start Time');
        const escCaseIdIdx = escHeaders.indexOf('Related Case ID');
        const escStartIdx = escHeaders.indexOf('Escalation Start Time');

        const pauseStartTimes = new Map();
        pauseLogData.forEach(row => {
            const startTime = row[pauseStartIdx] instanceof Date ? row[pauseStartIdx] : null;
            if (!startTime || startTime < startDate || startTime > endDate) return;

            const caseId = row[pauseCaseIdIdx];
            if (caseId && startTime) {
                if (!pauseStartTimes.has(caseId)) pauseStartTimes.set(caseId, new Set());
                pauseStartTimes.get(caseId).add(startTime.getTime());
            }
        });

        escalationLogData.forEach(row => {
            const escStartTime = row[escStartIdx] instanceof Date ? row[escStartIdx] : null;
            if (!escStartTime || escStartTime < startDate || escStartTime > endDate) return;

            const caseId = row[escCaseIdIdx];
            if (caseId && escStartTime && pauseStartTimes.has(caseId)) {
                if (pauseStartTimes.get(caseId).has(escStartTime.getTime())) {
                    anomalies.push({
                        caseId: caseId,
                        type: "Concurrent Events",
                        details: `A pause and an escalation were started at the exact same time: ${escStartTime.toLocaleString()}.`
                    });
                }
            }
        });
    }

    return anomalies.length > 0 ? anomalies : [{ caseId: "N/A", type: "No Anomalies Found", details: "No issues detected in the selected date range." }];

  } catch (e) {
    Logger.log("Error in getAnomalies: " + e.toString());
    // Return the error message as a special kind of anomaly
    return [{ caseId: "Error", type: "Function Error", details: e.message }];
  }
}

function previewHandlingTimeFix(caseId) {
    try {
        const fixDetails = calculateCorrectedHandlingTime_(caseId, true); // Get full details for preview

        // Helper to format seconds into HH:MM:SS string
        const formatSeconds = (s) => {
            if (isNaN(s) || s === null || s === undefined) return "N/A";
            const prefix = s < 0 ? "-" : "";
            s = Math.abs(s);
            const hours = Math.floor(s / 3600);
            const minutes = Math.floor((s % 3600) / 60);
            const seconds = Math.floor(s % 60);
            return `${prefix}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        };

        // --- FIX: Serialize Date objects in logs before sending to frontend ---
        const serializableLogs = (fixDetails.problematicLogs || []).map(log => ({
            ...log,
            start: log.start instanceof Date ? log.start.toISOString() : log.start,
            end: log.end instanceof Date ? log.end.toISOString() : log.end
        }));

        return {
            currentAHT: formatSeconds(fixDetails.currentAHTSeconds),
            proposedAHT: formatSeconds(fixDetails.newAHTSeconds),
            currentPause: formatSeconds(fixDetails.currentPauseSeconds),
            proposedPause: formatSeconds(fixDetails.newPauseSeconds),
            currentEscalation: formatSeconds(fixDetails.currentEscalationSeconds),
            proposedEscalation: formatSeconds(fixDetails.newEscalationSeconds),
            grossDuration: formatSeconds(fixDetails.grossDurationSeconds),
            mergedDowntime: formatSeconds(fixDetails.totalDowntimeSeconds),
            problematicLogs: serializableLogs
        };
    } catch (e) {
        Logger.log(`Error in previewHandlingTimeFix for case ${caseId}: ${e.toString()}`);
        return { error: e.message };
    }
}

function fixHandlingTimeAnomaly(caseId) {
    try {
        const fixDetails = calculateCorrectedHandlingTime_(caseId, false); // Recalculate without preview details

        const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
        const sheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
        const data = sheet.getDataRange().getValues();
        const headers = data[0];
        const caseIdCol = headers.indexOf('Main Task ID');
        const ahtCol = headers.indexOf('Stored Agent Handling Time');
        const pauseCol = headers.indexOf('Stored Pause Duration');
        const escalationCol = headers.indexOf('Stored Escalation Duration');

        for (let i = 1; i < data.length; i++) {
            if (data[i][caseIdCol] == caseId) {
                const rowToUpdate = i + 1;
                // Update AHT
                const newAHTSheetValue = fixDetails.newAHTSeconds > 0 ? fixDetails.newAHTSeconds / 86400 : 0;
                sheet.getRange(rowToUpdate, ahtCol + 1).setValue(newAHTSheetValue).setNumberFormat("[h]:mm:ss.SSS");

                // Update Pause Duration
                const newPauseSheetValue = fixDetails.newPauseSeconds > 0 ? fixDetails.newPauseSeconds / 86400 : 0;
                sheet.getRange(rowToUpdate, pauseCol + 1).setValue(newPauseSheetValue).setNumberFormat("[h]:mm:ss.SSS");

                // Update Escalation Duration
                const newEscalationSheetValue = fixDetails.newEscalationSeconds > 0 ? fixDetails.newEscalationSeconds / 86400 : 0;
                sheet.getRange(rowToUpdate, escalationCol + 1).setValue(newEscalationSheetValue).setNumberFormat("[h]:mm:ss.SSS");

                SpreadsheetApp.flush();
                invalidateCasesCache();
                return `Successfully corrected calculations for case ${caseId}.`;
            }
        }
        throw new Error("Could not find the case to update after calculation.");
    } catch (e) {
        Logger.log(`Error in fixHandlingTimeAnomaly for case ${caseId}: ${e.toString()}`);
        throw e; // Re-throw to be caught by the frontend
    }
}

function calculateCorrectedHandlingTime_(caseId, getDetails = false) {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
    const sheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
    if (!sheet) throw new Error("Main Tasks sheet not found.");

    const data = sheet.getDataRange().getValues();
    const headers = data.shift();
    const caseIdCol = headers.indexOf('Main Task ID');
    const startCol = headers.indexOf('Main Task Start Date/Time');
    const endCol = headers.indexOf('Main Task End Date/Time');
    const ahtCol = headers.indexOf('Stored Agent Handling Time');
    const pauseCol = headers.indexOf('Stored Pause Duration');
    const escalationCol = headers.indexOf('Stored Escalation Duration');

    let caseRow = null;
    for (const row of data) {
        if (row[caseIdCol] == caseId) { caseRow = row; break; }
    }
    if (!caseRow) throw new Error(`Case ${caseId} not found.`);

    const mainStartTime = new Date(caseRow[startCol]);
    const mainEndTime = new Date(caseRow[endCol]);
    if (isNaN(mainStartTime.getTime()) || isNaN(mainEndTime.getTime())) {
        throw new Error("Case has invalid start or end times.");
    }

    const grossDurationSeconds = (mainEndTime - mainStartTime) / 1000;

    const logs = getLogsForCase(caseId);
    let pauseIntervals = [];
    let escalationIntervals = [];

    logs.pausingLogs.forEach(log => {
        if (log['Pause Start Time'] && log['Pause End Time']) {
            let start = new Date(log['Pause Start Time']); let end = new Date(log['Pause End Time']);
            if (start < mainEndTime && end > mainStartTime) {
                pauseIntervals.push({ start: new Date(Math.max(start, mainStartTime)), end: new Date(Math.min(end, mainEndTime)), type: 'Pause', id: log.ID });
            }
        }
    });
    logs.escalationLogs.forEach(log => {
        if (log['Escalation Start Time'] && log['Escalation End Time']) {
            let start = new Date(log['Escalation Start Time']); let end = new Date(log['Escalation End Time']);
            if (start < mainEndTime && end > mainStartTime) {
                escalationIntervals.push({ start: new Date(Math.max(start, mainStartTime)), end: new Date(Math.min(end, mainEndTime)), type: 'Escalation', id: log['Log ID'] });
            }
        }
    });

    const mergedEscalations = mergeTimeIntervals_(escalationIntervals);
    const newEscalationSeconds = mergedEscalations.reduce((acc, iv) => acc + (iv.end - iv.start) / 1000, 0);

    const pauseOnlyIntervals = [];
    pauseIntervals.forEach(pauseIv => {
        let currentStart = pauseIv.start;
        for (const escIv of mergedEscalations) {
            if (currentStart >= escIv.end) continue;
            if (pauseIv.end <= escIv.start) break;
            if (currentStart < escIv.start) {
                pauseOnlyIntervals.push({ start: currentStart, end: escIv.start });
            }
            currentStart = new Date(Math.max(currentStart, escIv.end));
            if (currentStart >= pauseIv.end) break;
        }
        if (currentStart < pauseIv.end) {
            pauseOnlyIntervals.push({ start: currentStart, end: pauseIv.end });
        }
    });
    const newPauseSeconds = pauseOnlyIntervals.reduce((acc, iv) => acc + (iv.end - iv.start) / 1000, 0);

    const totalDowntimeSeconds = newEscalationSeconds + newPauseSeconds;
    const newAHTSeconds = grossDurationSeconds - totalDowntimeSeconds;

    let problematicLogs = [];
    if (getDetails) {
        const allIntervals = [...pauseIntervals, ...escalationIntervals].sort((a,b) => a.start - b.start);
        const flaggedIds = new Set();
        for (let i = 1; i < allIntervals.length; i++) {
            const prev = allIntervals[i-1];
            const curr = allIntervals[i];
            if (curr.start < prev.end) {
                if (!flaggedIds.has(prev.id)) { flaggedIds.add(prev.id); problematicLogs.push({...prev, reason: `Overlaps with ${curr.type} log ${curr.id}`}); }
                if (!flaggedIds.has(curr.id)) { flaggedIds.add(curr.id); problematicLogs.push({...curr, reason: `Overlaps with ${prev.type} log ${prev.id}`}); }
            }
        }
    }

    const getSecondsFromSheet = (value) => {
        if (value instanceof Date) { return Math.round((value.getTime() - SPREADSHEET_EPOCH_OFFSET_MS) / 1000); }
        if (value !== '' && !isNaN(parseFloat(value))) { return parseFloat(value) * 86400; }
        return 0;
    };

    return {
        currentAHTSeconds: getSecondsFromSheet(caseRow[ahtCol]),
        currentPauseSeconds: getSecondsFromSheet(caseRow[pauseCol]),
        currentEscalationSeconds: getSecondsFromSheet(caseRow[escalationCol]),
        newAHTSeconds, newPauseSeconds, newEscalationSeconds,
        grossDurationSeconds, totalDowntimeSeconds, problematicLogs
    };
}

function mergeTimeIntervals_(intervals) {
    if (intervals.length <= 1) return intervals;
    intervals.sort((a, b) => a.start - b.start);
    const merged = [intervals[0]];
    for (let i = 1; i < intervals.length; i++) {
        const lastMerged = merged[merged.length - 1];
        const current = intervals[i];
        if (current.start < lastMerged.end) {
            lastMerged.end = new Date(Math.max(lastMerged.end, current.end));
        } else {
            merged.push(current);
        }
    }
    return merged;
}

/**
 * Gets unique values for all specified filter columns to populate the dashboard UI.
 * NOTE: Adjust the header names in the 'headerNames' object if they differ in your sheet.
 */
function getProductionFilterOptions() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
    const sheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
    if (!sheet) {
      throw new Error(`Sheet '${CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES}' not found.`);
    }
    const data = sheet.getDataRange().getValues();
    const headers = data.shift().map(h => String(h).trim().toLowerCase());

    // --- CONFIGURATION: Match these names to your sheet's column headers ---
    const headerNames = {
      status: "status",
      country: "country",
      category: "category",
      taskType: "task type", // Assumed header name
      retailerType: "retailer provider type",
      slaMissedReason: "sla missed reason" // Assumed header name
    };
    // --------------------------------------------------------------------

    const colIndices = {
      status: headers.indexOf(headerNames.status),
      country: headers.indexOf(headerNames.country),
      category: headers.indexOf(headerNames.category),
      taskType: headers.indexOf(headerNames.taskType),
      retailerType: headers.indexOf(headerNames.retailerType),
      slaMissedReason: headers.indexOf(headerNames.slaMissedReason),
    };

    const uniqueValues = {
      statuses: new Set(),
      markets: new Set(),
      categories: new Set(),
      taskTypes: new Set(),
      retailerTypes: new Set(),
      slaMissedReasons: new Set(),
    };

    data.forEach(row => {
      if (colIndices.status !== -1 && row[colIndices.status]) uniqueValues.statuses.add(row[colIndices.status]);
      if (colIndices.country !== -1 && row[colIndices.country]) uniqueValues.markets.add(row[colIndices.country]);
      if (colIndices.category !== -1 && row[colIndices.category]) uniqueValues.categories.add(row[colIndices.category]);
      if (colIndices.taskType !== -1 && row[colIndices.taskType]) uniqueValues.taskTypes.add(row[colIndices.taskType]);
      if (colIndices.retailerType !== -1 && row[colIndices.retailerType]) uniqueValues.retailerTypes.add(row[colIndices.retailerType]);
      if (colIndices.slaMissedReason !== -1 && row[colIndices.slaMissedReason]) uniqueValues.slaMissedReasons.add(row[colIndices.slaMissedReason]);
    });

    return {
      statuses: Array.from(uniqueValues.statuses).sort(),
      markets: Array.from(uniqueValues.markets).sort(),
      categories: Array.from(uniqueValues.categories).sort(),
      taskTypes: Array.from(uniqueValues.taskTypes).sort(),
      retailerTypes: Array.from(uniqueValues.retailerTypes).sort(),
      slaMissedReasons: Array.from(uniqueValues.slaMissedReasons).sort(),
    };

  } catch (e) {
    console.error("getProductionFilterOptions Error: " + e.toString());
    return { statuses: [], markets: [], categories: [], taskTypes: [], retailerTypes: [], slaMissedReasons: [] };
  }
}


function getProductionReport(filters) {
  try {
    const {
      startDateStr, endDateStr,
      drillDownStatus, drillDownMarket, drillDownTat,
      // New filter values from the front-end
      selectedStatus, selectedMarket, selectedCategory,
      selectedTaskType, selectedRetailerType, selectedSlaReason
    } = filters;

    // ... (blankSummary object remains the same)
    const blankSummary = {
      totalCounts: {}, marketCounts: {}, tatCounts: {},
      menuComplexity: { marketData: {}, grandTotal: {} },
      ahtByMonth: { marketData: {}, grandTotal: {} },
      ahtByRetailer: { marketData: {}, grandTotal: {} },
      ahtByCategory: { categoryData: {}, grandTotal: {} },
      tatBucket: { marketData: {}, grandTotal: {} },
      monthList: [], retailerTypeList: [], categoryList: []
    };

    const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
    const sheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
    if (!sheet) throw new Error(`Sheet '${CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES}' not found.`);

    const startDate = new Date(startDateStr);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(endDateStr);
    endDate.setHours(23, 59, 59, 999);

    const rawData = sheet.getDataRange().getValues();
    const headers = rawData.shift().map(h => h.toString().trim());

    const headerMap = {
      // ... (existing headerMap remains the same)
      country: headers.indexOf("Country"),
      status: headers.indexOf("Status"),
      category: headers.indexOf("Category"),
      startTime: headers.indexOf("Main Task Start Date/Time"),
      endTime: headers.indexOf("Main Task End Date/Time"),
      escalation: headers.indexOf("Stored Escalation Duration"),
      aht: headers.indexOf("Stored Agent Handling Time"),
      totalDishes: headers.indexOf("Total No. of dishes"),
      mainDishesPhotos: headers.indexOf("No of Valid Photos for Main dishes (Exlcuding Extras, drinks, sides etc.)"),
      totalOptions: headers.indexOf("Total no. of options"),
      totalOptionGroups: headers.indexOf("Total no. of option Groups"),
      retailerType: headers.indexOf("Retailer Provider Type"),
      // Add new headers for filtering if they aren't already here
      taskType: headers.indexOf("Task Type"),
      slaMissedReason: headers.indexOf("SLA Missed Reason")
    };

    // --- NEW: CENTRAL FILTERING LOGIC (MULTI-SELECT ENABLED) ---
const dataInDateRange = rawData.filter(row => {
    // 1. Date Filter (mandatory)
    const status = row[headerMap.status];
    const dateToCheck = (status === 'Completed' || status === 'Finished') ? row[headerMap.endTime] : row[headerMap.startTime];
    const isDateValid = dateToCheck instanceof Date && dateToCheck >= startDate && dateToCheck <= endDate;
    if (!isDateValid) return false;

    // 2. Dropdown Filters (handle arrays; an empty array means "All")
    const statusMatch = !selectedStatus || selectedStatus.length === 0 || selectedStatus.includes(row[headerMap.status]);
    const marketMatch = !selectedMarket || selectedMarket.length === 0 || selectedMarket.includes(row[headerMap.country]);
    const categoryMatch = !selectedCategory || selectedCategory.length === 0 || selectedCategory.includes(row[headerMap.category]);
    const taskTypeMatch = !selectedTaskType || selectedTaskType.length === 0 || selectedTaskType.includes(row[headerMap.taskType]);
    const retailerTypeMatch = !selectedRetailerType || selectedRetailerType.length === 0 || selectedRetailerType.includes(row[headerMap.retailerType]);
    const slaReasonMatch = !selectedSlaReason || selectedSlaReason.length === 0 || selectedSlaReason.includes(row[headerMap.slaMissedReason]);

    return statusMatch && marketMatch && categoryMatch && taskTypeMatch && retailerTypeMatch && slaReasonMatch;
});
// --- END OF NEW LOGIC ---

    // ... (The rest of the function remains identical, as it now operates on the pre-filtered 'dataInDateRange' array)
    // ... from 'const totalCounts = ...' all the way to the final 'return { summary: summary, ... }'

    // NOTE: The entire aggregation and drilldown logic from the previous version of the function
    // should be pasted here without any changes.

    const totalCounts = { "Cancelled": 0, "Completed": 0, "Escalated": 0, "In Progress": 0, "Not Started": 0, "Task Paused": 0, "GrandTotal": 0 };
    const marketCounts = {};
    const tatCounts = {};
    const menuComplexityAgg = {};
    const ahtByMonthAgg = {};
    const ahtByRetailerAgg = {};
    const ahtByCategoryAgg = {};
    const tatBucketAgg = {};
    const monthSet = new Set();
    const retailerTypeSet = new Set();
    const categorySet = new Set();
    const now = new Date();

    dataInDateRange.forEach(row => {
      const country = row[headerMap.country];
      const status = row[headerMap.status];
      const category = row[headerMap.category];
      const startTime = row[headerMap.startTime];
      const endTime = row[headerMap.endTime];
      const retailerType = row[headerMap.retailerType];
      
      let ahtInSeconds = 0;
      const ahtRawValue = row[headerMap.aht];
      if (ahtRawValue instanceof Date) { ahtInSeconds = (ahtRawValue.getHours() * 3600) + (ahtRawValue.getMinutes() * 60) + ahtRawValue.getSeconds(); }
      else if (!isNaN(parseFloat(ahtRawValue))) { ahtInSeconds = parseFloat(ahtRawValue) * 86400; }

      if (category && ahtInSeconds > 0) {
          categorySet.add(category);
          if (!ahtByCategoryAgg[category]) {
              ahtByCategoryAgg[category] = { sum: 0, count: 0 };
          }
          ahtByCategoryAgg[category].sum += ahtInSeconds;
          ahtByCategoryAgg[category].count++;
      }

      if (country && endTime instanceof Date) {
        if (ahtInSeconds > 0) { const year = endTime.getFullYear(); const month = (endTime.getMonth() + 1).toString().padStart(2, '0'); const monthKey = `${year}-${month}`; monthSet.add(monthKey); if (!ahtByMonthAgg[country]) ahtByMonthAgg[country] = {}; if (!ahtByMonthAgg[country][monthKey]) ahtByMonthAgg[country][monthKey] = { sum: 0, count: 0 }; ahtByMonthAgg[country][monthKey].sum += ahtInSeconds; ahtByMonthAgg[country][monthKey].count++; }
        if (ahtInSeconds > 0 && retailerType) { retailerTypeSet.add(retailerType); if (!ahtByRetailerAgg[country]) ahtByRetailerAgg[country] = {}; if (!ahtByRetailerAgg[country][retailerType]) ahtByRetailerAgg[country][retailerType] = { sum: 0, count: 0 }; ahtByRetailerAgg[country][retailerType].sum += ahtInSeconds; ahtByRetailerAgg[country][retailerType].count++; }
      }
      if (country && startTime instanceof Date) { const effectiveEndTime = (endTime instanceof Date) ? endTime : now; const durationHours = (effectiveEndTime.getTime() - startTime.getTime()) / 3600000; if (!tatBucketAgg[country]) tatBucketAgg[country] = { under24: 0, between24and30: 0, between30and48: 0, over48: 0, total: 0 }; if (durationHours < 24) tatBucketAgg[country].under24++; else if (durationHours >= 24 && durationHours < 30) tatBucketAgg[country].between24and30++; else if (durationHours >= 30 && durationHours < 48) tatBucketAgg[country].between30and48++; else tatBucketAgg[country].over48++; tatBucketAgg[country].total++; }
      if (totalCounts.hasOwnProperty(status)) totalCounts[status]++;
      if (country) { if (!marketCounts[country]) marketCounts[country] = { "Cancelled": 0, "Completed": 0, "Escalated": 0, "In Progress": 0, "Not Started": 0, "Task Paused": 0 }; if (marketCounts[country].hasOwnProperty(status)) marketCounts[country][status]++; }
      if ((status === 'Completed' || status === 'Finished') && startTime instanceof Date && endTime instanceof Date) { const escalationMs = (parseFloat(row[headerMap.escalation]) || 0) * 86400000; const netDurationHours = (endTime.getTime() - startTime.getTime() - escalationMs) / 3600000; if (!tatCounts[country]) tatCounts[country] = { adhered: 0, missed: 0 }; if (netDurationHours < 24) tatCounts[country].adhered++; else tatCounts[country].missed++; }
      if (country) { if (!menuComplexityAgg[country]) menuComplexityAgg[country] = { aht: { sum: 0, count: 0 }, totalDishes: { sum: 0, count: 0 }, mainDishesPhotos: { sum: 0, count: 0 }, totalOptions: { sum: 0, count: 0 }, totalOptionGroups: { sum: 0, count: 0 } }; const safeAdd = (metric, value, isSeconds = false) => { const num = parseFloat(value); if (!isNaN(num)) { menuComplexityAgg[country][metric].sum += (isSeconds ? value : num); menuComplexityAgg[country][metric].count++; } }; if (ahtInSeconds > 0) safeAdd('aht', ahtInSeconds, true); safeAdd('totalDishes', row[headerMap.totalDishes]); safeAdd('mainDishesPhotos', row[headerMap.mainDishesPhotos]); safeAdd('totalOptions', row[headerMap.totalOptions]); safeAdd('totalOptionGroups', row[headerMap.totalOptionGroups]); }
    });
    
    totalCounts.GrandTotal = Object.values(totalCounts).reduce((a, b) => a + b, 0) - totalCounts.GrandTotal;
    const menuComplexity = {}; for (const country in menuComplexityAgg) { const agg = menuComplexityAgg[country]; menuComplexity[country] = { avgAhtSeconds: (agg.aht.count > 0) ? (agg.aht.sum / agg.aht.count) : 0, avgTotalDishes: (agg.totalDishes.count > 0) ? agg.totalDishes.sum / agg.totalDishes.count : 0, avgMainDishesPhotos: (agg.mainDishesPhotos.count > 0) ? agg.mainDishesPhotos.sum / agg.mainDishesPhotos.count : 0, avgTotalOptions: (agg.totalOptions.count > 0) ? agg.totalOptions.sum / agg.totalOptions.count : 0, avgTotalOptionGroups: (agg.totalOptionGroups.count > 0) ? agg.totalOptionGroups.sum / agg.totalOptionGroups.count : 0 }; }
    const ahtByMonth = {}; for (const country in ahtByMonthAgg) { ahtByMonth[country] = {}; for (const month in ahtByMonthAgg[country]) { const agg = ahtByMonthAgg[country][month]; if (agg.count > 0) { ahtByMonth[country][month] = (agg.sum / agg.count); } } } const monthList = Array.from(monthSet).sort();
    const ahtByRetailer = {}; for (const country in ahtByRetailerAgg) { ahtByRetailer[country] = {}; for (const rType in ahtByRetailerAgg[country]) { const agg = ahtByRetailerAgg[country][rType]; if (agg.count > 0) { ahtByRetailer[country][rType] = (agg.sum / agg.count); } } } const retailerTypeList = Array.from(retailerTypeSet).sort();
    const ahtByCategory = {}; for (const category in ahtByCategoryAgg) { const agg = ahtByCategoryAgg[category]; if (agg.count > 0) { ahtByCategory[category] = (agg.sum / agg.count); } } const categoryList = Array.from(categorySet).sort();
    const tatBucket = { marketData: tatBucketAgg };
    const complexityGrandTotalAgg = { aht: { sum: 0, count: 0 }, totalDishes: { sum: 0, count: 0 }, mainDishesPhotos: { sum: 0, count: 0 }, totalOptions: { sum: 0, count: 0 }, totalOptionGroups: { sum: 0, count: 0 } }; for (const country in menuComplexityAgg) { for (const metric in menuComplexityAgg[country]) { complexityGrandTotalAgg[metric].sum += menuComplexityAgg[country][metric].sum; complexityGrandTotalAgg[metric].count += menuComplexityAgg[country][metric].count; } } const menuComplexityGrandTotal = { avgAhtSeconds: (complexityGrandTotalAgg.aht.count > 0) ? (complexityGrandTotalAgg.aht.sum / complexityGrandTotalAgg.aht.count) : 0, avgTotalDishes: (complexityGrandTotalAgg.totalDishes.count > 0) ? (complexityGrandTotalAgg.totalDishes.sum / complexityGrandTotalAgg.totalDishes.count) : 0, avgMainDishesPhotos: (complexityGrandTotalAgg.mainDishesPhotos.count > 0) ? (complexityGrandTotalAgg.mainDishesPhotos.sum / complexityGrandTotalAgg.mainDishesPhotos.count) : 0, avgTotalOptions: (complexityGrandTotalAgg.totalOptions.count > 0) ? (complexityGrandTotalAgg.totalOptions.sum / complexityGrandTotalAgg.totalOptions.count) : 0, avgTotalOptionGroups: (complexityGrandTotalAgg.totalOptionGroups.count > 0) ? (complexityGrandTotalAgg.totalOptionGroups.sum / complexityGrandTotalAgg.totalOptionGroups.count) : 0 };
    const ahtByMonthGrandTotal = {}; monthList.forEach(month => { let monthSum = 0; let monthCount = 0; for (const country in ahtByMonthAgg) { if (ahtByMonthAgg[country][month]) { monthSum += ahtByMonthAgg[country][month].sum; monthCount += ahtByMonthAgg[country][month].count; } } ahtByMonthGrandTotal[month] = (monthCount > 0) ? (monthSum / monthCount) : 0; });
    const ahtByRetailerGrandTotal = {}; retailerTypeList.forEach(retailerType => { let retailerSum = 0; let retailerCount = 0; for (const country in ahtByRetailerAgg) { if (ahtByRetailerAgg[country][retailerType]) { retailerSum += ahtByRetailerAgg[country][retailerType].sum; retailerCount += ahtByRetailerAgg[country][retailerType].count; } } ahtByRetailerGrandTotal[retailerType] = (retailerCount > 0) ? (retailerSum / retailerCount) : 0; });
    const ahtByCategoryGrandTotalAgg = { sum: 0, count: 0 }; for (const category in ahtByCategoryAgg) { ahtByCategoryGrandTotalAgg.sum += ahtByCategoryAgg[category].sum; ahtByCategoryGrandTotalAgg.count += ahtByCategoryAgg[category].count; } const ahtByCategoryGrandTotal = { avgAhtSeconds: (ahtByCategoryGrandTotalAgg.count > 0) ? (ahtByCategoryGrandTotalAgg.sum / ahtByCategoryGrandTotalAgg.count) : 0 };
    const tatBucketGrandTotal = { under24: 0, between24and30: 0, between30and48: 0, over48: 0, total: 0 }; for (const country in tatBucketAgg) { for (const bucket in tatBucketAgg[country]) { tatBucketGrandTotal[bucket] += tatBucketAgg[country][bucket]; } } tatBucket.grandTotal = tatBucketGrandTotal;
    
    let drillDownDetails = [];
    if (filters.drillDownStatus || filters.drillDownTat) {
      drillDownDetails = dataInDateRange.filter(row => {
        const country = row[headerMap.country]; const status = row[headerMap.status]; const category = row[headerMap.category];
        if (filters.drillDownTat) { if (status !== 'Completed' && status !== 'Finished') return false; if (country !== filters.drillDownMarket) return false; const startTime = row[headerMap.startTime]; const endTime = row[headerMap.endTime]; if (!(startTime instanceof Date && endTime instanceof Date)) return false; const escalationMs = (parseFloat(row[headerMap.escalation]) || 0) * 86400000; const netDurationHours = (endTime.getTime() - startTime.getTime() - escalationMs) / 3600000; const tatStatus = netDurationHours < 24 ? "Adhered" : "Missed"; return tatStatus === filters.drillDownTat; }
        if (filters.drillDownStatus === 'TAT Bucket') { if (country !== filters.drillDownMarket) return false; const startTime = row[headerMap.startTime]; if (!(startTime instanceof Date)) return false; const effectiveEndTime = (row[headerMap.endTime] instanceof Date) ? row[headerMap.endTime] : now; const durationHours = (effectiveEndTime.getTime() - startTime.getTime()) / 3600000; const bucket = filters.subFilter; if (bucket === '<24 hours') return durationHours < 24; if (bucket === '24-30 hours') return durationHours >= 24 && durationHours < 30; if (bucket === '30-48 hours') return durationHours >= 30 && durationHours < 48; if (bucket === '>48 hours') return durationHours > 48; return false; }
        if (filters.drillDownStatus === 'AHT by Month') { if (country !== filters.drillDownMarket) return false; const endTime = row[headerMap.endTime]; if (!(endTime instanceof Date)) return false; const monthKey = `${endTime.getFullYear()}-${(endTime.getMonth() + 1).toString().padStart(2, '0')}`; return monthKey === filters.subFilter; }
        if (filters.drillDownStatus === 'AHT by Retailer') { if (country !== filters.drillDownMarket) return false; return row[headerMap.retailerType] === filters.subFilter; }
        if (filters.drillDownStatus === 'AHT by Category') { return category === filters.subFilter; }
        if (filters.drillDownStatus === 'Menu Complexity') { return country === filters.drillDownMarket; }
        const marketMatch = filters.drillDownMarket === 'All' || country === filters.drillDownMarket; return status === filters.drillDownStatus && marketMatch;
      }).map(row => {
          const record = {};
          headers.forEach((header, i) => {
              let value = row[i];
              if (header === 'Stored Agent Handling Time' && value instanceof Date) {
                  const totalSeconds = value.getHours() * 3600 + value.getMinutes() * 60 + value.getSeconds();
                  record[header] = totalSeconds / 86400.0;
              } else {
                  record[header] = (value instanceof Date) ? value.toISOString() : value;
              }
          });
          return record;
      });
    }
    const summary = { totalCounts, marketCounts, tatCounts, menuComplexity: { marketData: menuComplexity, grandTotal: menuComplexityGrandTotal }, ahtByMonth: { marketData: ahtByMonth, grandTotal: ahtByMonthGrandTotal }, ahtByRetailer: { marketData: ahtByRetailer, grandTotal: ahtByRetailerGrandTotal }, ahtByCategory: { categoryData: ahtByCategory, grandTotal: ahtByCategoryGrandTotal }, tatBucket: tatBucket, monthList, retailerTypeList, categoryList };
    return { summary: summary, details: drillDownDetails, error_message: null };

  } catch (e) {
    console.error("getProductionReport Error: " + e.toString() + "\nStack: " + e.stack);
    return { summary: blankSummary, details: [], error_message: "An unexpected error occurred: " + e.message };
  }
}








/**
 * Fetches an agent's attendance log entries for a given date range.
 */
function getAgentAttendanceLog(dateRange) {
  try {
    const agentEmail = Session.getActiveUser().getEmail();
    if (!agentEmail) throw new Error("Could not identify the current user.");

    const startDate = new Date(dateRange.startDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(dateRange.endDate);
    endDate.setHours(23, 59, 59, 999);

    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const sheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.AGENT_LOG);
    if (!sheet) throw new Error("AgentLog sheet not found.");

    const allData = sheet.getDataRange().getValues();
    allData.shift();

    const agentLogs = allData.filter(row => {
      const rowEmail = (row[1] || "").toString().trim().toLowerCase();
      if (rowEmail !== agentEmail.toLowerCase()) return false;
      const timestamp = row[0] instanceof Date ? row[0] : new Date(row[0]);
      return timestamp >= startDate && timestamp <= endDate;
    });

    return agentLogs.map(row => {
      const timestamp = row[0] instanceof Date ? row[0] : new Date(row[0]);
      return {
        // --- CHANGE IS HERE ---
        // Send the full ISO string to preserve milliseconds
        timestamp: timestamp.toISOString(),
        action: row[3],
        sessionId: row[4]
      };
    }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  } catch (e) {
    Logger.log("Error in getAgentAttendanceLog: " + e.toString());
    throw new Error("Failed to retrieve attendance log. " + e.message);
  }
}

/**
 * Gets a performance summary for the agent for the current day.
 * Called by the new agent dashboard to populate scorecards.
 */
function getAgentDashboardSummary() {
  try {
    const agentEmail = Session.getActiveUser().getEmail();
    if (!agentEmail) return {};

    const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
    const sheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
    if (!sheet) throw new Error(`Sheet '${CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES}' not found.`);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const data = sheet.getDataRange().getValues();
    const headers = data.shift().map(h => h.toString().trim().toLowerCase());

    const emailCol = headers.indexOf("useremail");
    const statusCol = headers.indexOf("status");
    const endTimeCol = headers.indexOf("main task end date/time");
    const caseIdCol = headers.indexOf("main task id");
    const handlingTimeCol = headers.indexOf("stored agent handling time");

    // Get cases the agent cooperated on today
    const cooperationLogSheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.COOPERATION_LOGS);
    let cooperatedCasesToday = new Set();
    if (cooperationLogSheet) {
        const cooperationLogData = cooperationLogSheet.getDataRange().getValues();
        const cooperationLogHeaders = cooperationLogData.shift().map(h => h.toString().trim().toLowerCase());
        const cooperationCaseIdCol = cooperationLogHeaders.indexOf("related case id");
        const cooperationEmailCol = cooperationLogHeaders.indexOf("user email");
        const cooperationEndTimeCol = cooperationLogHeaders.indexOf("end time");

        if (cooperationCaseIdCol !== -1 && cooperationEmailCol !== -1 && cooperationEndTimeCol !== -1) {
            cooperationLogData.forEach(row => {
                const rowEmail = (row[cooperationEmailCol] || "").toString().trim().toLowerCase();
                const endTime = row[cooperationEndTimeCol] instanceof Date ? row[cooperationEndTimeCol] : null;

                if (rowEmail === agentEmail.toLowerCase() && endTime && endTime >= todayStart && endTime <= todayEnd) {
                    cooperatedCasesToday.add(row[cooperationCaseIdCol]);
                }
            });
        }
    }

    let summary = {
      closedToday: 0,
      inProgress: 0,
      escalated: 0,
      totalHandlingTime: 0
    };

    data.forEach(row => {
      const rowEmail = (row[emailCol] || "").toString().trim().toLowerCase();
      const status = (row[statusCol] || "").toString();
      const endTime = row[endTimeCol] instanceof Date ? row[endTimeCol] : null;
      const caseId = row[caseIdCol];

      const isOwner = rowEmail === agentEmail.toLowerCase();
      const isCooperator = caseId && cooperatedCasesToday.has(caseId);

      // In-progress and Escalated cases are only counted if the user is the owner.
      if (isOwner) {
          if (status === 'In Progress') {
              summary.inProgress++;
          } else if (status === 'Escalated') {
              summary.escalated++;
          }
      }

      // A case is counted as "closed today" if it was completed today AND
      // the user is either the owner OR a cooperator on that case.
      const isClosedToday = (status === 'Completed' || status === 'Finished') && endTime && endTime >= todayStart && endTime <= todayEnd;

      if (isClosedToday && (isOwner || isCooperator)) {
          summary.closedToday++;
          const handlingTimeValue = row[handlingTimeCol];
          let handlingTimeSeconds = 0;
          if (handlingTimeValue) {
              if (handlingTimeValue instanceof Date) {
                  handlingTimeSeconds = (handlingTimeValue.getTime() - SPREADSHEET_EPOCH_OFFSET_MS) / 1000;
              } else if (!isNaN(parseFloat(handlingTimeValue))) {
                  handlingTimeSeconds = parseFloat(handlingTimeValue) * 86400;
              }
          }
          summary.totalHandlingTime += handlingTimeSeconds > 0 ? handlingTimeSeconds : 0;
      }
    });

    summary.aht = summary.closedToday > 0 ? summary.totalHandlingTime / summary.closedToday : 0;

    return summary;

  } catch (e) {
    Logger.log("Error in getAgentDashboardSummary: " + e.toString());
    return { closedToday: 'Err', aht: 0, escalated: 'Err', inProgress: 'Err' };
  }
}


/**
 * Fetches, filters, sorts, and paginates cases for the Case Management page.
 * Includes a smarter, targeted search.
 */
function searchAllCases(searchTerm) {
  try {
    if (!searchTerm) {
      return [];
    }

    const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
    const sheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
    if (!sheet) throw new Error(`Sheet '${CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES}' not found.`);

    const data = sheet.getDataRange().getValues();
    const headers = data.shift();

    let records = data.map(row => {
      let record = {};
      headers.forEach((header, i) => { record[header] = row[i]; });
      return record;
    });

    const lowerCaseSearchTerm = searchTerm.toLowerCase();
    const searchableHeaders = ['Main Task ID', 'Country', 'Account Name', 'Case Title', 'Category', 'Provider Id', 'Useremail'];
    let filteredRecords = records.filter(record => {
        return searchableHeaders.some(header =>
            record[header] && String(record[header]).toLowerCase().includes(lowerCaseSearchTerm)
        );
    });

    filteredRecords.sort((a, b) => {
      const dateA = new Date(a['Menu Request Sent Date'] || 0);
      const dateB = new Date(b['Menu Request Sent Date'] || 0);
      return dateB - dateA;
    });

    const serializableRecords = filteredRecords.map(record => {
        const newRecord = {};
        for (const key in record) {
            if (record[key] instanceof Date) {
                newRecord[key] = record[key].toISOString();
            } else {
                newRecord[key] = record[key];
            }
        }
        return newRecord;
    });

    return serializableRecords;

  } catch (e) {
    Logger.log("Error in searchAllCases: " + e.toString());
    throw new Error("Failed to search cases. " + e.message);
  }
}

function getCasesByStatus(options) {
  const { status, searchTerm, limit = 20, offset = 0, country, filter } = options;
  const cache = CacheService.getScriptCache();

  // --- Versioned Caching Logic ---
  const versionKey = 'cache_version';
  let currentVersion = cache.get(versionKey) || '1';
  const CACHE_KEY_MANIFEST = `v${currentVersion}_main_tasks_manifest`;
  const CACHE_EXPIRATION = 300; // 5 minutes

  let rawData;
  const manifestJSON = cache.get(CACHE_KEY_MANIFEST);

  if (manifestJSON) {
    Logger.log("Cache HIT for manifest: " + CACHE_KEY_MANIFEST);
    const manifest = JSON.parse(manifestJSON);
    const chunkKeys = manifest.keys;
    const cachedChunks = cache.getAll(chunkKeys);
    let reassembledJSON = "";
    for (const key of chunkKeys) {
      if (cachedChunks[key]) {
        reassembledJSON += cachedChunks[key];
      } else {
        Logger.log(`Cache MISS for chunk ${key}. Forcing refresh.`);
        reassembledJSON = null;
        break;
      }
    }
    if (reassembledJSON) {
      rawData = JSON.parse(reassembledJSON);
    }
  }

  if (!rawData) {
    Logger.log("Cache MISS for manifest: " + CACHE_KEY_MANIFEST + ". Acquiring lock.");
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(30000); // Wait up to 30 seconds.
      // Re-check version and cache inside the lock
      currentVersion = cache.get(versionKey) || '1';
      const manifestAfterLockKey = `v${currentVersion}_main_tasks_manifest`;
      const manifestAfterLock = cache.get(manifestAfterLockKey);

      if (manifestAfterLock) {
         Logger.log("Cache HIT for manifest after waiting for lock: " + manifestAfterLockKey);
         const manifest = JSON.parse(manifestAfterLock);
         // Simplified reassembly for brevity. Full assembly is above.
         rawData = JSON.parse(cache.get(manifest.keys[0]));
      } else {
        Logger.log("Fetching from spreadsheet for version: " + currentVersion);
        const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
        const sheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
        const data = sheet.getDataRange().getValues();
        const headers = data.shift();

        rawData = { headers: headers, data: data };

        const rawDataString = JSON.stringify(rawData);
        const CHUNK_SIZE = 90000; // 90KB
        const numChunks = Math.ceil(rawDataString.length / CHUNK_SIZE);
        const chunks = {};
        const chunkKeys = [];

        for (let i = 0; i < numChunks; i++) {
          const key = `v${currentVersion}_main_tasks_chunk_${i}`;
          chunkKeys.push(key);
          chunks[key] = rawDataString.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        }

        const newManifest = { keys: chunkKeys, timestamp: new Date().getTime() };
        chunks[manifestAfterLockKey] = JSON.stringify(newManifest);

        cache.putAll(chunks, CACHE_EXPIRATION);
        Logger.log(`Populated cache for version ${currentVersion} with ${numChunks} chunks.`);
      }
    } catch (e) {
      Logger.log("Lock timeout or error during fetch: " + e.toString());
      throw new Error("Server is busy fetching new data, please try again in a moment.");
    } finally {
      lock.releaseLock();
    }
  }

  // --- Start processing with the (now populated) rawData ---
  const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID); // Needed for logs
  const openPauses = getOpenLogs_(ss, CONFIG.PRODUCTION.SHEETS.PAUSING_LOGS, 'Related Case ID', 'Pause Start Time', 'Pause End Time');
  const openEscalations = getOpenLogs_(ss, CONFIG.PRODUCTION.SHEETS.ESCALATION_LOGS, 'Related Case ID', 'Escalation Start Time', 'Escalation End Time');

  const headers = rawData.headers;
  const caseIdHeader = 'Main Task ID';
  const ignoredHeaders = ['Pause Time', 'Pause End Time', 'Escalated Start Time', 'Escalated End Time'];
  const userEmail = (filter === 'my') ? Session.getActiveUser().getEmail() : null;

  const records = rawData.data.map(row => {
    let record = {};
    headers.forEach((header, i) => { if (!ignoredHeaders.includes(header)) { record[header] = row[i]; } });
    const caseId = record[caseIdHeader];
    if (caseId) {
      if (openPauses.has(caseId)) { record['Pause Start Time'] = openPauses.get(caseId); record['Paused End Time'] = ''; }
      if (openEscalations.has(caseId)) { record['Escalated Start Time'] = openEscalations.get(caseId); record['Escalated End Time'] = ''; }
    }
    return record;
  });

  // Perform filtering
  const filteredRecords = records.filter(record => {
    if (status !== 'All') {
      const hasOpenPause = record['Pause Start Time'] && !record['Paused End Time'];
      const hasOpenEscalation = record['Escalated Start Time'] && !record['Escalated End Time'];
      let effectiveStatus = record.Status;
      if (hasOpenPause) effectiveStatus = 'Task Paused';
      else if (hasOpenEscalation) effectiveStatus = 'Escalated';
      if (effectiveStatus !== status) return false;
    }
    if (country && record.Country !== country) return false;
    if (userEmail && (!record.Useremail || record.Useremail.toLowerCase() !== userEmail.toLowerCase())) return false;
    if (searchTerm) {
      const lowerCaseSearchTerm = searchTerm.toLowerCase();
      const searchableHeaders = ['Main Task ID', 'Country', 'Account Name', 'Case Title', 'Category', 'Provider Id', 'Useremail'];
      if (!searchableHeaders.some(h => record[h] && String(record[h]).toLowerCase().includes(lowerCaseSearchTerm))) return false;
    }
    return true;
  });

  // Sort and paginate
  filteredRecords.sort((a, b) => new Date(b['Menu Request Sent Date'] || 0) - new Date(a['Menu Request Sent Date'] || 0));
  const paginatedRecords = filteredRecords.slice(offset, offset + limit);

  // Serialize final output for the client, using the new helper
  return paginatedRecords.map(record => serializeCaseData_(record));
}

/**
 * Updates a specific case in the AvailableCases sheet.
 * Applies specific number formatting for dates and durations.
 */
function updateCaseData(caseId, updatedData) {
  try {
    if (!caseId || !updatedData) {
      throw new Error("Case ID or update data is missing.");
    }

    const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
    const sheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
    if (!sheet) throw new Error(`Sheet '${CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES}' not found.`);

    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    const headers = values.shift();
    const caseIdColumnIndex = headers.indexOf('Main Task ID');

    if (caseIdColumnIndex === -1) {
      throw new Error("'Main Task ID' column not found.");
    }

    let rowNumberToUpdate = -1;
    for (let i = 0; i < values.length; i++) {
      if (values[i][caseIdColumnIndex] == caseId) {
        rowNumberToUpdate = i + 2; // +1 for header offset, +1 for 1-based indexing
        break;
      }
    }

    if (rowNumberToUpdate === -1) {
      throw new Error(`Case with ID '${caseId}' not found.`);
    }

    for (const header of Object.keys(updatedData)) {
      const colIndex = headers.indexOf(header);
      if (colIndex !== -1) {
        let value = updatedData[header];
        const cell = sheet.getRange(rowNumberToUpdate, colIndex + 1);

        if (isDateTimeField_(header) && value) {
          cell.setValue(new Date(value)).setNumberFormat("MM-dd-yyyy HH:mm:ss");
        } else if (isDurationField_(header)) {
          const totalSeconds = parseFloat(value) || 0;
          // Convert total seconds to Google Sheet's fraction-of-a-day format for durations
          const sheetDuration = totalSeconds > 0 ? totalSeconds / 86400 : 0;
          cell.setValue(sheetDuration).setNumberFormat("[h]:mm:ss.SSS");
        } else {
          cell.setValue(value);
        }
      }
    }

    SpreadsheetApp.flush(); // Force all pending changes to be written immediately.
    invalidateCasesCache();
    return `Case ${caseId} updated successfully.`;

  } catch (e) {
    Logger.log("Error in updateCaseData: " + e.toString() + " Stack: " + e.stack);
    throw new Error("Failed to update case. " + e.message);
  }
}

/**
 * Fetches all related log entries for a given Case ID from multiple log sheets.
 * @param {string} caseId The Main Task ID to search for.
 * @returns {object} An object containing arrays of logs for each type.
 */
function getLogsForCase(caseId) {
  if (!caseId) {
    return { escalationLogs: [], pausingLogs: [], cooperationLogs: [] };
  }

  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);

    // Helper function to reduce redundant code
    const fetchLogData = (sheetName, ...relatedIdColumnNames) => {
        const sheet = ss.getSheetByName(sheetName);
        if (!sheet || sheet.getLastRow() < 2) return [];

        const data = sheet.getDataRange().getValues();
        const headers = data.shift();
        let relatedIdIndex = -1;

        // Find the first matching column name
        for (const colName of relatedIdColumnNames) {
            relatedIdIndex = headers.indexOf(colName);
            if (relatedIdIndex !== -1) break;
        }

        if (relatedIdIndex === -1) {
            Logger.log(`Warning: None of the potential related ID columns (${relatedIdColumnNames.join(", ")}) were found in sheet "${sheetName}".`);
            return [];
        }

        const logs = [];
        data.forEach(row => {
            if (String(row[relatedIdIndex]).trim() === String(caseId).trim()) {
                let record = {};
                headers.forEach((header, i) => {
                    record[header] = row[i] instanceof Date ? row[i].toISOString() : row[i];
                });
                logs.push(record);
            }
        });
        return logs;
    };

    // Use the flexible helper function with multiple possible column names
    const escalationLogs = fetchLogData(CONFIG.PRODUCTION.SHEETS.ESCALATION_LOGS, "Related Case ID", "Main Task ID", "Case ID");
    const pausingLogs = fetchLogData(CONFIG.PRODUCTION.SHEETS.PAUSING_LOGS, "Related Case ID", "Main Task ID", "Case ID");
    const cooperationLogs = fetchLogData(CONFIG.PRODUCTION.SHEETS.COOPERATION_LOGS, "Related Case ID", "Main Task ID", "Case ID");

    return {
      escalationLogs: escalationLogs,
      pausingLogs: pausingLogs,
      cooperationLogs: cooperationLogs
    };

  } catch(e) {
    Logger.log(`Error in getLogsForCase for ID ${caseId}: ${e.toString()}`);
    return { error: e.message };
  }
}

/**
 * Updates a single log entry in a specified log sheet.
 * @param {string} logId The unique ID of the log entry to update.
 * @param {string} sheetName The name of the sheet to update (e.g., "Escalation Logs").
 * @param {string} primaryKeyColumnName The name of the primary key column (e.g., "Log ID").
 * @param {object} updatedData The object of key-value pairs to update.
 * @returns {string} A success message.
 */
function updateLogData(logId, sheetName, primaryKeyColumnName, updatedData) {
  try {
    if (!logId || !sheetName || !primaryKeyColumnName || !updatedData) {
      throw new Error("Required parameters are missing for updating log data.");
    }

    const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error(`Sheet "${sheetName}" not found.`);

    const data = sheet.getDataRange().getValues();
    const headers = data.shift();
    const pkIndex = headers.indexOf(primaryKeyColumnName);

    if (pkIndex === -1) {
      throw new Error(`Primary key column "${primaryKeyColumnName}" not found in sheet "${sheetName}".`);
    }

    let rowIndexToUpdate = -1;
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][pkIndex]).trim() === String(logId).trim()) {
        rowIndexToUpdate = i + 2; // +1 for header offset, +1 for 1-based indexing
        break;
      }
    }

    if (rowIndexToUpdate === -1) {
      throw new Error(`Log entry with ID '${logId}' not found in "${sheetName}".`);
    }

    // Update each cell specified in the updatedData object
    for (const header of Object.keys(updatedData)) {
      const colIndex = headers.indexOf(header);
      if (colIndex !== -1) {
        let value = updatedData[header];
        // If the value is a date string, convert it back to a Date object
        if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
           value = new Date(value);
        }
        sheet.getRange(rowIndexToUpdate, colIndex + 1).setValue(value);
      }
    }

    SpreadsheetApp.flush(); // Force all pending changes to be written immediately.
    invalidateCasesCache();
    return `Log ${logId} in ${sheetName} updated successfully.`;

  } catch (e) {
    Logger.log(`Error in updateLogData: ${e.toString()}`);
    throw new Error(`Failed to update log: ${e.message}`);
  }
}


/**
 * Creates a new Google Sheet with a custom name, specific columns, and formatting.
 * @param {Array<Object>} data An array of objects representing the full data.
 * @param {Array<string>} headers The specific column headers to be exported.
 * @param {string} fileName The desired name for the new spreadsheet.
 * @returns {string} The URL of the newly created spreadsheet.
 */
function manuallyInvalidateCache() {
  try {
    invalidateCasesCache();
    return "Cache has been successfully cleared. All users will see fresh data on their next page load.";
  } catch (e) {
    Logger.log('Manual cache invalidation failed: ' + e.toString());
    throw new Error("Failed to clear the cache. " + e.message);
  }
}

function invalidateCasesCache() {
  try {
    const cache = CacheService.getScriptCache();
    const versionKey = 'cache_version';
    let currentVersion = cache.get(versionKey);
    if (!currentVersion) {
      currentVersion = 1;
    } else {
      currentVersion = parseInt(currentVersion, 10) + 1;
    }
    // Set a long expiration for the version itself.
    cache.put(versionKey, currentVersion.toString(), 21600); // 6 hours
    Logger.log('Cache invalidated. New version: ' + currentVersion);
    return currentVersion;
  } catch (e) {
    Logger.log('Could not invalidate cache: ' + e.toString());
  }
}

function createSheetWithData(data, headers, fileName) {
  if (!data || !Array.isArray(data) || data.length === 0) {
    throw new Error("No data provided to create the sheet.");
  }
  if (!headers || !Array.isArray(headers) || headers.length === 0) {
    throw new Error("No column headers were specified for the export.");
  }

  try {
    // THIS LINE IS MODIFIED - It now uses the filename from the browser, with a fallback.
    const spreadsheetName = fileName || `Drill-down Export - ${new Date().toLocaleString()}`;

    const newSs = SpreadsheetApp.create(spreadsheetName);
    const sheet = newSs.getSheets()[0];
    sheet.setName("Exported Data");

    const rows = data.map(obj => headers.map(header => obj[header]));
    const outputData = [headers, ...rows];

    sheet.getRange(1, 1, outputData.length, headers.length).setValues(outputData);

    const durationColIndex = headers.indexOf('Stored Agent Handling Time');
    if (durationColIndex !== -1) {
      const durationRange = sheet.getRange(2, durationColIndex + 1, sheet.getLastRow() - 1, 1);
      durationRange.setNumberFormat("[h]:mm:ss");
    }

    headers.forEach((_, i) => {
      sheet.autoResizeColumn(i + 1);
    });

    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");

    return newSs.getUrl();

  } catch (e) {
    Logger.log(`Error in createSheetWithData: ${e.toString()}`);
    throw new Error("Failed to create the spreadsheet. " + e.message);
  }
}

// =================================================================================
// --- CASE ACTION FUNCTIONS ---
// =================================================================================

function updateCaseStatus(caseId, newStatus) {
    try {
        if (!caseId || !newStatus) {
            throw new Error("Case ID or new status is missing.");
        }

        const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
        const sheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
        if (!sheet) throw new Error("AvailableCases sheet not found.");

        const dataRange = sheet.getDataRange();
        const values = dataRange.getValues();
        const headers = values.shift();
        const caseIdColumnIndex = headers.indexOf('Main Task ID');
        const statusColumnIndex = headers.indexOf('Status');

        if (caseIdColumnIndex === -1) throw new Error("'Main Task ID' column not found.");
        if (statusColumnIndex === -1) throw new Error("'Status' column not found.");

        let rowNumberToUpdate = -1;
        for (let i = 0; i < values.length; i++) {
            if (values[i][caseIdColumnIndex] == caseId) {
                rowNumberToUpdate = i + 2; // +1 for header offset, +1 for 1-based indexing
                break;
            }
        }

        if (rowNumberToUpdate === -1) throw new Error(`Case with ID '${caseId}' not found.`);

        sheet.getRange(rowNumberToUpdate, statusColumnIndex + 1).setValue(newStatus);
        return `Case ${caseId}: Status updated successfully to ${newStatus}.`;

    } catch (e) {
        Logger.log(`Error in updateCaseStatus: ${e.toString()}`);
        throw new Error(`Failed to update status. ${e.message}`);
    }
}

function updateCaseField(caseId, fieldName, value) {
    try {
        if (!caseId || !fieldName) {
            throw new Error("Case ID or field name is missing.");
        }

        const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
        const sheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
        if (!sheet) throw new Error("AvailableCases sheet not found.");

        const dataRange = sheet.getDataRange();
        const values = dataRange.getValues();
        const headers = values.shift();
        const caseIdColumnIndex = headers.indexOf('Main Task ID');
        const fieldColumnIndex = headers.indexOf(fieldName);

        if (caseIdColumnIndex === -1) throw new Error("'Main Task ID' column not found.");
        if (fieldColumnIndex === -1) throw new Error(`'${fieldName}' column not found.`);

        let rowNumberToUpdate = -1;
        for (let i = 0; i < values.length; i++) {
            if (values[i][caseIdColumnIndex] == caseId) {
                rowNumberToUpdate = i + 2; // +1 for header offset, +1 for 1-based indexing
                break;
            }
        }

        if (rowNumberToUpdate === -1) throw new Error(`Case with ID '${caseId}' not found.`);

        sheet.getRange(rowNumberToUpdate, fieldColumnIndex + 1).setValue(value);
        return `Case ${caseId}: ${fieldName} updated successfully.`;

    } catch (e) {
        Logger.log(`Error in updateCaseField: ${e.toString()}`);
        throw new Error(`Failed to update ${fieldName}. ${e.message}`);
    }
}

function createNewLogEntry(sheetName, logData) {
    try {
        if (!sheetName || !logData) {
            throw new Error("Sheet name or log data is missing.");
        }
        const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
        const sheet = ss.getSheetByName(sheetName);
        if (!sheet) throw new Error(`Sheet "${sheetName}" not found.`);

        const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        const newRow = headers.map(header => logData[header] || null);

        sheet.appendRow(newRow);
        invalidateCasesCache();
        return `New log entry created in ${sheetName}.`;
    } catch (e) {
        Logger.log(`Error in createNewLogEntry: ${e.toString()}`);
        throw new Error(`Failed to create log entry. ${e.message}`);
    }
}

function endOpenLogEntry(sheetName, caseId, endColName, relatedIdColName) {
    try {
        const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
        const sheet = ss.getSheetByName(sheetName);
        if (!sheet) throw new Error(`Sheet "${sheetName}" not found.`);

        const data = sheet.getDataRange().getValues();
        const headers = data.shift();
        const idIndex = headers.indexOf(relatedIdColName);
        const endIndex = headers.indexOf(endColName);

        if (idIndex === -1 || endIndex === -1) {
            throw new Error(`Required columns not found in "${sheetName}". Check sheet configuration.`);
        }

        // Iterate backwards to find the most recent open log for the case
        for (let i = data.length - 1; i >= 0; i--) {
            const row = data[i];
            if (String(row[idIndex]).trim() === String(caseId).trim() && !row[endIndex]) {
                sheet.getRange(i + 2, endIndex + 1).setValue(new Date());
                invalidateCasesCache();
                return `Log entry for case ${caseId} in ${sheetName} has been closed.`;
            }
        }
        throw new Error(`No open log entry found for case ${caseId} in ${sheetName}.`);

    } catch (e) {
        Logger.log(`Error in endOpenLogEntry: ${e.toString()}`);
        throw new Error(`Failed to end log entry. ${e.message}`);
    }
}


function claimCase(caseId) {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
    const sheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
    if (!sheet) throw new Error(`Sheet '${CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES}' not found.`);

    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    const headers = values[0]; // Keep header row for indices
    const caseIdColumnIndex = headers.indexOf('Main Task ID');
    const userEmailColumnIndex = headers.indexOf('Useremail');

    if (caseIdColumnIndex === -1) throw new Error("'Main Task ID' column not found.");
    if (userEmailColumnIndex === -1) throw new Error("'Useremail' column not found.");

    let caseRow = null;
    for (let i = 1; i < values.length; i++) { // Start from 1 to skip header
        if (values[i][caseIdColumnIndex] == caseId) {
            caseRow = values[i];
            break;
        }
    }

    if (!caseRow) {
        throw new Error(`Case with ID '${caseId}' not found.`);
    }

    const existingUser = caseRow[userEmailColumnIndex];
    if (existingUser) {
        throw new Error("Ups, Someone was faster than you and already claimed this case, please refresh the Case Box.");
    }

    const userEmail = Session.getActiveUser().getEmail();
    updateCaseField(caseId, 'Useremail', userEmail);
    return updateCaseStatus(caseId, 'In Progress');
}

function pauseCase(caseId) {
    const userEmail = Session.getActiveUser().getEmail();
    const logData = {
        'ID': `${caseId}_${new Date().getTime()}`,
        'Related Case ID': caseId,
        'Pause Start Time': new Date(),
        'User Email': userEmail
    };
    createNewLogEntry(CONFIG.PRODUCTION.SHEETS.PAUSING_LOGS, logData);
    return updateCaseStatus(caseId, 'Task Paused');
}

function unpauseCase(caseId) {
    try {
        const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
        const logSheetName = CONFIG.PRODUCTION.SHEETS.PAUSING_LOGS;
        const mainSheetName = CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES;

        // --- DURATION CALCULATION ---
        const logSheet = ss.getSheetByName(logSheetName);
        if (!logSheet) throw new Error(`Sheet "${logSheetName}" not found.`);

        const logRange = logSheet.getDataRange();
        const logValues = logRange.getValues();
        const logHeaders = logValues[0];

        const logIdIndex = logHeaders.indexOf('Related Case ID');
        const logStartIndex = logHeaders.indexOf('Pause Start Time');
        const logEndIndex = logHeaders.indexOf('Pause End Time');

        if (logIdIndex === -1 || logStartIndex === -1 || logEndIndex === -1) {
            throw new Error(`Required columns not found in pausing logs.`);
        }

        let pauseStartTime = null;
        for (let i = logValues.length - 1; i >= 1; i--) {
            const row = logValues[i];
            if (String(row[logIdIndex]).trim() === String(caseId).trim() && row[logStartIndex] && !row[logEndIndex]) {
                pauseStartTime = new Date(row[logStartIndex]);
                break;
            }
        }

        if (pauseStartTime) {
            const endTime = new Date();
            const durationSeconds = (endTime.getTime() - pauseStartTime.getTime()) / 1000;

            const mainSheet = ss.getSheetByName(mainSheetName);
            if (!mainSheet) throw new Error(`Sheet "${mainSheetName}" not found.`);
            const mainRange = mainSheet.getDataRange();
            const mainValues = mainRange.getValues();
            const mainHeaders = mainValues[0];

            const mainCaseIdIndex = mainHeaders.indexOf('Main Task ID');
            const storedDurationIndex = mainHeaders.indexOf('Stored Pause Duration');

            if (mainCaseIdIndex === -1 || storedDurationIndex === -1) {
                throw new Error("Required columns not found in Main Tasks sheet.");
            }

            for (let i = 1; i < mainValues.length; i++) {
                if (String(mainValues[i][mainCaseIdIndex]).trim() === String(caseId).trim()) {
                    const existingDurationValue = mainValues[i][storedDurationIndex];
                    const existingDurationSeconds = (parseFloat(existingDurationValue) || 0) * 86400;
                    const newTotalSeconds = existingDurationSeconds + durationSeconds;
                    const newTotalSheetDuration = newTotalSeconds > 0 ? newTotalSeconds / 86400 : 0;

                    mainSheet.getRange(i + 1, storedDurationIndex + 1).setValue(newTotalSheetDuration).setNumberFormat("[h]:mm:ss.SSS");
                    break;
                }
            }
        }
        // --- END DURATION CALCULATION ---

        endOpenLogEntry(logSheetName, caseId, 'Pause End Time', 'Related Case ID');
        return updateCaseStatus(caseId, 'In Progress');

    } catch (e) {
        Logger.log(`Error in unpauseCase for ${caseId}: ${e.toString()}`);
        throw e;
    }
}

function escalateCase(caseId) {
    const userEmail = Session.getActiveUser().getEmail();
    const logData = {
        'Log ID': `${caseId}_${new Date().getTime()}`,
        'Related Case ID': caseId,
        'Escalation Start Time': new Date(),
        'User Email': userEmail
    };
    createNewLogEntry(CONFIG.PRODUCTION.SHEETS.ESCALATION_LOGS, logData);
    return updateCaseStatus(caseId, 'Escalated');
}

function deEscalateCase(caseId) {
    try {
        const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
        const logSheetName = CONFIG.PRODUCTION.SHEETS.ESCALATION_LOGS;
        const mainSheetName = CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES;

        // --- DURATION CALCULATION ---
        const logSheet = ss.getSheetByName(logSheetName);
        if (!logSheet) throw new Error(`Sheet "${logSheetName}" not found.`);

        const logRange = logSheet.getDataRange();
        const logValues = logRange.getValues();
        const logHeaders = logValues[0]; // Keep header row intact for index lookup

        const logIdIndex = logHeaders.indexOf('Related Case ID');
        const logStartIndex = logHeaders.indexOf('Escalation Start Time');
        const logEndIndex = logHeaders.indexOf('Escalation End Time');

        if (logIdIndex === -1 || logStartIndex === -1 || logEndIndex === -1) {
            throw new Error(`Required columns not found in escalation logs.`);
        }

        let escalationStartTime = null;
        // Iterate backwards from the last data row to find the open log
        for (let i = logValues.length - 1; i >= 1; i--) {
            const row = logValues[i];
            if (String(row[logIdIndex]).trim() === String(caseId).trim() && row[logStartIndex] && !row[logEndIndex]) {
                escalationStartTime = new Date(row[logStartIndex]);
                break;
            }
        }

        if (escalationStartTime) {
            const endTime = new Date();
            const durationSeconds = (endTime.getTime() - escalationStartTime.getTime()) / 1000;

            const mainSheet = ss.getSheetByName(mainSheetName);
            if (!mainSheet) throw new Error(`Sheet "${mainSheetName}" not found.`);
            const mainRange = mainSheet.getDataRange();
            const mainValues = mainRange.getValues();
            const mainHeaders = mainValues[0];

            const mainCaseIdIndex = mainHeaders.indexOf('Main Task ID');
            const storedDurationIndex = mainHeaders.indexOf('Stored Escalation Duration');

            if (mainCaseIdIndex === -1 || storedDurationIndex === -1) {
                throw new Error("Required columns not found in Main Tasks sheet.");
            }

            for (let i = 1; i < mainValues.length; i++) {
                if (String(mainValues[i][mainCaseIdIndex]).trim() === String(caseId).trim()) {
                    const existingDurationValue = mainValues[i][storedDurationIndex];
                    const existingDurationSeconds = (parseFloat(existingDurationValue) || 0) * 86400;
                    const newTotalSeconds = existingDurationSeconds + durationSeconds;
                    const newTotalSheetDuration = newTotalSeconds > 0 ? newTotalSeconds / 86400 : 0;

                    // Update the cell; row index is i + 1 because sheets are 1-indexed
                    mainSheet.getRange(i + 1, storedDurationIndex + 1).setValue(newTotalSheetDuration).setNumberFormat("[h]:mm:ss.SSS");
                    break;
                }
            }
        }
        // --- END DURATION CALCULATION ---

        // This function will close the log entry we just read.
        endOpenLogEntry(logSheetName, caseId, 'Escalation End Time', 'Related Case ID');

        // And finally, update the status.
        return updateCaseStatus(caseId, 'In Progress');

    } catch (e) {
        Logger.log(`Error in deEscalateCase for ${caseId}: ${e.toString()}`);
        throw e; // Re-throw the error to the client
    }
}

function endCase(caseId) {
    try {
        // Use the robust, centralized calculation function to get correct numbers.
        const correctTimes = calculateCorrectedHandlingTime_(caseId);

        // This function calculates individual sums without merging overlaps.
        // This is for storing representative (though potentially overlapping) values in the sheet.
        const logs = getLogsForCase(caseId);
        let totalPauseSeconds = 0;
        logs.pausingLogs.forEach(log => {
            const start = new Date(log['Pause Start Time']);
            const end = new Date(log['Pause End Time']);
            if (start && end && end > start) totalPauseSeconds += (end - start) / 1000;
        });
        let totalEscalationSeconds = 0;
        logs.escalationLogs.forEach(log => {
            const start = new Date(log['Escalation Start Time']);
            const end = new Date(log['Escalation End Time']);
            if (start && end && end > start) totalEscalationSeconds += (end - start) / 1000;
        });

        const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
        const sheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
        if (!sheet) throw new Error(`Sheet '${CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES}' not found.`);

        const data = sheet.getDataRange().getValues();
        const headers = data.shift();
        const caseIdCol = headers.indexOf('Main Task ID');
        const endTimeCol = headers.indexOf('Main Task End Date/Time');
        const storedPauseCol = headers.indexOf('Stored Pause Duration');
        const storedEscalationCol = headers.indexOf('Stored Escalation Duration');
        const storedAHTCol = headers.indexOf('Stored Agent Handling Time');
        const statusCol = headers.indexOf('Status');

        let rowNumberToUpdate = -1;
        for (let i = 0; i < data.length; i++) {
            if (data[i][caseIdCol] == caseId) {
                rowNumberToUpdate = i + 2;
                break;
            }
        }
        if (rowNumberToUpdate === -1) throw new Error(`Case ID '${caseId}' not found.`);

        const mainTaskEndTime = new Date();
        const storedPause = totalPauseSeconds > 0 ? totalPauseSeconds / 86400 : 0;
        const storedEscalation = totalEscalationSeconds > 0 ? totalEscalationSeconds / 86400 : 0;
        const storedAHT = correctTimes.newAHTSeconds > 0 ? correctTimes.newAHTSeconds / 86400 : 0;

        sheet.getRange(rowNumberToUpdate, storedPauseCol + 1).setValue(storedPause).setNumberFormat("[h]:mm:ss.SSS");
        sheet.getRange(rowNumberToUpdate, storedEscalationCol + 1).setValue(storedEscalation).setNumberFormat("[h]:mm:ss.SSS");
        sheet.getRange(rowNumberToUpdate, storedAHTCol + 1).setValue(storedAHT).setNumberFormat("[h]:mm:ss.SSS");
        sheet.getRange(rowNumberToUpdate, endTimeCol + 1).setValue(mainTaskEndTime).setNumberFormat("MM-dd-yyyy HH:mm:ss");
        sheet.getRange(rowNumberToUpdate, statusCol + 1).setValue('Completed');

        invalidateCasesCache();
        return `Case ${caseId} marked as 'Completed' and durations calculated.`;
    } catch (e) {
        Logger.log(`Error in endCase for ${caseId}: ${e.toString()}`);
        throw e;
    }
}

/**
 * A server-side helper to check if a field name indicates a date/time.
 * @param {string} fieldName The name of the field.
 * @returns {boolean} True if it's a date/time field.
 */
function isDateTimeField_(fieldName) {
    const lower = fieldName.toLowerCase();
    // A field is a date/time field if it contains 'date' or 'time', but is NOT a duration field.
    return (lower.includes('date') || lower.includes('time')) && !isDurationField_(fieldName);
}

/**
 * A server-side helper to check if a field name indicates a duration.
 * @param {string} fieldName The name of the field.
 * @returns {boolean} True if it's a duration field.
 */
function isDurationField_(fieldName) {
    const lower = fieldName.toLowerCase();
    return lower.includes('duration') || lower.includes('agent handling time');
}

/**
 * Serializes a case data object, converting dates to ISO strings and
 * correctly handling duration fields that might be misinterpreted as dates.
 * @param {object} dataObject The object to serialize.
 * @returns {object} The serialized object.
 */
function serializeCaseData_(dataObject) {
    if (!dataObject) return null;
    const serialized = {};

    for (const key in dataObject) {
        let value = dataObject[key];
        if (isDurationField_(key)) {
            let totalSeconds = 0;
            if (value instanceof Date) {
                // This handles durations misinterpreted as dates.
                // It correctly calculates total seconds from the epoch, accounting for >24h durations.
                const timeValue = value.getTime() - SPREADSHEET_EPOCH_OFFSET_MS;
                totalSeconds = Math.round(timeValue / 1000);
            } else if (typeof value === 'number') {
                 // Always assume a raw number in a duration field is a fraction of a day.
                totalSeconds = Math.round(value * 86400);
            }
            value = totalSeconds;
        } else if (value instanceof Date) {
            value = value.toISOString();
        }
        serialized[key] = value;
    }
    return serialized;
}

function getCaseDetailsById(caseId) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
    const sheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
    if (!sheet) throw new Error(`Sheet '${CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES}' not found.`);

    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    const headers = values.shift();
    const caseIdColumnIndex = headers.indexOf('Main Task ID');

    if (caseIdColumnIndex === -1) {
      throw new Error("'Main Task ID' column not found.");
    }

    let caseData = null;
    for (let i = 0; i < values.length; i++) {
      if (values[i][caseIdColumnIndex] == caseId) {
        caseData = {};
        headers.forEach((header, index) => {
          caseData[header] = values[i][index];
        });
        break;
      }
    }

    if (!caseData) {
      throw new Error(`Case with ID '${caseId}' not found.`);
    }

    // --- SERIALIZATION STEP ---
    const serializedCaseData = serializeCaseData_(caseData);

    const logs = getLogsForCase(caseId);
    if (logs.error) {
      throw new Error(logs.error);
    }

    // Also serialize the logs
    serializedCaseData.escalationLogs = logs.escalationLogs.map(log => serializeCaseData_(log));
    serializedCaseData.pausingLogs = logs.pausingLogs.map(log => serializeCaseData_(log));
    serializedCaseData.cooperationLogs = logs.cooperationLogs.map(log => serializeCaseData_(log));

    return serializedCaseData;
  } catch (e) {
    Logger.log(`Error in getCaseDetailsById for ${caseId}: ${e.toString()}`);
    throw e;
  }
}

/**
 * A reusable helper function to get a map of open logs from a specified log sheet.
 * @param {Spreadsheet} ss The spreadsheet object.
 * @param {string} sheetName The name of the log sheet.
 * @param {string} relatedIdCol The name of the column containing the related case ID.
 * @param {string} startCol The name of the start time column.
 * @param {string} endCol The name of the end time column.
 * @returns {Map<string, Date>} A map where keys are case IDs and values are start times.
 */
function getOpenLogs_(ss, sheetName, relatedIdCol, startCol, endCol) {
  const openLogs = new Map();
  const logSheet = ss.getSheetByName(sheetName);
  if (!logSheet) {
    Logger.log(`Warning: Log sheet "${sheetName}" not found.`);
    return openLogs;
  }
  const logData = logSheet.getDataRange().getValues();
  const headers = logData.shift();
  const idIndex = headers.indexOf(relatedIdCol);
  const startIndex = headers.indexOf(startCol);
  const endIndex = headers.indexOf(endCol);

  if ([idIndex, startIndex, endIndex].includes(-1)) {
    Logger.log(`Warning: Required columns not found in "${sheetName}".`);
    return openLogs;
  }

  logData.forEach(row => {
    const caseId = row[idIndex];
    const startTime = row[startIndex];
    const endTime = row[endIndex];
    if (caseId && startTime && !endTime) {
      openLogs.set(String(caseId).trim(), startTime);
    }
  });
  return openLogs;
}

function addUserAccess(email) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const sheet = ss.getSheetByName('BackupSystemAccess');
    if (!sheet) {
      throw new Error("Sheet 'BackupSystemAccess' not found.");
    }
    sheet.appendRow([email]);
    return `User ${email} added successfully.`;
  } catch (e) {
    Logger.log("Error in addUserAccess: " + e.toString());
    throw new Error("Failed to add user. " + e.message);
  }
}

function getAuthorizedUsers() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const sheet = ss.getSheetByName('BackupSystemAccess');
    if (!sheet || sheet.getLastRow() < 2) {
      return [];
    }
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    return data.flat().filter(Boolean);
  } catch (e) {
    Logger.log("Error in getAuthorizedUsers: " + e.toString());
    return [];
  }
}

function removeUserAccess(email) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const sheet = ss.getSheetByName('BackupSystemAccess');
    if (!sheet) {
      throw new Error("Sheet 'BackupSystemAccess' not found.");
    }
    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i][0] === email) {
        sheet.deleteRow(i + 1);
      }
    }
    return `User ${email} removed successfully.`;
  } catch (e) {
    Logger.log("Error in removeUserAccess: " + e.toString());
    throw new Error("Failed to remove user. " + e.message);
  }
}

function checkUserCaseAccess() {
  try {
    const userEmail = Session.getActiveUser().getEmail();
    const authorizedUsers = getAuthorizedUsers();
    return authorizedUsers.includes(userEmail);
  } catch (e) {
    Logger.log("Error in checkUserCaseAccess: " + e.toString());
    return false;
  }
}

function sendDebugEmail() {
  const recipient = "andre.homem@cognizant.com";
  const subject = "testing email function";
  const body = "testing email function";
  MailApp.sendEmail(recipient, subject, body);
}

function sendMonthlyPerformanceReport() {
  // This function will generate and email the automated performance summary.

  // --- 1. DEFINE DATE RANGE ---
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  // Helper function to format dates as YYYY-MM-DD strings
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const startDateStr = formatDate(startOfMonth);
  const endDateStr = formatDate(today);

  // --- 2. AGGREGATE DATA ---
  try {
    // a. Get Leaderboard Data
    const leaderboardData = getLeaderboardData(startDateStr, endDateStr);

    // b. Get Production Report Data
    const productionFilters = {
      startDateStr: startDateStr,
      endDateStr: endDateStr,
      // Pass empty arrays for other filters to get all data
      selectedStatus: [],
      selectedMarket: [],
      selectedCategory: [],
      selectedTaskType: [],
      selectedRetailerType: [],
      selectedSlaReason: []
    };
    const productionReport = getProductionReport(productionFilters);
    const productionSummary = productionReport.summary; // We need the summary part

    // For now, I'll log the data to confirm it's being fetched.
    Logger.log("Leaderboard Data:", leaderboardData.length, "entries");
    Logger.log("Production Summary Total Cases:", productionSummary.totalCounts.GrandTotal);

    // --- 3. CREATE DYNAMIC CHARTS AS IMAGES ---
    const imageBlobs = {};

    // a. Market Share Chart (Pie Chart)
    const marketData = Charts.newDataTable()
      .addColumn(Charts.ColumnType.STRING, "Market")
      .addColumn(Charts.ColumnType.NUMBER, "Count");
    for (const market in productionSummary.marketCounts) {
      const total = Object.values(productionSummary.marketCounts[market]).reduce((a, b) => a + b, 0);
      marketData.addRow([market, total]);
    }
    const marketChart = Charts.newPieChart()
      .setDataTable(marketData)
      .setOption('title', 'Task Distribution by Market')
      .setOption('pieHole', 0.4)
      .setOption('width', 500)
      .setOption('height', 350)
      .build();
    imageBlobs['marketChart'] = marketChart.getAs('image/png');


    // b. TAT Adherence Chart (Bar Chart)
    const tatData = Charts.newDataTable()
      .addColumn(Charts.ColumnType.STRING, 'Market')
      .addColumn(Charts.ColumnType.NUMBER, 'Adhered')
      .addColumn(Charts.ColumnType.NUMBER, 'Missed');
    for (const market in productionSummary.tatCounts) {
      tatData.addRow([market, productionSummary.tatCounts[market].adhered || 0, productionSummary.tatCounts[market].missed || 0]);
    }
    const tatChart = Charts.newBarChart()
      .setDataTable(tatData)
      .setOption('title', 'TAT Adherence by Market')
      .setOption('isStacked', 'percent')
      .setOption('width', 500)
      .setOption('height', 350)
      .setOption('hAxis', { format: 'percent' })
      .build();
    imageBlobs['tatChart'] = tatChart.getAs('image/png');

    // c. AHT by Category Chart (Bar Chart)
    const ahtByCategoryData = Charts.newDataTable()
      .addColumn(Charts.ColumnType.STRING, 'Category')
      .addColumn(Charts.ColumnType.NUMBER, 'Average Handling Time (Minutes)');
    for (const category in productionSummary.ahtByCategory.categoryData) {
        const ahtInMinutes = (productionSummary.ahtByCategory.categoryData[category] || 0) / 60;
        ahtByCategoryData.addRow([category, ahtInMinutes]);
    }
    const ahtByCategoryChart = Charts.newColumnChart()
        .setDataTable(ahtByCategoryData)
        .setOption('title', 'Average Handling Time by Category')
        .setOption('width', 500)
        .setOption('height', 350)
        .setOption('vAxis', { title: 'Time (Minutes)' })
        .build();
    imageBlobs['ahtByCategoryChart'] = ahtByCategoryChart.getAs('image/png');

    // d. Leaderboard Chart (Bar Chart)
    const leaderboardChartData = Charts.newDataTable()
        .addColumn(Charts.ColumnType.STRING, 'Agent')
        .addColumn(Charts.ColumnType.NUMBER, 'Cases Completed');
    leaderboardData.slice(0, 10).forEach(agent => { // Top 10 agents
        leaderboardChartData.addRow([agent.agentName, agent.totalCases]);
    });
    const leaderboardChart = Charts.newBarChart()
        .setDataTable(leaderboardChartData)
        .setOption('title', 'Top 10 Agents by Cases Completed')
        .setOption('width', 500)
        .setOption('height', 350)
        .build();
    imageBlobs['leaderboardChart'] = leaderboardChart.getAs('image/png');

    // e. TAT Bucket Chart (Bar Chart)
    const tatBucketData = Charts.newDataTable()
        .addColumn(Charts.ColumnType.STRING, 'Bucket')
        .addColumn(Charts.ColumnType.NUMBER, 'Count');
    const tatBucketTotal = productionSummary.tatBucket.grandTotal;
    tatBucketData.addRow(['<24 hours', tatBucketTotal.under24 || 0]);
    tatBucketData.addRow(['24-30 hours', tatBucketTotal.between24and30 || 0]);
    tatBucketData.addRow(['30-48 hours', tatBucketTotal.between30and48 || 0]);
    tatBucketData.addRow(['>48 hours', tatBucketTotal.over48 || 0]);
    const tatBucketChart = Charts.newColumnChart()
        .setDataTable(tatBucketData)
        .setOption('title', 'TAT Bucket Distribution (All Markets)')
        .setOption('width', 500)
        .setOption('height', 350)
        .build();
    imageBlobs['tatBucketChart'] = tatBucketChart.getAs('image/png');

    // f. Menu Complexity Chart (Bar Chart)
    const menuComplexityData = Charts.newDataTable()
        .addColumn(Charts.ColumnType.STRING, 'Metric')
        .addColumn(Charts.ColumnType.NUMBER, 'Average');
    const menuComplexityTotal = productionSummary.menuComplexity.grandTotal;
    menuComplexityData.addRow(['Avg. Dishes', parseFloat((menuComplexityTotal.avgTotalDishes || 0).toFixed(1))]);
    menuComplexityData.addRow(['Avg. Photos', parseFloat((menuComplexityTotal.avgMainDishesPhotos || 0).toFixed(1))]);
    menuComplexityData.addRow(['Avg. Options', parseFloat((menuComplexityTotal.avgTotalOptions || 0).toFixed(1))]);
    menuComplexityData.addRow(['Avg. Option Groups', parseFloat((menuComplexityTotal.avgTotalOptionGroups || 0).toFixed(1))]);
    const menuComplexityChart = Charts.newColumnChart()
        .setDataTable(menuComplexityData)
        .setOption('title', 'Menu Complexity Analysis (All Markets)')
        .setOption('width', 500)
        .setOption('height', 350)
        .build();
    imageBlobs['menuComplexityChart'] = menuComplexityChart.getAs('image/png');

    // g. AHT by Retailer Chart (Bar Chart)
    const ahtByRetailerData = Charts.newDataTable()
        .addColumn(Charts.ColumnType.STRING, 'Retailer Type')
        .addColumn(Charts.ColumnType.NUMBER, 'Average AHT (Minutes)');
    const ahtRetailerTotal = productionSummary.ahtByRetailer.grandTotal;
    for (const retailerType in ahtRetailerTotal) {
        ahtByRetailerData.addRow([retailerType, (ahtRetailerTotal[retailerType] || 0) / 60]);
    }
    const ahtByRetailerChart = Charts.newColumnChart()
        .setDataTable(ahtByRetailerData)
        .setOption('title', 'Average AHT by Retailer Type (All Markets)')
        .setOption('width', 500)
        .setOption('height', 350)
        .build();
    imageBlobs['ahtByRetailerChart'] = ahtByRetailerChart.getAs('image/png');

    // h. AHT by Month Chart (Line Chart)
    const ahtByMonthData = Charts.newDataTable()
        .addColumn(Charts.ColumnType.STRING, 'Month');
    const markets = Object.keys(productionSummary.ahtByMonth.marketData);
    markets.forEach(market => ahtByMonthData.addColumn(Charts.ColumnType.NUMBER, market));

    productionSummary.monthList.forEach(month => {
        const row = [month];
        markets.forEach(market => {
            row.push(productionSummary.ahtByMonth.marketData[market][month] || 0);
        });
        ahtByMonthData.addRow(row);
    });

    const ahtByMonthChart = Charts.newLineChart()
        .setDataTable(ahtByMonthData)
        .setOption('title', 'AHT Trend by Market')
        .setOption('width', 600)
        .setOption('height', 350)
        .setOption('legend', { position: 'top', maxLines: 3 })
        .build();
    imageBlobs['ahtByMonthChart'] = ahtByMonthChart.getAs('image/png');


    Logger.log("Generated Charts:", Object.keys(imageBlobs));

    // --- 4. COMBINE DATA, CHARTS, AND TEMPLATE ---
    const template = HtmlService.createTemplateFromFile('email-template.html');
    template.startDate = startDateStr;
    template.endDate = endDateStr;
    template.productionSummary = productionSummary;
    template.leaderboardData = leaderboardData;
    template.formatDuration = formatDuration;

    const htmlBody = template.evaluate().getContent();

    // --- 5. IMPLEMENT EMAIL SENDING LOGIC ---
    const recipient = "andre.homem@cognizant.com";
    const subject = `Monthly Performance Report: ${startDateStr} to ${endDateStr}`;

    MailApp.sendEmail({
      to: recipient,
      cc: "inesa.Povar@cognizant.com, Jitesh.Amin@cognizant.com, Amelia.Kalamarska@cognizant.com",
      subject: subject,
      htmlBody: htmlBody,
      inlineImages: imageBlobs
    });

    Logger.log("Performance report sent successfully to", recipient);

  } catch (e) {
    Logger.log(`Error during data aggregation for performance report: ${e.toString()}`);
    // Optional: Send a simple error email
    MailApp.sendEmail("andre.homem@cognizant.com", "Error: Performance Report Generation Failed", `Failed to generate the report due to an error: ${e.message}\n\nStack: ${e.stack}`);
  }
}

function formatDuration(totalSeconds) {
    if (totalSeconds === null || totalSeconds === undefined || isNaN(totalSeconds)) {
        return "00:00:00";
    }
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// =================================================================================
// --- SCHEDULE EFFICIENCY & PLANNING FUNCTIONS ---
// =================================================================================

/**
 * Analyzes the AgentLog to determine the average number of agents clocked in and working
 * for each hour of the day within a specified date range.
 * @param {string} startDateStr The start date in YYYY-MM-DD format.
 * @param {string} endDateStr The end date in YYYY-MM-DD format.
 * @returns {object} An object where keys are hours (e.g., "07") and values are the average agent count.
 */
function getHourlyStaffing(startDateStr, endDateStr) {
    const startDate = new Date(startDateStr);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(endDateStr);
    endDate.setHours(23, 59, 59, 999);

    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const sheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.AGENT_LOG);
    if (!sheet) throw new Error("AgentLog sheet not found.");

    const allData = sheet.getDataRange().getValues();
    const headers = allData.shift();
    const tsIdx = headers.indexOf('Timestamp');
    const emailIdx = headers.indexOf('Agent Email');
    const actionIdx = headers.indexOf('Action');

    const agentSessions = {};
    const agentLogs = {};
    allData.forEach(row => {
        const ts = new Date(row[tsIdx]);
        if (ts >= startDate && ts <= endDate) {
            const email = row[emailIdx];
            if (!agentLogs[email]) agentLogs[email] = [];
            agentLogs[email].push({ ts, action: row[actionIdx] });
        }
    });

    for (const email in agentLogs) {
        agentLogs[email].sort((a, b) => a.ts - b.ts);
        let currentSession = null;
        agentLogs[email].forEach(log => {
            if (log.action === 'Start Work') {
                if (currentSession) { // Handle forgotten End Work
                    currentSession.end = log.ts;
                     if (!agentSessions[email]) agentSessions[email] = [];
                    agentSessions[email].push(currentSession);
                }
                currentSession = { start: log.ts, end: null };
            } else if (log.action === 'End Work' && currentSession) {
                currentSession.end = log.ts;
                 if (!agentSessions[email]) agentSessions[email] = [];
                agentSessions[email].push(currentSession);
                currentSession = null;
            }
        });
        if (currentSession) { // Session was not ended
            currentSession.end = endDate;
             if (!agentSessions[email]) agentSessions[email] = [];
            agentSessions[email].push(currentSession);
        }
    }

    const dailyHourlyCounts = {0: {}, 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}}; // Sunday: 0 - Saturday: 6
    const daysWithData = {0: new Set(), 1: new Set(), 2: new Set(), 3: new Set(), 4: new Set(), 5: new Set(), 6: new Set()};

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        for (let hour = 7; hour < 20; hour++) {
            dailyHourlyCounts[dayIndex][hour] = 0;
        }
    }

    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
        const dayIndex = currentDate.getDay();
        const dayKey = currentDate.toISOString().split('T')[0];

        for (let hour = 7; hour < 20; hour++) {
            const hourStart = new Date(currentDate);
            hourStart.setHours(hour, 0, 0, 0);
            const hourEnd = new Date(currentDate);
            hourEnd.setHours(hour, 59, 59, 999);
            let agentsThisHour = new Set();

            for (const email in agentSessions) {
                for (const session of agentSessions[email]) {
                    if (session.start < hourEnd && session.end > hourStart) {
                        agentsThisHour.add(email);
                    }
                }
            }
            if(agentsThisHour.size > 0){
              daysWithData[dayIndex].add(dayKey);
              dailyHourlyCounts[dayIndex][hour] += agentsThisHour.size;
            }
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }

    const averages = {};
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for(let i=0; i < 7; i++){
      const dayName = daysOfWeek[i];
      const numDays = daysWithData[i].size > 0 ? daysWithData[i].size : 1;
      averages[dayName] = {};
      for(let hour = 7; hour < 20; hour++){
        averages[dayName][hour] = dailyHourlyCounts[i][hour] / numDays;
      }
    }

    return averages;
}

function getSheetHeaders(sheetName) {
  return query_engine.getSheetHeaders(sheetName);
}

function getAllSheetNames() {
  return query_engine.getAllSheetNames();
}

function saveQueryToLibrary(name, description, queryJson) {
  return query_engine.saveQueryToLibrary(name, description, queryJson);
}

function getQueriesFromLibrary() {
  return query_engine.getQueriesFromLibrary();
}

function submitQueryToQueue(query) {
  return query_engine.submitQueryToQueue(query);
}

// Note: The scheduleQuery and scheduleRecurringQuery functions have been removed.
// The new on-demand engine model is initiated by a user submitting a query
// via submitQueryToQueue, which creates its own temporary trigger.
// A separate scheduling feature would need to be designed to integrate
// with the new queue-based system.



function deleteLogEntries(logEntries) {
    if (!logEntries || !Array.isArray(logEntries) || logEntries.length === 0) {
        throw new Error("No log entries provided for deletion.");
    }

    try {
        const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
        const pauseSheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.PAUSING_LOGS);
        const escalationSheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.ESCALATION_LOGS);

        const logsBySheet = {
            [CONFIG.PRODUCTION.SHEETS.PAUSING_LOGS]: { sheet: pauseSheet, ids: new Set(), pk: 'ID' },
            [CONFIG.PRODUCTION.SHEETS.ESCALATION_LOGS]: { sheet: escalationSheet, ids: new Set(), pk: 'Log ID' }
        };

        logEntries.forEach(log => {
            if (log.type === 'Pause') {
                logsBySheet[CONFIG.PRODUCTION.SHEETS.PAUSING_LOGS].ids.add(log.id);
            } else if (log.type === 'Escalation') {
                logsBySheet[CONFIG.PRODUCTION.SHEETS.ESCALATION_LOGS].ids.add(log.id);
            }
        });

        let totalDeleted = 0;
        for (const sheetName in logsBySheet) {
            const { sheet, ids, pk } = logsBySheet[sheetName];
            if (!sheet || ids.size === 0) continue;

            const data = sheet.getDataRange().getValues();
            const headers = data[0];
            const pkIndex = headers.indexOf(pk);
            if (pkIndex === -1) continue;

            // Find rows to delete, iterating backwards to not mess up indices
            for (let i = data.length - 1; i >= 1; i--) {
                if (ids.has(data[i][pkIndex])) {
                    sheet.deleteRow(i + 1);
                    totalDeleted++;
                }
            }
        }

        invalidateCasesCache();
        return `Successfully deleted ${totalDeleted} log entries.`;

    } catch (e) {
        Logger.log(`Error in deleteLogEntries: ${e.toString()}`);
        throw new Error(`Failed to delete log entries: ${e.message}`);
    }
}

/**
 * Orchestrator function that combines staffing and workload data for the efficiency dashboard.
 * @param {string} startDateStr The start date in YYYY-MM-DD format.
 * @param {string} endDateStr The end date in YYYY-MM-DD format.
 * @returns {object} A combined data object with hourly staffing, workload, and efficiency ratios.
 */
function getScheduleEfficiencyData(startDateStr, endDateStr) {
    const staffingByDay = getHourlyStaffing(startDateStr, endDateStr);
    const workloadByDay = getHourlyWorkload(startDateStr, endDateStr);
    const combinedData = {};
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    daysOfWeek.forEach(dayName => {
        combinedData[dayName] = {};
        for (let hour = 7; hour < 20; hour++) {
            const hourKey = String(hour).padStart(2, '0');
            const avgAgents = staffingByDay[dayName] ? (staffingByDay[dayName][hour] || 0) : 0;
            const avgStarted = workloadByDay.started[dayName] ? (workloadByDay.started[dayName][hour] || 0) : 0;
            const avgClosed = workloadByDay.closed[dayName] ? (workloadByDay.closed[dayName][hour] || 0) : 0;
            const totalWorkload = avgStarted + avgClosed;

            combinedData[dayName][hourKey] = {
                avgAgents: avgAgents,
                avgWorkload: totalWorkload,
                casePerAgentRatio: avgAgents > 0 ? totalWorkload / avgAgents : 0
            };
        }
    });

    return combinedData;
}

/**
 * Analyzes historical data to suggest an optimal number of agents per hour and saves it to a sheet.
 * @returns {string} A success message.
 */
function generateSuggestedSchedule(startDateStr, endDateStr) {
    const efficiencyDataByDay = getScheduleEfficiencyData(startDateStr, endDateStr);

    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const sheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.SUGGESTED_SCHEDULE);
    if (!sheet) throw new Error("SuggestedSchedule sheet not found.");
    sheet.clearContents();
    sheet.appendRow(['DayOfWeek', 'Hour', 'RecommendedAgents', 'GeneratedTimestamp', 'Justification']);

    const generatedTimestamp = new Date();
    const suggestions = {};
    const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

    daysOfWeek.forEach(dayName => {
        suggestions[dayName] = {};
        for (let hour = 7; hour < 20; hour++) {
            const hourKey = String(hour).padStart(2, '0');
            const data = efficiencyDataByDay[dayName][hourKey];

            const targetRatio = 2.0; // Target 2 cases per agent per hour
            let recommendedAgents = 0;
            let justification = "No workload data for this slot.";

            if (data.avgWorkload > 0) {
                recommendedAgents = Math.max(1, Math.ceil(data.avgWorkload / targetRatio)); // Ensure at least 1 agent if there's work
                if (data.avgAgents > 0) {
                    if (data.casePerAgentRatio > targetRatio + 1) {
                        justification = `High workload (${data.avgWorkload.toFixed(1)} cases/hr) and high ratio (${data.casePerAgentRatio.toFixed(1)}) suggests under-staffing.`;
                    } else if (data.casePerAgentRatio < targetRatio -1 && data.casePerAgentRatio > 0) {
                        justification = `Low ratio (${data.casePerAgentRatio.toFixed(1)}) suggests potential over-staffing.`;
                    } else {
                        justification = "Workload and staffing appear balanced.";
                    }
                } else {
                   justification = `Workload of ${data.avgWorkload.toFixed(1)} cases/hr detected with no staffing.`;
                }
            } else {
                 justification = "No workload recorded for this hour on this day.";
            }

            sheet.appendRow([dayName, hourKey + ':00', recommendedAgents, generatedTimestamp, justification]);
            suggestions[dayName][hourKey] = {
                recommended: recommendedAgents,
                justification: justification
            };
        }
    });

    return suggestions;
}

/**
 * Saves an agent's requested work slots for the next week to the spreadsheet.
 * @param {Array<string>} requestedSlots An array of ISO 8601 formatted date/time strings.
 * @returns {string} A success message.
 */
function submitScheduleApplication(requestedSlots) {
  if (!requestedSlots || requestedSlots.length === 0) {
    throw new Error("No schedule slots were submitted.");
  }

  const userEmail = Session.getActiveUser().getEmail();
  const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
  const sheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.NEXT_WEEK_APPLICATIONS);
  if (!sheet) throw new Error("NextWeekApplications sheet not found.");

  // First, delete this user's existing applications for next week
    const allData = sheet.getDataRange().getValues();
    const rowsToDelete = [];
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const nextMonday = new Date(today.setDate(diff + 7));
    nextMonday.setHours(0, 0, 0, 0);
    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);
    nextSunday.setHours(23, 59, 59, 999);

    for (let i = allData.length - 1; i >= 1; i--) { // Iterate backwards when deleting
        const row = allData[i];
        const email = row[1];
        const slot = new Date(row[2]);
        if (email === userEmail && slot >= nextMonday && slot <= nextSunday) {
            sheet.deleteRow(i + 1);
        }
    }

  // Now, add the new applications
  const submissionTimestamp = new Date();
  const rowsToAdd = requestedSlots.map(slot => {
    return [submissionTimestamp, userEmail, new Date(slot)];
  });

  if (rowsToAdd.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAdd.length, 3).setValues(rowsToAdd);
  }

  return `Successfully submitted ${rowsToAdd.length} schedule requests. Your schedule for next week has been updated.`;
}

/**
 * Retrieves the current agent's schedule applications for the upcoming week.
 * @returns {Array<string>} An array of ISO 8601 formatted date/time strings for the slots the agent has applied for.
 */
function getAgentSchedule() {
    const userEmail = Session.getActiveUser().getEmail();
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const sheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.NEXT_WEEK_APPLICATIONS);
    if (!sheet || sheet.getLastRow() < 2) {
        return [];
    }

    const allData = sheet.getDataRange().getValues();
    allData.shift(); // Remove header

    // Calculate the start of next week
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1); // Get last Monday
    const nextMonday = new Date(today.setDate(diff + 7));
    nextMonday.setHours(0, 0, 0, 0);
    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);
    nextSunday.setHours(23, 59, 59, 999);

    const agentSlots = [];
    allData.forEach(row => {
        const email = row[1];
        const slot = new Date(row[2]);
        if (email === userEmail && slot >= nextMonday && slot <= nextSunday) {
            agentSlots.push(slot.toISOString());
        }
    });

    return agentSlots;
}

/**
 * Fetches data for the manager's review calendar, combining suggested agent counts
 * with the actual number of agent applications for each slot.
 * @returns {object} An object where keys are ISO 8601 date/time strings for each slot,
 *                   and values are objects containing { recommended: X, applied: Y }.
 */
function getReviewCalendarData() {
  const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
  const applicationsSheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.NEXT_WEEK_APPLICATIONS);
  const suggestedSheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.SUGGESTED_SCHEDULE);

  if (!applicationsSheet || !suggestedSheet) {
    throw new Error("Required scheduling sheets not found.");
  }

  // Initialize data structure for the next week's calendar
  const calendarData = {};
  const today = new Date();
  const day = today.getDay();
  const diff = today.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(today.setDate(diff));
  monday.setDate(monday.getDate() + 7);
  monday.setHours(0, 0, 0, 0);

  for (let d = 0; d < 7; d++) {
    for (let h = 7; h < 20; h++) {
      const slotDate = new Date(monday);
      slotDate.setDate(monday.getDate() + d);
      slotDate.setHours(h);
      calendarData[slotDate.toISOString()] = { recommended: 0, applied: 0 };
    }
  }

  // 1. Read suggested schedule
  const suggestedData = suggestedSheet.getDataRange().getValues();
  suggestedData.shift(); // Remove header
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  suggestedData.forEach(row => {
    const dayName = row[0];
    let hour;
    if (row[1] instanceof Date) {
        hour = row[1].getHours();
    } else {
        hour = parseInt(String(row[1]).split(':')[0]);
    }
    const recommended = row[2];
    const dayIndex = daysOfWeek.indexOf(dayName);

    if (dayIndex !== -1) {
        for (const slotISO in calendarData) {
            const slotDate = new Date(slotISO);
            if (slotDate.getDay() === dayIndex && slotDate.getHours() === hour) {
                calendarData[slotISO].recommended = recommended;
            }
        }
    }
  });


  // 2. Read and count agent applications
  const applicationsData = applicationsSheet.getDataRange().getValues();
  applicationsData.shift(); // Remove header
  applicationsData.forEach(row => {
    const slot = new Date(row[2]);
    slot.setMinutes(0,0,0);
    const slotISO = slot.toISOString();
    if (calendarData[slotISO]) {
      calendarData[slotISO].applied++;
    }
  });

  return calendarData;
}

/**
 * Analyzes the Main Tasks sheet to determine the average number of cases started and closed
 * for each hour of the day within a specified date range.
 * @param {string} startDateStr The start date in YYYY-MM-DD format.
 * @param {string} endDateStr The end date in YYYY-MM-DD format.
 * @returns {object} An object with 'started' and 'closed' keys, each containing hourly averages.
 */
function getHourlyWorkload(startDateStr, endDateStr) {
    const startDate = new Date(startDateStr);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(endDateStr);
    endDate.setHours(23, 59, 59, 999);

    const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
    const sheet = ss.getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
    if (!sheet) throw new Error("Main Tasks sheet not found.");

    const allData = sheet.getDataRange().getValues();
    const headers = allData.shift();
    const startIdx = headers.indexOf('Main Task Start Date/Time');
    const endIdx = headers.indexOf('Main Task End Date/Time');

    const dailyHourlyCounts = {
        started: {0: {}, 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}},
        closed: {0: {}, 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}}
    };
    const daysWithData = {
        started: {0: new Set(), 1: new Set(), 2: new Set(), 3: new Set(), 4: new Set(), 5: new Set(), 6: new Set()},
        closed: {0: new Set(), 1: new Set(), 2: new Set(), 3: new Set(), 4: new Set(), 5: new Set(), 6: new Set()}
    };

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        for (let hour = 7; hour < 20; hour++) {
            dailyHourlyCounts.started[dayIndex][hour] = 0;
            dailyHourlyCounts.closed[dayIndex][hour] = 0;
        }
    }

    allData.forEach(row => {
        const startTime = new Date(row[startIdx]);
        const endTime = new Date(row[endIdx]);

        if (startTime >= startDate && startTime <= endDate) {
            const dayIndex = startTime.getDay();
            const hour = startTime.getHours();
            if (hour >= 7 && hour < 20) {
                dailyHourlyCounts.started[dayIndex][hour]++;
                daysWithData.started[dayIndex].add(startTime.toISOString().split('T')[0]);
            }
        }

        if (endTime >= startDate && endTime <= endDate) {
            const dayIndex = endTime.getDay();
            const hour = endTime.getHours();
            if (hour >= 7 && hour < 20) {
                dailyHourlyCounts.closed[dayIndex][hour]++;
                daysWithData.closed[dayIndex].add(endTime.toISOString().split('T')[0]);
            }
        }
    });

    const averages = { started: {}, closed: {} };
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (let i = 0; i < 7; i++) {
        const dayName = daysOfWeek[i];
        averages.started[dayName] = {};
        averages.closed[dayName] = {};
        const numDaysStarted = daysWithData.started[i].size > 0 ? daysWithData.started[i].size : 1;
        const numDaysClosed = daysWithData.closed[i].size > 0 ? daysWithData.closed[i].size : 1;

        for (let hour = 7; hour < 20; hour++) {
            averages.started[dayName][hour] = dailyHourlyCounts.started[i][hour] / numDaysStarted;
            averages.closed[dayName][hour] = dailyHourlyCounts.closed[i][hour] / numDaysClosed;
        }
    }

    return averages;
}

// =================================================================================
// --- DAILY SUMMARY EMAIL ---
// =================================================================================

/**
 * To set up a daily trigger for this function:
 * 1. Open the Google Apps Script editor.
 * 2. Go to "Triggers" (the clock icon on the left).
 * 3. Click "Add Trigger".
 * 4. Choose "sendDailySummaryEmail" from the "Choose which function to run" dropdown.
 * 5. Choose "Time-driven" from the "Select event source" dropdown.
 * 6. Select "Day timer" from the "Select type of time based trigger" dropdown.
 * 7. Choose a time of day for the trigger to run (e.g., "8am to 9am").
 * 8. Click "Save".
 */
function sendDailySummaryEmail() {
  try {
    const recipient = "andre.homem@cognizant.com"; // Dummy recipient
    const ccRecipients = [
      "Inesa.Povar@cognizant.com",
      "Jitesh.Amin@cognizant.com",
    ].join(',');

    const subject = "Daily Operations Summary - " + new Date().toLocaleDateString();

    // 1. Fetch all data
    const attendanceAlerts = getAttendanceAlerts();
    const scoreCardData = getScoreCardData();
    const top5Agents = getTop5Agents();
    const pendingCorrections = getPendingApprovalRequests();

    // Get anomalies for the current month to date
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const anomaliesRaw = getAnomalies(startOfMonth.toISOString().slice(0, 10), today.toISOString().slice(0, 10));

    // Enhance anomalies with their fix previews
    const anomalies = anomaliesRaw
      .filter(a => a.type !== 'No Anomalies Found' && a.caseId !== 'Error')
      .map(anomaly => {
        try {
          anomaly.preview = previewHandlingTimeFix(anomaly.caseId);
        } catch (e) {
          anomaly.preview = { error: "Could not generate preview." };
        }
        return anomaly;
      });

    // 2. Prepare the HTML template
    const template = HtmlService.createTemplateFromFile('Daily-Summary-Email-Template.html');
    template.attendanceAlerts = attendanceAlerts;
    template.scoreCardData = scoreCardData;
    template.top5Agents = top5Agents;
    template.pendingCorrections = pendingCorrections;
    template.anomalies = anomalies;
    template.formatDuration = formatDuration; // Pass the helper function to the template

    const htmlBody = template.evaluate().getContent();

    // 3. Send the email
    MailApp.sendEmail({
      to: recipient,
      cc: ccRecipients,
      subject: subject,
      htmlBody: htmlBody,
    });

    Logger.log("Daily summary email sent successfully.");

  } catch (e) {
    Logger.log("Failed to send daily summary email: " + e.toString());
    // Optional: Send a failure notification
    MailApp.sendEmail("admin@example.com", "CRITICAL: Daily Summary Email Failed", "The automated daily summary email failed to generate. Error: " + e.message);
  }
}

function getAttendanceAlerts() {
  const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
  const sheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.AGENT_LOG);
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();

  const agentLogs = {};
  data.forEach(row => {
    const email = row[1];
    if (!agentLogs[email]) {
      agentLogs[email] = [];
    }
    agentLogs[email].push({
      timestamp: new Date(row[0]),
      action: row[3]
    });
  });

  const alerts = [];
  for (const email in agentLogs) {
    const logs = agentLogs[email].sort((a, b) => b.timestamp - a.timestamp);
    const lastLog = logs[0];

    if (lastLog.action === 'Start Work') {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      if (lastLog.timestamp.getDate() === yesterday.getDate() &&
          lastLog.timestamp.getMonth() === yesterday.getMonth() &&
          lastLog.timestamp.getFullYear() === yesterday.getFullYear()) {
        alerts.push({
          agent: email,
          lastLogin: lastLog.timestamp.toLocaleString()
        });
      }
    }
  }

  return alerts;
}

function getScoreCardData() {
  const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
  const agentSheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.AGENTS);
  const allAgents = agentSheet.getDataRange().getValues().slice(1).map(row => row[0]);

  const logSheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.AGENT_LOG);
  const logData = logSheet.getDataRange().getValues().slice(1);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const activeAgents = new Set();
  logData.forEach(row => {
    const timestamp = new Date(row[0]);
    if (timestamp.getDate() === yesterday.getDate() &&
        timestamp.getMonth() === yesterday.getMonth() &&
        timestamp.getFullYear() === yesterday.getFullYear()) {
      activeAgents.add(row[1]);
    }
  });

  const activeCount = activeAgents.size;
  const inactiveCount = allAgents.length - activeCount;

  return {
    active: activeCount,
    inactive: inactiveCount
  };
}

function getTop5Agents() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const leaderboardData = getLeaderboardData(yesterdayStr, yesterdayStr);
  return leaderboardData.slice(0, 5);
}

function isDateTimeField_(fieldName) {
    const lower = fieldName.toLowerCase();
    return (lower.includes('date') || lower.includes('time')) && !isDurationField_(fieldName);
}

function isDurationField_(fieldName) {
    const lower = fieldName.toLowerCase();
    return lower.includes('duration') || lower.includes('agent handling time');
}

function getArchivedCases(options = {}) {
  // New filters, with defaults
  const {
    limit = 20,
    offset = 0,
    caseId = '',
    status = '',
    startDate: startDateStr = '',
    endDate: endDateStr = '',
    country = '',
    userEmail = '',
    category = ''
  } = options;

  const FILE_NAME = 'HistoricalProductionReport.csv';

  try {
    const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
    const files = folder.getFilesByName(FILE_NAME);
    if (!files.hasNext()) {
      throw new Error(`File "${FILE_NAME}" not found in the specified Google Drive folder.`);
    }
    const file = files.next();
    const csvContent = file.getBlob().getDataAsString();
    const rows = Utilities.parseCsv(csvContent);

    if (rows.length < 2) {
      return { records: [], total: 0 };
    }

    const headers = rows.shift();
    const mainTasks = {};

    rows.forEach(row => {
      const record = {};
      headers.forEach((header, i) => {
        record[header] = row[i];
      });

      const recordType = record['record_type'];
      const mainTaskId = record['Main Task ID'];

      if (!mainTaskId) return;

      if (recordType === 'Main Task') {
        if (!mainTasks[mainTaskId]) {
          mainTasks[mainTaskId] = {
            ...record,
            escalations: [],
            pauses: [],
            cooperations: []
          };
        } else {
          Object.assign(mainTasks[mainTaskId], record);
        }
      } else {
        if (!mainTasks[mainTaskId]) {
          mainTasks[mainTaskId] = {
            'Main Task ID': mainTaskId,
            escalations: [],
            pauses: [],
            cooperations: []
          };
        }
        if (recordType === 'Escalation') {
          mainTasks[mainTaskId].escalations.push(record);
        } else if (recordType === 'Pausing') {
          mainTasks[mainTaskId].pauses.push(record);
        } else if (recordType === 'Cooperation') {
          mainTasks[mainTaskId].cooperations.push(record);
        }
      }
    });

    let allTasks = Object.values(mainTasks);

    // --- ADVANCED SEARCH FILTER ---
    let filteredTasks = allTasks.filter(task => {
        // Helper function for case-insensitive string comparison
        const matches = (value, filter) => {
            if (!filter) return true; // If filter is empty, it's a match
            if (!value) return false; // If value is empty but filter is not, it's not a match
            return String(value).toLowerCase().includes(filter.toLowerCase());
        };

        // Date Range Filter
        if (startDateStr && endDateStr) {
            const startDate = new Date(startDateStr);
            const endDate = new Date(endDateStr);
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
            const taskStartDateStr = task['Main Task Start Date/Time'];
            if (!taskStartDateStr) return false;
            try {
                const taskDate = new Date(taskStartDateStr);
                if (isNaN(taskDate.getTime()) || taskDate < startDate || taskDate > endDate) {
                    return false;
                }
            } catch (e) {
                return false; // Invalid date format in the CSV
            }
        }

        // Apply all filters
        return (
            matches(task['Main Task ID'], caseId) &&
            matches(task['Status'], status) &&
            matches(task['Country'], country) &&
            matches(task['Useremail'], userEmail) &&
            matches(task['Category'], category)
        );
    });


    const total = filteredTasks.length;

    // --- PAGINATION ---
    const paginatedTasks = filteredTasks.slice(offset, offset + limit);


    // --- SERIALIZATION ---
    const records = paginatedTasks.map(task => {
        const serializedTask = {};
        for(const key in task){
            try {
                if(task[key] instanceof Date){
                    serializedTask[key] = task[key].toISOString();
                } else if (isDateTimeField_(key) && task[key] && String(task[key]).trim() !== '') {
                    const date = new Date(task[key]);
                    if (isNaN(date.getTime())) {
                        // Instead of throwing, log it and set to null
                        Logger.log(`Invalid date value for key "${key}": ${task[key]}`);
                        serializedTask[key] = null;
                    } else {
                       serializedTask[key] = date.toISOString();
                    }
                } else {
                    serializedTask[key] = task[key];
                }
            } catch (e) {
                serializedTask[key] = null;
                Logger.log(`Handled invalid date for key "${key}" with value "${task[key]}". Set to null.`);
            }
        }
        return serializedTask;
    });

    return { records: records, total: total };

  } catch (e) {
    Logger.log(`Error in getArchivedCases: ${e.toString()}`);
    throw new Error(`Failed to get archived cases. ${e.message}`);
  }
}

function exportArchiveToSheet() {
    const FILE_NAME = 'HistoricalProductionReport.csv';
    try {
        const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
        const files = folder.getFilesByName(FILE_NAME);
        if (!files.hasNext()) {
            throw new Error(`File "${FILE_NAME}" not found in the specified Google Drive folder.`);
        }
        const file = files.next();
        const csvContent = file.getBlob().getDataAsString();
        const allRows = Utilities.parseCsv(csvContent);

        if (allRows.length < 2) {
            throw new Error("CSV file is empty or contains only a header.");
        }

        const originalHeaders = allRows.shift();
        const recordTypeIndex = originalHeaders.indexOf('record_type');
        if (recordTypeIndex === -1) {
            throw new Error("'record_type' column not found in CSV.");
        }

        const mainTaskHeaders = ["Created By", "Useremail", "Main Task ID", "Country", "Menu Request Sent Date", "Language", "Case Title", "Category", "Account Name", "Status", "Provider Id", "City", "Menu Instructions", "Onboarding", "Menu Comment", "Menu link", "Dish Photos Link", "Photo Coverage", "Main Task Start Date/Time", "Main Task End Date/Time", "Escalated Start Time", "Escalated End Time", "Task Tat", "Escalated Comment", "Task Paused", "Pause Time", "Pause End Time", "TAT Adherance", "SalesforceUpdated", "Salesforce Updated time", "Ready for QA", "Date stamp", "Task Type", "Rework Count", "No of Main dishes(Excluding Extras, drinks, sides, etc)", "Total No of dishes", "Total No of categories", "Total no of options", "Total no of tags", "Total no of timetables.", "No of Valid Photos for Main dishes (Excluding Extras, drinks, sides, etc.)", "Comments", "Event Summary", "Stored Escalation Duration", "Stored Pause Duration", "Stored Agent Handling Time", "Retailer Provider Type", "Airtable Link", "Description Coverage", "Visual and Descriptive Elements", "Claim Flag", "SLA Missed Reason", "SLA Missed Comment", "Linking Snapshot URL"];
        const escalationLogHeaders = ["Log ID", "Related Case ID", "Escalation Start Time", "Escalation End Time"];
        const pausingLogHeaders = ["ID", "Related Case ID", "Pause Start Time", "Pause End Time"];
        const cooperationLogHeaders = ["Log ID", "User Email", "Related Case ID", "Start Time", "End Time", "Cooperation Notes"];

        const headerMapping = {
            'Escalation Logs': { 'Log ID': 'Log ID', 'Related Case ID': 'Main Task ID', 'Escalation Start Time': 'Escalated Start Time', 'Escalation End Time': 'Escalated End Time' },
            'Pausing Logs': { 'ID': 'Log ID', 'Related Case ID': 'Main Task ID', 'Pause Start Time': 'Pause Time', 'Pause End Time': 'Pause End Time' },
            'Cooperation Logs': { 'Log ID': 'Log ID', 'User Email': 'Useremail', 'Related Case ID': 'Main Task ID', 'Start Time': 'Main task Start Date/Time', 'End Time': 'Main Task End Date/Time', 'Cooperation Notes': 'Cooperation Notes' }
        };

        const dataByType = {
            'Main Task': { headers: mainTaskHeaders, rows: [] },
            'Escalation': { headers: escalationLogHeaders, rows: [] },
            'Pausing': { headers: pausingLogHeaders, rows: [] },
            'Cooperation': { headers: cooperationLogHeaders, rows: [] }
        };

        allRows.forEach(row => {
            const type = row[recordTypeIndex];
            if (dataByType[type]) {
                const record = {};
                originalHeaders.forEach((header, i) => { record[header] = row[i]; });
                dataByType[type].rows.push(record);
            }
        });

        const spreadsheet = SpreadsheetApp.create(`Archive Export - ${new Date().toLocaleString()}`);

        const createSheet = (name, headerOrder, dataRows) => {
            if (dataRows.length > 0) {
                const sheet = spreadsheet.insertSheet(name);
                const mapping = headerMapping[name];

                const outputRows = dataRows.map(row => {
                    return headerOrder.map(destHeader => {
                        let sourceHeader = destHeader;
                        if (name !== 'Main Tasks' && mapping && mapping[destHeader]) {
                            sourceHeader = mapping[destHeader];
                        }
                        let value = row[sourceHeader] || "";

                        if (typeof value === 'string' && value.trim() === '') return "";

                        if (isDateTimeField_(destHeader)) {
                            try {
                                const date = new Date(value);
                                return isNaN(date.getTime()) ? value : date;
                            } catch (e) {
                                return value;
                            }
                        } else if (isDurationField_(destHeader)) {
                            const num = parseFloat(value);
                            return isNaN(num) ? 0 : num;
                        }
                        return value;
                    });
                });

                const outputData = [headerOrder, ...outputRows];
                if (outputData.length > 1) { // Ensure there is data to write
                    const dataRange = sheet.getRange(1, 1, outputData.length, headerOrder.length);
                    dataRange.setValues(outputData);

                    headerOrder.forEach((header, i) => {
                        const colIndex = i + 1;
                        if (sheet.getLastRow() > 1) { // Don't format an empty sheet
                            if (isDateTimeField_(header)) {
                                sheet.getRange(2, colIndex, sheet.getLastRow() - 1, 1).setNumberFormat("mm-dd-yyyy hh:mm:ss");
                            } else if (isDurationField_(header)) {
                                sheet.getRange(2, colIndex, sheet.getLastRow() - 1, 1).setNumberFormat("[h]:mm:ss.SSS");
                            }
                        }
                    });
                } else {
                     sheet.getRange(1, 1, 1, headerOrder.length).setValues([headerOrder]);
                }
                 sheet.setFrozenRows(1);
                 headerOrder.forEach((_, i) => sheet.autoResizeColumn(i + 1));
            }
        };

        createSheet('Main Tasks', dataByType['Main Task'].headers, dataByType['Main Task'].rows);
        createSheet('Escalation Logs', dataByType['Escalation'].headers, dataByType['Escalation'].rows);
        createSheet('Pausing Logs', dataByType['Pausing'].headers, dataByType['Pausing'].rows);
        createSheet('Cooperation Logs', dataByType['Cooperation'].headers, dataByType['Cooperation'].rows);

        const defaultSheet = spreadsheet.getSheetByName('Sheet1');
        if (defaultSheet) {
            spreadsheet.deleteSheet(defaultSheet);
        }

        SpreadsheetApp.flush();
        return spreadsheet.getUrl();

    } catch (e) {
        Logger.log(`Error in exportArchiveToSheet: ${e.toString()}`);
        throw new Error(`Failed to export archive to Google Sheet. ${e.message}`);
    }
}

function startArchiveExport() {
  try {
    const userEmail = Session.getActiveUser().getEmail();

    // 1. Create the destination spreadsheet immediately
    const spreadsheet = SpreadsheetApp.create(`Archive Export - ${new Date().toLocaleString()}`);
    spreadsheet.addEditor(userEmail); // Add user as editor
    const spreadsheetId = spreadsheet.getId();
    const url = spreadsheet.getUrl();

    // 2. Store the ID for the background worker
    PropertiesService.getScriptProperties().setProperty('tempExportSheetId', spreadsheetId);


    // 3. Create a one-time trigger to start the background process
    ScriptApp.newTrigger('continueArchiveExport')
      .timeBased()
      .after(5 * 1000) // 5 seconds from now
      .create();

    Logger.log(`Started archive export for ${userEmail}. Sheet ID: ${spreadsheetId}`);

    // 4. Return the URL to the user immediately
    return url;

  } catch (e) {
    Logger.log(`Error in startArchiveExport: ${e.toString()}`);
    throw new Error(`Failed to start the archive export process. ${e.message}`);
  }
}

function continueArchiveExport() {
  deleteAllTriggersByName_('continueArchiveExport');
  const sheetId = PropertiesService.getScriptProperties().getProperty('tempExportSheetId');
  if (!sheetId) {
    Logger.log("Could not find 'tempExportSheetId' property. Aborting export.");
    return;
  }

  const FILE_NAME = 'HistoricalProductionReport.csv';
  const BATCH_SIZE = 500;

  try {
    Logger.log(`Starting background export for Sheet ID: ${sheetId}`);
    const newSpreadsheet = SpreadsheetApp.openById(sheetId);

    // Read the entire CSV once
    Logger.log(`Reading CSV file: ${FILE_NAME}`);
    const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
    const files = folder.getFilesByName(FILE_NAME);
    if (!files.hasNext()) throw new Error(`File "${FILE_NAME}" not found.`);
    const file = files.next();
    const csvContent = file.getBlob().getDataAsString();
    const allRows = Utilities.parseCsv(csvContent);
    Logger.log(`Found ${allRows.length -1} data rows in CSV.`);
    const originalHeaders = allRows.shift();
    const recordTypeIndex = originalHeaders.indexOf('record_type');

    // Define structure
    const mainTaskHeaders = ["Created By", "Useremail", "Main Task ID", "Country", "Menu Request Sent Date", "Language", "Case Title", "Category", "Account Name", "Status", "Provider Id", "City", "Menu Instructions", "Onboarding", "Menu Comment", "Menu link", "Dish Photos Link", "Photo Coverage", "Main Task Start Date/Time", "Main Task End Date/Time", "Escalated Start Time", "Escalated End Time", "Task Tat", "Escalated Comment", "Task Paused", "Pause Time", "Pause End Time", "TAT Adherance", "SalesforceUpdated", "Salesforce Updated time", "Ready for QA", "Date stamp", "Task Type", "Rework Count", "No of Main dishes(Excluding Extras, drinks, sides, etc)", "Total No of dishes", "Total No of categories", "Total no of options", "Total no of tags", "Total no of timetables.", "No of Valid Photos for Main dishes (Excluding Extras, drinks, sides, etc.)", "Comments", "Event Summary", "Stored Escalation Duration", "Stored Pause Duration", "Stored Agent Handling Time", "Retailer Provider Type", "Airtable Link", "Description Coverage", "Visual and Descriptive Elements", "Claim Flag", "SLA Missed Reason", "SLA Missed Comment", "Linking Snapshot URL"];
    const escalationLogHeaders = ["Log ID", "Related Case ID", "Escalation Start Time", "Escalation End Time"];
    const pausingLogHeaders = ["ID", "Related Case ID", "Pause Start Time", "Pause End Time"];
    const cooperationLogHeaders = ["Log ID", "User Email", "Related Case ID", "Start Time", "End Time", "Cooperation Notes"];
    const headerMapping = {
        'Escalation Logs': { 'Log ID': 'Log ID', 'Related Case ID': 'Main Task ID', 'Escalation Start Time': 'Escalated Start Time', 'Escalation End Time': 'Escalated End Time' },
        'Pausing Logs': { 'ID': 'Log ID', 'Related Case ID': 'Main Task ID', 'Pause Start Time': 'Pause Time', 'Pause End Time': 'Pause End Time' },
        'Cooperation Logs': { 'Log ID': 'Log ID', 'User Email': 'Useremail', 'Related Case ID': 'Main Task ID', 'Start Time': 'Main task Start Date/Time', 'End Time': 'Main Task End Date/Time', 'Cooperation Notes': 'Cooperation Notes' }
    };
    const dataByType = {
        'Main Task': { headers: mainTaskHeaders, rows: [] },
        'Escalation': { headers: escalationLogHeaders, rows: [] },
        'Pausing': { headers: pausingLogHeaders, rows: [] },
        'Cooperation': { headers: cooperationLogHeaders, rows: [] }
    };

    // Process all rows in memory first
    Logger.log("Processing and separating rows by record_type in memory...");
    allRows.forEach(row => {
      const type = row[recordTypeIndex];
      if (dataByType[type]) {
        const record = {};
        originalHeaders.forEach((header, i) => { record[header] = row[i]; });
        dataByType[type].rows.push(record);
      }
    });
    Logger.log(`Processing complete. Found: ${dataByType['Main Task'].rows.length} Main Tasks, ${dataByType['Escalation'].rows.length} Escalations, ${dataByType['Pausing'].rows.length} Pauses, ${dataByType['Cooperation'].rows.length} Cooperations.`);


    // Write to sheets in batches
    Object.keys(dataByType).forEach(type => {
      const job = dataByType[type];
      const sheetName = type === 'Main Task' ? 'Main Tasks' : `${type} Logs`;
      Logger.log(`--- Starting export for: ${sheetName} ---`);

      const sheet = newSpreadsheet.insertSheet(sheetName);
      sheet.getRange(1, 1, 1, job.headers.length).setValues([job.headers]).setFontWeight('bold');
      sheet.setFrozenRows(1);

      const mapping = headerMapping[sheetName];
      const rowsToWrite = job.rows.map(row => {
          return job.headers.map(destHeader => {
              const sourceHeader = (type !== 'Main Task' && mapping) ? mapping[destHeader] : destHeader;
              let value = row[sourceHeader] || "";
              if (typeof value === 'string' && value.trim() === '') return "";
              if (isDateTimeField_(destHeader) && value) {
                  try { return new Date(value); } catch(e) { return value; /* Return original string if date is invalid */ }
              }
              if (isDurationField_(destHeader) && value) return parseFloat(value) || 0;
              return value;
          });
      });

      if (rowsToWrite.length > 0) {
        Logger.log(`Writing ${rowsToWrite.length} rows to '${sheetName}' in batches of ${BATCH_SIZE}...`);
        for (let i = 0; i < rowsToWrite.length; i += BATCH_SIZE) {
          const batch = rowsToWrite.slice(i, i + BATCH_SIZE);
          Logger.log(`Writing batch ${i / BATCH_SIZE + 1} to '${sheetName}' (${batch.length} rows).`);
          sheet.getRange(i + 2, 1, batch.length, job.headers.length).setValues(batch);
          SpreadsheetApp.flush(); // Crucial for preventing timeouts
        }
      } else {
        Logger.log(`No rows to write for '${sheetName}'.`);
      }

      // Final formatting pass
      Logger.log(`Applying column formatting for '${sheetName}'...`);
      if (sheet.getLastRow() > 1) {
        job.headers.forEach((header, i) => {
          if (isDateTimeField_(header)) {
            sheet.getRange(2, i + 1, sheet.getLastRow() - 1).setNumberFormat("mm-dd-yyyy hh:mm:ss");
          } else if (isDurationField_(header)) {
            sheet.getRange(2, i + 1, sheet.getLastRow() - 1).setNumberFormat("[h]:mm:ss.SSS");
          }
        });
        // Auto-resizing all columns at once is much faster than one-by-one in a loop.
        sheet.autoResizeColumns(1, job.headers.length);
      }
       Logger.log(`--- Finished export for: ${sheetName} ---`);
    });

    const defaultSheet = newSpreadsheet.getSheetByName('Sheet1');
    if (defaultSheet) newSpreadsheet.deleteSheet(defaultSheet);

    Logger.log("--- Background archive export has completed successfully. ---");

  } catch (e) {
    Logger.log(`A critical error occurred during the archive fill operation: ${e.message} \nStack: ${e.stack}`);
    const sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
    sheet.setName("Error");
    sheet.getRange("A1").setValue(`An error occurred: ${e.message}`);
  } finally {
    PropertiesService.getScriptProperties().deleteProperty('tempExportSheetId');
  }
}

function deleteAllTriggersByName_(functionName) {
    const allTriggers = ScriptApp.getProjectTriggers();
    allTriggers.forEach(trigger => {
        if (trigger.getHandlerFunction() === functionName) {
            ScriptApp.deleteTrigger(trigger);
        }
    });
}

function getArchiveFilterOptions() {
  const FILE_NAME = 'HistoricalProductionReport.csv';
  try {
    const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
    const files = folder.getFilesByName(FILE_NAME);
    if (!files.hasNext()) {
      throw new Error(`File "${FILE_NAME}" not found in the specified Google Drive folder.`);
    }
    const file = files.next();
    const csvContent = file.getBlob().getDataAsString();
    const rows = Utilities.parseCsv(csvContent);

    if (rows.length < 2) {
      return { statuses: [], countries: [], categories: [] };
    }

    const headers = rows.shift();
    const statusIndex = headers.indexOf('Status');
    const countryIndex = headers.indexOf('Country');
    const categoryIndex = headers.indexOf('Category');

    const uniqueValues = {
      statuses: new Set(),
      countries: new Set(),
      categories: new Set()
    };

    rows.forEach(row => {
      if (statusIndex !== -1 && row[statusIndex]) uniqueValues.statuses.add(row[statusIndex]);
      if (countryIndex !== -1 && row[countryIndex]) uniqueValues.countries.add(row[countryIndex]);
      if (categoryIndex !== -1 && row[categoryIndex]) uniqueValues.categories.add(row[categoryIndex]);
    });

    return {
      statuses: Array.from(uniqueValues.statuses).sort(),
      countries: Array.from(uniqueValues.countries).sort(),
      categories: Array.from(uniqueValues.categories).sort()
    };
  } catch (e) {
    Logger.log(`Error in getArchiveFilterOptions: ${e.toString()}`);
    throw new Error(`Failed to get archive filter options. ${e.message}`);
  }
}
