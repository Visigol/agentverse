
/**
 * @fileoverview Backend logic for the Email Hub feature.
 * This script handles serving the UI, fetching data for emails,
 * and sending both templated and custom emails.
 */

// =================================================================================
// --- CORE HUB FUNCTIONS ---
// =================================================================================

/**
 * Serves the Email Hub HTML page as a web app.
 * This function will be called from the main `code.gs` router.
 */
function serveEmailHub() {
  return HtmlService.createHtmlOutputFromFile('emailHub.html')
    .setTitle('Manager Email Hub')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Reads Google Sheets and returns arrays of objects for email recipients.
 * @returns {object} An object containing two arrays: 'agents' and 'managers'.
 */
function getEmailRecipients() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const agentsSheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.AGENTS);
    const managersSheet = ss.getSheetByName(CONFIG.ATTENDANCE.SHEETS.MANAGERS);

    const agents = [];
    if (agentsSheet) {
      const agentData = agentsSheet.getRange(2, 1, agentsSheet.getLastRow() - 1, 2).getValues();
      agentData.forEach(row => {
        if (row[0] && row[1]) {
          agents.push({ name: row[1], email: row[0] });
        }
      });
    }

    const managers = [];
    if (managersSheet) {
      const managerData = managersSheet.getRange(2, 1, managersSheet.getLastRow() - 1, 2).getValues();
      managerData.forEach(row => {
        if (row[0] && row[1]) {
          managers.push({ name: row[1], email: row[0] });
        }
      });
    }

    return { agents: agents, managers: managers };
  } catch (e) {
    Logger.log('Error in getEmailRecipients: ' + e.toString());
    return { agents: [], managers: [], error: e.message };
  }
}

/**
 * Provides pre-written text templates for the "Manager's Note."
 * It reads from a sheet named "Email Templates".
 * @returns {Array<Object>} An array of template objects.
 */
function getEmailTextTemplates() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    let templateSheet = ss.getSheetByName("Email Templates");
    if (!templateSheet) {
      // Create the sheet with headers if it doesn't exist.
      templateSheet = ss.insertSheet("Email Templates");
      templateSheet.appendRow(['TemplateID', 'TemplateSubject', 'TemplateBody']);
      // Add a sample template
      templateSheet.appendRow(['monthly-checkin', 'Monthly Performance Check-in', 'Hi team, here is your performance report for last month. Great job everyone!']);
      return [{id: 'monthly-checkin', subject: 'Monthly Performance Check-in', body: 'Hi team, here is your performance report for last month. Great job everyone!'}];
    }

    if (templateSheet.getLastRow() < 2) {
        return [];
    }

    const data = templateSheet.getRange(2, 1, templateSheet.getLastRow() - 1, 3).getValues();
    return data.map(row => ({
      id: row[0],
      subject: row[1],
      body: row[2]
    })).filter(t => t.id && t.subject && t.body);
  } catch (e) {
    Logger.log('Error in getEmailTextTemplates: ' + e.toString());
    return { error: e.message };
  }
}


/**
 * Returns a static list of available block names for the custom email builder.
 * @returns {Array<string>} A list of block names.
 */
function getDashboardSections() {
  // For now, static as requested.
  return ["Sales Chart", "KPI Table", "Manager's Note"];
}

// =================================================================================
// --- "MONTHLY PERFORMANCE" DATA FUNCTIONS ---
// =================================================================================

/**
 * A helper function that returns the start and end date of the previous full month.
 * @returns {object} An object with startDate and endDate properties.
 */
function getPreviousMonthDateRange() {
  const now = new Date();
  const firstDayOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDayOfPreviousMonth = new Date(firstDayOfCurrentMonth);
  lastDayOfPreviousMonth.setDate(lastDayOfPreviousMonth.getDate() - 1);

  const firstDayOfPreviousMonth = new Date(lastDayOfPreviousMonth.getFullYear(), lastDayOfPreviousMonth.getMonth(), 1);

  return {
    startDate: firstDayOfPreviousMonth,
    endDate: lastDayOfPreviousMonth
  };
}

/**
 * Gets the "Quality numbers" for a specific agent from the "Quality Sheet".
 * @param {string} agentEmail The email of the agent.
 * @param {Date} startDate The start of the date range.
 * @param {Date} endDate The end of the date range.
 * @returns {object} An object with quality metrics.
 */
