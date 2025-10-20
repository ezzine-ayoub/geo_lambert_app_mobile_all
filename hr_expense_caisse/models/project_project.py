# -*- coding: utf-8 -*-

from odoo import models, fields,api,_
import json



class ProjectProject(models.Model):
    _inherit = 'project.project'

    expense_ids=fields.One2many('hr.expense.account.move','project_id',string="Dépenses")
    

    total_depenses = fields.Float(
        string="Total Dépenses", compute="_compute_total_depenses"
    )
    nbr_depenses = fields.Float(
        string="Nomber Dépenses", compute="_compute_nbr_depenses"
    )
    nbr_alimentations = fields.Float(
        string="Nomber Alimentations", compute="_compute_nbr_alimentations"
    )
    total_alimentations = fields.Float(
        string="Total Alimentations", compute="_compute_total_alimentations"
    )
    
    @api.depends("expense_ids")
    def _compute_nbr_depenses(self):
        for rec in self:
            total = len([dep for dep in rec.expense_ids if dep.expense_move_type == "spent"])
            rec.nbr_depenses = total

    @api.depends("expense_ids")
    def _compute_nbr_alimentations(self):
        for rec in self:
            total = len([dep for dep in rec.expense_ids if dep.expense_move_type == "replenish"])
            rec.nbr_alimentations = total

    @api.depends("expense_ids.total_amount")
    def _compute_total_depenses(self):
        """
        Calcule le total des Dépenses liées à cette project.
        """
        for rec in self:
            total = sum(
                deponse.total_amount for deponse in rec.expense_ids if deponse.expense_move_type == "spent"
            )
            rec.total_depenses = total

    @api.depends("expense_ids.total_amount")
    def _compute_total_alimentations(self):
        """
        Calcule le total des Dépenses liées à cette project.
        """
        for rec in self:
            total = sum(
                deponse.total_amount for deponse in rec.expense_ids if deponse.expense_move_type == "replenish"
            )
            rec.total_alimentations = total


    def _get_stat_buttons(self):
        buttons = super()._get_stat_buttons()

        return buttons + [
            {
                'text': 'Dépenses',
                'icon': 'fa fa-money-bill-wave',
                'sequence': 5,
                'action': 'action_view_project_expenses',
                'action_type': 'object',
                'number': self.nbr_depenses,
                'show': True, 
                'color': 'blue',
            },
              {
                'text': 'Alimentations',
                'icon': 'fa fa-money-bill-wave',
                'sequence': 6,
                'action': 'action_view_project_alimentations',
                'action_type': 'object',
                'number': self.nbr_alimentations,
                'show': True, 
                'color': 'blue',
            },
        ]
    
    def action_view_project_expenses(self):
        """Action pour voir toutes les dépenses du projet (pour les smart buttons)"""
        self.ensure_one()
        return {
            'name': _('Dépenses du projet: %s') % self.name,
            'type': 'ir.actions.act_window',
            'res_model': 'hr.expense.account.move',
            'view_mode': 'list,form,pivot,kanban,graph',
            'domain': [('project_id', '=', self.id),("expense_move_type", "=", "spent")],
            'context': {
                'default_project_id': self.id,
                # 'group_by': ['expense_type'],
            },
            'target': 'current',
        }
    
    
    def _get_profitability_items(self, with_action=True):
        profitability_data = super()._get_profitability_items(with_action)

        custom_expenses_total = self.total_depenses
        if custom_expenses_total > 0:
            custom_expenses_entry = {
                'id': 'Les Dépenses',
                'sequence': 999,
                'name': 'Dépenses projet',
                'billed': -custom_expenses_total,
                'to_bill': 0.0,  
            }

            if with_action:
                if with_action:
                    custom_expenses_entry[0]['action'] = {
                        'name': 'action_profitability_items',
                        'type': 'object',
                        'args': json.dumps(['Les Dépenses', [('project_id', '=', self.id),("expense_move_type", "=", "spent")]]),
                        'embedded_action_ids': [],
                    }


            if 'costs' in profitability_data:
                if 'data' not in profitability_data['costs']:
                    profitability_data['costs']['data'] = []

                # Bien ajouter les 2 éléments
                profitability_data['costs']['data'].extend(custom_expenses_entry)

                if 'total' not in profitability_data['costs']:
                    profitability_data['costs']['total'] = {'billed': 0.0, 'to_bill': 0.0}

                profitability_data['costs']['total']['billed'] -= custom_expenses_total

        return profitability_data


    def action_profitability_items(self, section_name, domain=None, res_id=False):
        if section_name == 'Les Dépenses':
            action = {
                'name': _('Dépenses du projet: %s') % self.name,
                'type': 'ir.actions.act_window',
                'res_model': 'hr.expense.account.move',
                'views': [[False, 'list'], [False, 'form']],
                'domain': domain or [('project_id', '=', self.id),("expense_move_type", "=", "spent")],
                'context': {
                    'default_project_id': self.id,
                    # 'group_by': ['expense_type'],
                    'create': False,
                    'edit': False,
                },
            }
            if res_id:
                action['res_id'] = res_id
                action['view_mode'] = 'form'
            return action
        if section_name == 'Les Alimentations':
            action = {
                'name': _('Alimentations du projet: %s') % self.name,
                'type': 'ir.actions.act_window',
                'res_model': 'hr.expense.account.move',
                'views': [[False, 'list'], [False, 'form']],
                'domain': domain or [('project_id', '=', self.id),("expense_move_type", "=", "replenish")],
                'context': {
                    'default_project_id': self.id,
                    # 'group_by': ['expense_type'],
                    'create': False,
                    'edit': False,
                },
            }
            if res_id:
                action['res_id'] = res_id
                action['view_mode'] = 'form'
            return action
        
        return super().action_profitability_items(section_name, domain, res_id)

