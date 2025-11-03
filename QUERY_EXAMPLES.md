# Dynamic Query Engine: Practical Examples

This document provides several real-world examples of queries that can be built using the Dynamic Query Engine. Each example includes a description of the goal, a screenshot of the UI configuration, and the resulting JSON formula.

## Example 1: Find All High-Priority Cases in a Specific Region

**Goal:** Identify all "In Progress" or "Escalated" cases in the " EMEA" region to prioritize team resources.

**UI Configuration:**

*   **SELECT:** (All columns)
*   **FROM:** `Main Tasks`
*   **WHERE:**
    *   Match **ALL** of the following groups:
        *   Group 1: Match **ANY** of the following rules:
            *   `Status` `is` `In Progress`
            *   `Status` `is` `Escalated`
        *   Group 2: Match **ALL** of the following rules:
            *   `Country` `is` `EMEA`

**JSON Formula:**

```json
{
  "select": [],
  "from": [
    "Main Tasks"
  ],
  "where": {
    "logic": "AND",
    "groups": [
      {
        "logic": "OR",
        "rules": [
          {
            "column": "Status",
            "operator": "is",
            "value": "In Progress"
          },
          {
            "column": "Status",
            "operator": "is",
            "value": "Escalated"
          }
        ]
      },
      {
        "logic": "AND",
        "rules": [
          {
            "column": "Country",
            "operator": "is",
            "value": "EMEA"
          }
        ]
      }
    ]
  },
  "groupBy": [],
  "orderBy": []
}
```

---

## Example 2: Count Completed Cases by Agent

**Goal:** Generate a report showing the total number of cases each agent has completed.

**UI Configuration:**

*   **SELECT:**
    *   `Useremail`
    *   `COUNT(Main Task ID)`
*   **FROM:** `Main Tasks`
*   **WHERE:**
    *   Match **ALL** of the following groups:
        *   Group 1: Match **ALL** of the following rules:
            *   `Status` `is` `Completed`
*   **GROUP BY:** `Useremail`

**JSON Formula:**

```json
{
  "select": [
    "Useremail",
    "COUNT(Main Task ID)"
  ],
  "from": [
    "Main Tasks"
  ],
  "where": {
    "logic": "AND",
    "groups": [
      {
        "logic": "AND",
        "rules": [
          {
            "column": "Status",
            "operator": "is",
            "value": "Completed"
          }
        ]
      }
    ]
  },
  "groupBy": [
    "Useremail"
  ],
  "orderBy": []
}
```

---

## Example 3: Find Cases with Unusually Long Pause Times

**Goal:** Identify cases that have been paused for more than 2 hours to investigate potential issues.

**UI Configuration:**

*   **SELECT:** (All columns)
*   **FROM:** `Main Tasks`
*   **WHERE:**
    *   Match **ALL** of the following groups:
        *   Group 1: Match **ALL** of the following rules:
            *   `Stored Pause Duration` `is_greater_than` `7200` (2 hours in seconds)

**JSON Formula:**

```json
{
  "select": [],
  "from": [
    "Main Tasks"
  ],
  "where": {
    "logic": "AND",
    "groups": [
      {
        "logic": "AND",
        "rules": [
          {
            "column": "Stored Pause Duration",
            "operator": "is_greater_than",
            "value": "7200"
          }
        ]
      }
    ]
  },
  "groupBy": [],
  "orderBy": []
}
```
