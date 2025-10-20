{
    "name": "Expense Caisse",
    "author": "Daisy consulting",
    "summary": """Manage expenses using Caisse System""",
    "license": "AGPL-3",
    "sequence": -300,
    "description": """ """,
    "version": "18.0.1.0.1",
    "depends": [
        "base",
        "mail",
        "hr",
        "account","project_custom_enhancement"
    ],
    "data": [
        "security/security.xml",
        "security/ir.model.access.csv",
        "data/data.xml",
        "data/cron.xml",
        "views/hr_expense_account_views.xml",
        "views/hr_expense_account_move_views.xml",
        "views/account_journal_views.xml",
        "views/hr_expense_account_month_views.xml",
        "views/hr_employee_views.xml",
        "views/project_project_views.xml",
        "views/project_task_views.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "hr_expense_caisse/static/src/utils/*.js",
            "hr_expense_caisse/static/src/components/dashboard_loader.js",
            "hr_expense_caisse/static/src/components/*.js",
            "hr_expense_caisse/static/src/components/*.xml",
            "hr_expense_caisse/static/src/views/*.js",
            "hr_expense_caisse/static/src/views/*.xml",
            "hr_expense_caisse/static/src/css/*.css",
        ]
    },
    "images": [],
    "installable": True,
    "application": True,
    "auto_install": False,
}
