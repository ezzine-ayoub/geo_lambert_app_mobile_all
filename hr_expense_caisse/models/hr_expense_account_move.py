from odoo import fields, models, api, _
from odoo.exceptions import ValidationError,UserError
from datetime import timedelta,datetime
from dateutil.relativedelta import relativedelta
import logging
_logger = logging.getLogger(__name__)

class HrExpenseAccountMove(models.Model):
    _name = "hr.expense.account.move"
    _description = "Expense Move"

    _inherit = ["mail.thread", "mail.activity.mixin", "analytic.mixin"]
    
    name = fields.Char("Reference", readonly=True, default=_("New"), tracking=True)
    task_id = fields.Many2one(
        'project.task', 
        string='Tâche', 
        required=False,
        ondelete='cascade',
        domain="[('project_id', '=', project_id)]",
        help="Tâche à laquelle cette dépense est associée"
    )
    
    project_id = fields.Many2one(
        'project.project',
        related='task_id.project_id', 
        store=True, 
        readonly=False,
        string='Projet'
    )
        # Relation avec les nouveaux modèles de catégories et types
    expense_category_id = fields.Many2one(
        'expense.category',
        string='Catégorie',
        tracking=True,
        help="Catégorie de la dépense"
    )
    
    expense_type_id = fields.Many2one(
        'expense.type',
        string='Type de dépense',
        required=False,
        tracking=True,
        help="Type spécifique de dépense"
    )
    

    description = fields.Html("Description", required=False)
    designation = fields.Char("Designation")
    balance = fields.Float(
        "Balance in (DH)",
        related='expense_account_id.balance'
    )
    caisse_mois_id = fields.Many2one(
        "hr.expense.account.month", string="Période"
    )
    
    date = fields.Datetime("Date", required=True, default=lambda self: fields.datetime.now())

    total_amount = fields.Float("Total in (DH)", required=True, tracking=True)
    
    expense_move_type = fields.Selection(
        [
            ("replenish", "Replenishment"), 
            ("spent", "Spending")
        ], 
        string="Move Type",
        default="replenish",
        tracking=True
    )
    currency_id = fields.Many2one('res.currency', string='Currency', default=lambda self: self.env.company.currency_id)
    
    # Champ calculé pour le solde dans la vue liste
    solde_amount = fields.Float(
        string="Solde",
        compute="_compute_solde_amount",
        store=False
    )
    total_deponse = fields.Float(
        string="Dépense",
        compute="_compute_depense_reconstitution_amount",
        currency_field="currency_id",
        store=False
    )
    total_reconstitution = fields.Float(
        string="Alimentation",
        compute="_compute_depense_reconstitution_amount",
        currency_field="currency_id",
        store=False
    )

    # validate_by_administrator= fields.Selection(
    #     [
    #         ("brouillon", "Brouillon"),
    #         ("envoyee", "Envoyé pour Validation"),
    #         ("valid", "Validé"),
    #         ("invalide", "Invalide"),
    #     ],
    #     default="brouillon",
    #     string="Validation",
    #     tracking=True
    # )
    
    @api.constrains('total_amount')
    def _check_total_amount(self):
        for rec in self:
            if rec.total_amount is None or rec.total_amount == 0 :
                raise ValidationError("Le montant total est requis.")
            

    user_id = fields.Many2one('res.users', string="Employé/Caissier", default=lambda self: self.env.user)
    partner_id = fields.Many2one('res.partner', related='user_id.partner_id')
    expense_account_id = fields.Many2one("hr.expense.account", string="Caisse", required=False,store=True,default=lambda self: self.env.user.employee_id.caisse_id)
    # employee_id = fields.Many2one("hr.employee", related='expense_account_id.employee_id', string="Employé", store=True)
    employee_id = fields.Many2one("hr.employee", string="Employé",related='expense_account_id.employee_id',required=True)
    # caisse_manager_id = fields.Many2one('res.users', string="Responsable Caisse")

    attachment_ids = fields.One2many(
        comodel_name="ir.attachment",
        inverse_name="res_id",
        domain="[('res_model', '=', 'hr.expense.account.move')]",
        string="Attachments",
    )

  
    nbr_attachment_ids=fields.Integer("PJ",compute="get_nbr_attachment_ids")
    def get_nbr_attachment_ids(self):
        for rec in self:
            rec.nbr_attachment_ids=len(rec.attachment_ids.ids)

    @api.model
    def create(self, values):
        # Génération du nom si nouveau
        if values.get('name', _("New")) == _("New"):
            if values.get('expense_move_type') == 'spent':
                values['name'] = self.env['ir.sequence'].next_by_code('expense.spending') or _("New")
            else:
                values['name'] = self.env['ir.sequence'].next_by_code('expense.replenishment') or _("New")

        current_date = values.get("date")
        if current_date and values.get("expense_account_id"):
            try:
                # Conversion si nécessaire
                if isinstance(current_date, str):
                    date_obj = fields.Date.from_string(current_date)
                else:
                    date_obj = current_date

                formatted_date = date_obj.strftime("%m/%Y")
                input_month = datetime.strptime(formatted_date, "%m/%Y")
                current_month_dt = datetime.today().replace(day=1)
                month_3_before_dt = current_month_dt - relativedelta(months=3)

                # Bloquer si hors plage
                if input_month < month_3_before_dt:
                    raise UserError(_("La date est trop ancienne (plus de trois mois)."))

                elif input_month > current_month_dt:
                    raise UserError(_("La date est dans le futur."))

                # Rechercher caisse existante ou la créer
                caisse = self.env["hr.expense.account.month"].search([
                    ("name", "=", formatted_date),
                    ("caisse_id", "=", values.get("expense_account_id")),
                ], limit=1)

                if not caisse:
                    caisse = self.env["hr.expense.account.month"].create({
                        "name": formatted_date,
                        "caisse_id": values.get("expense_account_id"),
                    })

                # Attribuer la caisse au mouvement
                values["caisse_mois_id"] = caisse.id

            except Exception as e:
                _logger.warning("Erreur lors de la gestion de la caisse mensuelle: %s", str(e))
                raise UserError(_("Erreur lors de la gestion de la caisse mensuelle : %s") % str(e))

        # Création de l'enregistrement principal
        res = super().create(values)

        # Appeler Settlement après la création (pour éviter le décalage)
        if res.date and res.expense_account_id:
            res.Settlement_of_monthly_accounts(res.date, res.expense_account_id.id)

        return res

    # @api.constrains("total_amount")
    # def _check_expense_amount(self):
    #     for rec in self:
    #         if rec.expense_account_id.balance < 0 and rec.expense_move_type == 'spent':
    #             raise ValidationError(_("vous n'avez pas suffisamment de solde pour effectuer cette transaction."))

    @api.model
    def get_expense_dashboard(self, selected_caisse_ids=None, selected_month_id=None):
        """Dashboard simple pour afficher les statistics de base avec filtre par mois"""
        user = self.env.user
        
        # Récupérer les caisses de l'utilisateur avec filtrage
        if selected_caisse_ids:
            # Utiliser les caisses sélectionnées
            user_accounts = self.env['hr.expense.account'].browse(selected_caisse_ids)
        else:
            # Logique existante
            user_accounts = self.env['hr.expense.account'].search([])
            
            # Appliquer les mêmes règles que get_dashboard_stats
            if not user.has_group('hr_expense_caisse.group_expense_caisse_administrator'):
                if user.has_group('hr_expense_caisse.group_expense_caisse_caisse_manager'):
                    user_accounts = user_accounts.filtered(lambda x: x.user_id == user)
                else:
                    user_accounts = user_accounts.filtered(
                        lambda x: user in x.user_ids or x.user_id == user
                    )
        
        # Construire le domaine de base pour les mouvements
        move_domain = [('expense_account_id', 'in', user_accounts.ids)]
        
        # Ajouter le filtre par mois si spécifié
        if selected_month_id:
            move_domain.append(('caisse_mois_id', '=', selected_month_id))
            _logger.info(f"Filtre par mois appliqué: {selected_month_id}")
        
        # Récupérer les mouvements filtrés
        filtered_moves = self.env['hr.expense.account.move'].search(move_domain)
        
        # Calculer les totaux basés sur les mouvements filtrés
        if selected_month_id:
            # Si un mois est sélectionné, calculer à partir des mouvements de ce mois
            spent_moves = filtered_moves.filtered(lambda x: x.expense_move_type == 'spent')
            replenish_moves = filtered_moves.filtered(lambda x: x.expense_move_type == 'replenish')
            
            total_spent = sum(spent_moves.mapped('total_amount'))
            total_replenished = sum(replenish_moves.mapped('total_amount'))
            
            # Pour le solde, utiliser le solde de la caisse mensuelle sélectionnée
            month_record = self.env['hr.expense.account.month'].browse(selected_month_id)
            total_balance = month_record.sold if month_record else 0
        else:
            # Si aucun mois sélectionné, utiliser les totaux globaux des caisses
            total_balance = sum(user_accounts.mapped('balance'))
            total_spent = sum(user_accounts.mapped('total_spent'))
            total_replenished = sum(user_accounts.mapped('total_replenished'))
        
        # Compter les mouvements récents (dernière semaine) avec les mêmes filtres
        recent_domain = move_domain + [('date', '>=', fields.Datetime.now() - timedelta(days=7))]
        recent_moves = self.env['hr.expense.account.move'].search(recent_domain)
        
        # Déterminer le texte du tooltip
        if selected_month_id:
            month_name = self.env['hr.expense.account.month'].browse(selected_month_id).name
            tooltip_suffix = f"pour le mois {month_name}"
        elif selected_caisse_ids:
            tooltip_suffix = "des caisses sélectionnées"
        else:
            tooltip_suffix = "de toutes vos caisses"
        
        expense_state = {
            "stable_credit": {
                "description": _("Solde Total"),
                "amount": total_balance,
                "tooltip": _(f"Solde total {tooltip_suffix}"),
                "currency": self.env.company.currency_id.id,
            },
            "total_spent": {
                "description": _("Total Dépensé"),
                "amount": total_spent,
                "tooltip": _(f"Montant total des dépenses {tooltip_suffix}"),
                "currency": self.env.company.currency_id.id,
            },
            "total_replenished": {
                "description": _("Total Reconstitué"),
                "amount": total_replenished,
                "tooltip": _(f"Montant total des Alimentations {tooltip_suffix}"),
                "currency": self.env.company.currency_id.id,
            },
            "recent_moves_count": len(recent_moves),
        }
  
        return expense_state

    # def create_payment(self, vals):
    #     payment =  self.env['account.payment'].create({
    #         "payment_type": "outbound",
    #         "journal_id": vals.get('journal_id'),
    #         "partner_id": vals.get('partner_id'),
    #         "company_id": self.env.company.id,
    #         "currency_id": self.env.company.currency_id.id,
    #         'payment_method_line_id': vals.get('payment_method_line_id'),
    #         "date": vals.get('date'),
    #         "amount": vals.get("total_amount"),
    #     })
    #     payment.action_post()
    #     return payment.id
    
    # def action_validate_by_administrator(self):
    #     """Méthode pour valider le mouvement par l'administrateur"""
    #     for record in self:
    #         record.write({
    #             'validate_by_administrator': 'valid'
    #         })
    #         # Ajouter un message dans le chatter
    #         record.message_post(
    #             body=_("Mouvement validé par l'administrateur %s") % self.env.user.name,
    #             message_type='notification'
    #         )
    #     return True
    
    # def action_reset_validation(self):
    #     """Méthode pour remettre en attente la validation (pour les tests)"""
    #     for record in self:
    #         record.write({
    #             'validate_by_administrator': 'brouillon'
    #         })
    #         record.message_post(
    #             body=_("Validation remise en attente par %s") % self.env.user.name,
    #             message_type='notification'
    #         )
    #     return True
    
    def Settlement_of_monthly_accounts(self, date=None, caisse_id=False):
        if not caisse_id:
            _logger.warning("❌ caisse_id manquant")
            return

        # Si aucune date fournie, utiliser aujourd'hui
        if not date:
            date = datetime.today()

        input_month_str = date.strftime("%m/%Y")
        input_month_dt = datetime.strptime(input_month_str, "%m/%Y")
        current_month_str = datetime.today().strftime("%m/%Y")
        current_month_dt = datetime.strptime(current_month_str, "%m/%Y")

        # Chercher tous les mois de cette caisse
        all_months = self.env['hr.expense.account.month'].search([
            ('caisse_id', '=', caisse_id)
        ], order='name')

        # Associer chaque record avec sa date réelle
        months_with_dates = []
        for month in all_months:
            try:
                month_dt = datetime.strptime(month.name, "%m/%Y")
                months_with_dates.append((month_dt, month))
            except Exception as e:
                _logger.warning(f"❌ Erreur parsing mois '{month.name}': {e}")

        # Trier par date croissante
        months_with_dates.sort(key=lambda x: x[0])

        # Trouver le point de départ
        start_index = 0
        for i, (month_dt, _) in enumerate(months_with_dates):
            if month_dt >= input_month_dt:
                start_index = i
                break

        # 🔁 Initialiser le solde à partir du solde_final du mois précédent
        previous_final_balance = 0.0
        if start_index > 0:
            prev_month = months_with_dates[start_index - 1][1]
            previous_final_balance = prev_month.solde_final or 0.0

        # Boucle sur tous les mois à partir de celui modifié
        for index in range(start_index, len(months_with_dates)):
            month_dt, month = months_with_dates[index]
            is_current_month = month_dt == current_month_dt

            # 🧮 Mettre à jour solde initial
            month.solde_initial = previous_final_balance

            # 🔄 Recalculer le sold
            if hasattr(month, '_recompute_field'):
                month._recompute_field('sold')
            else:
                month._compute_sold()

            # 🧾 Solde final sauf pour mois courant
            if not is_current_month:
                month.solde_final = month.sold
                previous_final_balance = month.solde_final
            else:
                month.solde_final = False
                previous_final_balance = month.sold

            _logger.info(f"✅ Mois {month.name} | Initial={month.solde_initial} | Sold={month.sold} | Final={month.solde_final}")

        _logger.info("✅ Recalcul en cascade terminé pour la caisse ID %s", caisse_id)
    


    @api.model
    def recalculate_all_monthly_balances(self, caisse_id):
        """Recalcule tous les soldes mensuels d'une caisse depuis le début"""
        if not caisse_id:
            _logger.warning("recalculate_all_monthly_balances: caisse_id manquant")
            return False
        
        # Déterminer le mois courant
        current_month_str = datetime.today().strftime("%m/%Y")
        current_month_dt = datetime.strptime(current_month_str, "%m/%Y")
        
        # Chercher tous les mois de cette caisse
        all_months = self.env['hr.expense.account.month'].search([
            ('caisse_id', '=', caisse_id)
        ], order='name')
        
        if not all_months:
            _logger.warning(f"Aucun mois trouvé pour la caisse {caisse_id}")
            return False
        
        _logger.info(f"Recalcul de tous les soldes pour la caisse {caisse_id} - {len(all_months)} mois")
        _logger.info(f"Mois courant: {current_month_str}")
        
        # Traitement séquentiel de tous les mois
        previous_final_balance = 0.0  # Commencer avec un solde de 0
        
        for index, month in enumerate(all_months):
            # Vérifier si c'est le mois courant
            try:
                month_dt = datetime.strptime(month.name, "%m/%Y")
                is_current_month = month_dt == current_month_dt
            except:
                is_current_month = False
            
            _logger.info(f"Recalcul du mois {month.name} (index {index}) - Courant: {is_current_month}")
            
            if index == 0:
                # Premier mois: solde initial = 0 (ou conserver s'il existe déjà)
                if month.solde_initial is False or month.solde_initial is None:
                    month.solde_initial = 0.0
                previous_final_balance = month.solde_initial
            else:
                # Mois suivants: solde initial = solde final du mois précédent
                month.solde_initial = previous_final_balance
            
            # Recalculer le solde courant
            month._compute_sold()
            
            # Définir le solde final selon le type de mois
            if not is_current_month:
                # Mois passé: solde_final = sold (fermer le mois)
                month.solde_final = month.sold
                previous_final_balance = month.solde_final  # Utiliser le solde final pour la suite
                _logger.info(f"Mois fermé {month.name}: initial={month.solde_initial}, sold={month.sold}, final={month.solde_final}")
            else:
                # Mois courant: pas de solde final défini
                month.solde_final = False
                previous_final_balance = month.sold  # Utiliser le solde courant temporairement
                _logger.info(f"Mois courant {month.name}: initial={month.solde_initial}, sold={month.sold}, final=NON_DÉFINI")
        
        _logger.info("Recalcul terminé avec succès")
        return True
      
   
   
    # def action_invalidate_by_administrator(self):
    #        """Méthode pour invalider le mouvement par l'administrateur"""
    #        for record in self:
    #            record.write({
    #                'validate_by_administrator': 'invalide'
    #            })
    #            # Ajouter un message dans le chatter
    #            record.message_post(
    #                body=_("Mouvement invalidé par l'administrateur %s") % self.env.user.name,
    #                message_type='notification'
    #            )
    #        return True
    

    # def action_envoyee(self):
    #     for record in self:
    #         record.write({
    #             'validate_by_administrator': 'envoyee'
    #         })
    #     return True
    
    @api.depends('expense_move_type', 'total_amount')
    def _compute_solde_amount(self):
        """Calcul du solde pour affichage dans la vue liste"""
        for record in self:
            # Pour les reconstitutions: valeur positive
            if record.expense_move_type == 'replenish':
                record.solde_amount = record.total_amount
            # Pour les dépenses: valeur négative
            elif record.expense_move_type == 'spent':
                record.solde_amount = -record.total_amount
            else:
                record.solde_amount = 0.0

    @api.depends('expense_move_type', 'total_amount')
    def _compute_depense_reconstitution_amount(self):
        """Calcul du solde Reconstitution et Dépense pour affichage dans la vue liste"""
        for record in self:
            # Pour les reconstitutions: valeur positive
            if record.expense_move_type == 'replenish':
                record.total_reconstitution=record.total_amount
                record.total_deponse=0
            # Pour les dépenses: valeur négative
            elif record.expense_move_type == 'spent':
                record.total_deponse=record.total_amount
                record.total_reconstitution=0                                                  
            else:
                record.total_deponse = 0.0
                record.total_reconstitution = 0.0




    @api.model
    def recalculate_all_monthly_balances_giniral(self):
        """Recalcule les soldes mensuels de toutes les caisses depuis le début."""
        # Déterminer le mois courant
        current_month_str = datetime.today().strftime("%m/%Y")
        current_month_dt = datetime.strptime(current_month_str, "%m/%Y")

        # Récupérer toutes les caisses
        all_caisses = self.env['hr.expense.account'].search([])
        if not all_caisses:
            _logger.warning("Aucune caisse trouvée.")
            return False

        for caisse in all_caisses:
            _logger.info(f"Traitement de la caisse ID {caisse.id} - {caisse.name}")
            
            all_months = self.env['hr.expense.account.month'].search([
                ('caisse_id', '=', caisse.id)
            ], order='name')

            if not all_months:
                _logger.warning(f"Aucun mois trouvé pour la caisse {caisse.name}")
                continue

            previous_final_balance = 0.0

            for index, month in enumerate(all_months):
                try:
                    month_dt = datetime.strptime(month.name, "%m/%Y")
                    is_current_month = month_dt == current_month_dt
                except Exception as e:
                    _logger.warning(f"Erreur de parsing date pour le mois {month.name} : {e}")
                    is_current_month = False

                if index == 0:
                    if month.solde_initial is False or month.solde_initial is None:
                        month.solde_initial = 0.0
                    previous_final_balance = month.solde_initial
                else:
                    month.solde_initial = previous_final_balance

                # Recalculer le solde du mois
                month._compute_sold()

                if not is_current_month:
                    month.solde_final = month.sold
                    previous_final_balance = month.solde_final
                else:
                    month.solde_final = False
                    previous_final_balance = month.sold

                _logger.info(f"Caisse {caisse.name} - Mois {month.name} : initial={month.solde_initial}, sold={month.sold}, final={month.solde_final}")

        _logger.info("Recalcul global des soldes mensuels terminé avec succès.")
        return True
     
