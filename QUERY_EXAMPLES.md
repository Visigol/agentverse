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

---

## Example 4: Food Delivery Brands by Market

**Goal:** Count the number of tasks for major food delivery brands (Uber, Glovo, Wolt, etc.) and group the results by country for the month of October 2025.

**UI Configuration:**

*   **SELECT:**
    *   `Country`
    *   `COUNT(Main Task ID)`
*   **FROM:** `Main Tasks`
*   **WHERE:**
    *   Match **ALL** of the following groups:
        *   Group 1: Match **ALL** of the following rules:
            *   `Main Task Start Date/Time` `is_between` `2025-10-01,2025-10-31`
        *   Group 2: Match **ANY** of the following rules:
            *   `Account Name` `contains` `Uber`
            *   `Account Name` `contains` `Glovo`
            *   `Account Name` `contains` `wolt`
            *   `Account Name` `contains` `foodora`
            *   `Account Name` `contains` `foody`
*   **GROUP BY:** `Country`
*   **ORDER BY:** `COUNT(Main Task ID)` `Descending`

**JSON Formula:**

```json
{
  "select": [
    "Country",
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
            "column": "Main Task Start Date/Time",
            "operator": "is_between",
            "value": "2025-10-01,2025-10-31"
          }
        ]
      },
      {
        "logic": "OR",
        "rules": [
          {
            "column": "Account Name",
            "operator": "contains",
            "value": "Uber"
          },
          {
            "column": "Account Name",
            "operator": "contains",
            "value": "Glovo"
          },
          {
            "column": "Account Name",
            "operator": "contains",
            "value": "wolt"
          },
          {
            "column": "Account Name",
            "operator": "contains",
            "value": "foodora"
          },
          {
            "column": "Account Name",
            "operator": "contains",
            "value": "foody"
          }
        ]
      }
    ]
  },
  "groupBy": [
    "Country"
  ],
  "orderBy": [
    {
      "column": "COUNT(Main Task ID)",
      "direction": "DESC"
    }
  ]
}
```

---

## Example 5: Average Handling Time (AHT) by Category

**Goal:** Calculate the average handling time for completed tasks, grouped by `Category`, to identify which types of tasks take the most time.

**UI Configuration:**

*   **SELECT:**
    *   `Category`
    *   `AVG(Stored Agent Handling Time)`
*   **FROM:** `Main Tasks`
*   **WHERE:**
    *   Match **ALL** of the following groups:
        *   Group 1: Match **ALL** of the following rules:
            *   `Status` `is` `Completed`
*   **GROUP BY:** `Category`
*   **ORDER BY:** `AVG(Stored Agent Handling Time)` `Descending`

**JSON Formula:**
```json
{
  "select": [
    "Category",
    "AVG(Stored Agent Handling Time)"
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
    "Category"
  ],
  "orderBy": [
    {
      "column": "AVG(Stored Agent Handling Time)",
      "direction": "DESC"
    }
  ]
}
```

---

## Example 6: Cases Missing Agent Assignments

**Goal:** Find all "In Progress" cases that do not have an agent assigned (i.e., the `Useremail` field is blank). This is useful for data integrity checks.

**UI Configuration:**

*   **SELECT:** (All columns)
*   **FROM:** `Main Tasks`
*   **WHERE:**
    *   Match **ALL** of the following groups:
        *   Group 1: Match **ALL** of the following rules:
            *   `Status` `is` `In Progress`
            *   `Useremail` `is_blank`

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
            "column": "Status",
            "operator": "is",
            "value": "In Progress"
          },
          {
            "column": "Useremail",
            "operator": "is_blank",
            "value": ""
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

## Example 7: Performance Breakdown by Country and Category

**Goal:** Get a detailed breakdown of case counts and average handling times, grouped first by `Country` and then by `Category`. This demonstrates multi-level grouping.

**UI Configuration:**

*   **SELECT:**
    *   `Country`
    *   `Category`
    *   `COUNT(Main Task ID)`
    *   `AVG(Stored Agent Handling Time)`
*   **FROM:** `Main Tasks`
*   **GROUP BY:**
    *   `Country`
    *   `Category`
*   **ORDER BY:**
    *   `Country` `Ascending`
    *   `COUNT(Main Task ID)` `Descending`

**JSON Formula:**
```json
{
  "select": [
    "Country",
    "Category",
    "COUNT(Main Task ID)",
    "AVG(Stored Agent Handling Time)"
  ],
  "from": [
    "Main Tasks"
  ],
  "where": {
    "logic": "AND",
    "groups": []
  },
  "groupBy": [
    "Country",
    "Category"
  ],
  "orderBy": [
    {
      "column": "Country",
      "direction": "ASC"
    },
    {
      "column": "COUNT(Main Task ID)",
      "direction": "DESC"
    }
  ]
}
```

---

## Example 8: All Cases Excluding Specific Categories

**Goal:** Retrieve all cases that are *not* in the 'General Inquiry' or 'Account Update' categories. This is useful for focusing on specific operational tasks.

**UI Configuration:**

*   **SELECT:** (All columns)
*   **FROM:** `Main Tasks`
*   **WHERE:**
    *   Match **ALL** of the following groups:
        *   Group 1: Match **ALL** of the following rules:
            *   `Category` `is_not_one_of` `General Inquiry,Account Update`

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
            "column": "Category",
            "operator": "is_not_one_of",
            "value": "General Inquiry,Account Update"
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

## Example 9: Find Case IDs with a Specific Format (Regex)

**Goal:** Use a regular expression to find all cases where the `Main Task ID` starts with "CS-" followed by exactly 8 digits. This is useful for validating ID formats or finding specific batches of work.

**UI Configuration:**

*   **SELECT:** `Main Task ID`, `Status`
*   **FROM:** `Main Tasks`
*   **WHERE:**
    *   Match **ALL** of the following groups:
        *   Group 1: Match **ALL** of the following rules:
            *   `Main Task ID` `matches_regex` `^CS-\\d{8}$`

**JSON Formula:**
```json
{
  "select": [
    "Main Task ID",
    "Status"
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
            "column": "Main Task ID",
            "operator": "matches_regex",
            "value": "^CS-\\\d{8}$"
          }
        ]
      }
    ]
  },
  "groupBy": [],
  "orderBy": []
}
```
