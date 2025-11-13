
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
      templateSheet = ss.insertSheet("Email Templates");
      templateSheet.appendRow(['TemplateID', 'TemplateSubject', 'TemplateBody', 'IsCustom']);
      templateSheet.appendRow(['monthly-performance', 'Monthly Performance Report', '', 'FALSE']);
    }

    if (templateSheet.getLastRow() < 2) {
        return [];
    }

    const data = templateSheet.getRange(2, 1, templateSheet.getLastRow() - 1, 4).getValues();
    return data.map(row => ({
      id: row[0],
      subject: row[1],
      body: row[2],
      isCustom: String(row[3]).toUpperCase() // Ensure this is always a string 'TRUE' or 'FALSE'
    })).filter(t => t.id && t.subject);
  } catch (e) {
    Logger.log('Error in getEmailTextTemplates: ' + e.toString());
    return { error: e.message };
  }
}

/**
 * Saves a custom email template to the "Email Templates" sheet.
 * @param {string} templateName The name/subject of the template.
 * @param {string} templateHtml The HTML content of the template.
 * @returns {object} A success or error message.
 */
function saveCustomEmailTemplate(templateName, templateHtml) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const templateSheet = ss.getSheetByName("Email Templates");
    if (!templateSheet) {
      throw new Error("Email Templates sheet not found.");
    }
    const templateId = templateName.replace(/\s+/g, '-').toLowerCase() + '-' + new Date().getTime();
    templateSheet.appendRow([templateId, templateName, templateHtml, 'TRUE']);
    return { success: true, message: `Template "${templateName}" saved.`, newId: templateId };
  } catch (e) {
    Logger.log('Error in saveCustomEmailTemplate: ' + e.toString());
    return { success: false, error: e.message };
  }
}


/**
 * Returns a list of available block names for the custom email builder.
 * @returns {Array<string>} A list of block names.
 */
function getDashboardSections() {
  return [
    "TAT Adherence by Market",
    "Quality Scorecard",
    "Agent Performance Summary",
    "Manager's Note"
  ];
}

/**
 * Master function to get the HTML for a given block.
 * This acts as a router to the specific generator functions.
 * @param {string} blockName The name of the block to generate.
 * @param {string} agentEmail Optional email for agent-specific blocks.
 * @returns {string} The HTML content of the block.
 */
function getCustomEmailBlockHtml(blockName, agentEmail) {
  try {
    const dateRange = getCurrentMonthDateRange();

    switch (blockName) {
      case "TAT Adherence by Market":
        return generateTatByMarketHtml(dateRange.startDate, dateRange.endDate);
      case "Quality Scorecard":
        return generateQualityScorecardHtml(dateRange.startDate, dateRange.endDate);
      case "Agent Performance Summary":
        if (!agentEmail) return "<p><i>Select a recipient to preview agent-specific data.</i></p>";
        return generateAgentPerformanceHtml(agentEmail, dateRange.startDate, dateRange.endDate);
      case "Manager's Note":
        return `<div style="background-color: #f9f9f9; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                  <h2 style="margin-top: 0;">Manager's Note</h2>
                  <p>{{manager_note}}</p>
                </div>`; // Placeholder for manager's note
      default:
        return `<p>Error: Block "${blockName}" not found.</p>`;
    }
  } catch (e) {
    Logger.log(`Error generating block ${blockName}: ${e.toString()}`);
    return `<p>Error generating block "${blockName}".</p>`;
  }
}

// =================================================================================
// --- CUSTOM EMAIL BLOCK GENERATOR FUNCTIONS ---
// =================================================================================

/**
 * Generates an HTML table for TAT Adherence by Market.
 */
