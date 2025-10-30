# Standard Operating Procedure (SOP) - BoltVerse Attendance & Production App

---

## 1. Introduction

This document provides a comprehensive technical and non-technical overview of the BoltVerse Attendance & Production App. It details the functionality of each component, from the user-facing dashboards to the backend data processing and calculations. This SOP is intended for developers, managers, and administrators to understand the application's architecture, workflows, and logic.

---

## 2. System Architecture

The application is a Google Apps Script web app that uses Google Sheets as its database. The architecture is divided into two main parts:

- **Frontend:** A series of HTML files (`.html.txt`) with embedded JavaScript and CSS that create the user interface. The frontend communicates with the backend using `google.script.run`.
- **Backend:** A single Google Apps Script file (`code.gs.txt`) that contains all the business logic, data manipulation functions, and routing for the web app.

### Data Sources:

The application relies on two primary Google Spreadsheets, defined in the `CONFIG` object in `code.gs.txt`:

1.  **Attendance Spreadsheet (`CONFIG.ATTENDANCE.ID`):** Contains sheets for `AgentLog`, `CaseLog`, `Agents`, `Managers`, `Requests`, and other configuration data.
2.  **Production Spreadsheet (`CONFIG.PRODUCTION.ID`):** Contains the main task data in a sheet named `Main Tasks`, as well as logs for escalations, pausing, and cooperation.

---

## 3. Agent Attendance Dashboard (`index.html.txt`)

This is the primary interface for agents. It allows them to manage their work status, track their performance, and review their attendance logs.

### 3.1. User Interface Components

-   **Header & Navigation:**
    -   Displays "Agent Dashboard," the agent's email and name, and the application's version.
    -   Features two main tabs: "Attendance" (the default view) and "Cases," which provides a link to the case management page (`cases.html.txt`). The "Cases" tab is only visible if the user has been granted access.

-   **Status & Scorecards:**
    -   **Current Status:** A prominent display showing the agent's real-time status: `Offline`, `Working`, `On Break`, or `In Meeting`.
    -   **Scorecards:** A grid of key performance indicators (KPIs) for the current day:
        -   **Cases Closed Today:** Total cases marked as "Completed" or "Finished" by the agent today.
        -   **Avg. Handling Time:** The average time spent actively working on cases that were closed today.
        -   **Open Escalated:** The number of cases currently assigned to the agent with a status of "Escalated."
        -   **In Progress:** The number of cases currently assigned to the agent with a status of "In Progress."

-   **Session & Activity Control:**
    -   **Session Control:** Contains the primary **Start Work / End Work** button. This controls the main work session for the day. A timer displays the total duration of the current work session.
    -   **Activity Section:** This section is only visible when the agent is in an active work session. It contains:
        -   **Start Break / End Break** button.
        -   **Start Meeting / End Meeting** button.
        -   Timers that display the duration of the current break/meeting and the total time spent in breaks/meetings during the session.

-   **Data & Logs:**
    -   **My Case Summary:** Allows the agent to select a date and view a table of all cases they completed on that day, including start/end times and total duration.
    -   **My Pending Requests:** A table that shows any attendance log corrections the agent has submitted that are still awaiting manager approval.
    -   **Attendance Log:** A detailed, timestamped log of all the agent's activities (e.g., Start Work, End Break) for a selected date range. Each log entry has an "Edit" button, which allows the agent to request a correction for that specific entry.

-   **Correction Modal:**
    -   A pop-up form that appears when an agent clicks the "Edit" button in their attendance log.
    -   It allows the agent to propose a new timestamp for the log entry and provide a reason for the change. Submitting this form sends a request to the manager for approval.

### 3.2. Frontend Logic & Backend Interactions

The frontend logic within the `<script>` tag of `index.html.txt` manages the UI and communicates with the backend (`code.gs.txt`).

-   **Initialization (`initializePage`)**
    -   **Frontend:** When the page loads, this function is called. It sets the date pickers to the current day.
    -   **Backend Call:** It immediately calls `getInitialAgentState()` on the backend.
    -   **Response:** The backend returns a state object containing the agent's current status (`isWorking`, `isOnBreak`, etc.), session start times, and other relevant data. The frontend then uses this object to render the UI in the correct state (e.g., showing "End Work" if a session is already active).
    -   **Additional Calls:** It also calls `loadDashboardMetrics()`, `loadPendingRequests()`, and `checkUserCaseAccess()` to populate the scorecards, pending requests table, and determine if the "Cases" tab should be shown.

