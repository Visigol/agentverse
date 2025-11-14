# BoltVerse Application - User Guide

This guide is intended for managers and administrators to understand how to maintain the system and use its frontend features effectively.

## Part 1: System Maintenance Guide

This section explains the critical Google Sheets that power the application and how to manage user access and roles. To perform these actions, you will need direct editor access to the source Google Spreadsheets.

### 1. Understanding the Data Sources

The application runs on two main Google Spreadsheets.

#### A. Production Spreadsheet
This sheet holds all data related to cases and production work.

*   **`Main Tasks` sheet:**
    *   **Purpose:** This is the master database for every case. Each row is a unique case, containing all its details like status, country, timestamps, and calculated metrics (e.g., `Stored Agent Handling Time`).
    *   **Connection:** This sheet is the primary source for both the **Production Dashboard** and the **Case Management** page. All edits and status changes made in `cases.html` are written back to this sheet.

*   **`Pausing Logs`, `Escalation Logs`, `Cooperation Logs` sheets:**
    *   **Purpose:** These sheets act as detailed ledgers for specific events. When an agent pauses a case, a new entry is created in `Pausing Logs`. This separation ensures a clean and auditable history for each case.
    *   **Connection:** The data from these logs is fetched and displayed in the modal view on the `cases.html` page. The calculations for metrics like `Stored Agent Handling Time` rely on the timestamps recorded in these sheets.

#### B. Attendance Spreadsheet
This sheet manages user identities, roles, and daily attendance records.

*   **`Agents` and `Managers` sheets:**
    *   **Purpose:** These sheets define user roles. An email address in the `Managers` sheet grants access to the Manager Dashboard (`manager.html`). All other users are considered agents and will see the Agent Dashboard (`index.html`).
    *   **Connection:** The `doGet()` function in `code.gs` checks the user's email against the `Managers` list upon loading the application to determine which interface to show.

*   **`AgentLog` sheet:**
    *   **Purpose:** This is the raw log of all agent activity. Every click on "Start Work," "End Break," etc., creates a timestamped entry here.
    *   **Connection:** This is the source of truth for the **Attendance** sections on both the Agent and Manager Dashboards. The system reads this log to calculate total work/break times and determine an agent's real-time status.

*   **`BackupSystemAccess` sheet:**
    *   **Purpose:** This sheet explicitly controls which agents can see the "Cases" tab and access the `cases.html` page.
    *   **Connection:** The Manager Dashboard's **Settings** tab provides a user-friendly interface to add or remove emails from this sheet. An agent's email must be on this list to handle cases.

### 2. How to Manage User Roles

#### To Promote an Agent to a Manager:
1.  Open the **Attendance Spreadsheet**.
2.  Navigate to the **`Agents`** sheet.
3.  Find and copy the agent's email address.
4.  Navigate to the **`Managers`** sheet.
5.  Paste the email address into a new row.
6.  (Recommended) Remove the email from the `Agents` sheet to keep the lists clean.
7.  The next time this user loads the application, they will see the Manager Dashboard.

#### To Demote a Manager to an Agent:
1.  Open the **Attendance Spreadsheet**.
2.  Navigate to the **`Managers`** sheet.
3.  Find and delete the row containing the manager's email address.
4.  (Recommended) Add their email to the `Agents` sheet if it's not already there.
5.  The next time this user loads the application, they will see the Agent Dashboard.

#### How a Manager Can View the Agent Dashboard:
Sometimes a manager may want to see the application from an agent's perspective.
1.  Temporarily follow the **"To Demote a Manager to an Agent"** steps above by removing your email from the `Managers` sheet.
2.  Reload the application. You will now see the Agent Dashboard.
3.  **Important:** Remember to add your email back to the `Managers` sheet when you are finished.

### 3. How to Manage "Cases" Tab Access for Agents

Access to the case management system is controlled separately from the user role. An agent needs to be explicitly granted permission to see the "Cases" tab.

#### Using the Manager Dashboard (Recommended Method):
1.  Navigate to the **Manager Dashboard** in the application.
2.  Click on the **"Settings"** tab.
3.  Under "Manage User Access," you will see a list of "Authorized Users."
    *   **To grant access:** Enter the agent's email in the input box and click "Add User."
    *   **To revoke access:** Find the user in the list and click the "Remove" button next to their email.

