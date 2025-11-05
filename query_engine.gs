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
      Logger.log("Resuming existing query: " + currentQueryState.query.select.sourceSheet);
    } else {
      // No active query, let's find the next "Pending" one.
      const ss = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID);
      const queueSheet = ss.getSheetByName("QueryQueue");
      if (!queueSheet || queueSheet.getLastRow() < 2) {
         Logger.log("Query queue is empty. Engine is going to sleep.");
         deleteTriggers_();
         return; // Work is done.
      }
      // FIX: Expanded the range to include the new "ErrorMessage" column (now 10 columns)
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
      const outputSpreadsheet = SpreadsheetApp.create(`Query Result - ${query.from[0]} - ${new Date().toLocaleString()}`);
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
        lastRowProcessed: 1, // Start after the header row
        queueRow: nextQueryRow,
        isGroupBy: !!query.groupBy
      };

      if (currentQueryState.isGroupBy) {
          // For GROUP BY, we need to process all data in memory.
          properties.setProperty('aggregationMap', JSON.stringify({}));
          outputSheet.appendRow(["Running GROUP BY query..."]);
      } else {
          // For regular queries, write headers immediately.
          outputSheet.appendRow(query.select);
      }
    }

    // --- Time-Aware Processing Loop ---
    const sourceSs = SpreadsheetApp.openById(CONFIG.PRODUCTION.ID);
    const sourceSheetName = currentQueryState.query.from[0]; // <-- FIX: Get sheet name from 'from' clause
    const sourceSheet = sourceSs.getSheetByName(sourceSheetName);

    // Defensive check to prevent "Cannot read properties of null" error
    if (!sourceSheet) {
      throw new Error(`The specified sheet "${sourceSheetName}" was not found.`);
    }

    const sourceData = sourceSheet.getDataRange().getValues();
    const sourceHeaders = sourceData.shift();

    let recordsProcessedThisRun = 0;

    while (new Date().getTime() - startTime < MAX_EXECUTION_TIME_MS) {
      if (currentQueryState.lastRowProcessed >= sourceData.length) {
        // --- QUERY FINISHED ---
        Logger.log("Query finished. Processed all rows.");

        if (currentQueryState.isGroupBy) {
            // Write aggregated results to sheet
            const aggregationMap = JSON.parse(properties.getProperty('aggregationMap'));
            const outputSheet = SpreadsheetApp.openById(currentQueryState.outputSheetId).getSheets()[0];
            outputSheet.clearContents();
            outputSheet.appendRow(currentQueryState.query.select); // Write final headers

            const results = [];
            for (const key in aggregationMap) {
                const group = aggregationMap[key];
                const row = [key];
                currentQueryState.query.select.slice(1).forEach(aggField => {
                  const aggFunc = aggField.split('(')[0].toLowerCase();
                  const field = aggField.match(/\((.*?)\)/)[1];
                  if (aggFunc === 'count') row.push(group[field].count);
                  else if (aggFunc === 'sum') row.push(group[field].sum);
                  else if (aggFunc === 'avg') row.push(group[field].sum / group[field].count);
                });
                results.push(row);
            }
            if(results.length > 0) {
              outputSheet.getRange(2, 1, results.length, results[0].length).setValues(results);
            }
            properties.deleteProperty('aggregationMap');
        }

        // Finalize queue entry
        const queueSheet = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID).getSheetByName("QueryQueue");
        queueSheet.getRange(currentQueryState.queueRow, 3).setValue("Complete");
        queueSheet.getRange(currentQueryState.queueRow, 6).setValue(new Date()); // Set ENDTime
        queueSheet.getRange(currentQueryState.queueRow, 8).setValue("Finished");

        // Send email notification
        const outputUrl = SpreadsheetApp.openById(currentQueryState.outputSheetId).getUrl();
        MailApp.sendEmail({
            to: currentQueryState.userEmail,
            cc: currentQueryState.ccRecipients || "",
            subject: `Your Query is Complete: ${currentQueryState.query.from[0]}`,
            htmlBody: `Your query has finished processing.<br/><br/>You can view the results here: <a href="${outputUrl}">${outputUrl}</a>`
        });

        properties.deleteProperty('currentQueryState');
        currentQueryState = null; // Mark as finished

        // Check for another pending query immediately.
        const nextPendingRow = findNextPendingQuery_();
        if (nextPendingRow !== -1) {
            Logger.log("Query finished. Found another pending query. Restarting loop without new trigger.");
            continue; // Re-enter the while loop to start the next query
        } else {
             Logger.log("Query finished. No more pending queries. Engine going to sleep.");
             deleteTriggers_();
             return;
        }
      }

      // --- PROCESS A CHUNK ---
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

      currentQueryState.lastRowProcessed += CHUNK_SIZE;
      recordsProcessedThisRun += CHUNK_SIZE;

      // Update progress in the queue
      const queueSheet = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID).getSheetByName("QueryQueue");
      const progress = `${currentQueryState.lastRowProcessed} / ${sourceData.length}`;
      queueSheet.getRange(currentQueryState.queueRow, 8).setValue(progress);
    }

    // --- EXECUTION TIME ENDED, BUT QUERY NOT FINISHED ---
    if (currentQueryState) {
        Logger.log("Execution time limit reached. Saving state and creating next trigger.");
        properties.setProperty('currentQueryState', JSON.stringify(currentQueryState));
        // Create a trigger to run itself again
        ScriptApp.newTrigger(QUERY_ENGINE_TRIGGER_FUNCTION)
            .timeBased()
            .after(60 * 1000) // 1 minute from now
            .create();
    }

  } catch (e) {
    Logger.log(`FATAL ERROR in runQueryEngineBatch: ${e.toString()}\nStack: ${e.stack}`);
    if (currentQueryState) {
        const queueSheet = SpreadsheetApp.openById(CONFIG.ATTENDANCE.ID).getSheetByName("QueryQueue");
        queueSheet.getRange(currentQueryState.queueRow, 3).setValue("Error");
        queueSheet.getRange(currentQueryState.queueRow, 6).setValue(new Date()); // Set ENDTime
        queueSheet.getRange(currentQueryState.queueRow, 8).setValue("Error"); // Keep progress concise
        queueSheet.getRange(currentQueryState.queueRow, 10).setValue(e.message); // Write full error to the new column
    }
    // Clean up state and triggers to prevent getting stuck
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
 * Evaluates a record against the 'where' clause of a query.
 * @param {Object} record The data record (row) as an object.
 * @param {Object} whereClause The 'where' clause from the query object.
 * @returns {boolean} True if the record matches all conditions, otherwise false.
 */
function evaluateWhereClause(record, whereClause) {
  // FIX: Added a guard against a null or undefined conditions array.
  if (!whereClause || !whereClause.conditions || whereClause.conditions.length === 0) {
    return true; // No conditions means it's a match
  }
  const logic = whereClause.logic.toUpperCase(); // AND or OR

  for (let i = 0; i < whereClause.conditions.length; i++) {
    const condition = whereClause.conditions[i];
    const recordValue = record[condition.field];
    const matches = applyRule(recordValue, condition.operator, condition.value);

    if (logic === 'AND' && !matches) {
      return false; // In AND, one failure means the whole thing fails
    }
    if (logic === 'OR' && matches) {
      return true; // In OR, one success means the whole thing succeeds
    }
  }

  // If we get here:
  // For AND, it means all conditions passed.
  // For OR, it means no conditions passed.
  return logic === 'AND';
}

/**
 * Applies a single filtering rule.
 * @param {*} recordValue The value from the current row.
 * @param {string} operator The comparison operator (e.g., 'equals', 'contains').
 * @param {*} conditionValue The value to compare against from the query.
 * @returns {boolean} True if the rule is met.
 */
function applyRule(recordValue, operator, conditionValue) {
    const rv = (recordValue === null || recordValue === undefined) ? '' : String(recordValue).toLowerCase();
    const cv = (conditionValue === null || conditionValue === undefined) ? '' : String(conditionValue).toLowerCase();

    switch (operator) {
        case 'equals': return rv === cv;
        case 'does not equal': return rv !== cv;
        case 'contains': return rv.includes(cv);
        case 'does not contain': return !rv.includes(cv);
        case 'is empty': return rv === '';
        case 'is not empty': return rv !== '';
        // Note: For date/number comparisons, more robust parsing is needed.
        // This basic version treats them as strings.
        case 'greater than': return parseFloat(rv) > parseFloat(cv);
        case 'less than': return parseFloat(rv) < parseFloat(cv);
        default: return false;
    }
}

/**
 * Processes a record for a GROUP BY aggregation.
 * @param {Object} record The data record object.
 * @param {string} groupByField The field to group by.
 * @param {Array<string>} aggregateFields The fields to aggregate (e.g., ["COUNT(ID)", "SUM(Amount)"]).
 * @param {Object} aggregationMap The map holding the aggregated data.
 */
function evaluateGroup(record, groupByField, aggregateFields, aggregationMap) {
    const key = record[groupByField];
    if (!aggregationMap[key]) {
        aggregationMap[key] = {};
        aggregateFields.slice(1).forEach(aggField => {
            const field = aggField.match(/\((.*?)\)/)[1];
            aggregationMap[key][field] = { sum: 0, count: 0 };
        });
    }

    aggregateFields.slice(1).forEach(aggField => {
        const aggFunc = aggField.split('(')[0].toLowerCase();
        const field = aggField.match(/\((.*?)\)/)[1];
        const value = record[field];

        if (aggFunc === 'count') {
            aggregationMap[key][field].count++;
        } else if (aggFunc === 'sum' || aggFunc === 'avg') {
            const numValue = parseFloat(value);
            if (!isNaN(numValue)) {
                aggregationMap[key][field].sum += numValue;
                aggregationMap[key][field].count++;
            }
        }
    });
}