-   **State Management (`updateUiFromState`)**
    -   **Frontend:** This is the core rendering function. Whenever the agent's state changes, this function is called to update the entire UI. It enables/disables buttons, changes status text and colors, and starts/stops timers based on the data in the `currentAgentState` object.

-   **Logging Actions (`handleWorkToggle`, `handleBreakToggle`, `handleMeetingToggle`)**
    -   **Frontend:** When an agent clicks a status button (e.g., "Start Break"), the corresponding `handle` function is triggered.
    -   **Backend Call:** The function calls the generic `logAgentAction(actionType)` function on the backend, passing the action as a string (e.g., "Start Break").
    -   **Backend Logic:** `logAgentAction` records the new event in the `AgentLog` sheet and then recalculates the agent's current state by calling the internal `_determineCurrentAgentState` function.
    -   **Response:** It returns the new, updated state object to the frontend. The frontend receives this new state and calls `updateUiFromState` to re-render the UI accordingly.

-   **Displaying Data (e.g., `loadAttendanceLog`, `loadMyCaseSummary`)**
    -   **Frontend:** When an agent selects a date and clicks "View Log" or "View Summary," the corresponding frontend function is called.
    -   **Backend Call:** It calls the appropriate backend function (e.g., `getAgentAttendanceLog(dateRange)`).
    -   **Backend Logic:** The backend function queries the relevant Google Sheet (`AgentLog` or `Main Tasks`), filters the data by agent email and the selected date range, and serializes it into a JSON-friendly format.
    -   **Response:** The backend returns an array of log objects or case summary objects, which the frontend then uses to build and display the HTML table.

-   **Correction Workflow (`openCorrectionModal`, `submitCorrectionFromLog`)**
    -   **Frontend:** Clicking "Edit" on a log entry opens a modal. When the agent fills out the form and clicks "Submit Request," the `submitCorrectionFromLog` function is called.
    -   **Backend Call:** This function calls `logCorrectionRequest(originalLogData, reason, newTimestampStr)` on the backend.
    -   **Backend Logic:** The `logCorrectionRequest` function appends a new row to the `Requests` sheet in the Attendance spreadsheet. This new row contains the original log details, the requested new timestamp, the reason for the change, and a status of "Waiting to be Approved."
    -   **Response:** The backend returns a success message, and the frontend refreshes the "My Pending Requests" table to show the newly submitted request.

---

## 4. Manager Dashboard (`manager.html.txt`)

The Manager Dashboard provides an aggregated view of agent activity, performance, and data integrity. It is the central hub for supervisors to monitor team productivity and manage administrative tasks.

### 4.1. User Interface Components

-   **Header & Navigation:**
    -   The header displays "Manager Dashboard."
    -   Navigation tabs allow managers to switch between the "Homepage" (the default view), "Production" (links to the Production Dashboard), "Cases" (links to the Case Management page), and "Settings."

-   **Data Loading Controls:**
    -   Managers can select a date or a date range to filter the data displayed in the dashboard's summary sections.
    -   The "Load Data" button triggers the data fetching process for the selected period.

-   **Real-time Agent Status:**
    -   **Active Agents:** A list of agents who are currently in an active work session, displaying their name and current status (e.g., "Working," "On Break").
    -   **Inactive Agents:** A collapsible list showing agents who are not currently in a work session.

-   **Data Summary Sections (Collapsible):**
    -   **Agent Summary:** A table summarizing each agent's total work time, break time, and meeting time for the selected date range. Each row includes a "View Cases" button to drill down into an agent's case activity.
    -   **Attendance Correction Requests:** A table listing all pending attendance correction requests submitted by agents. Managers can approve or deny requests directly from this table. Approving a request automatically updates the `AgentLog`.
    -   **Agent Leaderboard:** Ranks agents based on the number of cases completed within the selected date range and displays their average handling time.
    -   **Agent Attendance Log:** Allows the manager to select a specific agent and a date range to view their detailed attendance log, similar to the agent's own view but for any agent.
    -   **Anomaly Detection:** A powerful tool that scans the production data for potential issues, such as negative durations, invalid timestamps, or excessively long handling times. For certain anomalies, a "Fix Calculation" button is provided to correct the data.