# Champs calculés pour les statistiques de dépenses
    total_project_expenses = fields.Float(
        'Total dépenses projet', 
        compute='_compute_project_expenses',
        help="Total des dépenses de toutes les tâches du projet"
    )
    
    task_expense_count = fields.Integer(
        'Nombre total de dépenses',
        compute='_compute_project_expenses',
        store=True,
        help="Nombre total de dépenses sur toutes les tâches"
    )
    @api.depends('task_ids.expense_ids.total_amount')
    def _compute_project_expenses(self):
        """Calcule les totaux des dépenses au niveau projet"""
        for project in self:
            # expenses = project.task_ids.mapped('expense_ids')
            expenses = project.expense_ids
            project.total_project_expenses = sum(expenses.mapped('total_amount'))
            project.task_expense_count = len(expenses)


    def _get_expenses_data(self):
        """Prépare les données des dépenses pour le dashboard avec le nouveau système dynamique"""
        expenses = self.task_ids.mapped('expense_ids')
        
        # Grouper par type de dépense (maintenant dynamique)
        grouped_expenses = {}
        for expense in expenses:
            if expense.expense_type_id:
                type_key = expense.expense_type_id.code
                type_name = expense.expense_type_id.name
            else:
                # Fallback pour les anciennes dépenses sans type dynamique
                type_key = expense.expense_type or 'other'
                type_name = 'Autre'
            
            if type_key not in grouped_expenses:
                grouped_expenses[type_key] = {
                    'name': type_name,
                    'amount': 0.0,
                    'count': 0,
                }
            grouped_expenses[type_key]['amount'] += expense.amount
            grouped_expenses[type_key]['count'] += 1
        
        # Convertir en liste pour le template
        expenses_list = []
        for type_key, data in grouped_expenses.items():
            expenses_list.append({
                'type': type_key,
                'name': data['name'],
                'amount': data['amount'],
                'count': data['count'],
            })
        
        # Trier par montant décroissant
        expenses_list.sort(key=lambda x: x['amount'], reverse=True)
        
        return {
            'data': expenses_list,
            'total': self.total_project_expenses,
            'count': self.task_expense_count,
        }



            



