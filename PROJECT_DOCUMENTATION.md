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

This section details the three primary user interfaces of the application.

### 4.1. Agent Dashboard (`index.html.txt`)

This is the main daily interface for agents, focused on attendance and personal productivity.

*   **Header & Navigation:** Displays the agent's name, email, and provides access to the "Cases" tab (if authorized) and a sidebar with important links.
*   **Status & Scorecards:**
    *   **Current Status:** A prominent display showing the agent's real-time status (e.g., "Working", "On Break", "Offline").
    *   **Scorecards:** A grid of key performance indicators (KPIs) for the current day, including "Cases Closed Today," "Average Handling Time," "Open Escalated," and "In Progress."
*   **Session Control:** Contains the main "Start Work" and "End Work" buttons that control the agent's daily session. It includes a timer for the total session duration.
*   **Activity Section:** This card appears after an agent starts work and contains buttons to "Start/End Break" and "Start/End Meeting," along with timers for current and total break/meeting durations.
*   **My Case Summary:** A table where agents can view their case activity for a selected date, showing case details and durations.
*   **My Pending Requests:** A table listing any attendance correction requests the agent has submitted that are awaiting manager approval.
*   **Attendance Log:** Allows agents to view their own attendance history for a selected date range and initiate a correction request for any log entry.

### 4.2. Manager Dashboard (`manager.html.txt`)

This is the command center for managers, providing an aggregated view of team performance, attendance, and data integrity.

*   **Header & Navigation:** Provides access to the "Homepage," a "Production" dashboard (for analytics), the "Cases" page, and a "Settings" tab.
*   **Controls & Status:**
    *   **Date Controls:** Date pickers to define the reporting range for all dashboard components.
    *   **Active/Inactive Agents:** Two cards showing real-time lists of which agents are currently working and which are not.
*   **Homepage Tab:**
    *   **Agent Summary:** A collapsible table summarizing each agent's total work, break, and meeting times for the selected date range. Managers can click to view the specific cases handled by an agent during that period.
    *   **Attendance Correction Requests:** A collapsible table where managers can review, approve, and apply or deny correction requests submitted by agents.
    *   **Agent Leaderboard:** A ranked table of agents based on cases completed and average handling time.
    *   **Agent Attendance Log:** A tool for managers to select any agent and view their detailed attendance log for a specific period.
    *   **Anomaly Detection:** A section where managers can scan for data integrity issues (e.g., negative durations, excessive handling times) within a date range.
*   **Settings Tab:**
    *   **User Access Management:** A simple interface for managers to add or remove agents' access to the "Cases" tab.

### 4.3. Case Management Page (`cases.html.txt`)

A dedicated interface for both agents and managers to interact with the full lifecycle of cases.

*   **Tabs & Search:**
    *   **Tabs:** Allows users to toggle between viewing "All Tasks" and "My Cases" (which filters cases assigned to the current user).
    *   **Search Bar:** A powerful search input that filters across multiple key fields (ID, Country, Account Name, etc.) and displays results in a separate, closable table.
    *   **Refresh Button:** A manual "Refresh Live Data" button that invalidates the server-side cache, ensuring the next data load is from the source spreadsheet.
*   **Case Tables:** The main view is organized into collapsible sections based on case status (e.g., "Not Started," "In Progress," "Escalated"). Cases are grouped by country within each status section.
*   **Case Modal:** Clicking on any case opens a detailed modal view with three main parts:
    1.  **Main Details:** A grid displaying all fields from the `Main Tasks` sheet for that case.
    2.  **Log Sections:** Dedicated, collapsible sections below the main details that show related log entries from the `Pausing Logs`, `Escalation Logs`, and `Cooperation Logs` sheets.
    3.  **Action Buttons:** A dynamic set of buttons that change based on the case's status (e.g., "Claim," "Pause," "Unpause," "Escalate," "De-Escalate," "End Case"). It also includes "Edit," "Save," and "Cancel" buttons for modifying case data.
*   **Edit Mode & Recalculation Sidebar:** When "Edit" is clicked, all fields in the modal (both main details and logs) become editable. If a user modifies any timestamp field, a sidebar automatically appears, showing the real-time recalculation of stored durations (like Agent Handling Time) before the changes are saved.

## 5. Feature List

This section outlines the core features of the application, categorized by user role.

### 5.1. Agent Features

*   **Attendance Tracking:**
    *   **Start/End Work:** Clock in and out to create a daily work session.
    *   **Start/End Break:** Log break periods, which are automatically deducted from work time.
    *   **Start/End Meeting:** Log meeting periods, also deducted from work time.
    *   **Real-time Timers:** View running timers for the current session, breaks, and meetings.
