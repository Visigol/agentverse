/**
 * @fileoverview Standalone Query Engine for the BoltVerse App.
 * Contains all logic for the on-demand, self-terminating asynchronous query processor.
 */

// =================================================================================
// --- ENGINE CONSTANTS ---
// =================================================================================

const QUERY_ENGINE_TRIGGER_FUNCTION = "runQueryEngineBatch";
const CHUNK_SIZE = 500; // Number of rows to process per chunk within the time limit
const MAX_EXECUTION_TIME_MS = 270000; // 4.5 minutes in milliseconds

// =================================================================================
// --- USER-FACING API FUNCTIONS ---
// =================================================================================

/**
 * Saves a user's query to their personal library.
 * @param {string} name The name for the query.
 * @param {string} description A brief description of the query.
 * @param {string} queryJson The JSON string representing the query object.
 * @returns {string} A success message.
 */
function saveQueryToLibrary(name, description, queryJson) {
  try {
    if (!name || !queryJson) {
      throw new Error("Query name and JSON are required to save to the library.");
    }
    const userEmail = Session.getActiveUser().getEmail();
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const librarySheet = ss.getSheetByName("QueryLibrary");
    if (!librarySheet) {
      // If the sheet doesn't exist, create it with headers
      const newSheet = ss.insertSheet("QueryLibrary");
      newSheet.appendRow(["QueryName", "Description", "QueryJSON", "OwnerEmail"]);
    }
    ss.getSheetByName("QueryLibrary").appendRow([name, description || "", queryJson, userEmail]);
    return `Query "${name}" was successfully saved to your library.`;
  } catch (e) {
    Logger.log(`Error in saveQueryToLibrary: ${e.toString()}`);
    throw new Error(`Could not save query: ${e.message}`);
  }
}

/**
 * Retrieves all queries saved by the current user.
 * @returns {Array<Object>} An array of query objects from the user's library.
 */
function getQueriesFromLibrary() {
  try {
    const userEmail = Session.getActiveUser().getEmail();
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const librarySheet = ss.getSheetByName("QueryLibrary");
    if (!librarySheet || librarySheet.getLastRow() < 2) {
      return [];
    }
    const data = librarySheet.getRange(2, 1, librarySheet.getLastRow() - 1, 4).getValues();
    return data
      .filter(row => row[3] === userEmail) // Filter by user's email
      .map(row => ({
        name: row[0],
        description: row[1],
        queryJson: row[2]
      }));
  } catch (e) {
    Logger.log(`Error in getQueriesFromLibrary: ${e.toString()}`);
    return []; // Return empty on error
  }
}

/**
 * Gets the column headers for a specific sheet in the PRODUCTION database.
 * @param {string} sheetName The name of the sheet.
 * @returns {Array<string>} An array of header strings.
 */
function getSheetHeaders(sheetName) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      throw new Error(`Sheet "${sheetName}" not found.`);
    }
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    return headers.filter(header => header); // Filter out empty header cells
  } catch (e) {
    Logger.log(`Error in getSheetHeaders: ${e.toString()}`);
    throw new Error(`Could not retrieve headers for sheet "${sheetName}".`);
  }
}

/**
 * Gets the names of all sheets in the PRODUCTION database.
 * @returns {Array<string>} An array of sheet name strings.
 */
function getAllSheetNames() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
    const sheets = ss.getSheets();
    return sheets.map(sheet => sheet.getName());
  } catch (e) {
    Logger.log(`Error in getAllSheetNames: ${e.toString()}`);
    throw new Error("Could not retrieve sheet names.");
  }
}

/**
 * The "Ignition" function. Submits a query to the queue and starts the engine if it's asleep.
 * @param {string} queryJson The JSON string of the query object from the UI.
 * @returns {string} A success message to the user.
 */