-   **Settings Tab:**
    -   Provides an interface to manage user access to the "Cases" tab. Managers can add or remove authorized users (agents) from a list stored in the `BackupSystemAccess` sheet.

### 4.2. Frontend Logic & Backend Interactions

-   **Initialization (`initializePage`)**
    -   **Frontend:** On page load, date pickers are set to the current day, and a series of functions are called to populate the dashboard with initial data.
    -   **Backend Calls:**
        -   `loadActiveAgents()` and `loadInactiveAgents()` call the backend functions `getActiveAgentStatuses()` and `getInactiveAgentStatuses()` respectively to get real-time status updates.
        -   `loadApprovalRequests()` calls `getPendingApprovalRequests()` to populate the correction requests table.
        -   `loadAnomalies()` calls `getAnomalies()` to scan for data issues.
        -   `loadAllAgentsForDropdown()` calls `getAllAgents()` to populate the agent selector in the "Agent Attendance Log" section.

-   **Loading Summary Data (`loadManagerData`)**
    -   **Frontend:** When the manager clicks "Load Data," this function is triggered.
    -   **Backend Calls:** It makes two main calls to the backend:
        1.  `getManagerAttendanceSummary(startDate, endDate)`: This function calculates the total work, break, and meeting durations for each agent based on the `AgentLog`.
        2.  `getLeaderboardData(startDate, endDate)`: This function queries the `Main Tasks` sheet to calculate the number of completed cases and average handling time for each agent.
    -   **Response:** The frontend receives the aggregated data and uses it to render the "Agent Summary" and "Agent Leaderboard" tables.

-   **Drill-down Functionality (`toggleAgentCases`, `toggleLeaderboardDetails`)**
    -   **Frontend:** Clicking "View Cases" in the Agent Summary or clicking on a row in the Leaderboard triggers a `toggle` function. This function dynamically creates a new "details" row in the table.
    -   **Backend Call:** It then calls a specific backend function, such as `getAgentCasesForDateRange(agentEmail, startDate, endDate)`, to fetch the detailed case data for that specific agent and period.
    -   **Response:** The backend returns a list of case objects, which the frontend then uses to build and display a detailed table within the "details" row.

-   **Approval Workflow (`handleApproveAction`, `handleDenyAction`)**
    -   **Frontend:** When a manager clicks "Approve & Apply" or "Deny" on a correction request, the corresponding `handle` function is called.
    -   **Backend Call:**
        -   **Approve:** Calls `applyCorrection(rowNumber)`. The backend finds the original log entry in `AgentLog` and updates its timestamp. It then updates the status of the request in the `Requests` sheet to "Approved."
        -   **Deny:** Calls `updateRequestStatus(rowNumber, 'Denied')`. The backend simply updates the status in the `Requests` sheet to "Denied" without modifying the `AgentLog`.
    -   **Response:** The backend returns a success message, and the frontend removes the processed request from the table.

-   **Anomaly Correction (`previewFix`, `applyFix`)**
    -   **Frontend:** Clicking "Fix Calculation" for an anomaly opens a modal and calls `previewFix(caseId)`.
    -   **Backend Call (`previewHandlingTimeFix`):** This function calls `calculateCorrectedHandlingTime_(caseId)` on the backend. This powerful function recalculates the agent handling time from scratch by fetching all raw pause and escalation logs, merging overlapping time intervals, and subtracting the total "downtime" from the gross case duration.
    -   **Response:** It returns the current stored (incorrect) AHT and the newly calculated (correct) AHT. The frontend displays this in the modal for the manager to review.
    -   **Confirmation (`applyFix`):** If the manager confirms, the frontend calls `fixHandlingTimeAnomaly(caseId)`.
    -   **Backend Call (`fixHandlingTimeAnomaly`):** The backend recalculates the AHT again (to ensure data consistency) and then updates the `Stored Agent Handling Time` value for that specific case in the `Main Tasks` sheet, applying the correct number formatting.

---

## 5. Production Dashboard (`production.html.txt`)

This dashboard provides a high-level, interactive view of production metrics. It is designed for data analysis, allowing users to filter and visualize the entire dataset from the `Main Tasks` sheet.

### 5.1. User Interface Components

-   **Header:** Displays "Production Dashboard" and the application version.