function getAgentQualityData(agentEmail, startDate, endDate) {
  try {
    const qualitySheet = SpreadsheetApp.openById('1mNi3qPfLLsd0VPxXk-LhiKyq_vIAYVxkp9VvQ7sEd-E').getSheetByName('Audit, WS 02/06');
    if (!qualitySheet) return { totalAudits: 0, qualityScore: 'N/A' };

    const data = qualitySheet.getDataRange().getValues();
    const headers = data.shift();

    const agentIdCol = headers.indexOf('Agent ID');
    const dateCol = headers.indexOf('Date');
    const criticalErrorsCol = headers.indexOf('Total Critical Errors');

    let totalAudits = 0;
    let criticalCount = 0;

    data.forEach(row => {
      const rowDate = new Date(row[dateCol]);
      if (row[agentIdCol] === agentEmail && rowDate >= startDate && rowDate <= endDate) {
        totalAudits++;
        if (Number(row[criticalErrorsCol]) > 0) {
          criticalCount++;
        }
      }
    });

    const qualityScore = totalAudits > 0 ? ((totalAudits - criticalCount) / totalAudits) * 100 : 100;

    return {
      totalAudits: totalAudits,
      qualityScore: qualityScore.toFixed(2) + '%'
    };
  } catch(e) {
    Logger.log('Error in getAgentQualityData: ' + e.toString());
    return { totalAudits: 'Error', qualityScore: 'Error' };
  }
}


/**
 * Gets the "TAT adherence Table" for a specific agent from the "Production Dashboard".
 * @param {string} agentEmail The email of the agent.
 * @param {Date} startDate The start of the date range.
 * @param {Date} endDate The end of the date range.
 * @returns {string} An HTML table string.
 */
function getAgentTATData(agentEmail, startDate, endDate) {
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID).getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
    if (!sheet) return "<p>Could not find Main Tasks sheet.</p>";

    const data = sheet.getDataRange().getValues();
    const headers = data.shift();
    const emailCol = headers.indexOf('Useremail');
    const startTimeCol = headers.indexOf('Main Task Start Date/Time');
    const endTimeCol = headers.indexOf('Main Task End Date/Time');
    const escalationCol = headers.indexOf('Stored Escalation Duration');

    let adhered = 0;
    let missed = 0;

    data.forEach(row => {
        const endTime = row[endTimeCol];
        if (row[emailCol] === agentEmail && endTime) {
            const endTimeDate = new Date(endTime);
            if (endTimeDate >= startDate && endTimeDate <= endDate) {
                const startTime = new Date(row[startTimeCol]);
                const escalationMs = (parseFloat(row[escalationCol]) || 0) * 86400000;
                const netDurationHours = (endTimeDate.getTime() - startTime.getTime() - escalationMs) / 3600000;
                if (netDurationHours < 24) {
                    adhered++;
                } else {
                    missed++;
                }
            }
        }
    });

    let html = `
      <table border="1" cellpadding="5" style="border-collapse: collapse; width: 100%;">
        <thead>
          <tr>
            <th>Adhered</th>
            <th>Missed</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${adhered}</td>
            <td>${missed}</td>
          </tr>
        </tbody>
      </table>
    `;
    return html;
  } catch(e) {
    Logger.log('Error in getAgentTATData: ' + e.toString());
    return "<p>Error generating TAT data.</p>";
  }
}

/**
 * Accesses the "Main Task" sheet and calculates performance metrics for an agent.
 * @param {string} agentEmail The email of the agent.
 * @param {Date} startDate The start of the date range.
 * @param {Date} endDate The end of the date range.
 * @returns {object} An object with calculated KPIs.
 */
function getAgentMainTaskKPIs(agentEmail, startDate, endDate) {
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID).getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
    if (!sheet) return {};

    const data = sheet.getDataRange().getValues();
    const headers = data.shift();

    const emailCol = headers.indexOf('Useremail');
    const endDateCol = headers.indexOf('Main Task End Date/Time');
    const dishesCol = headers.indexOf('Total No of dishes');
    const optionGroupsCol = headers.indexOf('Total no of option Groups');
    const optionsCol = headers.indexOf('Total no of options');
    const tagsCol = headers.indexOf('Total no of tags');
    const categoriesCol = headers.indexOf('Total no of categories');

    let totalCases = 0;
    let totalDishes = 0;
    let totalOptionGroups = 0;
    let totalOptions = 0;
    let totalTags = 0;
    let totalCategories = 0;

    data.forEach(row => {
        const endDateValue = row[endDateCol];
        if (endDateValue) {
            const rowDate = new Date(endDateValue);
            if (row[emailCol] === agentEmail && rowDate >= startDate && rowDate <= endDate) {
                totalCases++;
                totalDishes += Number(row[dishesCol]) || 0;
                totalOptionGroups += Number(row[optionGroupsCol]) || 0;
                totalOptions += Number(row[optionsCol]) || 0;
                totalTags += Number(row[tagsCol]) || 0;
                totalCategories += Number(row[categoriesCol]) || 0;
            }
        }
    });

    return {
      totalCases: totalCases,
      avgDishes: totalCases > 0 ? (totalDishes / totalCases).toFixed(2) : 0,
      avgOptionGroups: totalCases > 0 ? (totalOptionGroups / totalCases).toFixed(2) : 0,
      avgOptions: totalCases > 0 ? (totalOptions / totalCases).toFixed(2) : 0,
      avgTags: totalCases > 0 ? (totalTags / totalCases).toFixed(2) : 0,
      avgCategories: totalCases > 0 ? (totalCategories / totalCases).toFixed(2) : 0
    };
  } catch(e) {
    Logger.log('Error in getAgentMainTaskKPIs: ' + e.toString());
    return {};
  }
}