function submitQueryToQueue(queryData) {
  const userEmail = Session.getActiveUser().getEmail();

  // Defensive Guard Clause: Ensure we are always working with both a valid object and a valid string.
  let queryObject;
  let queryString;
  if (typeof queryData === 'string') {
    queryString = queryData;
    try {
      queryObject = JSON.parse(queryData);
    } catch (e) {
      throw new Error(`Invalid JSON format received from client: ${e.message}`);
    }
  } else if (typeof queryData === 'object' && queryData !== null) {
    queryObject = queryData;
    queryString = JSON.stringify(queryData);
  } else {
    throw new Error("Received invalid or null query data.");
  }

  try {
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const queueSheet = ss.getSheetByName("QueryQueue");
    if (!queueSheet) {
        const newSheet = ss.insertSheet("QueryQueue");
        // FIX: Added "StartTime", "ENDTime", and "ErrorMessage" columns to the header.
        newSheet.appendRow(["QueueTimestamp", "UserEmail", "Status", "QueryJSON", "StartTime", "ENDTime", "OutputSheetURL", "Progress", "CCRecipients", "ErrorMessage"]);
    }
    ss.getSheetByName("QueryQueue").appendRow([
      new Date(),
      userEmail,
      "Pending",
      queryString, // <-- THE FIX: Always write the guaranteed string version to the sheet.
      "", // StartTime
      "", // ENDTime
      "", // OutputSheetURL
      "Queued...",
      queryObject.ccRecipients || "", // Safely access property from the object.
      "" // Add an empty string for the new ErrorMessage column
    ]);

    // "Ignition" Logic: Check if the engine is already running.
    const existingTriggers = ScriptApp.getProjectTriggers();
    const isEngineRunning = existingTriggers.some(t => t.getHandlerFunction() === QUERY_ENGINE_TRIGGER_FUNCTION);

    if (!isEngineRunning) {
      // Engine is "asleep". Create a one-time trigger to "ignite" it.
      ScriptApp.newTrigger(QUERY_ENGINE_TRIGGER_FUNCTION)
        .timeBased()
        .after(15 * 1000) // ~15 seconds from now
        .create();
      Logger.log("Query Engine was asleep. Created a new trigger to ignite it.");
    } else {
      Logger.log("Query Engine is already running. Query was added to the queue.");
    }
    return "Query successfully submitted to the queue. You will be notified by email upon completion.";
  } catch (e) {
    Logger.log(`Error in submitQueryToQueue: ${e.toString()}`);
    throw new Error(`Failed to submit query: ${e.message}`);
  }
}

// =================================================================================
// --- CORE ENGINE & BATCH PROCESSOR ---
// =================================================================================

/**
 * The "Self-Terminating" Engine. Processes the query queue in a time-aware loop.
 * This function is ONLY ever called by a trigger (either the "ignition" or its own).
 */
