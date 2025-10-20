# -*- coding: utf-8 -*-

from odoo import models, fields, api, _
import json


class HrEmployee(models.Model):
    _inherit = 'hr.employee'

    caisse_id = fields.Many2one('hr.expense.account', string="Caisse Employé", ondelete='restrict')
    deponse_ids = fields.One2many('hr.expense.account.move', 'employee_id', string="Dépenses")
    
    total_depenses = fields.Float(
        string="Total Dépenses", 
        compute="_compute_total_depenses"
    )
    nbr_depenses = fields.Integer(
        string="Nombre Dépenses", 
        compute="_compute_nbr_depenses"
    )
    nbr_alimentations = fields.Integer(
        string="Nombre Alimentations", 
        compute="_compute_nbr_alimentations"
    )
    total_alimentations = fields.Float(
        string="Total Alimentations", 
        compute="_compute_total_alimentations"
    )
    
    @api.depends("deponse_ids")
    def _compute_nbr_depenses(self):
        for rec in self:
            total = len([dep for dep in rec.deponse_ids if dep.expense_move_type == "spent"])
            rec.nbr_depenses = total

    @api.depends("deponse_ids")
    def _compute_nbr_alimentations(self):
        for rec in self:
            total = len([dep for dep in rec.deponse_ids if dep.expense_move_type == "replenish"])
            rec.nbr_alimentations = total

    @api.depends("deponse_ids.total_amount")
    def _compute_total_depenses(self):
        """
        Calcule le total des Dépenses liées à cet employé.
        """
        for rec in self:
            total = sum(
                deponse.total_amount for deponse in rec.deponse_ids 
                if deponse.expense_move_type == "spent"
            )
            rec.total_depenses = total

    @api.depends("deponse_ids.total_amount")
    def _compute_total_alimentations(self):
        """
        Calcule le total des Alimentations liées à cet employé.
        """
        for rec in self:
            total = sum(
                deponse.total_amount for deponse in rec.deponse_ids 
                if deponse.expense_move_type == "replenish"
            )
            rec.total_alimentations = total

    def action_view_employee_expenses(self):
        """Action pour voir toutes les dépenses de l'employé"""
        self.ensure_one()
        return {
            'name': _('Dépenses de %s') % self.name,
            'type': 'ir.actions.act_window',
            'res_model': 'hr.expense.account.move',
            'view_mode': 'list,form,pivot,kanban,graph',
            'domain': [('employee_id', '=', self.id), ("expense_move_type", "=", "spent")],
            'context': {
                'default_employee_id': self.id,
            },
            'target': 'current',
        }
    
    def action_view_employee_alimentations(self):
        """Action pour voir toutes les alimentations de l'employé"""
        self.ensure_one()
        return {
            'name': _('Alimentations de %s') % self.name,
            'type': 'ir.actions.act_window',
            'res_model': 'hr.expense.account.move',
            'view_mode': 'list,form,pivot,kanban,graph',
            'domain': [('employee_id', '=', self.id), ("expense_move_type", "=", "replenish")],
            'context': {
                'default_employee_id': self.id,
            },
            'target': 'current',
        }
    
    def action_create_employee_caisse(self):
        """Action pour créer une caisse pour cet employé"""
        self.ensure_one()
        
        # Vérifier si une caisse existe déjà
        if self.caisse_id:
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': _("Attention!"),
                    'message': _("Cet employé a déjà une caisse."),
                    'type': 'warning'
                }
            }
        
        # Créer la caisse
        caisse = self.env['hr.expense.account'].create({
            'name': f"Caisse - {self.name}",
            'employee_id': self.id,
            'type': 'personal',
            'user_id': self.user_id.id if self.user_id else self.env.user.id
        })
        
        # Mettre à jour l'employé avec la caisse
        self.write({'caisse_id': caisse.id})
        
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _("Succès!"),
                'message': _("La caisse a été créée avec succès pour %s") % self.name,
                'type': 'success'
            }
        }
