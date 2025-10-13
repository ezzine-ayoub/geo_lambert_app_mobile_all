from odoo import models, api
from odoo.exceptions import MissingError

class TaskExponse(models.Model):
    _inherit = 'task.expense'

    def read(self, fields=None, load='_classic_read'):
        """Override to filter out deleted records gracefully"""
        try:
            # Filtrer les records qui existent encore
            existing_records = self.exists()
            if not existing_records:
                return []
            return super(TaskExponse, existing_records).read(fields, load)
        except MissingError:
            # Record supprimé, retourner une liste vide
            return []

    @api.model_create_multi
    def create(self, vals_list):
        lines = super(TaskExponse, self).create(vals_list)
        for line in lines:
            if line.task_id:
                line.task_id._send_project_update(event_type='updated')
            elif line.project_id:
                line.project_id.get_project_data_for_websocket(event_type='updated')
        return lines

    def write(self, vals):
        old_projects = self.mapped('project_id')
        res = super(TaskExponse, self).write(vals)
        new_projects = self.mapped('project_id')
        all_projects = old_projects | new_projects
        for project in all_projects:
            project.get_project_data_for_websocket(event_type='updated')
        return res

    def unlink(self):
        # ✅ Sauvegarder les infos AVANT le unlink pour éviter les erreurs de cache
        expenses_to_notify = []
        if not self.env.context.get('deleting_project') and not self.env.context.get('deleting_task'):
            for expense in self:
                try:
                    if expense.task_id and expense.task_id.project_id:
                        expenses_to_notify.append({
                            'project_id': expense.task_id.project_id.id,
                            'expense_id': expense.id,
                            'task_id': expense.task_id.id,
                        })
                    elif expense.project_id:
                        expenses_to_notify.append({
                            'project_id': expense.project_id.id,
                            'expense_id': expense.id,
                            'task_id': False,
                        })
                except Exception:
                    # Si erreur de lecture, continuer
                    continue
        
        # ✅ Supprimer d'abord
        result = super(TaskExponse, self).unlink()
        
        # ✅ Envoyer les notifications APRÈS la suppression (cache invalidé)
        for notify_data in expenses_to_notify:
            try:
                project = self.env['project.project'].browse(notify_data['project_id'])
                if project.exists():
                    if notify_data['task_id']:
                        project.get_project_data_for_websocket(
                            event_type='updated',
                            deleted_expense_id=notify_data['expense_id'],
                            task_id_with_deleted_expense=notify_data['task_id']
                        )
                    else:
                        project.get_project_data_for_websocket(
                            event_type='updated',
                            deleted_expense_id=notify_data['expense_id']
                        )
            except Exception:
                # Si erreur lors de l'envoi, continuer
                continue
        
        return result
