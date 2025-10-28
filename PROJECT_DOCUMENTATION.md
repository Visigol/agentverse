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

## 2. UI Sections Breakdown

This section details the components of each HTML page and the backend functions that support them.

### `index.html.txt` (Agent Dashboard)

*   **Purpose:** Provides agents with a view of their current status, daily performance, and tools to manage their attendance.
*   **Sections:**
    *   **Header:** Displays the logged-in agent's email and name.
        *   **Backend:** `getInitialAgentState()`
    *   **Session Control:** "Start/End Work" button and session timer.
        *   **Backend:** `handleWorkToggle()` -> `logAgentAction()`
    *   **Activity Section:** "Start/End Break" and "Start/End Meeting" buttons with associated timers.
        *   **Backend:** `handleBreakToggle()`, `handleMeetingToggle()` -> `logAgentAction()`
    *   **My Case Summary:** A table showing cases the agent has handled on a selected date.
        *   **Backend:** `loadMyCaseSummary()` -> `getAgentSummaryFromAvailableCases()`
    *   **My Pending Requests:** Lists any attendance correction requests the agent has submitted that are awaiting manager approval.
        *   **Backend:** `loadPendingRequests()` -> `getPendingRequests()`
    *   **Attendance Log:** A detailed log of the agent's work, break, and meeting activities. Includes an "Edit" button to request corrections.
        *   **Backend:** `loadAttendanceLog()` -> `getAgentAttendanceLog()`, `submitCorrectionFromLog()` -> `logCorrectionRequest()`
    *   **Sidebar:** Provides quick access to important links.
        *   **Backend:** `loadImportantLinks()` -> `getImportantLinks()`

### `cases.html.txt` (Case Management)

*   **Purpose:** The primary interface for viewing, searching, and managing all cases. Accessible to managers and authorized agents.
*   **Sections:**
    *   **Tabs:** Allows switching between "All Tasks" and "My Cases" (filtered to the current user).
        *   **Backend:** The `filter` parameter is passed to `getCasesByStatus()`.
    *   **Search Bar:** Filters cases by keywords across multiple fields. Includes a "Refresh Live Data" button to clear the server cache.
        *   **Backend:** `handleSearch()` -> `searchAllCases()`, `refreshCache()` -> `manuallyInvalidateCache()`
    *   **Cases Container:** Displays cases in collapsible tables, grouped by status (e.g., 'Not Started', 'In Progress') and then by country.
        *   **Backend:** `initializeBoard()` -> `loadCases()` -> `getCasesByStatus()`
    *   **Case Modal:** A detailed pop-up view for a single case.
        *   **Details Grid:** Shows all fields for the selected case.
            *   **Backend:** Data is initially loaded from a local JavaScript store (`caseDataStore`). The modal can be refreshed with the latest data using `refreshSingleCaseView()` -> `getCaseDetailsById()`.
        *   **Log Sections:** Displays related Escalation, Pausing, and Cooperation logs in separate grids.
            *   **Backend:** `openCaseModal()` triggers `getLogsForCase()`.
        *   **Action Buttons:** A dynamic set of buttons (Claim, Pause, Escalate, etc.) based on the case's current status.
            *   **Backend:** `populateActionButtons()` calls `handleCaseAction()`, which in turn calls specific backend functions like `claimCase()`, `pauseCase()`, etc.
        *   **Edit/Save Workflow:** Allows users to modify case fields and log entries directly.
            *   **Backend:** `saveChanges()` calls `updateCaseData()` for main fields and `updateLogData()` for log entries.
        *   **Recalculation Sidebar:** Appears during editing to show real-time calculations of handling time as timestamps are modified.

### `manager.html.txt` (Manager Dashboard)