-   **Filter Controls:** A comprehensive control panel allows for deep data filtering:
    -   **Date Range:** Select a start date and an end date.
    -   **Multi-select Dropdowns:** Advanced dropdowns (using the Choices.js library) allow for filtering by one or more of the following:
        -   Status
        -   Market (Country)
        -   Category
        -   Task Type
        -   Retailer Type
        -   SLA Missed Reason
    -   **Load Data Button:** Applies the selected filters and refreshes the entire dashboard.

-   **Data Sections:** The main body of the dashboard is composed of several sections, each containing a data table and a corresponding chart for visualization.
    -   **Task Summary:** A set of scorecards showing the total count of tasks for each status (e.g., Completed, In Progress, Escalated).
    -   **Task Count by Market:** A table and a stacked bar chart showing the distribution of task statuses across different markets.
    -   **TAT Adherence by Market:** A table and a 100% stacked bar chart visualizing the percentage of tasks that met or missed their Turnaround Time (TAT) SLA.
    -   **TAT Bucket:** A table and a stacked bar chart that categorizes tasks by how long they have been open (e.g., <24 hours, 24-30 hours).
    -   **Menu Complexity Analysis:** A table and a bar chart showing the average Agent Handling Time (AHT), number of dishes, photos, etc., per market.
    -   **Average AHT per Market by Month:** A table and a line chart that trend the AHT for each market over time.
    -   **Average AHT by Retailer Provider Type:** A table and a bar chart comparing the AHT for different types of retailers.
    -   **Average AHT by Category:** A table and a bar chart comparing the AHT for different task categories.

-   **Drill-down Functionality:**
    -   Most numerical values in the tables are clickable. Clicking on a number will fetch and display a detailed table of the specific tasks that make up that number.
    -   The drill-down view includes a "Download" button, which allows the user to export the detailed data to a new Google Sheet.

### 5.2. Frontend Logic & Backend Interactions

-   **Initialization (`window.onload`)**
    -   **Frontend:** When the page loads, it sets the date pickers to the current day.
    -   **Backend Call:** It calls `getProductionFilterOptions()` to fetch all unique values for the multi-select dropdowns (e.g., all available statuses, markets).
    -   **Response:** The backend returns an object containing arrays of unique values. The frontend then uses this data to populate the filter dropdowns using the Choices.js library.
    -   **Initial Data Load:** The page automatically calls `loadProductionData()` to load the data for the current day.

-   **Loading Production Data (`loadProductionData`)**
    -   **Frontend:** When the user clicks "Load Data," this function gathers all the selected values from the date pickers and multi-select dropdowns into a `filters` object.
    -   **Backend Call:** It calls the main data aggregation function on the backend: `getProductionReport(filters)`.
    -   **Backend Logic (`getProductionReport`):** This is one of the most complex functions in the backend.
        1.  It receives the `filters` object from the frontend.
        2.  It reads the entire `Main Tasks` sheet from the Production spreadsheet.
        3.  It performs a comprehensive filtering operation based on the selected date range, statuses, markets, etc.
        4.  It then iterates through the filtered data, aggregating it into multiple structured objects that correspond to each section of the dashboard (e.g., `marketCounts`, `tatCounts`, `menuComplexityAgg`).
        5.  It performs calculations on the aggregated data, such as calculating averages, sums, and percentages.
    -   **Response:** The backend returns a large `summary` object containing all the aggregated data. The frontend then calls `displaySummaryData`, which in turn calls individual `display` and `render` functions for each table and chart on the dashboard.

-   **Drill-down (`toggleCaseDetails`)**
    -   **Frontend:** When a user clicks a clickable number in a table, this function is called. It identifies which metric was clicked (e.g., "Completed" for "Portugal").
    -   **Backend Call:** It re-calls the `getProductionReport(filters)` function, but this time it includes additional `drillDownStatus` and `drillDownMarket` parameters in the `filters` object.
    -   **Backend Logic:** The `getProductionReport` function detects the drill-down parameters. After performing the main data aggregation, it performs a second, more specific filtering pass to isolate only the rows that match the drill-down criteria.
    -   **Response:** The backend returns both the main `summary` object and a `details` array containing the specific rows for the drill-down. The frontend then uses this `details` array to build and display a detailed table.

-   **Downloading Data (`downloadDrilldownData`)**
    -   **Frontend:** When a user clicks the "Download" button in a drill-down view, this function is called. It gathers the data from the drill-down table.
    -   **Backend Call:** It calls `createSheetWithData(data, headers, fileName)` on the backend.
    -   **Backend Logic:** The `createSheetWithData` function creates a brand new Google Spreadsheet, populates it with the provided data and headers, applies basic formatting (like bolding the header), and then returns the URL of the new sheet.
    -   **Response:** The frontend receives the URL of the newly created spreadsheet and opens it in a new tab.