function generateTatByMarketHtml(startDate, endDate) {
  const sheet = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID).getSheetByName(CONFIG.PRODUCTION.SHEETS.AVAILABLE_CASES);
  if (!sheet) return "<p>Could not find Main Tasks sheet.</p>";

  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  const countryCol = headers.indexOf('Country');
  const startTimeCol = headers.indexOf('Main Task Start Date/Time');
  const endTimeCol = headers.indexOf('Main Task End Date/Time');
  const escalationCol = headers.indexOf('Stored Escalation Duration');

  const marketStats = {};

  data.forEach(row => {
    const endTime = row[endTimeCol];
    const country = row[countryCol];
    if (country && endTime) {
      const endTimeDate = new Date(endTime);
      if (endTimeDate >= startDate && endTimeDate <= endDate) {
        if (!marketStats[country]) marketStats[country] = { adhered: 0, missed: 0 };
        const startTime = new Date(row[startTimeCol]);
        const escalationMs = (parseFloat(row[escalationCol]) || 0) * 86400000;
        const netDurationHours = (endTimeDate.getTime() - startTime.getTime() - escalationMs) / 3600000;
        if (netDurationHours < 24) marketStats[country].adhered++;
        else marketStats[country].missed++;
      }
    }
  });

  let html = `
    <h2 style="margin-top: 0;">TAT Adherence by Market</h2>
    <table border="1" cellpadding="5" style="border-collapse: collapse; width: 100%;">
      <thead><tr><th>Market</th><th>Adhered</th><th>Missed</th></tr></thead>
      <tbody>`;
  Object.keys(marketStats).sort().forEach(market => {
    html += `<tr><td>${market}</td><td>${marketStats[market].adhered}</td><td>${marketStats[market].missed}</td></tr>`;
  });
  html += `</tbody></table>`;
  return html;
}

/**
 * Generates an HTML block for the Quality Scorecard.
 */
function generateQualityScorecardHtml(startDate, endDate) {
  const qualitySheet = SpreadsheetApp.openById('1mNi3qPfLLsd0VPxXk-LhiKyq_vIAYVxkp9VvQ7sEd-E').getSheetByName('Audit, WS 02/06');
  if (!qualitySheet) return "<p>Could not find Quality Audit sheet.</p>";

  const data = qualitySheet.getDataRange().getValues();
  const headers = data.shift();
  const dateCol = headers.indexOf('Date');
  const criticalErrorsCol = headers.indexOf('Total Critical Errors');

  let totalAudits = 0;
  let criticalCount = 0;

  data.forEach(row => {
    const rowDate = new Date(row[dateCol]);
    if (rowDate >= startDate && rowDate <= endDate) {
      totalAudits++;
      if (Number(row[criticalErrorsCol]) > 0) criticalCount++;
    }
  });

  const qualityScore = totalAudits > 0 ? (((totalAudits - criticalCount) / totalAudits) * 100).toFixed(2) + '%' : '100%';

  return `
    <div style="background-color: #f9f9f9; padding: 15px; border-radius: 8px;">
      <h2 style="margin-top: 0;">Team Quality Scorecard</h2>
      <p>Total Audits: <strong>${totalAudits}</strong></p>
      <p>Overall Quality Score: <strong>${qualityScore}</strong></p>
    </div>`;
}

/**
 * Generates an HTML block for a specific agent's performance summary.
 */
function generateAgentPerformanceHtml(agentEmail, startDate, endDate) {
  const kpis = getAgentMainTaskKPIs(agentEmail, startDate, endDate);
  return `
    <div style="background-color: #f9f9f9; padding: 15px; border-radius: 8px;">
      <h2 style="margin-top: 0;">Agent Performance: ${agentEmail}</h2>
      <ul>
        <li>Total Cases Completed: <strong>${kpis.totalCases}</strong></li>
        <li>Avg. Dishes/Case: <strong>${kpis.avgDishes}</strong></li>
        <li>Avg. Option Groups/Case: <strong>${kpis.avgOptionGroups}</strong></li>
        <li>Avg. Options/Case: <strong>${kpis.avgOptions}</strong></li>
        <li>Avg. Tags/Case: <strong>${kpis.avgTags}</strong></li>
        <li>Avg. Categories/Case: <strong>${kpis.avgCategories}</strong></li>
      </ul>
    </div>`;
}


// =================================================================================
// --- "MONTHLY PERFORMANCE" DATA FUNCTIONS ---
// =================================================================================

/**
 * A helper function that returns the start and end date of the current month to date.
 * @returns {object} An object with startDate and endDate properties.
 */