function runQueryEngineBatch() {
  const properties = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();

  // Concurrency check: Ensure only one instance of the engine runs at a time.
  if (!lock.tryLock(10000)) {
    Logger.log("runQueryEngineBatch: Could not acquire lock. Another instance is likely running. Exiting.");
    return;
  }

  const startTime = new Date().getTime();
  let currentQueryState = null;

  try {
    const stateJson = properties.getProperty('currentQueryState');
    if (stateJson) {
      currentQueryState = JSON.parse(stateJson);
      Logger.log("Resuming existing query.");
    } else {
      // No active query, let's find the next "Pending" one.
      const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
      const queueSheet = ss.getSheetByName("QueryQueue");
      if (!queueSheet || queueSheet.getLastRow() < 2) {
         Logger.log("Query queue is empty. Engine is going to sleep.");
         deleteTriggers_();
         return; // Work is done.
      }
      const queueData = queueSheet.getRange(2, 1, queueSheet.getLastRow() - 1, 10).getValues();
      let nextQueryRow = -1;
      for(let i = 0; i < queueData.length; i++) {
        if (queueData[i][2] === "Pending") {
          nextQueryRow = i + 2;
          break;
        }
      }

      if (nextQueryRow === -1) {
        Logger.log("No 'Pending' queries found. Engine is going to sleep.");
        deleteTriggers_();
        return; // Work is done.
      }

      // Found a new query to start.
      const queryJson = queueData[nextQueryRow - 2][3];
      const query = JSON.parse(queryJson);
      const userEmail = queueData[nextQueryRow - 2][1];
      const ccRecipients = queueData[nextQueryRow - 2][6];

      // Create the output sheet immediately
      const outputSpreadsheet = SpreadsheetApp.create(`Query Result - ${query.from.join(', ')} - ${new Date().toLocaleString()}`);
      const outputSheet = outputSpreadsheet.getSheets()[0];
      outputSheet.setName("Results");
      const outputUrl = outputSpreadsheet.getUrl();

      // Update the queue
      queueSheet.getRange(nextQueryRow, 3).setValue("Running");
      queueSheet.getRange(nextQueryRow, 5).setValue(new Date()); // Set StartTime
      queueSheet.getRange(nextQueryRow, 7).setValue(outputUrl);

      // Initialize state for the new query
      currentQueryState = {
        query: query,
        userEmail: userEmail,
        ccRecipients: ccRecipients,
        outputSheetId: outputSpreadsheet.getId(),
        currentSheetIndex: 0,
        lastRowProcessed: 0, // Start before the header row
        totalRecordsProcessed: 0,
        totalRecordsToProcess: 0, // Will be calculated
        queueRow: nextQueryRow,
        isGroupBy: !!(query.groupBy && query.groupBy.length > 0)
      };

      if (currentQueryState.isGroupBy) {
          properties.setProperty('aggregationMap', JSON.stringify({}));
          outputSheet.appendRow(["Running GROUP BY query..."]);
      } else {
          outputSheet.appendRow(query.select);
      }
    }

    // --- Time-Aware Processing Loop ---
    const sourceSs = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
    if (currentQueryState.totalRecordsToProcess === 0) {
      let total = 0;
      for (const sheetName of currentQueryState.query.from) {
        const sheet = sourceSs.getSheetByName(sheetName);
        if (sheet) {
          total += sheet.getLastRow() -1; // Exclude header
        }
      }
      currentQueryState.totalRecordsToProcess = total;
    }

    while (new Date().getTime() - startTime < MAX_EXECUTION_TIME_MS) {
      if (currentQueryState.currentSheetIndex >= currentQueryState.query.from.length) {
        // --- QUERY FINISHED ---
        Logger.log("Query finished. Processed all sheets.");

        if (currentQueryState.isGroupBy) {
            const aggregationMap = JSON.parse(properties.getProperty('aggregationMap'));
            const outputSheet = SpreadsheetApp.openById(currentQueryState.outputSheetId).getSheets()[0];
            outputSheet.clearContents();
            outputSheet.appendRow(currentQueryState.query.select);

            const results = [];
            for (const key in aggregationMap) {
                const group = aggregationMap[key];
                const row = [];
                currentQueryState.query.select.forEach(selectField => {
                    if (selectField.includes('(')) {
                        const aggFunc = selectField.split('(')[0].toLowerCase();
                        const field = selectField.match(/\((.*?)\)/)[1];
                        if (aggFunc === 'count') row.push(group[field].count);
                        else if (aggFunc === 'sum') row.push(group[field].sum);
                        else if (aggFunc === 'avg') {
                          const avg = group[field].count > 0 ? group[field].sum / group[field].count : 0;
                          row.push(avg);
                        }
                    } else {
                        row.push(group[selectField]);
                    }
                });
                results.push(row);
            }
            if(results.length > 0) {
              outputSheet.getRange(2, 1, results.length, results[0].length).setValues(results);
            }
            properties.deleteProperty('aggregationMap');
        }

        const queueSheet = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID).getSheetByName("QueryQueue");
        queueSheet.getRange(currentQueryState.queueRow, 3).setValue("Complete");
        queueSheet.getRange(currentQueryState.queueRow, 6).setValue(new Date());
        queueSheet.getRange(currentQueryState.queueRow, 8).setValue("Finished");

        const outputUrl = SpreadsheetApp.openById(currentQueryState.outputSheetId).getUrl();
        MailApp.sendEmail({
            to: currentQueryState.userEmail,
            cc: currentQueryState.ccRecipients || "",
            subject: `Your Query is Complete: ${currentQueryState.query.from.join(', ')}`,
            htmlBody: `Your query has finished processing.<br/><br/>You can view the results here: <a href="${outputUrl}">${outputUrl}</a>`
        });

        properties.deleteProperty('currentQueryState');
        currentQueryState = null;

        const nextPendingRow = findNextPendingQuery_();
        if (nextPendingRow !== -1) {
            Logger.log("Query finished. Found another pending query. Restarting loop.");
            continue;
        } else {
             Logger.log("Query finished. No more pending queries. Engine going to sleep.");
             deleteTriggers_();
             return;
        }
      }

      const sourceSheetName = currentQueryState.query.from[currentQueryState.currentSheetIndex];
      const sourceSheet = sourceSs.getSheetByName(sourceSheetName);

      if (!sourceSheet) {
          currentQueryState.currentSheetIndex++;
          currentQueryState.lastRowProcessed = 0;
          continue;
      }

      const sourceData = sourceSheet.getDataRange().getValues();
      const sourceHeaders = sourceData.shift() || [];

      if (currentQueryState.lastRowProcessed >= sourceData.length) {
        currentQueryState.currentSheetIndex++;
        currentQueryState.lastRowProcessed = 0;
        continue;
      }

      const chunk = sourceData.slice(currentQueryState.lastRowProcessed, currentQueryState.lastRowProcessed + CHUNK_SIZE);
      const matchingRows = [];

      chunk.forEach(row => {
        const record = {};
        sourceHeaders.forEach((header, i) => { record[header] = row[i]; });
        if (evaluateWhereClause(record, currentQueryState.query.where)) {
            matchingRows.push(record);
        }
      });

      if (currentQueryState.isGroupBy) {
          const aggregationMap = JSON.parse(properties.getProperty('aggregationMap'));
          matchingRows.forEach(record => {
              evaluateGroup(record, currentQueryState.query.groupBy, currentQueryState.query.select, aggregationMap);
          });
          properties.setProperty('aggregationMap', JSON.stringify(aggregationMap));
      } else {
        if (matchingRows.length > 0) {
            const outputSheet = SpreadsheetApp.openById(currentQueryState.outputSheetId).getSheets()[0];
            const outputData = matchingRows.map(record => {
                return currentQueryState.query.select.map(field => record[field]);
            });
            outputSheet.getRange(outputSheet.getLastRow() + 1, 1, outputData.length, outputData[0].length).setValues(outputData);
        }
      }

      currentQueryState.lastRowProcessed += chunk.length;
      currentQueryState.totalRecordsProcessed += chunk.length;

      const queueSheet = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID).getSheetByName("QueryQueue");
      const progress = `${currentQueryState.totalRecordsProcessed} / ${currentQueryState.totalRecordsToProcess}`;
      queueSheet.getRange(currentQueryState.queueRow, 8).setValue(progress);
    }

    if (currentQueryState) {
        Logger.log("Execution time limit reached. Saving state and creating next trigger.");
        properties.setProperty('currentQueryState', JSON.stringify(currentQueryState));
        ScriptApp.newTrigger(QUERY_ENGINE_TRIGGER_FUNCTION)
            .timeBased()
            .after(60 * 1000)
            .create();
    }

  } catch (e) {
    Logger.log(`FATAL ERROR in runQueryEngineBatch: ${e.toString()}\nStack: ${e.stack}`);
    if (currentQueryState) {
        const queueSheet = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID).getSheetByName("QueryQueue");
        queueSheet.getRange(currentQueryState.queueRow, 3).setValue("Error");
        queueSheet.getRange(currentQueryState.queueRow, 6).setValue(new Date());
        queueSheet.getRange(currentQueryState.queueRow, 8).setValue("Error");
        queueSheet.getRange(currentQueryState.queueRow, 10).setValue(e.message);
    }
    properties.deleteProperty('currentQueryState');
    deleteTriggers_();
  } finally {
    lock.releaseLock();
  }
}