#### Manually via Google Sheets (Alternative Method):
1.  Open the **Attendance Spreadsheet**.
2.  Navigate to the **`BackupSystemAccess`** sheet.
3.  To grant access, add the agent's email to a new row.
4.  To revoke access, delete the row containing the agent's email.

## Part 2: Frontend User Guide

This section provides a detailed walkthrough of every page and feature available in the user interface.

### 1. Agent Dashboard (`index.html`)

This is the primary interface for agents, focused on attendance and personal productivity.

*   **Header & Navigation:**
    *   Displays your name, email, and the application version.
    *   **Attendance Tab:** The main page for managing your work status.
    *   **Cases Tab:** A link to the Case Management page (`cases.html`). This tab is only visible if a manager has granted you access.

*   **Status & Scorecards:**
    *   **Current Status:** Shows your real-time status: `Offline`, `Working`, `On Break`, or `In Meeting`.
    *   **Scorecards:** A grid of your key performance indicators (KPIs) for the current day:
        *   **Cases Closed Today:** Total cases you have marked as "Completed."
        *   **Avg. Handling Time:** The average time you spent actively working on cases closed today.
        *   **Open Escalated:** The number of your cases that are currently in "Escalated" status.
        *   **In Progress:** The number of cases currently assigned to you.

*   **Session & Activity Control:**
    *   **Session Control:** Contains the main **Start Work / End Work** button to control your daily session. A timer displays the total duration of your current work session.
    *   **Activity Section:** Appears only when you are "Working." It contains:
        *   **Start Break / End Break** button.
        *   **Start Meeting / End Meeting** button.
        *   Timers for the current break/meeting and the total time spent in each during the session.

*   **My Case Summary:**
    *   Select a date and click "View Summary" to see a table of all cases you worked on that day, including start/end times and duration.

*   **Attendance Log & Corrections:**
    *   **Attendance Log:** Select a date range and click "View Log" to see a detailed, timestamped list of all your activities (e.g., Start Work, End Break).
    *   **Requesting a Correction:** If you find an incorrect entry, click the **"Edit"** button in that row. A pop-up will appear where you can propose a new correct timestamp and provide a reason for the change. This sends a request to your manager for approval.
    *   **My Pending Requests:** This table shows any correction requests you have submitted that are still awaiting a manager's decision.

### 2. Manager Dashboard (`manager.html`)

This is the command center for managers, providing an aggregated view of team performance, attendance, and data integrity.

*   **Header & Navigation:**
    *   **Homepage:** The main dashboard view.
    *   **Production:** Opens the detailed Production Dashboard in a new tab.
    *   **Cases:** Opens the Case Management page in a new tab.
    *   **Settings:** A tab for managing user permissions.
    *   **Archive:** A read-only view of historical case data.

*   **Homepage Tab:**
    *   **Date Controls:** Select a single date or a date range and click **"Load Data"** to filter all reports on this page.
    *   **Real-time Agent Status:**
        *   **Active Agents:** A list of agents currently in a work session, showing their real-time status.
        *   **Inactive Agents:** A collapsible list of agents not currently working.
    *   **Agent Summary:** A table summarizing each agent's total work, break, and meeting times for the selected period. Click **"View Cases"** to see a detailed list of cases handled by that agent.
    *   **Attendance Correction Requests:** Review, approve, or deny correction requests submitted by agents. Approving a request automatically updates the official `AgentLog`.
    *   **Agent Leaderboard:** Ranks agents by cases completed and average handling time for the selected period.
    *   **Agent Attendance Log:** Select any agent and a date range to view their complete, detailed attendance log.
    *   **Anomaly Detection:** Scans the production data for integrity issues (e.g., negative durations, excessively long handling times). For certain issues, a **"Fix Calculation"** button appears, allowing you to preview and apply a corrected calculation.

*   **Settings Tab:**
    *   **Manage User Access:** Add or remove agents' access to the "Cases" tab. Enter an agent's email and click **"Add User"** to grant access, or click the **"Remove"** button next to an existing user to revoke it.