/**
 * Assembles the final HTML email body for the monthly performance report.
 * @param {string} agentName The name of the agent.
 * @param {object} kpiData The agent's KPIs.
 * @param {object} qualityData The agent's quality data.
 * @param {string} tatTable The agent's TAT adherence table.
 * @param {string} managersNote A custom note from the manager.
 * @returns {string} The HTML email body.
 */
function buildMonthlyPerformanceHtml(agentName, kpiData, qualityData, tatTable, managersNote) {
  let html = `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
      <h1 style="color: #00B14F;">Monthly Performance Report for ${agentName}</h1>
      <div style="background-color: #f9f9f9; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
        <h2 style="margin-top: 0;">Manager's Note</h2>
        <p>${managersNote.replace(/\n/g, '<br>')}</p>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 8px;">
          <h2 style="margin-top: 0;">Key Performance Indicators</h2>
          <ul>
            <li>Total Cases Completed: <strong>${kpiData.totalCases}</strong></li>
            <li>Average Dishes Managed: <strong>${kpiData.avgDishes}</strong></li>
            <li>Average Option Groups: <strong>${kpiData.avgOptionGroups}</strong></li>
            <li>Average Options: <strong>${kpiData.avgOptions}</strong></li>
            <li>Average Tags: <strong>${kpiData.avgTags}</strong></li>
            <li>Average Categories Managed: <strong>${kpiData.avgCategories}</strong></li>
          </ul>
        </div>
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 8px;">
            <h2 style="margin-top: 0;">Quality Score</h2>
            <p>Total Audits: <strong>${qualityData.totalAudits}</strong></p>
            <p>Quality Score: <strong>${qualityData.qualityScore}</strong></p>
        </div>
      </div>
       <div style="background-color: #f9f9f9; padding: 15px; border-radius: 8px; margin-top: 20px;">
          <h2 style="margin-top: 0;">TAT Adherence</h2>
          ${tatTable}
        </div>
    </div>
  `;
  return html;
}

/**
 * The master sending function for the monthly performance template.
 * @param {Array<object>} recipientList A list of agent objects with name and email.
 * @param {string} subject The subject of the email.
 * @param {string} managersNote A custom note from the manager.
 */
function sendMonthlyPerformanceEmail(recipientList, subject, managersNote) {
  const dateRange = getPreviousMonthDateRange();

  recipientList.forEach(agent => {
    try {
        const kpiData = getAgentMainTaskKPIs(agent.email, dateRange.startDate, dateRange.endDate);
        const qualityData = getAgentQualityData(agent.email, dateRange.startDate, dateRange.endDate);
        const tatTable = getAgentTATData(agent.email, dateRange.startDate, dateRange.endDate);

        const htmlBody = buildMonthlyPerformanceHtml(agent.name, kpiData, qualityData, tatTable, managersNote);

        GmailApp.sendEmail(agent.email, subject, "Please view this email in an HTML-compatible client.", { htmlBody: htmlBody });
        Logger.log(`Successfully sent performance email to ${agent.email}`);
    } catch (e) {
        Logger.log(`Failed to send performance email to ${agent.email}. Error: ${e.toString()}`);
    }
  });
}

// =================================================================================
// --- "CUSTOM EMAIL" SENDING FUNCTION ---
// =================================================================================

/**
 * A simpler function that sends the same emailBodyHtml to everyone in the recipientList.
 * @param {Array<object>} recipientList A list of recipient objects with email.
 * @param {string} subject The subject of the email.
 * @param {string} emailBodyHtml The HTML body of the email.
 */
function sendCustomEmail(recipientList, subject, emailBodyHtml) {
    if (!recipientList || recipientList.length === 0) {
        Logger.log('sendCustomEmail called with no recipients.');
        return;
    }
    const emails = recipientList.map(r => r.email).join(',');
    try {
        GmailApp.sendEmail(emails, subject, "Please view this email in an HTML-compatible client.", { htmlBody: emailBodyHtml });
        Logger.log(`Successfully sent custom email to ${emails}`);
    } catch (e) {
        Logger.log(`Failed to send custom email. Error: ${e.toString()}`);
    }
}