// =================================================================================
// --- ENGINE HELPER FUNCTIONS ---
// =================================================================================

/**
 * Deletes all triggers associated with the query engine to put it "to sleep".
 * @private
 */
function deleteTriggers_() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === QUERY_ENGINE_TRIGGER_FUNCTION) {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  Logger.log("All engine triggers have been deleted.");
}

/**
 * Checks the queue for the next pending query.
 * @private
 * @returns {number} The row number of the next pending query, or -1 if none.
 */
function findNextPendingQuery_() {
    const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
    const queueSheet = ss.getSheetByName("QueryQueue");
    if (!queueSheet || queueSheet.getLastRow() < 2) return -1;
    const statuses = queueSheet.getRange(2, 3, queueSheet.getLastRow() - 1, 1).getValues().flat();
    const nextIndex = statuses.indexOf("Pending");
    return nextIndex !== -1 ? nextIndex + 2 : -1;
}

/**
 * Evaluates a record against the 'where' clause of a query recursively.
 * @param {Object} record The data record (row) as an object.
 * @param {Object} whereClause The 'where' clause from the query object.
 * @returns {boolean} True if the record matches the conditions, otherwise false.
 */
function evaluateWhereClause(record, whereClause) {
  if (!whereClause || !whereClause.groups || whereClause.groups.length === 0) {
    return true; // No conditions means it's a match.
  }

  const rootLogic = whereClause.logic.toUpperCase(); // AND or OR

  for (let i = 0; i < whereClause.groups.length; i++) {
    const group = whereClause.groups[i];
    const groupMatches = evaluateGroupRules(record, group);

    if (rootLogic === 'AND' && !groupMatches) {
      return false; // In AND, one group failure means the whole thing fails.
    }
    if (rootLogic === 'OR' && groupMatches) {
      return true; // In OR, one group success means the whole thing succeeds.
    }
  }

  return rootLogic === 'AND';
}