*   **Dashboard & Analytics:**
    *   **Live Status:** See current status (Working, On Break, Offline) reflected in the UI.
    *   **Daily Scorecards:** View at-a-glance metrics for cases closed today, average handling time, and the number of escalated or in-progress cases.
    *   **Case Summary:** View a detailed table of personal case activity for any selected date.
*   **Attendance Correction:**
    *   **Viewable Log:** Access a historical log of all personal attendance events (work, break, meeting starts/stops).
    *   **Correction Requests:** Submit a request to a manager to correct an incorrect timestamp, providing a reason for the change.
    *   **Pending Request View:** See a list of submitted correction requests that are awaiting manager approval.
*   **Case Management (with authorized access):**
    *   **View Cases:** Access the shared case management board, with views for "All Tasks" and "My Cases."
    *   **Claim Case:** Assign an unassigned case to oneself, changing its status to "In Progress."
    *   **Lifecycle Management:** Perform actions on a claimed case:
        *   **Pause/Unpause:** Start or stop a pause timer for a case, which is logged separately.
        *   **Escalate/De-Escalate:** Mark a case as needing higher-level attention and bring it back into the normal workflow.
        *   **End Case:** Mark a case as "Completed," automatically calculating and storing final handling and duration metrics.
    *   **Edit Case Data:** Modify any field within a case's details or associated logs.
    *   **Real-time Recalculation:** See an immediate recalculation of Agent Handling Time and other durations when editing timestamp fields.

### 5.2. Manager Features

*   **Team Oversight:**
    *   **Real-time Agent Status:** View lists of all "Active" and "Inactive" agents and their current status (e.g., Working, On Break).
    *   **Agent Summary Report:** Generate a summary of total work, break, and meeting times for all agents within a selected date range.
    *   **Drill-Down Views:** Click on an agent in the summary report to see a detailed list of all cases they handled in that period.
*   **Attendance Management:**
    *   **Correction Request Approval:** Review, approve, or deny attendance correction requests submitted by agents. Approved requests automatically update the agent's official log.
    *   **Full Agent Log Access:** Select any agent from a dropdown to view their complete, historical attendance log for any date range.
*   **Analytics & Reporting:**
    *   **Production Dashboard:** Access a separate, advanced dashboard with visual charts and filterable metrics on team productivity.
    *   **Agent Leaderboard:** View a ranked list of agents based on performance metrics (total cases, average handling time) for a selected period.
    *   **Data Anomaly Detection:** Scan the production data for integrity issues, such as negative durations, excessively long handling times, or invalid timestamps.
*   **System Administration:**
    *   **Case Management Access:** Grant or revoke agent access to the "Cases" tab via a simple settings panel.
*   **Full Case Management Access:**
    *   Managers have all the same case viewing, searching, and editing capabilities as agents.

## 6. Standard Operating Procedure (SOP)

This section provides clear, step-by-step guides for common tasks within the application, separated into procedures for end-users (Agents and Managers) and developers.

### 6.1. End-User SOPs

#### **SOP-USER-01: Agent Daily Workflow**

1.  **Start of Day:**
    *   Navigate to the Agent Dashboard URL.
    *   Click the **"Start Work"** button to begin your session. The main timer will start, and the "Activity" card will appear.
2.  **Handling Cases (if applicable):**
    *   Navigate to the "Cases" tab.
    *   Find an unassigned case in the "Not Started" section and click on it to open the modal.
    *   Click the **"Claim Case"** button. The case is now assigned to you and moves to "In Progress."
3.  **Pausing a Task:**
    *   If you need to step away from a case temporarily, open the case modal and click **"Pause Case."** The case status will change to "Task Paused."
    *   When you return, click **"Unpause Case."** The case will return to "In Progress."
4.  **Taking a Break or Attending a Meeting:**
    *   Return to the "Attendance" tab.
    *   Click **"Start Break"** or **"Start Meeting."** Your status will update, and the respective timer will begin.
    *   When finished, click **"End Break"** or **"End Meeting"** to return to a "Working" status.
5.  **Completing a Case:**
    *   After finishing all work on a case, open its modal.
    *   Ensure all data fields are accurate.
    *   Click the **"End Case"** button. The system will automatically calculate all final durations and move the case to the "Completed" section.
6.  **End of Day:**
    *   Return to the "Attendance" tab.
    *   Click the **"End Work"** button to officially end your session.

#### **SOP-USER-02: Requesting an Attendance Correction**

