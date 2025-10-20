from odoo import models, api


class MailFollowers(models.Model):
    _inherit = 'mail.followers'

    @api.model_create_multi
    def create(self, vals_list):
        """Déclencher WebSocket quand on ajoute un follower"""
        followers = super(MailFollowers, self).create(vals_list)
        
        # Envoyer notification pour chaque projet concerné
        for follower in followers:
            if follower.res_model == 'project.project' and follower.res_id:
                project = self.env['project.project'].browse(follower.res_id)
                if project.exists():
                    project.get_project_data_for_websocket(event_type='updated')
        
        return followers

    def write(self, vals):
        """Déclencher WebSocket quand on modifie un follower"""
        res = super(MailFollowers, self).write(vals)
        
        # Envoyer notification pour chaque projet concerné
        for follower in self:
            if follower.res_model == 'project.project' and follower.res_id:
                project = self.env['project.project'].browse(follower.res_id)
                if project.exists():
                    project.get_project_data_for_websocket(event_type='updated')
        
        return res

    def unlink(self):
        """Déclencher WebSocket quand on supprime un follower"""
        # Récupérer les projets concernés avant la suppression
        projects_to_notify = self.env['project.project']
        for follower in self:
            if follower.res_model == 'project.project' and follower.res_id:
                project = self.env['project.project'].browse(follower.res_id)
                if project.exists():
                    projects_to_notify |= project
        
        res = super(MailFollowers, self).unlink()
        
        # Envoyer les notifications après la suppression
        for project in projects_to_notify:
            project.get_project_data_for_websocket(event_type='updated')
        
        return res
