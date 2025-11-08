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
        "account",
        "project_custom_enhancement"
    ],
    "data": [
        "security/security.xml",
        "security/ir.model.access.csv",
        "data/data.xml",
        "data/cron.xml",
        "views/hr_expense_account_views.xml",
        "views/hr_expense_account_move_views.xml",
        "views/hr_expense_account_month_views.xml",
        "views/hr_employee_views.xml",
        "views/project_project_views.xml",
        "views/project_task_views.xml",
    ],
    "assets": {
        "web.assets_backend": [
            # ========== Services (chargés en premier) ==========
            "hr_expense_caisse/static/src/services/formatUtils.js",
            "hr_expense_caisse/static/src/services/externalFiltersService.js",
            
            # ========== Main Dashboard Component ==========
            "hr_expense_caisse/static/src/components/expense_dashboard.js",
            "hr_expense_caisse/static/src/components/expense_dashboard.xml",
            
            # ========== Views ==========
            "hr_expense_caisse/static/src/views/list.js",
            "hr_expense_caisse/static/src/views/list.xml",
            
            # ========== Styles ==========
            "hr_expense_caisse/static/src/css/*.css",
            
            # ========== Index (optionnel - pour imports faciles) ==========
            "hr_expense_caisse/static/src/index.js",
        ]
    },
    "images": [],
    "installable": True,
    "application": True,
    "auto_install": False,
}
