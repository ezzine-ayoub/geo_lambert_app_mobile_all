# -*- coding: utf-8 -*-

from odoo import models, fields, api, _,Command
from odoo.exceptions import UserError


class ProjectTask(models.Model):
    _inherit = 'project.task'

    expense_ids = fields.One2many(
        'hr.expense.account.move', 
        'task_id', 
        string='Dépenses',
        help="Liste des dépenses associées à cette tâche"
    )
    order_id = fields.Many2one(
        'sale.order', 
        string='Order',
    )
  
    
    total_expenses = fields.Float(
        'Total dépenses', 
        compute='_compute_total_expenses', 
        store=True,
        help="Montant total des dépenses de cette tâche"
    )
    total_expenses_chields = fields.Float(
        'Total dépenses', 
        compute='_compute_total_expenses_chields', 
        store=True,
    )
    total_expenses_parent = fields.Float(
        'Total dépenses', 
        compute='_compute_total_expenses_parent', 
        store=True,
    )
    
    expense_count = fields.Integer(
        'Nombre de dépenses', 
        compute='_compute_expense_count',
        help="Nombre de dépenses associées à cette tâche"
    )

    last_expense_date = fields.Date(
        'Dernière dépense',
        compute='_compute_last_expense_date',
        help="Date de la dernière dépense enregistrée"
    )

    
    @api.depends('expense_ids.total_amount')
    def _compute_total_expenses(self):
        """Calcule le total des dépenses pour chaque tâche"""
        for task in self:
            task.total_expenses = sum(task.expense_ids.mapped('total_amount'))


    @api.depends('child_ids', 'child_ids.expense_ids', 'child_ids.expense_ids.total_amount')
    def _compute_total_expenses_chields(self):
        """Calcule le total des dépenses des sous-tâches (childs) pour chaque tâche"""
        for task in self:
            if task.child_ids:
                # On additionne toutes les dépenses de toutes les sous-tâches
                total = sum(task.child_ids.mapped('expense_ids.total_amount'))
                task.total_expenses_chields = total
            else:
                task.total_expenses_chields = 0.0
    
    @api.depends('expense_ids.total_amount','total_expenses_chields','total_expenses')
    def _compute_total_expenses_parent(self):
        """Calcule le total des dépenses pour chaque tâche"""
        for task in self:
            task.total_expenses_parent = task.total_expenses+task.total_expenses_chields
                

    @api.depends('expense_ids')
    def _compute_expense_count(self):
        """Calcule le nombre de dépenses pour chaque tâche"""
        for task in self:
            task.expense_count = len(task.expense_ids)

    @api.depends('expense_ids.date')
    def _compute_last_expense_date(self):
        """Calcule la date de la dernière dépense"""
        for task in self:
            if task.expense_ids:
                task.last_expense_date = max(task.expense_ids.mapped('date'))
            else:
                task.last_expense_date = False

  
    def action_view_task_expenses(self):
        """Action pour voir les dépenses de la tâche"""
        self.ensure_one()
        return {
            'name': _('Dépenses de la tâche: %s') % self.name,
            'type': 'ir.actions.act_window',
            'res_model': 'hr.expense.account.move',
            'view_mode': 'list,form',
            'domain': [('task_id', '=', self.id)],
            'context': {
                'default_task_id': self.id,
            },
            'target': 'current',
        }
    