function getCurrentMonthDateRange() {
  const now = new Date();
  const firstDayOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    startDate: firstDayOfCurrentMonth,
    endDate: now
  };
}

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
    const statusCol = headers.indexOf('Status');
    const dishesCol = headers.indexOf('Total No of dishes');
    const optionGroupsCol = headers.indexOf('Total no of option Groups');
    const optionsCol = headers.indexOf('Total no of options');
    const tagsCol = headers.indexOf('Total no of tags');
    const categoriesCol = headers.indexOf('Total no of categories');
    const photosCol = headers.indexOf('No of Valid Photos for Main dishes (Exlcuding Extras, drinks, sides etc.)');
    const timetablesCol = headers.indexOf('Total no of timetables.');

    let totalCases = 0;
    let totalDishes = 0;
    let totalOptionGroups = 0;
    let totalOptions = 0;
    let totalTags = 0;
    let totalCategories = 0;
    let totalPhotos = 0;
    let totalTimetables = 0;

    data.forEach(row => {
        const endDateValue = row[endDateCol];
        const status = row[statusCol];
        if (endDateValue && status === 'Completed') {
            const rowDate = new Date(endDateValue);
            if (row[emailCol] === agentEmail && rowDate >= startDate && rowDate <= endDate) {
                totalCases++;
                totalDishes += Number(row[dishesCol]) || 0;
                totalOptionGroups += Number(row[optionGroupsCol]) || 0;
                totalOptions += Number(row[optionsCol]) || 0;
                totalTags += Number(row[tagsCol]) || 0;
                totalCategories += Number(row[categoriesCol]) || 0;
                totalPhotos += Number(row[photosCol]) || 0;
                totalTimetables += Number(row[timetablesCol]) || 0;
            }
        }
    });

    return {
      totalCases: totalCases,
      avgDishes: totalCases > 0 ? (totalDishes / totalCases).toFixed(2) : 0,
      avgOptionGroups: totalCases > 0 ? (totalOptionGroups / totalCases).toFixed(2) : 0,
      avgOptions: totalCases > 0 ? (totalOptions / totalCases).toFixed(2) : 0,
      avgTags: totalCases > 0 ? (totalTags / totalCases).toFixed(2) : 0,
      avgCategories: totalCases > 0 ? (totalCategories / totalCases).toFixed(2) : 0,
      avgPhotos: totalCases > 0 ? (totalPhotos / totalCases).toFixed(2) : 0,
      avgTimetables: totalCases > 0 ? (totalTimetables / totalCases).toFixed(2) : 0
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
  const log = { success: [], failed: [] };

  recipientList.forEach(agent => {
    try {
      const kpiData = getAgentMainTaskKPIs(agent.email, dateRange.startDate, dateRange.endDate);
      const qualityData = getAgentQualityData(agent.email, dateRange.startDate, dateRange.endDate);
      const tatTable = getAgentTATData(agent.email, dateRange.startDate, dateRange.endDate);
      const htmlBody = buildMonthlyPerformanceHtml(agent.name, kpiData, qualityData, tatTable, managersNote);

      MailApp.sendEmail(agent.email, subject, "Please view this email in an HTML-compatible client.", { htmlBody: htmlBody });
      log.success.push(agent.email);
      Logger.log(`Successfully sent performance email to ${agent.email}`);
    } catch (e) {
      log.failed.push({ email: agent.email, error: e.message });
      Logger.log(`Failed to send performance email to ${agent.email}. Error: ${e.toString()}`);
    }
  });
  return log;
}

// =================================================================================
// --- "CUSTOM EMAIL" SENDING FUNCTION ---
// =================================================================================

/**
 * Sends a custom email to a list of recipients and returns a log of success/failure.
 * @param {Array<object>} recipientList A list of recipient objects with email.
 * @param {string} subject The subject of the email.
 * @param {string} emailBodyHtml The HTML body of the email.
 * @returns {object} A log object with 'success' and 'failed' arrays.
 */
function sendCustomEmail(recipientList, subject, emailBodyHtml) {
  if (!recipientList || recipientList.length === 0) {
    return { success: [], failed: [], error: "No recipients provided." };
  }

  const log = { success: [], failed: [] };

  recipientList.forEach(recipient => {
    try {
      // Replace placeholder for manager's note if it exists
      const personalizedBody = emailBodyHtml.replace(/{{manager_note}}/g, "This is a test note."); // Basic placeholder replacement
      MailApp.sendEmail(recipient.email, subject, "Please view this email in an HTML-compatible client.", { htmlBody: personalizedBody });
      log.success.push(recipient.email);
    } catch (e) {
      log.failed.push({ email: recipient.email, error: e.message });
    }
  });

  Logger.log(`Custom email sending complete. Success: ${log.success.length}, Failed: ${log.failed.length}`);
  return log;
}
