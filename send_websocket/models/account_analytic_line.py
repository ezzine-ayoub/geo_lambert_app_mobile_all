from odoo import models, api

class AccountAnalyticLine(models.Model):
    _inherit = 'account.analytic.line'

    @api.model_create_multi
    def create(self, vals_list):
        lines = super(AccountAnalyticLine, self).create(vals_list)
        for line in lines:
            if line.task_id:
                line.task_id._send_project_update(event_type='updated')
            elif line.project_id:
                line.project_id.get_project_data_for_websocket(event_type='updated')
        return lines

    def write(self, vals):
        old_projects = self.mapped('project_id')
        old_tasks = self.mapped('task_id')
        res = super(AccountAnalyticLine, self).write(vals)
        new_projects = self.mapped('project_id')
        new_tasks = self.mapped('task_id')
        
        # Notifier les projets
        all_projects = old_projects | new_projects
        for project in all_projects:
            project.get_project_data_for_websocket(event_type='updated')
        
        # Notifier les tâches
        all_tasks = old_tasks | new_tasks
        for task in all_tasks:
            if task.project_id:
                task._send_project_update(event_type='updated')
        
        return res

    def unlink(self):
        # ✅ Sauvegarder les tâches et projets AVANT suppression
        tasks_to_notify = self.mapped('task_id')
        projects_to_notify = self.mapped('project_id')
        
        # Supprimer les lignes
        res = super(AccountAnalyticLine, self).unlink()
        
        # ✅ Notifier les tâches et projets APRÈS suppression
        for task in tasks_to_notify:
            if task.exists() and task.project_id:
                task._send_project_update(event_type='updated')
        
        for project in projects_to_notify:
            if project.exists():
                project.get_project_data_for_websocket(event_type='updated')
        
        return res