*   **Purpose:** A centralized dashboard for managers to oversee agent activity, approve requests, and analyze data.
*   **Sections:**
    *   **Controls:** Date filters that control the data displayed across the entire dashboard.
        *   **Backend:** The selected dates are passed to functions like `getManagerAttendanceSummary()` and `getLeaderboardData()`.
    *   **Active/Inactive Agents:** Two cards showing real-time agent statuses.
        *   **Backend:** `loadActiveAgents()` -> `getActiveAgentStatuses()`, `loadInactiveAgents()` -> `getInactiveAgentStatuses()`
    *   **Agent Summary:** A table summarizing each agent's work, break, and meeting durations. Rows can be expanded to show detailed case activity.
        *   **Backend:** `loadManagerData()` -> `getManagerAttendanceSummary()`. Drill-down uses `toggleAgentCases()` -> `getAgentCasesForDateRange()`.
    *   **Attendance Correction Requests:** A table listing pending requests from agents, with "Approve" and "Deny" buttons.
        *   **Backend:** `loadApprovalRequests()` -> `getPendingApprovalRequests()`. Actions call `applyCorrection()` or `updateRequestStatus()`.
    *   **Agent Leaderboard:** Ranks agents based on performance metrics like cases completed and average handling time.
        *   **Backend:** `loadLeaderboardData()` -> `getLeaderboardData()`
    *   **Anomaly Detection:** A section to scan for and display data integrity issues within a selected date range.
        *   **Backend:** `loadAnomalies()` -> `getAnomalies()`
    *   **Settings Tab:** An administrative panel for managing which users have access to the "Cases" tab.
        *   **Backend:** `addUserAccess()`, `loadAuthorizedUsers()` -> `getAuthorizedUsers()`, `removeUserAccess()`.

### `production.html.txt` (Production Dashboard)

*   **Purpose:** A dedicated, highly-visual dashboard for in-depth analysis of production metrics.
*   **Sections:**
    *   **Advanced Controls:** A comprehensive set of filters for date range, status, market, category, and other dimensions.
    *   **Task Summary Scorecards:** High-level case counts by status. These are clickable to drill down into details.
    *   **Charts and Tables:** A series of data visualizations, each with a corresponding table:
        *   Task Count by Market
        *   TAT Adherence by Market
        *   TAT Bucket Distribution
        *   Menu Complexity Analysis
        *   Average AHT per Market by Month
        *   Average AHT by Retailer Provider Type
        *   Average AHT by Category
    *   **Backend:** All data for this dashboard is fetched and aggregated by a single, powerful backend function: `getProductionReport()`. Clicking on data points to drill down re-calls this same function with additional filter parameters.

## 3. Feature List

*   **Role-Based Dashboards:** Separate, tailored interfaces for Agents and Managers.
*   **Real-Time Agent Status:** Managers can see at a glance who is Working, On Break, In Meeting, or Offline.
*   **Attendance Management:**
    *   Agents can log their work, break, and meeting sessions.
    *   A correction system allows agents to request fixes for incorrect log entries.
    *   Managers have an interface to approve or deny these requests.
*   **Comprehensive Case Management:**
    *   View cases grouped by status and country.
    *   Full-text search across key case fields.
    *   Detailed modal view for individual cases, including all related logs.
    *   Direct case actions from the UI (Claim, Pause, Unpause, Escalate, etc.).
*   **In-Place Editing:**
    *   Ability to edit main case details and log entries directly from the case modal.
    *   A recalculation sidebar provides immediate feedback on how timestamp changes affect handling time.
*   **Advanced Reporting & Analytics (Production Dashboard):**
    *   Multi-select filters for granular data analysis.
    *   A suite of charts and tables visualizing key metrics (TAT, AHT, Volume, Complexity).
    *   Drill-down functionality from any chart or table to see the underlying case data.
*   **Data Integrity & Anomaly Detection:**
    *   A dedicated section in the manager dashboard to flag operational anomalies like negative durations, excessive handling times, and invalid timestamps.
*   **Performance and Optimization:**
    *   Server-side caching is used to reduce load times and minimize Google Sheets API calls.
    *   A "Refresh Live Data" button allows users to manually invalidate the cache for immediate updates.
*   **User & Access Management:**
    *   A settings panel for managers to grant or revoke access to the case management system.
*   **System Maintenance:**
    *   Centralized `CONFIG` object for easy management of spreadsheet IDs and sheet names.
    *   Built-in version checking and a notification system to prompt users when an update is available.

## 4. Maintenance FAQ

**Q: How do I add a new agent or manager?**
**A:** Open the **Attendance Spreadsheet**. To add an agent, add their email and name to the **`Agents`** sheet. To add a manager, add their email to the **`Managers`** sheet.

**Q: The application seems slow or is showing old data. What should I do?**
**A:** Click the **"Refresh Live Data"** button on the "Cases" page. This clears the server-side cache and forces the app to fetch the latest data from the Google Sheets. If performance is consistently slow, the underlying Google Sheets may be very large and could benefit from archiving old data.

**Q: How do I change an anomaly detection rule, like the 8-hour AHT limit?**
**A:**
1.  Open the `code.gs.txt` file in the Apps Script editor.
2.  Find the `getAnomalies` function.
3.  Locate the `durationFields` array inside the function.
4.  Change the `limit` property for the 'Handling Time' object. The value is in seconds (e.g., 8 hours = 28800).
5.  Update the `details` message string to reflect the new limit.
6.  Save and deploy a new version of the script.

