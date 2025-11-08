from odoo import models, fields, api
import logging

_logger = logging.getLogger(__name__)


class ProjectCategory(models.Model):
    _inherit = 'project.category'

    project_ids = fields.One2many(
        'project.project',
        'category_id',
        string="Projects"
    )

    def _get_all_users_with_access_to_category_projects(self):
        """
        Récupère tous les utilisateurs ayant accès à au moins un projet de cette catégorie
        """
        self.ensure_one()
        
        all_authorized_users = self.env['res.users']
        
        for project in self.project_ids:
            if hasattr(project, '_get_authorized_users'):
                authorized_users = project._get_authorized_users()
                all_authorized_users |= authorized_users
        
        _logger.info(
            f"📂 Catégorie {self.id} ({self.name}) - "
            f"{len(all_authorized_users)} utilisateurs uniques avec accès"
        )
        
        return all_authorized_users
    
    def _get_accessible_projects_for_user(self, user):
        """
        Récupère les projets de cette catégorie accessibles par un utilisateur spécifique
        Basé sur privacy_visibility et message_follower_ids
        """
        self.ensure_one()
        
        accessible_projects = self.env['project.project']
        
        for project in self.project_ids:
            privacy = project.privacy_visibility if hasattr(project, 'privacy_visibility') else False
            
            has_access = False
            
            if privacy == 'portal':
                has_access = True
            elif privacy == 'followers':
                follower_partners = project.message_follower_ids.mapped('partner_id')
                user_partner = user.partner_id
                has_access = user_partner in follower_partners
            elif privacy == 'employees':
                has_access = not user.share
            else:
                follower_partners = project.message_follower_ids.mapped('partner_id')
                user_partner = user.partner_id
                has_access = user_partner in follower_partners
            
            if has_access:
                accessible_projects |= project
        
        return accessible_projects
    
    def _prepare_category_payload_for_user(self, user, event_type='updated'):
        """
        Prépare le payload de la catégorie pour un utilisateur spécifique
        ✅ Filtre les projets selon privacy_visibility
        """
        self.ensure_one()
        
        accessible_projects = self._get_accessible_projects_for_user(user)
        project_ids_list = accessible_projects.ids
        
        _logger.info(
            f"👤 User {user.id} ({user.name}) - "
            f"Catégorie {self.id}: {len(project_ids_list)}/{len(self.project_ids)} projets accessibles"
        )
        
        return {
            'model': 'project.category',
            'id': self.id,
            'name': self.name,
            'display_name': self.display_name if hasattr(self, 'display_name') else self.name,
            'project_ids': project_ids_list,
            'event_type': event_type
        }

    def _send_category_to_users_unified_channel(self, event_type='updated'):
        """
        🔥 CANAL UNIFIÉ: geo_lambert_category_projects_{user_id}
        Émet la catégorie vers le canal unifié de chaque utilisateur
        """
        self.ensure_one()
        
        try:
            authorized_users = self._get_all_users_with_access_to_category_projects()
            
            if not authorized_users:
                _logger.warning(
                    f"⚠️ Catégorie {self.id} ({self.name}) - Aucun utilisateur autorisé trouvé"
                )
                return
            
            channels_sent = []
            for user in authorized_users:
                try:
                    # 🔥 CANAL UNIFIÉ
                    channel = f"geo_lambert_category_projects_{user.id}"
                    
                    payload = self._prepare_category_payload_for_user(user, event_type=event_type)
                    
                    if payload['project_ids']:
                        self.env["ws.notifier"].send(channel, payload)
                        channels_sent.append(channel)
                    else:
                        payload_deleted = {
                            'model': 'project.category',
                            'event_type': 'deleted',
                            'id': self.id,
                            'name': self.name,
                            'display_name': self.display_name if hasattr(self, 'display_name') else self.name,
                        }
                        self.env["ws.notifier"].send(channel, payload_deleted)
                        _logger.info(f"➖ User {user.id} n'a plus de projets dans catégorie {self.id}")
                    
                except Exception as e:
                    _logger.error(
                        f"❌ Erreur émission WebSocket catégorie vers {user.name} (user_id={user.id}): {str(e)}"
                    )
                    continue
            
            _logger.info(
                f"✅ Catégorie {self.id} ({self.name}) - WebSocket émis vers {len(channels_sent)} users - "
                f"event={event_type} - Canal: geo_lambert_category_projects_{{user_id}}"
            )
            
        except Exception as e:
            _logger.error(
                f"❌ Erreur globale émission WebSocket catégorie {self.id}: {str(e)}",
                exc_info=True
            )

    @api.model_create_multi
    def create(self, vals_list):
        records = super(ProjectCategory, self).create(vals_list)
        
        for record in records:
            record._send_category_to_users_unified_channel(event_type='created')
        
        return records

    def write(self, vals):
        old_authorized_users_by_category = {}
        for category in self:
            old_authorized_users_by_category[category.id] = category._get_all_users_with_access_to_category_projects()
        
        result = super(ProjectCategory, self).write(vals)
        
        for category in self:
            new_authorized_users = category._get_all_users_with_access_to_category_projects()
            old_authorized_users = old_authorized_users_by_category.get(category.id, self.env['res.users'])
            
            users_still_authorized = new_authorized_users & old_authorized_users
            for user in users_still_authorized:
                try:
                    channel = f"geo_lambert_category_projects_{user.id}"
                    payload = category._prepare_category_payload_for_user(user, event_type='updated')
                    
                    if payload['project_ids']:
                        self.env["ws.notifier"].send(channel, payload)
                    else:
                        payload_deleted = {
                            'model': 'project.category',
                            'event_type': 'deleted',
                            'id': category.id,
                            'name': category.name,
                            'display_name': category.display_name if hasattr(category, 'display_name') else category.name,
                        }
                        self.env["ws.notifier"].send(channel, payload_deleted)
                        _logger.info(f"➖ User {user.id} n'a plus de projets dans catégorie {category.id}")
                except Exception as e:
                    _logger.error(f"❌ Erreur envoi update user {user.id}: {str(e)}")
            
            new_users = new_authorized_users - old_authorized_users
            for user in new_users:
                try:
                    channel = f"geo_lambert_category_projects_{user.id}"
                    payload = category._prepare_category_payload_for_user(user, event_type='created')
                    
                    if payload['project_ids']:
                        self.env["ws.notifier"].send(channel, payload)
                        _logger.info(f"➕ Nouvel accès user {user.id} à la catégorie {category.id}")
                except Exception as e:
                    _logger.error(f"❌ Erreur envoi created user {user.id}: {str(e)}")
            
            removed_users = old_authorized_users - new_authorized_users
            for user in removed_users:
                try:
                    channel = f"geo_lambert_category_projects_{user.id}"
                    payload = {
                        'model': 'project.category',
                        'event_type': 'deleted',
                        'id': category.id,
                        'name': category.name,
                        'display_name': category.display_name if hasattr(category, 'display_name') else category.name,
                    }
                    self.env["ws.notifier"].send(channel, payload)
                    _logger.info(f"➖ Accès retiré user {user.id} de la catégorie {category.id}")
                except Exception as e:
                    _logger.error(f"❌ Erreur envoi deleted user {user.id}: {str(e)}")
        
        return result

    def unlink(self):
        categories_info = []
        for category in self:
            authorized_users = category._get_all_users_with_access_to_category_projects()
            categories_info.append({
                'id': category.id,
                'name': category.name,
                'display_name': category.display_name if hasattr(category, 'display_name') else category.name,
                'authorized_users': authorized_users,
            })
        
        result = super(ProjectCategory, self).unlink()
        
        for info in categories_info:
            payload = {
                'model': 'project.category',
                'event_type': 'deleted',
                'id': info['id'],
                'name': info['name'],
                'display_name': info['display_name'],
            }
            
            for user in info['authorized_users']:
                try:
                    channel = f"geo_lambert_category_projects_{user.id}"
                    self.env["ws.notifier"].send(channel, payload)
                except Exception as e:
                    _logger.error(
                        f"❌ Erreur émission WebSocket deleted catégorie {info['id']} "
                        f"vers user {user.id}: {str(e)}"
                    )
        
        return result