---

## 6. Case Management Interface (`cases.html.txt`)

This page is the primary workspace for agents to view, claim, and manage their assigned cases. It is accessible to all managers and to agents who have been granted specific access.

### 6.1. User Interface Components

-   **Header & Navigation:**
    -   Displays "Case Management" and the application version.
    -   Includes tabs for "All Tasks" and "My Cases," allowing users to filter the view.

-   **Search and Refresh:**
    -   **Search Bar:** A powerful search input that allows users to find cases by ID, country, account name, or other keywords.
    -   **Refresh Live Data Button:** This button manually invalidates the server-side cache, forcing the application to fetch the absolute latest data from the Google Sheet on the next load. This is a critical feature for ensuring data consistency.

-   **Case Display:**
    -   Cases are organized into collapsible sections based on their status (e.g., "Not Started," "In Progress," "Escalated").
    -   Each status section displays a table of cases with key information like SLA status, request date, Task ID, country, and account name.
    -   Tables are paginated with a "Show More" button to load additional cases on demand.
    -   The entire table can be sorted by clicking on the column headers.

-   **Case Details Modal:**
    -   Clicking on any case in the tables opens a detailed modal view.
    -   **Header:** Displays the case ID and includes a "Refresh" button to fetch the latest data for only that specific case.
    -   **Details Grid:** A comprehensive grid showing all fields for the selected case.
    -   **Log Sections:** Separate, clearly marked sections display any associated "Escalation Logs," "Pausing Logs," and "Cooperation Logs" for the case.
    -   **Action Buttons:** A dynamic set of buttons appears based on the case's current status (e.g., "Claim Case," "Pause Case," "End Case").
    -   **Edit/Save Controls:** An "Edit" button allows authorized users to modify case data. When in edit mode, this changes to "Save" and "Cancel."

-   **Edit Mode & Recalculation Sidebar:**
    -   When a user clicks "Edit," the fields in the modal become editable inputs, textareas, or dropdowns.
    -   If a user modifies any timestamp field (in the main details or in the logs), a sidebar appears on the right.
    -   This sidebar shows a real-time preview of how the **Agent Handling Time**, **Pause Duration**, and **Escalation Duration** will be recalculated based on the new timestamps. This provides immediate feedback and transparency into the calculation logic.

### 6.2. Frontend Logic & Backend Interactions

-   **Initialization (`initializeBoard`)**
    -   **Frontend:** On page load, the interface is built by creating a table section for each status defined in the `STATUS_SECTIONS` array. It then automatically loads the initial set of cases for the "Not Started" and "In Progress" sections.

-   **Data Loading and Caching (`loadCases`)**
    -   **Frontend:** This function is called to load cases for a specific status. It constructs an `options` object containing the status, search term, pagination offset, and current tab ('all' or 'my').
    -   **Backend Call:** It calls `getCasesByStatus(options)`.
    -   **Backend Logic (`getCasesByStatus`):** This function implements a sophisticated versioned caching strategy to balance performance and data freshness.
        1.  **Cache Check:** It first checks for a cached "manifest" for the current data version. If the manifest and all its data "chunks" are found in the cache, it serves the data directly from the cache.
        2.  **Cache Miss & Locking:** If the cache is stale or missing, it acquires a script lock (`LockService`) to prevent multiple users from fetching data simultaneously.
        3.  **Data Fetch:** It reads the *entire* `Main Tasks` sheet, along with any open pause/escalation logs.
        4.  **Cache Population:** It stores the freshly fetched data in the script cache, broken into chunks to avoid size limits, and updates the version number.
        5.  **Filtering & Serialization:** Finally, it filters the data based on the user's request (status, 'my cases', etc.), serializes it to a consistent format (converting durations to seconds), and returns the paginated results.
    -   **Response:** The frontend receives the array of case objects and renders them in the appropriate table.

