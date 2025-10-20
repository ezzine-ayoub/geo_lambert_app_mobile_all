from odoo import fields, models, api, _
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta

class HrExpenseAccount(models.Model):
    _name = "hr.expense.account"
    _description = "Expense Caisse"
    _inherit = ["mail.thread", "mail.activity.mixin", "analytic.mixin"]
    
    display_name = fields.Char("Display Name",compute="_compute_display_name",store=True)
    name = fields.Char("Name", required=True)

    user_id = fields.Many2one("res.users", required=True, string="Responsible" , related='employee_id.user_id')
    employee_id = fields.Many2one("hr.employee", string="Employé", required=True, ondelete='cascade')

    balance = fields.Float(
        "Balance in (DH)",
        compute="_compute_balance",
        store=True
    )

    min_balance = fields.Float(
        "Min Balance of Caisse in (DH)",
        default=0.00
    )

    expense_account_move_ids = fields.One2many(comodel_name='hr.expense.account.move', inverse_name='expense_account_id', string='Expense Account Moves')
    month_ids = fields.One2many("hr.expense.account.month", "caisse_id", string="Caisses")
    type = fields.Selection(
        [
            ("project", "Project"),
            ("personal", "Personal"),
        ],
        default="personal", 
        string="Type"
    )
    currency_id = fields.Many2one('res.currency', string='Currency', default=lambda self: self.env.company.currency_id)

    
    user_ids = fields.Many2many("res.users", string="Users")

    # Nouveaux champs pour les statistiques
    total_spent = fields.Float(
        "Total Spent", 
        compute="_compute_totals",
        store=True
    )
    
    total_replenished = fields.Float(
        "Total Replenished", 
        compute="_compute_totals",
        store=True
    )

    last_transaction_date = fields.Datetime(
        "Last Transaction", 
        compute="_compute_last_transaction"
    )

    status = fields.Selection([
        ('healthy', 'Healthy'),
        ('warning', 'Low Balance'),
        ('critical', 'Critical'),
        ('empty', 'Empty')
    ], compute="_compute_status", store=True)

    # Champ de filtrage par mois pour les transactions
    selected_month_id = fields.Many2one(
        "hr.expense.account.month",
        string="Mois sélectionné",
        help="Mois pour filtrer les transactions",
        domain="[('caisse_id', '=', id)]"
    )
    
    # Filtre par date (mois/année) pour les statistiques
    filter_month_year = fields.Date(
        string="Filtrer par mois",
        help="Sélectionnez un mois pour filtrer les statistiques",
        default=lambda self: fields.Date.today().replace(day=1)  # Premier jour du mois courant
    )
    
    # Statistiques filtrées par mois
    filtered_balance = fields.Float(
        "Solde du mois",
        compute="_compute_filtered_statistics",
        store=False
    )
    
    filtered_total_spent = fields.Float(
        "Total dépensé du mois",
        compute="_compute_filtered_statistics", 
        store=False
    )
    
    filtered_total_replenished = fields.Float(
        "Total reconstitué du mois",
        compute="_compute_filtered_statistics",
        store=False
    )
    
    # Champ calculé pour compter le nombre de mois
    month_count = fields.Integer(
        "Nombre de mois",
        compute="_compute_month_count",
        store=False
    )
    
    # Champ calculé pour compter le nombre de transactions
    transaction_count = fields.Integer(
        "Nombre de transactions",
        compute="_compute_transaction_count",
        store=False
    )
    
    # Champ calculé pour les transactions filtrées
    filtered_expense_account_move_ids = fields.One2many(
        comodel_name='hr.expense.account.move', 
        inverse_name='expense_account_id', 
        string='Transactions Filtrées',
        compute='_compute_filtered_transactions'
    )
    _sql_constraints = [
        ('unique_employee_id',
         'UNIQUE(employee_id)',
         'Un seul compte de caisse peut être lié à un même employé.')
    ]

    @api.depends('name', 'user_id.name')
    def _compute_display_name(self):
        for record in self:
            if record.name and record.user_id:
                record.display_name = f"{record.name} - {record.user_id.name}"
            elif record.name:
                record.display_name = record.name
            elif record.user_id:
                record.display_name = record.user_id.name
            else:
                record.display_name = ''

    def name_get(self):
        """Surcharge la méthode name_get pour utiliser display_name"""
        result = []
        for record in self:
            # display_name est calculé grâce au champ compute, pas besoin de recalculer ici
            name = record.display_name or record.name or 'N/A'
            result.append((record.id, name))
        return result

    @api.model
    def create(self, vals):
        record = super(HrExpenseAccount, self).create(vals)

        # Obtenir la date du système (mois/année au format MM/YYYY)
        current_date = datetime.now()
        formatted_date = current_date.strftime("%m/%Y")

        # Créer un enregistrement dans le modèle expense.caisse.month
        self.env["hr.expense.account.month"].create(
            {
                "name": formatted_date,
                "caisse_id": record.id,  # Lier à la caisse nouvellement créée
            }
        )
        
        # Mettre à jour l'employé avec la caisse
        if record.employee_id:
            record.employee_id.caisse_id = record.id

        return record
   
   
    @api.model
    def create_monthly_record(self):
        current_date = datetime.today()
        formatted_date = current_date.strftime("%m/%Y")  # Format actuel : mois/année
        previous_month_date = current_date - relativedelta(months=1)
        month_pre = previous_month_date.strftime("%m/%Y")

        for caisse in self.search([]):
            caisse_pre = caisse.month_ids.filtered(lambda m: m.name == month_pre)
            if caisse_pre:
                caisse_pre.write({"solde_final": caisse_pre.sold})
                existing_record = caisse.month_ids.filtered(
                    lambda m: m.name == formatted_date
                )
                if not existing_record:
                    self.env["hr.expense.account.month"].create(
                        {
                            "name": formatted_date,
                            "solde_initial": caisse_pre.sold,
                            "caisse_id": caisse.id,  # Associer à la caisse parente
                            "company_id": self.env.company.id,
                        }
                    )

    @api.depends("expense_account_move_ids", "expense_account_move_ids.total_amount")
    def _compute_balance(self):
        for account in self:
            replenishments = sum(account.expense_account_move_ids.filtered(
                lambda x: x.expense_move_type == 'replenish'
            ).mapped('total_amount'))
            
            expenses = sum(account.expense_account_move_ids.filtered(
                lambda x: x.expense_move_type == 'spent'
            ).mapped('total_amount'))
            
            account.balance = replenishments - expenses

    @api.depends("expense_account_move_ids", "expense_account_move_ids.total_amount")
    def _compute_totals(self):
        for account in self:
            account.total_spent = sum(account.expense_account_move_ids.filtered(
                lambda x: x.expense_move_type == 'spent'
            ).mapped('total_amount'))
            
            account.total_replenished = sum(account.expense_account_move_ids.filtered(
                lambda x: x.expense_move_type == 'replenish'
            ).mapped('total_amount'))

    @api.depends("expense_account_move_ids")
    def _compute_last_transaction(self):
        for account in self:
            if account.expense_account_move_ids:
                account.last_transaction_date = max(
                    account.expense_account_move_ids.mapped('date')
                )
            else:
                account.last_transaction_date = False

    @api.depends("balance", "min_balance")
    def _compute_status(self):
        for account in self:
            if account.balance <= 0:
                account.status = 'empty'
            elif account.balance <= account.min_balance:
                account.status = 'critical'
            elif account.balance <= account.min_balance * 1.5:
                account.status = 'warning'
            else:
                account.status = 'healthy'

    @api.depends('expense_account_move_ids', 'selected_month_id')
    def _compute_filtered_statistics(self):
        """Calcule les statistiques filtrées par mois sélectionné"""
        for account in self:
            if account.selected_month_id:
                # Filtrer les transactions du mois sélectionné
                month_transactions = account.expense_account_move_ids.filtered(
                    lambda t: t.caisse_mois_id == account.selected_month_id
                )
                
                # Calculer les totaux du mois
                month_replenishments = sum(month_transactions.filtered(
                    lambda x: x.expense_move_type == 'replenish'
                ).mapped('total_amount'))
                
                month_expenses = sum(month_transactions.filtered(
                    lambda x: x.expense_move_type == 'spent'
                ).mapped('total_amount'))
                
                account.filtered_total_replenished = month_replenishments
                account.filtered_total_spent = month_expenses
                
                # Pour le solde filtré, utiliser directement le solde du mois sélectionné
                account.filtered_balance = account.selected_month_id.sold if account.selected_month_id else 0
            else:
                # Si aucun filtre, utiliser les totaux généraux
                account.filtered_total_replenished = account.total_replenished
                account.filtered_total_spent = account.total_spent
                account.filtered_balance = account.balance
            
    @api.depends('expense_account_move_ids', 'selected_month_id')
    def _compute_filtered_transactions(self):
        """Calcule les transactions filtrées selon le mois sélectionné"""
        for account in self:
            transactions = account.expense_account_move_ids
            
            # Filtrer par selected_month_id
            if account.selected_month_id:
                transactions = transactions.filtered(
                    lambda t: t.caisse_mois_id == account.selected_month_id
                )
            
            account.filtered_expense_account_move_ids = transactions

    @api.onchange('selected_month_id')
    def _onchange_filters(self):
        """Déclenche la mise à jour quand les filtres changent"""
        # Force le recalcul des transactions filtrées et des statistiques
        self._compute_filtered_transactions()
        self._compute_filtered_statistics()

    def action_clear_month_filter(self):
        """Efface le filtre de mois et recharge la vue"""
        self.ensure_one()
        
        # Effacer le filtre de mois
        self.write({
            'selected_month_id': False
        })
        
        # Recharger la vue pour assurer la mise à jour
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'hr.expense.account',
            'res_id': self.id,
            'view_mode': 'form',
            'target': 'current',
            'context': {
                'active_id': self.id,
                'active_model': 'hr.expense.account',
            }
        }
    
    def action_clear_all_filters(self):
        """Efface tous les filtres et recharge la vue"""
        self.ensure_one()
        
        # Effacer tous les filtres
        self.write({
            'selected_month_id': False
        })
        
        # Recharger la vue pour assurer la mise à jour
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'hr.expense.account',
            'res_id': self.id,
            'view_mode': 'form',
            'target': 'current',
            'context': {
                'active_id': self.id,
                'active_model': 'hr.expense.account',
            }
        }

    @api.depends('month_ids')
    def _compute_month_count(self):
        """Calcule le nombre de mois liés à cette caisse"""
        for account in self:
            account.month_count = len(account.month_ids)

    @api.depends('expense_account_move_ids')
    def _compute_transaction_count(self):
        """Calcule le nombre de transactions liées à cette caisse"""
        for account in self:
            account.transaction_count = len(account.expense_account_move_ids)

    def action_view_months(self):
        """Ouvre la vue des mois liés à cette caisse"""
        self.ensure_one()
        return {
            "type": "ir.actions.act_window",
            "name": f"Mois de {self.name}",
            "view_mode": "kanban,list,form",
            "res_model": "hr.expense.account.month",
            "domain": [('caisse_id', '=', self.id)],
            "context": {
                'default_caisse_id': self.id,
                'search_default_caisse_id': self.id,
            }
        }

    def action_view_transactions(self):
        self.ensure_one()
        # Rechercher la vue de recherche, avec fallback si elle n'existe pas
        search_view_id = False
        try:
            search_view_id = self.env.ref("hr_expense_caisse.hr_expense_account_move_search_with_date").id
        except:
            # Utiliser la vue de recherche par défaut si la vue spécifique n'existe pas
            pass
            
        return {
            "type": "ir.actions.act_window",
            "name": f"Transactions de {self.name}",
            "view_mode": "list,form",
            "res_model": "hr.expense.account.move",
            "domain": [('expense_account_id', '=', self.id)],
            "context": {
                'default_expense_account_id': self.id,
            },
            "search_view_id": search_view_id if search_view_id else False,
        }

    def action_replenish(self):
        self.ensure_one()

        return {
            "type": "ir.actions.act_window",
            "name": "Reconstituer Sold",
            "view_mode": "form",
            "view_type": "form",
            "res_model": "hr.expense.account.move",
            "view_id": self.env.ref("hr_expense_caisse.hr_expense_account_move_replenish_form").id,
            "target":"new",
            "context": {
                "default_expense_move_type": "replenish",
                "default_expense_account_id": self.id,
            },
        } 

    def create_caisse_for_employee(self, employee):
        """Crée une caisse pour un employé"""
        self.create({
            "name": f"Caisse - {employee.name}",
            "employee_id": employee.id,
            "type": "personal",
            "user_id": employee.user_id.id if employee.user_id else self.env.user.id
        })
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _("Génial!"),
                'message': _("La caisse a été créée avec succès pour %s") % employee.name,
                'type': 'success'
            }
        }

    @api.model
    def test_caisse_filter(self):
        """Méthode de test pour vérifier le filtrage des caisses"""
        import logging
        _logger = logging.getLogger(__name__)
        
        # Lister toutes les caisses
        all_caisses = self.search([])
        _logger.info(f"=== TEST FILTRE CAISSES ===")
        _logger.info(f"Nombre total de caisses: {len(all_caisses)}")
        
        for caisse in all_caisses:
            _logger.info(f"ID: {caisse.id} | Nom: {caisse.name} | Type: {caisse.type} | Balance: {caisse.balance}")
            _logger.info(f"   Responsable: {caisse.user_id.name} | Dépensé: {caisse.total_spent} | Reconstitué: {caisse.total_replenished}")
        
        # Test avec une caisse spécifique
        if all_caisses:
            test_caisse_id = all_caisses[0].id
            _logger.info(f"Test avec caisse ID {test_caisse_id}:")
            
            # Tester get_dashboard_stats avec filtre
            stats_filtered = self.get_dashboard_stats([test_caisse_id])
            _logger.info(f"Stats filtrées: Balance={stats_filtered['totalBalance']}, Dépenses={stats_filtered['totalExpenses']}")
            
            # Tester get_dashboard_stats sans filtre
            stats_all = self.get_dashboard_stats(None)
            _logger.info(f"Stats toutes: Balance={stats_all['totalBalance']}, Dépenses={stats_all['totalExpenses']}")
        
        _logger.info(f"=== FIN TEST ===")
        
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': 'Test Filtre Caisses',
                'message': f'Test terminé! {len(all_caisses)} caisses trouvées. Vérifiez les logs.',
                'type': 'success'
            }
        }
    @api.model
    def get_dashboard_stats(self, selected_caisse_ids=None):
        """Méthode pour récupérer les statistiques du dashboard"""
        current_user = self.env.user
        
        import logging
        _logger = logging.getLogger(__name__)
        _logger.info(f"=== DEBUG DASHBOARD ===\nUtilisateur: {current_user.name}\nGroupes: {[g.name for g.name in current_user.groups_id]}")
        
        # Compter les caisses par type
        if selected_caisse_ids:
            # Filtrer par les caisses sélectionnées
            accounts = self.browse(selected_caisse_ids)
            _logger.info(f"Caisses sélectionnées: {selected_caisse_ids}")
        else:
            accounts = self.search([])
            _logger.info(f"Toutes les caisses trouvées: {len(accounts)} - Noms: {[acc.name for acc in accounts]}")
        
        # Vérifier le groupe admin
        is_admin = current_user.has_group('hr_expense_caisse.group_expense_caisse_administrator')
        _logger.info(f"Est administrateur: {is_admin}")
        
        # Si l'utilisateur est admin, afficher toutes les caisses (ou filtrées)
        # Sinon, filtrer ses caisses personnelles
        if not is_admin:
            if current_user.has_group('hr_expense_caisse.group_expense_caisse_caisse_manager'):
                # Caisse Manager: juste ses caisses où il est responsable
                accounts = accounts.filtered(
                    lambda x: x.user_id == current_user
                )
                _logger.info(f"Filtré pour Caisse Manager: {len(accounts)} caisses")
            else:
                # Utilisateur normal: ses caisses où il est responsable ou membre
                accounts = accounts.filtered(
                    lambda x: current_user in x.user_ids or x.user_id == current_user
                )
                _logger.info(f"Filtré pour utilisateur normal: {len(accounts)} caisses")
        else:
            _logger.info(f"Administrateur - Aucun filtrage appliqué: {len(accounts)} caisses")

        # Détail des caisses pour debug
        for acc in accounts:
            _logger.info(f"Caisse: {acc.name} - Responsable: {acc.user_id.name} - Balance: {acc.balance} - Dépensé: {acc.total_spent} - Reconstitué: {acc.total_replenished}")
        # FIN DEBUG
        
        # Statistiques de base
        total_balance = sum(accounts.mapped('balance'))
        total_expenses = sum(accounts.mapped('total_spent'))
        total_replenishments = sum(accounts.mapped('total_replenished'))
        caisse_count = len(accounts)
        average_balance = total_balance / caisse_count if caisse_count > 0 else 0

        # Compter par type
        project_caisses = len(accounts.filtered(lambda x: x.type == 'project'))
        personal_caisses = len(accounts.filtered(lambda x: x.type == 'personal'))
        shared_caisses = len(accounts.filtered(lambda x: x.type == 'shared'))

        # Alertes
        low_balance_caisses = len(accounts.filtered(lambda x: x.status in ['warning', 'critical']))
        empty_caisses = len(accounts.filtered(lambda x: x.status == 'empty'))

        # Données mensuelles pour les graphiques
        monthly_data = self._get_monthly_data(accounts)

        # Retourner aussi la liste des caisses pour le filtre
        all_user_caisses = self.search([])
        if not current_user.has_group('hr_expense_caisse.group_expense_caisse_administrator'):
            if current_user.has_group('hr_expense_caisse.group_expense_caisse_caisse_manager'):
                all_user_caisses = all_user_caisses.filtered(
                    lambda x: x.user_id == current_user
                )
            else:
                all_user_caisses = all_user_caisses.filtered(
                    lambda x: current_user in x.user_ids or x.user_id == current_user
                )
        
        caisses_list = [{
            'id': caisse.id,
            'name': caisse.name,
            'type': caisse.type,
            'balance': caisse.balance
        } for caisse in all_user_caisses]
        
        return {
            'totalBalance': total_balance,
            'totalExpenses': total_expenses,
            'totalReplenishments': total_replenishments,
            'averageBalance': average_balance,
            'caisseCount': caisse_count,
            'projectCaisses': project_caisses,
            'personalCaisses': personal_caisses,
            'sharedCaisses': shared_caisses,
            'lowBalanceCaisses': low_balance_caisses,
            'emptyCaisses': empty_caisses,
            'monthlyData': monthly_data,
            'caissesList': caisses_list,
            'isAdmin': current_user.has_group('hr_expense_caisse.group_expense_caisse_administrator'),
            'isCaisseManager': current_user.has_group('hr_expense_caisse.group_expense_caisse_caisse_manager')
        }

    def _get_monthly_data(self, accounts):
        """Récupérer les données mensuelles pour les graphiques"""
        monthly_data = []
        
        # Récupérer les 6 derniers mois
        for i in range(6):
            date_start = datetime.now().replace(day=1) - relativedelta(months=i)
            date_end = date_start + relativedelta(months=1) - timedelta(days=1)
            
            # Filtrer les transactions du mois
            month_moves = self.env['hr.expense.account.move'].search([
                ('expense_account_id', 'in', accounts.ids),
                ('date', '>=', date_start),
                ('date', '<=', date_end)
            ])
            
            expenses = sum(month_moves.filtered(
                lambda x: x.expense_move_type == 'spent'
            ).mapped('total_amount'))
            
            replenishments = sum(month_moves.filtered(
                lambda x: x.expense_move_type == 'replenish'
            ).mapped('total_amount'))
            
            monthly_data.append({
                'month': date_start.strftime('%b %Y'),
                'expenses': expenses,
                'replenishments': replenishments
            })
        
        # Inverser pour avoir l'ordre chronologique
        return list(reversed(monthly_data))
    
    def action_recalculate_monthly_balances(self):
        """Action pour recalculer tous les soldes mensuels de cette caisse"""
        self.ensure_one()
        result = self.env['hr.expense.account.move'].recalculate_all_monthly_balances(self.id)
        
        if result:
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': _("Succès!"),
                    'message': _("Les soldes mensuels ont été recalculés avec succès."),
                    'type': 'success'
                }
            }
        else:
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': _("Erreur!"),
                    'message': _("Erreur lors du recalcul des soldes mensuels."),
                    'type': 'danger'
                }
            }