**Q: How do I grant an agent access to the "Cases" tab?**
**A:**
1.  Navigate to the **Manager Dashboard** and click the **"Settings"** tab.
2.  Under "Manage User Access," enter the agent's full email address and click "Add User".
3.  The user will appear in the "Authorized Users" list. They will need to refresh the application to see the "Cases" tab.

**Q: How do I deploy a new version of the application?**
**A:**
1.  After making your code changes, increment the `SCRIPT_APP_VERSION` constant at the top of `code.gs.txt`.
2.  (Optional) Update the `UpdateConfig` sheet in the Attendance spreadsheet with details about the new version.
3.  In the Apps Script editor, go to **Deploy > Manage deployments**.
4.  Find your active web app deployment, click the **Edit (pencil) icon**.
5.  In the dialog, select **"New version"** from the "Version" dropdown.
6.  Click **"Deploy"**. Users will be prompted to refresh or will see an update notification.

## 5. Standard Operating Procedure (SOP)

### 5.1. Non-Technical SOP (For End Users)

#### Daily Agent Workflow
1.  **Start of Shift:** Access the application URL. On the "Attendance" tab, click **"Start Work"**.
2.  **During Shift:**
    *   Use **"Start Break"** / **"End Break"** for all breaks.
    *   Use **"Start Meeting"** / **"End Meeting"** for all meetings.
    *   Access the **"Cases"** tab to view and work on your assigned tasks. Use the action buttons (e.g., "Claim", "Pause") within the case modal as needed.
3.  **End of Shift:** Ensure you are not on a break or in a meeting, then click **"End Work"**.

#### Requesting a Correction
1.  On the "Attendance" tab, find the **"Attendance Log"** section.
2.  Use the date filters to find the log entry you need to correct.
3.  Click the **"Edit"** button on the corresponding row.
4.  In the pop-up, set the new correct timestamp and provide a clear reason for the change.
5.  Click **"Submit Request"**. Your manager will be notified to approve it.

#### Manager Daily Tasks
1.  **Overview:** Use the date filters on the **"Homepage"** to get a summary of agent attendance and performance for the day.
2.  **Approve Requests:** Check the **"Attendance Correction Requests"** section for pending items and approve or deny them.
3.  **Monitor Activity:** Use the **"Active Agents"** and **"Inactive Agents"** cards to see real-time team status.
4.  **Analyze Data:** Use the **"Production"** dashboard to investigate trends, and the **"Anomaly Detection"** section on the Homepage to find potential data issues.

### 5.2. Technical SOP (For Developers & Admins)

#### Codebase Overview
*   **`code.gs.txt`:** The backend. Contains all server-side logic, data manipulation, and API-like functions.
*   **`*.html.txt`:** The frontend. Each file represents a different page or view and contains the HTML structure, CSS styling, and client-side JavaScript for interacting with the backend.

#### Configuration Management
*   **Primary Config:** All spreadsheet IDs and sheet names **must** be managed in the `CONFIG` object at the top of `code.gs.txt`. Avoid hardcoding these values anywhere else in the code.
*   **Version Config:** The `UpdateConfig` sheet in the Attendance spreadsheet controls the information displayed in the update notification.

#### Common Modification Procedures
1.  **Adding a New Field to the Case Modal:**
    *   Add the new spreadsheet column to the `Main Tasks` sheet.
    *   In `cases.html.txt`, add the exact column name to the `ALL_FIELDS` JavaScript array.
    *   The UI will automatically render the new field in the details view and include it in the edit/save workflow.
2.  **Adding a New Case Action Button:**
    *   In `code.gs.txt`, create a new backend function to handle the action (e.g., `function releaseCase(caseId) {...}`).
    *   In `cases.html.txt`, find the `populateActionButtons` function.
    *   Add a new object to the `buttons` array, defining the button's text, icon, class, display condition, and the backend function it should call.

#### Troubleshooting
1.  **Server-Side Errors:** Check the **Executions** log in the Google Apps Script editor for errors in `code.gs.txt`. Use `Logger.log()` to print variables for debugging.
2.  **Client-Side Errors:** Open the browser's Developer Console (F12) to check for JavaScript errors originating from the HTML files.
3.  **Data Discrepancies:** If the UI shows outdated information, the first step is always to use the **"Refresh Live Data"** button. If the issue persists, verify that the `CONFIG` object in `code.gs.txt` points to the correct spreadsheet IDs and sheet names.
