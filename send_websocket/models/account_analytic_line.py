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
        res = super(AccountAnalyticLine, self).write(vals)
        new_projects = self.mapped('project_id')
        all_projects = old_projects | new_projects
        for project in all_projects:
            project.get_project_data_for_websocket(event_type='updated')
        return res