-   **Case Modal Workflow (`openCaseModal`, `renderModalContent`)**
    -   **Frontend:** Clicking a case triggers `openCaseModal(caseId)`.
    -   **Backend Call:** This function immediately calls `getCaseDetailsById(caseId)`.
    -   **Backend Logic (`getCaseDetailsById`):** This function is designed for fetching all data related to a *single* case.
        1.  It finds the specific case row in the `Main Tasks` sheet.
        2.  It then calls `getLogsForCase(caseId)` to fetch all related log entries from the `Pausing Logs`, `Escalation Logs`, and `Cooperation Logs` sheets.
        3.  It bundles the main case data and all its logs into a single object.
        4.  Crucially, it serializes this entire object using `serializeCaseData_` to ensure all dates are in a consistent ISO format and all durations are converted to total seconds before sending to the frontend.
    -   **Response:** The frontend receives the complete, serialized case object. The `renderModalContent` function then populates all fields, displays the logs, and dynamically generates the correct action buttons based on the case's state.

-   **Case Actions (e.g., `claimCase`, `pauseCase`, `endCase`)**
    -   **Frontend:** Clicking an action button (e.g., "Pause Case") calls a generic `handleCaseAction` function, which in turn calls the specific action function on the backend.
    -   **Backend Calls:**
        -   `claimCase(caseId)`: Updates the `Useremail` field and sets the status to "In Progress."
        -   `pauseCase(caseId)`: Creates a new entry in the `Pausing Logs` sheet with a start time and updates the main case status.
        -   `unpauseCase(caseId)`: Finds the open log entry in `Pausing Logs`, sets the end time, calculates the duration, updates the `Stored Pause Duration` in the main sheet, and sets the status back to "In Progress."
        -   `escalateCase` / `deEscalateCase`: Follow a similar log-and-update pattern.
        -   `endCase(caseId)`: This is a critical function that performs final calculations. It calls `calculateCorrectedHandlingTime_` to get the definitive AHT, updates all `Stored...` duration fields, sets the `Main Task End Date/Time`, and changes the status to "Completed."
    -   **Data Integrity:** All backend functions that modify data call `SpreadsheetApp.flush()` to commit changes immediately and `invalidateCasesCache()` to ensure all users will see the updated data on their next action.

-   **Editing and Saving (`toggleEditMode`, `saveChanges`)**
    -   **Frontend:** `toggleEditMode` converts display spans into input/select/textarea fields. As the user edits timestamps, `handleTimestampChange` is triggered, which recalculates durations in real-time and displays them in the sidebar.
    -   **Backend Call (`saveChanges`):** When the user clicks "Save," the frontend collects all data from the main fields and the log fields. It then makes parallel calls to `updateCaseData` (for the main case) and `updateLogData` (for each modified log entry).
    -   **Backend Logic:** The `updateCaseData` and `updateLogData` functions are robust handlers that can update any field. They intelligently apply number formatting based on whether the field is a date/time or a duration, ensuring data is stored correctly in the Google Sheet.

---
## 7. Backend Logic and Key Functions (`code.gs.txt`)

This file is the brain of the application. It handles all data processing, business logic, and communication with the Google Sheets database. All functions in this file are exposed to the frontend via the `google.script.run` API.

### 7.1. Core Concepts

-   **Centralized Configuration (`CONFIG`):** A global constant object at the top of the file that holds all spreadsheet IDs and sheet names. This makes the script easy to configure and maintain without hardcoding values in functions.

-   **Routing (`doGet`):** This is the main entry point for the web app. It determines which HTML file to serve based on the URL parameters (e.g., `?page=cases`) and the user's role (manager or agent). It uses `HtmlService.createTemplateFromFile` to process and serve the HTML, which allows for the use of scriptlets (`<?= ... ?>`) in the HTML files.

-   **Data Serialization and Durations:**
    -   Google Sheets stores durations as a fraction of a day (e.g., 12 hours is 0.5). When read by Apps Script, these often become `Date` objects relative to an epoch of `1899-12-30`.
    -   To handle this consistently, the script uses a `SPREADSHEET_EPOCH_OFFSET_MS` constant.
    -   The `serializeCaseData_` function is a critical helper that converts all `Date` objects to ISO strings and, most importantly, correctly converts duration `Date` objects into a total number of seconds. This ensures that the frontend always deals with simple, reliable numbers for durations.
    -   Conversely, when writing data back (`updateCaseData`), duration values (in seconds) are converted back to the fractional day format that Google Sheets expects, and the cell's number format is set to `[h]:mm:ss.SSS` to ensure it's displayed correctly as a duration.