/**
 * Evaluates a record against a single group of rules.
 * @param {Object} record The data record (row) as an object.
 * @param {Object} group The group object from the where clause.
 * @returns {boolean} True if the record matches the group's rules, otherwise false.
 */
function evaluateGroupRules(record, group) {
  if (!group.rules || group.rules.length === 0) {
    return true; // An empty group is considered a match.
  }

  const groupLogic = group.logic.toUpperCase(); // AND or OR

  for (let i = 0; i < group.rules.length; i++) {
    const rule = group.rules[i];
    const recordValue = record[rule.column];
    const ruleMatches = applyRule(recordValue, rule.operator, rule.value);

    if (groupLogic === 'AND' && !ruleMatches) {
      return false; // In AND, one rule failure means the group fails.
    }
    if (groupLogic === 'OR' && ruleMatches) {
      return true; // In OR, one rule success means the group succeeds.
    }
  }

  return groupLogic === 'AND';
}

/**
 * Applies a single filtering rule with expanded operators and type coercion.
 * @param {*} recordValue The value from the current row.
 * @param {string} operator The comparison operator (e.g., 'is', 'contains').
 * @param {*} conditionValue The value to compare against from the query.
 * @returns {boolean} True if the rule is met.
 */
function applyRule(recordValue, operator, conditionValue) {
  const isRecordValueBlank = recordValue === null || recordValue === undefined || recordValue === '';
  const isConditionValueBlank = conditionValue === null || conditionValue === undefined || conditionValue === '';

  if (operator === 'is_blank') return isRecordValueBlank;
  if (operator === 'is_not_blank') return !isRecordValueBlank;

  if (isRecordValueBlank) return false;

  const rv = String(recordValue);
  const cv = String(conditionValue);
  const rvLower = rv.toLowerCase();
  const cvLower = cv.toLowerCase();
  const rvNum = parseFloat(rv);
  const cvNum = parseFloat(cv);

  const conditionValues = cv.split(',').map(v => v.trim().toLowerCase());

  switch (operator) {
    case 'is': return rvLower === cvLower;
    case 'is_not': return rvLower !== cvLower;
    case 'is_one_of': return conditionValues.includes(rvLower);
    case 'is_not_one_of': return !conditionValues.includes(rvLower);
    case 'contains': return rvLower.includes(cvLower);
    case 'does_not_contain': return !rvLower.includes(cvLower);
    case 'starts_with': return rvLower.startsWith(cvLower);
    case 'does_not_start_with': return !rvLower.startsWith(cvLower);
    case 'ends_with': return rvLower.endsWith(cvLower);
    case 'does_not_end_with': return !rvLower.endsWith(cvLower);
    case 'is_greater_than': return !isNaN(rvNum) && !isNaN(cvNum) && rvNum > cvNum;
    case 'is_less_than': return !isNaN(rvNum) && !isNaN(cvNum) && rvNum < cvNum;
    case 'is_greater_than_or_equal_to': return !isNaN(rvNum) && !isNaN(cvNum) && rvNum >= cvNum;
    case 'is_less_than_or_equal_to': return !isNaN(rvNum) && !isNaN(cvNum) && rvNum <= cvNum;
    case 'matches_regex':
      try {
        return new RegExp(cv, 'i').test(rv);
      } catch (e) {
        return false;
      }
    case 'does_not_match_regex':
      try {
        return !new RegExp(cv, 'i').test(rv);
      } catch (e) {
        return true;
      }
    default: return false;
  }
}

