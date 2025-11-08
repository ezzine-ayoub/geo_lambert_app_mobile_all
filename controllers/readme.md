# Odoo RPC API Enhancements

This document outlines recent enhancements to the Odoo RPC API, focusing on advanced filtering capabilities.

## Advanced Filtering

Advanced filtering can be applied using `check_message_follower_ids` and `domain` parameters. This allows for precise, multi-level data retrieval.

This functionality is available in two main ways:
1.  **Top-Level Filter**: Applied to the main model being queried in an operation.
2.  **Relational Filter**: Applied to related fields that are being expanded via a `replaceToObject` configuration.

---

### Example 1: Standard RPC Operation

In a standard RPC call, filters can be used at the top level of `kwargs` and nested within a `replaceToObject` definition.

**Endpoint:** `/rpc/call`
**Method:** `POST`

**Example Request Body:**

```json
{
    "operation": "rpc",
    "db": "your_db",
    "username": "your_user",
    "password": "your_password",
    "model": "project.category",
    "method": "search_read",
    "kwargs": {
        "domain": [["name", "=", "Client Projects"]],
        "fields": ["name", "project_ids"],
        "replaceToObject": [{
            "project_ids": {
                "project.project": [
                    "name",
                    "partner_id",
                    "privacy_visibility"
                ],
                "check_message_follower_ids": true
            }
        }]
    }
}
```

**Explanation:**

This request first fetches `project.category` records named "Client Projects". Then, when expanding the `project_ids` for those categories, it applies a **relational filter**: it only populates the list with `project.project` records where the authenticated user is a follower.

---

### Example 2: Enhanced Update Operation

The same relational filtering logic can be used inside the `replaceToObject` block of an `/rpc/update` operation.

**Endpoint:** `/rpc/update`
**Method:** `POST`

**Example Request Body:**

```json
{
    "db": "your_db",
    "username": "your_user",
    "password": "your_password",
    "body": {
        "project.project": {
            "objects": [],
            "fields": ["id", "name", "tasks"],
            "include_missing": true,
            "check_message_follower_ids": true,
            "replaceToObject": [{
                 "tasks": {
                    "project.task": [
                        "name",
                        "stage_id"
                    ],
                    "check_message_follower_ids": true,
                    "domain": [["stage_id.name", "=", "In Progress"]]
                }
            }]
        }
    }
}
```

**Explanation:**

This request demonstrates multiple levels of filtering:
1.  **Top-Level Filter**: It fetches all `project.project` records where the user is a follower (`check_message_follower_ids: true`).
2.  **Relational Filter**: For each of those projects, it populates the `tasks` field. When doing so, it applies another filter to the tasks, returning only those where:
    - The user is a follower (`check_message_follower_ids: true`).
    - AND the task's stage is "In Progress" (`"domain": [["stage_id.name", "=", "In Progress"]]`).

This powerful combination allows you to build complex, filtered data structures in a single API call across all supported operations.