1.  **Navigate to Log:** On the Agent Dashboard, go to the "Attendance Log" card.
2.  **Select Date:** Use the date pickers to select the range that includes the incorrect entry and click **"View Log."**
3.  **Find Entry:** Locate the incorrect log entry in the table that appears.
4.  **Initiate Request:** Click the **"Edit"** button in that row.
5.  **Fill Modal:**
    *   In the modal that appears, use the "New Corrected Timestamp" picker to set the accurate date and time.
    *   In the "Reason for Correction" box, provide a clear and concise explanation for the change.
6.  **Submit:** Click **"Submit Request."** The request will now appear in your "My Pending Requests" table and on the manager's dashboard for approval.

#### **SOP-USER-03: Manager Approving a Correction**

1.  **Navigate to Requests:** On the Manager Dashboard, find the "Attendance Correction Requests" section.
2.  **Review Request:** Locate the pending request in the table. Review the agent, original time, requested time, and reason.
3.  **Take Action:**
    *   To approve: Click the **"Approve & Apply"** button. The system will automatically find the original log entry, update its timestamp, and mark the request as approved.
    *   To deny: Click the **"Deny"** button. The request will be marked as denied, and the original log will remain unchanged.

#### **SOP-USER-04: Granting Case Management Access**

1.  **Navigate to Settings:** On the Manager Dashboard, click the "Settings" tab in the top navigation bar.
2.  **Add User:**
    *   In the "Manage User Access" section, enter the agent's full email address into the "Agent Email" input field.
    *   Click the **"Add User"** button.
3.  **Verify:** The agent's email should now appear in the "Authorized Users" table below. The "Cases" tab will now be visible for that agent on their next page load.
4.  **Remove User:** To revoke access, find the user in the "Authorized Users" table and click the corresponding **"Remove"** button.

### 6.2. Developer & Maintenance SOPs

#### **SOP-DEV-01: Adding a New Field to the Case Modal**

*This procedure is detailed in Section 3 (Maintenance & Extensibility FAQ) but is summarized here.*

1.  **Spreadsheet:** Add a new column with the desired field name to the **`Main Tasks`** sheet in the Production Google Sheet.
2.  **Code (`cases.html.txt`):**
    *   Locate the `ALL_FIELDS` JavaScript array near the top of the `<script>` tag.
    *   Add the exact, case-sensitive name of your new column to this array as a string.
3.  **Deploy:** Save the changes. The field will now automatically appear in the case modal's view and edit modes.

#### **SOP-DEV-02: Adding a New Case Action Button**

*This procedure is also covered in Section 3 and is summarized here.*

1.  **Backend (`code.gs.txt`):**
    *   Create a new, top-level function that accepts a `caseId` argument (e.g., `function requestReview(caseId) { ... }`).
    *   Implement the desired logic. The function should perform its actions and return a success message string.
2.  **Frontend (`cases.html.txt`):**
    *   Find the `populateActionButtons` JavaScript function.
    *   Add a new button definition object to the `buttons` array. Define its text, icon, CSS class, the `action` it calls (e.g., `handleCaseAction('requestReview', caseId)`), and an optional `condition` for its visibility.

#### **SOP-DEV-03: Deploying a New Version**

1.  **Update Version Number:**
    *   In `code.gs.txt`, locate the `SCRIPT_APP_VERSION` constant at the top of the file.
    *   Increment the version number (e.g., from `"8.1"` to `"8.2"`).
2.  **Update Version Config Sheet:**
    *   Open the Attendance Google Sheet (`CONFIG.ATTENDANCE.ID`).
    *   Navigate to the **`UpdateConfig`** sheet.
    *   Update the `LatestVersion` field to the new version number (e.g., `8.2`).
    *   Update the `LatestFeatures` field with a comma-separated list of new features or fixes.
    *   **Crucially:** Update the `LatestVersionURL` with the new deployment URL you will generate in the next step.
3.  **Deploy in Apps Script:**
    *   In the Apps Script editor, click **Deploy > New deployment**.
    *   Select the deployment type (e.g., "Web app").
    *   Enter a description for the new version (e.g., "Added feature X, fixed bug Y").
    *   Ensure "Execute as" is set to "Me" and "Who has access" is set to "Anyone with Google account."
    *   Click **Deploy**.
4.  **Final URL Update:**
    *   Copy the new "Web app" URL provided after deployment.
    *   Paste this new URL into the `LatestVersionURL` field in the `UpdateConfig` sheet as mentioned in step 2. This enables the automatic "Update Available" notification for users.
