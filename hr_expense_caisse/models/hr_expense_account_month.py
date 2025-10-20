from odoo import models, fields, api, _
from datetime import datetime


class HrExpenseAccountMonth(models.Model):
    _name = "hr.expense.account.month"
    _description = "Expense Month"
    _inherit = ["mail.thread", "mail.activity.mixin"]


    display_name = fields.Char("Display Name",compute="_compute_display_name",store=True)
    name = fields.Char(string="Nom", readonly=True)
    user_id = fields.Many2one("res.users", required=True, string="Responsible",related='caisse_id.user_id')
    project_id = fields.Many2one("project.project", string="Project",related='caisse_id.project_id')
    transaction_ids = fields.One2many(
        "hr.expense.account.move", "caisse_mois_id", string="Transaction"
    )
    caisse_id = fields.Many2one("hr.expense.account", string="Caisse")
    solde_initial = fields.Monetary(
        string="Solde Initial",
        currency_field="currency_id",
        readonly=True
    )
    solde_final = fields.Monetary(
        string="Solde Final",
        currency_field="currency_id",
        readonly=True
    )
    sold = fields.Monetary(
        string="Solde",
        compute="_compute_sold",
        store=True,
        currency_field="currency_id",
    )
    currency_id = fields.Many2one(
        "res.currency",
        string="Currency",
        related="company_id.currency_id",
        readonly=True,
    )
    company_id = fields.Many2one(
        "res.company",
        string="Company",
        required=True,
        default=lambda self: self.env.company,
    )
    project_id = fields.Many2one(
        'project.project',
        string='Projet',
        help='Projet associé à ce mois de dépenses'
    )

    @api.depends("transaction_ids")
    def _compute_sold(self):
        for rec in self:
            total_credit = sum(
                transaction.total_amount for transaction in rec.transaction_ids if transaction.expense_move_type == 'replenish'
            )
            total_debtor = sum(
                transaction.total_amount for transaction in rec.transaction_ids if transaction.expense_move_type == 'spent'
            )
            rec.sold = total_credit - total_debtor + rec.solde_initial

    def action_open_form(self):
        return {
            "type": "ir.actions.act_window",
            "name": "Expense Project",
            "view_mode": "form",
            "res_model": "expense.caisse.month",
            "res_id": self.id,
            "view_id": False,
            "target": "current",
        }

    number_transaction = fields.Integer(
        string=" Transaction", compute="_compute_number_transaction"
    )

    @api.depends("transaction_ids")
    def _compute_number_transaction(self):
        for record in self:
            record.number_transaction = len(record.transaction_ids)

    def open_view_transaction(self):
        return {
            "type": "ir.actions.act_window",
            "name": "Transaction",
            "view_mode": "list,form,kanban",
            "mobile_view_mode": "kanban",
            "domain": [
                ("caisse_mois_id", "=", self.id),
            ],
            "context": {
                # "project_id": self.id,
                # "default_project_id": self.id,
                "search_default_project_id": self.caisse_id.id,
                "search_default_caisse_mois_id": self.id,
                # "default_city_id": self.city_id.id,
                # "default_employee_id": self.pointeur.id,
            },
            "res_model": "hr.expense.account.move",
            "target": "current",
        }
   
    @api.depends('name','sold','transaction_ids')
    def _compute_display_name(self):
        for record in self:
            # Afficher "Le Mois MM/YYYY" pour un affichage plus convivial
            if record.name:
                record.display_name = f"Le Mois {record.name}"
            else:
                record.display_name = 'Mois non défini'
    
    def name_get(self):
        """Surcharge la méthode name_get pour utiliser display_name"""
        result = []
        for record in self:
            # S'assurer que display_name est calculé
            if not record.display_name or record.display_name == 'Mois non défini':
                record._compute_display_name()
            result.append((record.id, record.display_name))
        return result
    
    @api.model
    def refresh_all_display_names(self):
        """Méthode utilitaire pour recalculer tous les display_name"""
        all_months = self.search([])
        all_months._compute_display_name()
        return True
    
    def action_close_month(self):
        """Ferme le mois en définissant le solde final"""
        self.ensure_one()
        
        # Vérifier que ce n'est pas le mois courant
        current_month_str = datetime.today().strftime("%m/%Y")
        if self.name == current_month_str:
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': _("Attention!"),
                    'message': _("Impossible de fermer le mois courant."),
                    'type': 'warning'
                }
            }
        
        # Définir le solde final
        self.solde_final = self.sold
        
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _("Succès!"),
                'message': _(f"Le mois {self.display_name} a été fermé avec un solde final de {self.solde_final}."),
                'type': 'success'
            }
        }
