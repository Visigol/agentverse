# Project Documentation: Manager & Agent Dashboard

This document provides a comprehensive overview of the Google Apps Script-based Manager and Agent Dashboard, including its data workflow, technical implementation, features, and standard operating procedures.

## 1. Data Workflow

The application is built on a Google Apps Script backend that interacts with Google Sheets, which act as the database. The frontend is composed of standard HTML and JavaScript files served directly by the script.

### 1.1. Data Sources (Google Sheets)

The application relies on two primary Google Spreadsheets, configured in the `CONFIG` object in `code.gs.txt`:

1.  **Attendance Spreadsheet (`CONFIG.ATTENDANCE.ID`):**
    *   **`AgentLog`:** Tracks agent status changes (Start/End Work, Start/End Break, Start/End Meeting).
    *   **`CaseLog`:** A secondary log for case-specific actions (deprecated in favor of the Production logs but may contain historical data).
    *   **`Agents` & `Managers`:** Lists of users and their roles, used for authentication and populating dropdowns.
    *   **`Requests`:** Stores agent requests for attendance corrections.
    *   **`BackupSystemAccess`:** Manages user permissions for the "Cases" tab.

2.  **Production Spreadsheet (`CONFIG.PRODUCTION.ID`):**
    *   **`Main Tasks`:** The central sheet for all case data. It is the primary source of truth for case details, statuses, and derived metrics like stored handling time.
    *   **`Pausing Logs`, `Escalation Logs`, `Cooperation Logs`:** These sheets serve as the definitive source for their respective log data. They are used to track the start and end times of these events, overriding any similar columns in the `Main Tasks` sheet.

### 1.2. Application Flow

1.  **User Access:** When a user visits the script URL, the `doGet(e)` function in `code.gs.txt` acts as a router.
2.  **Role Check:** It checks if the user's email is in the `Managers` sheet using `isUserManager_()`.
3.  **Page Serving:** Based on the user's role and any URL parameters (e.g., `?page=cases`), the appropriate HTML file (`index.html.txt`, `manager.html.txt`, `cases.html.txt`) is served as a template.
4.  **Frontend-Backend Communication:** The frontend JavaScript communicates with the backend `code.gs.txt` functions using the `google.script.run` API. This is an asynchronous bridge that allows the client-side code to call server-side functions and receive data in response.
5.  **Data Caching:** To improve performance and reduce Google Sheets API calls, the application uses a versioned, chunked caching strategy (`CacheService`).
    *   The `getCasesByStatus` function first checks the cache for a valid data manifest.
    -   If the cache is empty or stale, it locks the script (`LockService`), fetches fresh data from the spreadsheet, splits it into chunks, and stores it in the cache under a new version number.
    *   Data modification functions (like `updateCaseData`) call `invalidateCasesCache()` to increment the version number, ensuring that the next data fetch will ignore the old cache and retrieve fresh data.

## 2. Function Reference (Detailed)

Functions are grouped by workflow and ordered to show the typical flow of execution from the user interface to the backend.

### 2.1. Initialization & Routing

This workflow handles the initial loading of the application.

1.  **(Backend) `doGet(e)`** (`code.gs.txt`)
    *   **Purpose:** The main entry point for the web app. It acts as a router.
    *   **Connections:**
        *   Called by: Google Apps Script runtime when a user visits the URL.
        *   Calls: `isUserManager_()` to determine the user's role. `HtmlService.createTemplateFromFile().evaluate()` to serve the appropriate HTML page.

2.  **(Backend) `isUserManager_(email)`** (`code.gs.txt`)
    *   **Purpose:** Checks if a given email belongs to a manager.
    *   **Connections:**
        *   Called by: `doGet(e)`.
        *   Calls: Reads from the `Managers` sheet in the Attendance spreadsheet.

3.  **(Frontend) `initializePage()`** (`index.html.txt`, `manager.html.txt`, `production.html.txt`)
    *   **Purpose:** The primary function called on window load in the agent and manager dashboards. It orchestrates the initial data fetching.
    *   **Connections:**
        *   Called by: `window.addEventListener('load', ...)`
        *   Calls (Backend): `getInitialAgentState()`, `checkUserCaseAccess()`, `getAgentDashboardSummary()`, `getPendingRequests()`, `getImportantLinks()`, `getVersionDetails()`, `getActiveAgentStatuses()`, etc.