*   **Archive Tab:**
    *   Provides a read-only interface to search and view historical case data from the `HistoricalProductionReport.csv` file.
    *   **Search/Filter:** Use the controls to filter by Case ID, status, date, and more.
    *   **View Details:** Click on any case to open a modal with its full details and associated logs. This view is read-only.
    *   **Extract to Google Sheets:** Click this button to start an asynchronous export of the entire archive file into a new, organized Google Sheet for further analysis.

### 3. Production Dashboard (`production.html`)

This dashboard provides a high-level, interactive view of production metrics, designed for data analysis.

*   **Filter Controls:**
    *   A comprehensive panel to filter the entire dashboard by **Date Range**, **Status**, **Market (Country)**, **Category**, and more. The dropdowns allow for selecting multiple values. Click **"Load Data"** to apply your filters.

*   **Charts and Data Tables:**
    *   The dashboard is composed of several sections, each containing a data table and a corresponding chart for visualization.
    *   **Key Sections Include:** Task Count by Market, TAT (Turnaround Time) Adherence, Menu Complexity, and Average Agent Handling Time (AHT) trended by month, retailer, or category.

*   **Drill-down Functionality:**
    *   Most numerical values in the tables are clickable. Clicking a number (e.g., the number of "Completed" cases in "Portugal") will open a detailed pop-up table showing the specific cases that make up that number.
    *   The drill-down view includes a **"Download"** button, allowing you to export that specific, filtered data to a new Google Sheet.

### 4. Case Management (`cases.html`)

A dedicated interface for both agents and managers to interact with the full lifecycle of cases.

*   **Tabs & Search:**
    *   **Tabs:** Toggle between "All Tasks" and "My Cases" (which filters for cases assigned to you).
    *   **Search Bar:** A powerful tool to find cases by ID, Country, Account Name, etc. Results are displayed in a separate, closable table.
    *   **Refresh Live Data Button:** Manually forces the system to fetch the absolute latest data from the Google Sheet, bypassing the cache. Use this if you suspect the data on screen might be slightly out of date.

*   **Case Tables:**
    *   The main view is organized into collapsible sections based on case status (e.g., "Not Started," "In Progress"). Cases are grouped by country within each status. Click "Show More" to load more cases.

*   **Case Details Modal:**
    *   Clicking on any case opens a detailed modal.
    *   **Main Details:** A grid displaying all fields for that case from the `Main Tasks` sheet.
    *   **Log Sections:** Separate, collapsible sections for `Pausing Logs`, `Escalation Logs`, and `Cooperation Logs`.
    *   **Action Buttons:** A dynamic set of buttons that changes based on the case's status. Common actions include:
        *   **Claim Case:** Assign an unassigned case to yourself.
        *   **Pause/Unpause:** Start or stop a pause timer, which is logged separately.
        *   **Escalate/De-Escalate:** Change the case's escalation status.
        *   **End Case:** Mark a case as "Completed," which automatically calculates and stores the final handling time.
    *   **Edit Mode:** Click **"Edit"** to make all fields in the modal editable. If you change any timestamp, a **Recalculation Sidebar** appears on the right, showing a real-time preview of how durations will be recalculated before you save. Click **"Save"** to commit your changes.

### 5. Quality Dashboard (`Dashboard.html`)

This dashboard provides insights into the quality assurance process, based on data from a separate Quality Audit spreadsheet.

*   **Filters:**
    *   Filter the dashboard by **Date Range**, **Market**, **Request Type**, and **Support Type** to narrow down the data.

*   **Audit Section:**
    *   **Quality Metrics by Market:** A table showing the number of cases audited, cases with critical or non-critical errors, and the final Quality Score for each market.
    *   **Agent Quality Scorecard:** A breakdown of quality metrics by individual agent. (Managers see all agents; agents only see their own data).
    *   **Audit Criteria Analysis:** A table showing which specific audit criteria are failing most often, separated by critical and non-critical errors.

*   **Rework Section:**
    *   **Rework Metrics by Market:** A table showing the number of "Valid" vs. "Invalid" rework requests and the error types found within the valid reworks.
    *   **Agent Rework Scorecard:** A breakdown of rework metrics by individual agent.
    *   **Rework Criteria Analysis:** A table showing which criteria are most often the cause of valid rework requests.
