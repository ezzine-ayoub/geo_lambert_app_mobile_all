from odoo import models, api


class ProjectCategory(models.Model):
    _inherit = 'project.category'  # In Odoo 18, project categories are 'project.tags'

    def _prepare_category_payload(self):
        """Prepare the payload for WebSocket notification"""
        self.ensure_one()
        
        # ✅ Envoyer SEULEMENT les IDs des projets
        # Les données complètes des projets sont gérées par leur propre channel WebSocket
        project_ids_list = self.project_ids.ids if self.project_ids else []
        
        return {
            'id': self.id,
            'name': self.name,
            'display_name': self.display_name if hasattr(self, 'display_name') else self.name,
            'project_ids': project_ids_list  # ⚠️ Seulement les IDs, pas les objets complets
        }

    def _send_category_notification(self, event_type='updated'):
        """Send WebSocket notification for category changes"""
        try:
            channel_name = 'geo_lambert_category_projects'
            payload = self._prepare_category_payload()
            payload['event_type'] = event_type
            
            self.env["ws.notifier"].send(channel_name, payload)
            
        except Exception as e:
            # Log error but don't block the operation
            import logging
            _logger = logging.getLogger(__name__)
            _logger.error(f'Failed to send category notification: {str(e)}')

    @api.model_create_multi
    def create(self, vals_list):
        """Override create to send WebSocket notification"""
        records = super(ProjectCategory, self).create(vals_list)
        
        for record in records:
            record._send_category_notification(event_type='created')
        
        return records

    def write(self, vals):
        """Override write to send WebSocket notification"""
        result = super(ProjectCategory, self).write(vals)
        
        # Send notification for each updated record
        for record in self:
            record._send_category_notification(event_type='updated')
        
        return result

    def unlink(self):
        """Override unlink to send WebSocket notification before deletion"""
        # Prepare payloads before deletion
        payloads = []
        for record in self:
            payload = record._prepare_category_payload()
            payload['event_type'] = 'deleted'
            payloads.append(payload)
        
        result = super(ProjectCategory, self).unlink()
        
        # Send notifications after successful deletion
        try:
            channel_name = 'geo_lambert_category_projects'
            for payload in payloads:
                self.env["ws.notifier"].send(channel_name, payload)
                
        except Exception as e:
            import logging
            _logger = logging.getLogger(__name__)
            _logger.error(f'Failed to send category deletion notification: {str(e)}')
        
        return result