-   **Caching and Performance (`CacheService`, `LockService`):**
    -   To avoid hitting Google Sheets rate limits and to improve performance, the application uses a versioned, chunked caching strategy for the main `Main Tasks` sheet.
    -   **`invalidateCasesCache()`:** This function increments a version number stored in `CacheService`.
    -   **`getCasesByStatus()`:** This function constructs its cache keys using the current version number (e.g., `v123_main_tasks_chunk_0`). When `invalidateCasesCache` is called, the version number changes, effectively making all old cache keys obsolete. This forces a fresh read from the spreadsheet on the next data request.
    -   **`LockService`:** This is used to prevent a "cache stampede," where multiple users request data simultaneously when the cache is empty. The first user to acquire the lock fetches the data and populates the cache, while subsequent users wait for the lock to be released and then read the newly populated cache.

### 7.2. Key Function Breakdowns

-   **`getInitialAgentState()` / `_determineCurrentAgentState()`**
    -   **Purpose:** To determine an agent's current status at the moment the page loads.
    -   **Logic:** It reads the entire `AgentLog` for the current user, sorts it by timestamp, and replays the events to find the last "Start Work" entry. From there, it checks for subsequent "Start/End Break" or "Start/End Meeting" events to determine the final, current state. It also scans the `CaseLog` to build a list of cases the agent has started but not yet finished or escalated.

-   **`getProductionReport(filters)`**
    -   **Purpose:** The main data aggregation engine for the Production Dashboard.
    -   **Logic:**
        1.  Reads the entire `Main Tasks` sheet.
        2.  Applies the user's selected filters (date, status, market, etc.).
        3.  Loops through the filtered rows and aggregates data into various objects for each chart/table (e.g., counting statuses per market, summing durations for AHT calculations).
        4.  If drill-down parameters are present, it performs a second filtering pass on the data to isolate the specific rows needed for the drill-down view.
        5.  Returns a large object containing both the aggregated `summary` data and the `details` for any drill-down.

-   **`calculateCorrectedHandlingTime_(caseId)`**
    -   **Purpose:** To provide the most accurate possible calculation for Agent Handling Time, ignoring any stored (and potentially incorrect) values. This is the source of truth for AHT.
    -   **Logic:**
        1.  Fetches the main task's start and end times.
        2.  Fetches *all* raw `Pausing Logs` and `Escalation Logs` for the case.
        3.  **Clipping:** It "clips" each log interval, ensuring that any pause/escalation time that occurred *before* the main task started or *after* it ended is ignored.
        4.  **Merging:** It takes all the clipped pause and escalation intervals and merges any that overlap into single, contiguous blocks of "downtime." This is the most critical step, as it prevents double-counting downtime (e.g., a case that was both paused and escalated at the same time).
        5.  **Calculation:** It subtracts the total merged downtime (in seconds) from the gross duration of the case (End Time - Start Time) to get the final, accurate AHT.

-   **`updateCaseData(caseId, updatedData)`**
    -   **Purpose:** A generic and robust function for updating any field in the `Main Tasks` sheet for a given case.
    -   **Logic:**
        1.  Finds the row corresponding to the `caseId`.
        2.  Iterates through the `updatedData` object. For each key (which corresponds to a column header):
        3.  It finds the correct column index.
        4.  It uses helper functions (`isDateTimeField_`, `isDurationField_`) to determine the data type.
        5.  It applies the correct value and number formatting to the cell (`.setValue().setNumberFormat(...)`). This ensures dates are stored as dates and durations are stored and displayed correctly as durations.
        6.  Calls `SpreadsheetApp.flush()` and `invalidateCasesCache()` to ensure data integrity.

-   **Case Action Functions (`claimCase`, `pauseCase`, `endCase`, etc.)**
    -   **Purpose:** These functions orchestrate the multi-step process for agent actions.
    -   **Logic:** They typically follow a pattern of:
        1.  Creating a new log entry in the appropriate log sheet (e.g., `createNewLogEntry`).
        2.  Closing any previously open log entries if necessary (e.g., `endOpenLogEntry`).
        3.  Updating the status in the `Main Tasks` sheet (e.g., `updateCaseStatus`).
        4.  For final actions like `unpauseCase` or `endCase`, they also perform duration calculations and update the corresponding `Stored...` fields in the `Main Tasks` sheet.
    -   **Error Handling:** The `claimCase` function includes a specific check to see if a case has already been assigned an email, throwing a user-friendly error if it has. This prevents two agents from claiming the same case in a race condition.