### 2.2. Agent Attendance Workflow (`index.html.txt`)

This workflow manages an agent's daily attendance and status changes.

1.  **(Frontend) `handleWorkToggle()`, `handleBreakToggle()`, `handleMeetingToggle()`**
    *   **Purpose:** Event handlers for the main action buttons on the agent dashboard.
    *   **Connections:**
        *   Called by: `onclick` events on the respective buttons.
        *   Calls (Backend): `logAgentAction(actionType)`.

2.  **(Backend) `logAgentAction(actionType)`** (`code.gs.txt`)
    *   **Purpose:** The core function for logging agent status changes. It validates the action and appends a new row to the `AgentLog` sheet.
    *   **Connections:**
        *   Called by: `handleWorkToggle()`, `handleBreakToggle()`, `handleMeetingToggle()`.
        *   Calls: `_determineCurrentAgentState()` to validate the action (e.g., can't start a break if not working). Appends a row to the `AgentLog` sheet. Returns the new state to the frontend.

3.  **(Backend) `_determineCurrentAgentState(agentEmail, agentName)`** (`code.gs.txt`)
    *   **Purpose:** A crucial internal function that reconstructs an agent's current state (isWorking, isOnBreak, currentSessionId, etc.) by analyzing the `AgentLog` from the beginning of their last session.
    *   **Connections:**
        *   Called by: `getInitialAgentState()` and `logAgentAction()`.
        *   Calls: Reads data from the `AgentLog` and `CaseLog` sheets.

4.  **(Frontend) `openCorrectionModal(logData)` & `submitCorrectionFromLog()`**
    *   **Purpose:** Handles the UI for an agent to request a correction to their attendance log.
    *   **Connections:**
        *   Called by: Clicking the "Edit" button in the attendance log.
        *   Calls (Backend): `logCorrectionRequest()`.

5.  **(Backend) `logCorrectionRequest(...)`** (`code.gs.txt`)
    *   **Purpose:** Appends a new entry to the `Requests` sheet with the details of the correction, awaiting manager approval.
    *   **Connections:**
        *   Called by: `submitCorrectionFromLog()`.
        *   Calls: Appends a row to the `Requests` sheet.

### 2.3. Case Management Workflow (`cases.html.txt`)

This workflow covers all actions related to viewing, searching, and modifying cases.

1.  **(Frontend) `loadCases(status)`**
    *   **Purpose:** Fetches a list of cases for a specific status tab.
    *   **Connections:**
        *   Called by: `initializeBoard()` and clicking "Show More".
        *   Calls (Backend): `getCasesByStatus()`.

2.  **(Backend) `getCasesByStatus(options)`** (`code.gs.txt`)
    *   **Purpose:** A complex function that fetches, filters, and paginates cases. It is the primary data source for the main cases view. It includes the caching and locking logic.
    *   **Connections:**
        *   Called by: `loadCases()`.
        *   Calls: `CacheService`, `LockService`, `getOpenLogs_()`, `serializeCaseData_()`. Reads from `Main Tasks`, `Pausing Logs`, and `Escalation Logs`.

3.  **(Frontend) `openCaseModal(caseId)`**
    *   **Purpose:** Opens the detailed modal view for a selected case.
    *   **Connections:**
        *   Called by: Clicking on a case row in any table.
        *   Calls (Backend): `getLogsForCase()` to fetch associated logs.

4.  **(Backend) `getLogsForCase(caseId)`** (`code.gs.txt`)
    *   **Purpose:** Fetches all log entries from the Pausing, Escalation, and Cooperation log sheets that are related to a specific `caseId`.
    *   **Connections:**
        *   Called by: `openCaseModal()`.
        *   Calls: Reads from `Pausing Logs`, `Escalation Logs`, `Cooperation Logs`.

5.  **(Frontend) `handleCaseAction(action, caseId)`**
    *   **Purpose:** A generic handler for all action buttons within the case modal (e.g., Claim, Pause).
    *   **Connections:**
        *   Called by: `onclick` events on the dynamic action buttons.
        *   Calls (Backend): A dynamically determined function based on the `action` parameter, such as `claimCase(caseId)`, `pauseCase(caseId)`, `unpauseCase(caseId)`, etc.

6.  **(Backend) Case Action Functions (`claimCase`, `pauseCase`, etc.)** (`code.gs.txt`)
    *   **Purpose:** A group of functions that perform a specific action on a case. They typically involve creating a log entry and/or updating the case status.
    *   **Connections:**
        *   Called by: `handleCaseAction()`.
        *   Calls: `createNewLogEntry()`, `endOpenLogEntry()`, `updateCaseStatus()`, `updateCaseField()`. These functions orchestrate the data changes in the spreadsheets.

7.  **(Frontend) `saveChanges(saveButton)`**
    *   **Purpose:** Collects all edited data from the modal's input fields and sends it to the backend for saving.
    *   **Connections:**
        *   Called by: Clicking the "Save" button in the modal.
        *   Calls (Backend): `updateCaseData()` to save changes to the `Main Tasks` sheet and `updateLogData()` for each log sheet that had changes.

8.  **(Backend) `updateCaseData(caseId, updatedData)` & `updateLogData(...)`** (`code.gs.txt`)
    *   **Purpose:** Finds the specific row in the target sheet (`Main Tasks` or a log sheet) and updates its cells with the provided data.
    *   **Connections:**
        *   Called by: `saveChanges()`.
        *   Calls: `invalidateCasesCache()` to ensure the UI will fetch fresh data. `SpreadsheetApp.flush()` to commit changes immediately.

### 2.4. Manager Analytics & Reporting (`manager.html.txt`, `production.html.txt`)

This workflow covers the data aggregation and reporting features available to managers.

1.  **(Frontend) `loadManagerData()`** (`manager.html.txt`)
    *   **Purpose:** Fetches the main summary data for the manager homepage based on the selected date range.
    *   **Connections:**
        *   Called by: The "Load Data" button.
        *   Calls (Backend): `getManagerAttendanceSummary()` and `getLeaderboardData()`.

2.  **(Backend) `getManagerAttendanceSummary(startDateStr, endDateStr)`** (`code.gs.txt`)
    *   **Purpose:** Aggregates attendance data from `AgentLog` for all agents within a date range to calculate total work, break, and meeting times.
    *   **Connections:**
        *   Called by: `loadManagerData()`.
        *   Calls: Reads from `AgentLog` and `Agents` sheets.

3.  **(Frontend) `loadProductionData()`** (`production.html.txt`)
    *   **Purpose:** Fetches and processes all data for the visual Production Dashboard.
    *   **Connections:**
        *   Called by: The "Load Data" button on the production page.
        *   Calls (Backend): `getProductionReport()`.

4.  **(Backend) `getProductionReport(filters)`** (`code.gs.txt`)
    *   **Purpose:** The single most complex aggregation function. It filters the entire `Main Tasks` sheet by date and any other criteria, then calculates all metrics for every chart and table on the Production Dashboard in a single pass.
    *   **Connections:**
        *   Called by: `loadProductionData()` and any drill-down click.
        *   Calls: Reads from the `Main Tasks` sheet.

5.  **(Frontend) `loadAnomalies()`** (`manager.html.txt`)
    *   **Purpose:** Fetches data integrity issues.
    *   **Connections:**
        *   Called by: The "Load Anomalies" button.
        *   Calls (Backend): `getAnomalies()`.

6.  **(Backend) `getAnomalies(startDateStr, endDateStr)`** (`code.gs.txt`)
    *   **Purpose:** Scans `Main Tasks`, `Pausing Logs`, and `Escalation Logs` for data that violates predefined rules (e.g., negative durations, excessive handling time).
    *   **Connections:**
        *   Called by: `loadAnomalies()`.
        *   Calls: Reads from the three specified production sheets.

## 3. Maintenance & Extensibility FAQ

**Q: How do I add a new data field to be viewable and editable in the Case Modal?**
**A:** This requires a two-step process:
1.  **Backend (Spreadsheet):** Add a new column to the `Main Tasks` sheet in your Production Google Sheet. The column header you choose will be the field name used in the code.
2.  **Frontend (`cases.html.txt`):**
    *   Find the `ALL_FIELDS` JavaScript array near the top of the `<script>` tag.
    *   Add the exact name of your new column (e.g., `"My New Field"`) to this array.
    *   That's it. The application will automatically render the field in the details view, make it editable when "Edit" is clicked, and include it in the data sent to `updateCaseData` when "Save" is clicked.

**Q: How do I add a completely new chart to the Production Dashboard?**
**A:** This is a more advanced task:
1.  **Backend (`code.gs.txt`):**
    *   In the `getProductionReport` function, create a new aggregation object (e.g., `const myNewChartAgg = {};`).
    *   Inside the main `dataInDateRange.forEach` loop, add logic to populate your new aggregation object with data from each row.
    *   After the loop, process your aggregation object to calculate the final data for the chart.
    *   Add your final chart data to the `summary` object that is returned at the end of the function.
2.  **Frontend (`production.html.txt`):**
    *   Add a new chart container element to the HTML body (e.g., `<div class="card chart-card" id="myNewChart"></div>`).
    *   Create a new global variable for the chart instance (e.g., `let myNewChartInstance = null;`).
    *   In the `displaySummaryData` function, add a call to a new rendering function (e.g., `renderMyNewChart(summary.myNewChartData)`).
    *   Create the new rendering function (e.g., `function renderMyNewChart(data) { ... }`). This function will contain the ApexCharts options and logic to create and render your new chart. Use the existing chart functions as a template.

**Q: How do I add a new case action button (e.g., "Send Reminder") to the Case Modal?**
**A:**
1.  **Backend (`code.gs.txt`):**
    *   Create a new top-level function that accepts a `caseId` as its argument (e.g., `function sendReminder(caseId) { ... }`).
    *   Implement the logic for your action inside this function. It should return a success message string or throw an error.
2.  **Frontend (`cases.html.txt`):**
    *   Find the `populateActionButtons` JavaScript function.
    *   Add a new object to the `buttons` array. This object defines the button's appearance and behavior.
    *   Example: `{ text: 'Send Reminder', icon: 'fa-solid fa-bell', className: 'btn-secondary', action: () => handleCaseAction('sendReminder', caseId) }`
    *   (Optional) Add a `condition` property to the object to control when the button should be visible (e.g., `condition: caseData['Status'] === 'In Progress'`).

**Q: How do I add a new filter (e.g., "Priority") to the Production Dashboard?**
**A:**
1.  **Backend (`code.gs.txt`):**
    *   In `getProductionFilterOptions`, add a new `Set` to `uniqueValues` (e.g., `priorities: new Set()`). Find the column index for your new field and add a line to populate the set from the data. Finally, add it to the returned object.
    *   In `getProductionReport`, add your new filter to the list of destructured `filters`.
    *   In the `dataInDateRange.filter` logic, add a new matching condition for your filter (e.g., `const priorityMatch = !selectedPriority || selectedPriority.length === 0 || selectedPriority.includes(row[headerMap.priority]);`). Remember to add it to the final `return` statement.
2.  **Frontend (`production.html.txt`):**
    *   In the `.controls-card` HTML, add a new `<select id="priorityFilter" multiple></select>`.
    *   In `populateFilterDropdowns`, add a new call to `initializeChoice('priorityFilter', options.priorities, 'All Priorities');`.
    *   In `buildFilters`, add `selectedPriority: getChoiceValues('priorityFilter')` to the returned object.

**Q: The app is throwing an error related to "Cannot find function... in object...". What does this mean?**
**A:** This is a common error in Google Apps Script when the frontend calls a backend function that doesn't exist or has a typo in its name.
1.  Check the client-side JavaScript (e.g., the `handleCaseAction` or `loadCases` function) to see the exact name of the backend function being called via `google.script.run`.
2.  Go to `code.gs.txt` and ensure a top-level function with that exact name exists and is spelled correctly.
3.  Remember that only top-level functions in `.gs` files are exposed to the `google.script.run` API. Helper functions prefixed with an underscore (`_`) or functions defined inside another function cannot be called directly from the frontend.

## 4. UI Sections Breakdown

(This section remains largely the same as the previous version, providing a high-level overview of the UI pages.)

## 5. Feature List

(This section remains largely the same as the previous version, providing a high-level list of application features.)

## 6. Standard Operating Procedure (SOP)

(This section remains largely the same as the previous version, providing guides for end-users and developers.)
