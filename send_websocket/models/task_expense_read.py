# -*- coding: utf-8 -*-
from odoo import models, api

class TaskExpense(models.Model):
    _inherit = 'task.expense'

    @api.model
    def _read_group_raw(self, domain, fields, groupby, offset=0, limit=None, orderby=False, lazy=True):
        """Override to handle missing records gracefully"""
        try:
            return super()._read_group_raw(domain, fields, groupby, offset, limit, orderby, lazy)
        except Exception:
            # Si erreur de lecture, retourner vide au lieu de planter
            return []

    def read(self, fields=None, load='_classic_read'):
        """Override to filter out deleted records"""
        # Filtrer les records qui n'existent plus
        existing_records = self.filtered(lambda r: r.exists())
        if not existing_records:
            return []
        return super(TaskExpense, existing_records).read(fields, load)

    @api.model
    def search_read(self, domain=None, fields=None, offset=0, limit=None, order=None):
        """Override to handle missing records"""
        try:
            return super().search_read(domain, fields, offset, limit, order)
        except Exception:
            # En cas d'erreur, retourner une liste vide
            return []