/**
 * Processes a record for a GROUP BY aggregation.
 * @param {Object} record The data record object.
 * @param {Array<string>} groupByFields The fields to group by.
 * @param {Array<string>} aggregateFields The fields to aggregate (e.g., ["COUNT(ID)", "SUM(Amount)"]).
 * @param {Object} aggregationMap The map holding the aggregated data.
 */
function evaluateGroup(record, groupByFields, aggregateFields, aggregationMap) {
    const key = groupByFields.map(field => record[field]).join(' | ');

    if (!aggregationMap[key]) {
        aggregationMap[key] = {};
        groupByFields.forEach(field => {
            aggregationMap[key][field] = record[field];
        });

        aggregateFields.forEach(aggField => {
            if (aggField.includes('(')) {
                const field = aggField.match(/\((.*?)\)/)[1];
                if (field && !aggregationMap[key][field]) {
                    aggregationMap[key][field] = { sum: 0, count: 0, values: new Set() };
                }
            }
        });
    }

    aggregateFields.forEach(aggField => {
        if (!aggField.includes('(')) return;

        const aggFunc = aggField.split('(')[0].toLowerCase();
        const field = aggField.match(/\((.*?)\)/)[1];
        if (!field) return;

        const value = record[field];

        if (aggFunc === 'count') {
            if (value !== null && value !== undefined && value !== '') {
                 aggregationMap[key][field].count++;
            }
        } else if (aggFunc === 'sum' || aggFunc === 'avg') {
            const numValue = parseFloat(value);
            if (!isNaN(numValue)) {
                aggregationMap[key][field].sum += numValue;
                aggregationMap[key][field].count++;
            }
        }
    });
}
