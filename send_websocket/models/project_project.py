from odoo import models, fields, api
import logging

_logger = logging.getLogger(__name__)


class ProjectProject(models.Model):
    _inherit = 'project.project'

    def _get_assigned_tasks_for_user(self, user):
        """
        Récupère les tâches de ce projet assignées à un utilisateur spécifique
        Basé sur le champ user_ids de project.task
        
        Args:
            user: res.users record
            
        Returns:
            recordset: project.task assignées à cet utilisateur
        """
        self.ensure_one()
        
        assigned_tasks = self.env['project.task']
        
        for task in self.tasks:
            # Vérifier si l'utilisateur est dans user_ids de la tâche
            if hasattr(task, 'user_ids') and user in task.user_ids:
                assigned_tasks |= task
        
        return assigned_tasks

    def _get_authorized_users(self):
        """
        Récupère tous les utilisateurs autorisés à voir ce projet selon privacy_visibility
        
        Returns:
            recordset: res.users ayant accès au projet
        """
        self.ensure_one()
        
        # ✅ Récupérer privacy_visibility
        privacy = self.privacy_visibility if hasattr(self, 'privacy_visibility') else False
        
        authorized_users = self.env['res.users']
        
        if privacy == 'portal':
            # 🌐 PUBLIC - Tous les utilisateurs
            authorized_users = self.env['res.users'].search([])
            _logger.info(f"📂 Projet {self.id} ({self.name}) - PUBLIC: {len(authorized_users)} users")
            
        elif privacy == 'followers':
            # 👥 FOLLOWERS ONLY - Récupérer les utilisateurs depuis message_follower_ids
            follower_partners = self.message_follower_ids.mapped('partner_id')
            follower_user_ids = follower_partners.mapped('user_ids')
            authorized_users = follower_user_ids
            _logger.info(
                f"👥 Projet {self.id} ({self.name}) - FOLLOWERS: "
                f"{len(authorized_users)} users, "
                f"{len(follower_partners)} partners"
            )
            
        elif privacy == 'employees':
            # 🏢 INTERNAL USERS - Tous les employés internes
            authorized_users = self.env['res.users'].search([
                ('share', '=', False)  # Utilisateurs internes uniquement
            ])
            _logger.info(
                f"🏢 Projet {self.id} ({self.name}) - INTERNAL: {len(authorized_users)} users"
            )
        
        else:
            # ⚠️ Par défaut : followers only
            follower_partners = self.message_follower_ids.mapped('partner_id')
            follower_user_ids = follower_partners.mapped('user_ids')
            authorized_users = follower_user_ids
            _logger.warning(
                f"⚠️ Projet {self.id} ({self.name}) - privacy_visibility inconnu ('{privacy}'), "
                f"using followers: {len(authorized_users)} users"
            )
        
        return authorized_users

    def _send_project_to_authorized_users(self, event_type='updated', deleted_task_id=None, deleted_expense_id=None, task_id_with_deleted_expense=None):
        """
        Émet le projet vers tous les utilisateurs autorisés via leurs channels privés
        ✅ Chaque utilisateur reçoit UNIQUEMENT les tâches auxquelles il est assigné
        """
        self.ensure_one()
        
        try:
            # ✅ 1. Récupérer tous les utilisateurs autorisés
            authorized_users = self._get_authorized_users()
            
            if not authorized_users:
                _logger.warning(
                    f"⚠️ Projet {self.id} ({self.name}) - Aucun utilisateur autorisé trouvé"
                )
                return
            
            # ✅ 2. Pour chaque utilisateur, préparer un payload PERSONNALISÉ
            channels_sent = []
            for user in authorized_users:
                try:
                    # 🔒 Canal privé par utilisateur
                    channel = f"geo_lambert_category_projects_{user.id}"
                    
                    # ✅ Préparer le payload FILTRÉ pour cet utilisateur
                    payload = self._prepare_project_payload_for_user(
                        user,
                        event_type=event_type,
                        deleted_task_id=deleted_task_id,
                        deleted_expense_id=deleted_expense_id,
                        task_id_with_deleted_expense=task_id_with_deleted_expense
                    )
                    
                    self.env["ws.notifier"].send(channel, payload)
                    channels_sent.append(channel)
                    
                except Exception as e:
                    _logger.error(
                        f"❌ Erreur émission WebSocket vers {user.name} (user_id={user.id}): {str(e)}"
                    )
                    continue
            
            _logger.info(
                f"✅ Projet {self.id} ({self.name}) - WebSocket émis vers {len(channels_sent)} users - "
                f"event={event_type}"
            )
            
        except Exception as e:
            _logger.error(
                f"❌ Erreur globale émission WebSocket projet {self.id}: {str(e)}",
                exc_info=True
            )

    def _prepare_project_payload_for_user(self, user, event_type='updated', deleted_task_id=None, deleted_expense_id=None, task_id_with_deleted_expense=None):
        """
        Prépare le payload du projet pour un utilisateur spécifique
        ✅ Filtre les tâches selon user_ids (tâches assignées à cet utilisateur)
        ✅ Format unifié avec identifiant de modèle
        """
        self.ensure_one()
        
        # ✅ Récupérer UNIQUEMENT les tâches assignées à cet utilisateur
        assigned_tasks = self._get_assigned_tasks_for_user(user)
        
        # ✅ Préparer la liste des tâches (SEULEMENT celles assignées)
        task_list = []
        for task in assigned_tasks:
            task_list.append(task.get_task_data_for_websocket())
        
        _logger.info(
            f"👤 User {user.id} ({user.name}) - "
            f"Projet {self.id}: {len(task_list)}/{len(self.tasks)} tâches assignées"
        )
        
        # ✅ Préparer la liste des followers
        follower_list = []
        for follower in self.message_follower_ids:
            follower_data = {
                'id': follower.id,
                'partner_id': [{
                    'id': follower.partner_id.id,
                    'name': follower.partner_id.name,
                    'display_name': follower.partner_id.display_name,
                }] if follower.partner_id else [],
                'partner_name': follower.partner_id.name if follower.partner_id else False,
                'partner_email': follower.partner_id.email if follower.partner_id else False,
            }
            follower_list.append(follower_data)
        
        # ✅ Récupérer category_id
        category_id = False
        if hasattr(self, 'project_category_id') and self.project_category_id:
            category_id = self.project_category_id.id
        elif hasattr(self, 'category_id') and self.category_id:
            category_id = self.category_id.id
        elif hasattr(self, 'categ_id') and self.categ_id:
            category_id = self.categ_id.id
        
        payload = {
            'model': 'project.project',  # ✅ Identifiant de modèle
            'id': self.id,
            'name': self.name,
            'project_type': self.project_type if hasattr(self, 'project_type') else False,
            'partner_id': self.partner_id.id if self.partner_id else False,
            'date_start': self.date_start.isoformat() if self.date_start else False,
            'date': self.date.isoformat() if self.date else False,
            'tasks': task_list,  # ✅ SEULEMENT les tâches assignées à cet utilisateur
            'numero': self.numero if hasattr(self, 'numero') else False,
            'message_follower_ids': follower_list,
            'privacy_visibility': self.privacy_visibility if hasattr(self, 'privacy_visibility') else False,
            'event_type': event_type,
            'create_date': self.create_date.isoformat() if self.create_date else False,
            'write_date': self.write_date.isoformat() if self.write_date else False,
            'project_source': self.project_source if hasattr(self, 'project_source') else False,
            'category_id': category_id,
            'type_ids': [
                {'id': t.id, 'name': t.name, 'display_name': t.display_name}
                for t in self.type_ids
            ] if hasattr(self, 'type_ids') and self.type_ids else [],
        }
        
        # ✅ Ajouter les IDs supprimés si applicable
        if deleted_task_id:
            payload['deleted_task_id'] = deleted_task_id
        
        if deleted_expense_id:
            payload['deleted_expense_id'] = deleted_expense_id
            if task_id_with_deleted_expense:
                payload['task_id_with_deleted_expense'] = task_id_with_deleted_expense
        
        return payload

    def _prepare_project_payload(self, event_type='updated', deleted_task_id=None, deleted_expense_id=None, task_id_with_deleted_expense=None):
        """
        Prépare le payload du projet pour WebSocket
        DEPRECATED: Utiliser _prepare_project_payload_for_user pour filtrer les tâches par utilisateur
        """
        self.ensure_one()
        
        # ✅ Préparer la liste des tâches
        task_list = []
        for task in self.tasks:
            task_list.append(task.get_task_data_for_websocket())
        
        # ✅ Préparer la liste des followers
        follower_list = []
        for follower in self.message_follower_ids:
            follower_data = {
                'id': follower.id,
                'partner_id': [{
                    'id': follower.partner_id.id,
                    'name': follower.partner_id.name,
                    'display_name': follower.partner_id.display_name,
                }] if follower.partner_id else [],
                'partner_name': follower.partner_id.name if follower.partner_id else False,
                'partner_email': follower.partner_id.email if follower.partner_id else False,
            }
            follower_list.append(follower_data)
        
        # ✅ Récupérer category_id
        category_id = False
        if hasattr(self, 'project_category_id') and self.project_category_id:
            category_id = self.project_category_id.id
        elif hasattr(self, 'category_id') and self.category_id:
            category_id = self.category_id.id
        elif hasattr(self, 'categ_id') and self.categ_id:
            category_id = self.categ_id.id
        
        payload = {
            'model': 'project.project',
            'id': self.id,
            'name': self.name,
            'project_type': self.project_type if hasattr(self, 'project_type') else False,
            'partner_id': self.partner_id.id if self.partner_id else False,
            'date_start': self.date_start.isoformat() if self.date_start else False,
            'date': self.date.isoformat() if self.date else False,
            'tasks': task_list,
            'numero': self.numero if hasattr(self, 'numero') else False,
            'message_follower_ids': follower_list,
            'privacy_visibility': self.privacy_visibility if hasattr(self, 'privacy_visibility') else False,
            'event_type': event_type,
            'create_date': self.create_date.isoformat() if self.create_date else False,
            'write_date': self.write_date.isoformat() if self.write_date else False,
            'project_source': self.project_source if hasattr(self, 'project_source') else False,
            'category_id': category_id,
            'type_ids': [
                {'id': t.id, 'name': t.name, 'display_name': t.display_name}
                for t in self.type_ids
            ] if hasattr(self, 'type_ids') and self.type_ids else [],
        }
        
        # ✅ Ajouter les IDs supprimés si applicable
        if deleted_task_id:
            payload['deleted_task_id'] = deleted_task_id
        
        if deleted_expense_id:
            payload['deleted_expense_id'] = deleted_expense_id
            if task_id_with_deleted_expense:
                payload['task_id_with_deleted_expense'] = task_id_with_deleted_expense
        
        return payload

    def get_project_data_for_websocket(self, event_type='updated', channel=None, deleted_task_id=None, deleted_expense_id=None, task_id_with_deleted_expense=None):
        """
        DEPRECATED: Conservé pour compatibilité backward
        Utilise maintenant _send_project_to_authorized_users
        """
        for project in self:
            if channel:
                # ⚠️ Mode legacy: utiliser le channel fourni
                payload = project._prepare_project_payload(
                    event_type=event_type,
                    deleted_task_id=deleted_task_id,
                    deleted_expense_id=deleted_expense_id,
                    task_id_with_deleted_expense=task_id_with_deleted_expense
                )
                self.env["ws.notifier"].send(channel, payload)
            else:
                # ✅ Mode nouveau: channels privés par utilisateur
                project._send_project_to_authorized_users(
                    event_type=event_type,
                    deleted_task_id=deleted_task_id,
                    deleted_expense_id=deleted_expense_id,
                    task_id_with_deleted_expense=task_id_with_deleted_expense
                )

    @api.model_create_multi
    def create(self, vals_list):
        """Déclencher WebSocket quand on crée un projet"""
        projects = super(ProjectProject, self).create(vals_list)
        
        for project in projects:
            project._send_project_to_authorized_users(event_type='created')
        
        return projects

    def write(self, vals):
        """Déclencher WebSocket quand on modifie un projet"""
        # ✅ 1. Sauvegarder les anciens utilisateurs AVANT modification
        old_authorized_users_by_project = {}
        for project in self:
            old_authorized_users_by_project[project.id] = project._get_authorized_users()
        
        # ✅ 2. Effectuer la modification
        res = super(ProjectProject, self).write(vals)
        
        # ✅ 3. Pour chaque projet modifié
        for project in self:
            # Récupérer les nouveaux utilisateurs autorisés
            new_authorized_users = project._get_authorized_users()
            old_authorized_users = old_authorized_users_by_project.get(project.id, self.env['res.users'])
            
            # 📤 Envoyer UPDATE aux utilisateurs qui ont toujours accès
            users_still_authorized = new_authorized_users & old_authorized_users
            for user in users_still_authorized:
                try:
                    channel = f"geo_lambert_category_projects_{user.id}"
                    # ✅ Utiliser le payload personnalisé
                    payload = project._prepare_project_payload_for_user(user, event_type='updated')
                    self.env["ws.notifier"].send(channel, payload)
                except Exception as e:
                    _logger.error(f"❌ Erreur envoi update user {user.id}: {str(e)}")
            
            # 📬 Envoyer CREATED aux nouveaux utilisateurs
            new_users = new_authorized_users - old_authorized_users
            for user in new_users:
                try:
                    channel = f"geo_lambert_category_projects_{user.id}"
                    # ✅ Utiliser le payload personnalisé
                    payload = project._prepare_project_payload_for_user(user, event_type='created')
                    self.env["ws.notifier"].send(channel, payload)
                    _logger.info(f"➕ Nouvel accès user {user.id} au projet {project.id}")
                except Exception as e:
                    _logger.error(f"❌ Erreur envoi created user {user.id}: {str(e)}")
            
            # 🗑️ Envoyer DELETED aux utilisateurs qui n'ont plus accès
            removed_users = old_authorized_users - new_authorized_users
            for user in removed_users:
                try:
                    channel = f"geo_lambert_category_projects_{user.id}"
                    payload = {
                        'model': 'project.project',
                        'event_type': 'deleted',
                        'id': project.id,
                        'name': project.name,
                        'display_name': project.display_name if hasattr(project, 'display_name') else project.name,
                    }
                    self.env["ws.notifier"].send(channel, payload)
                    _logger.info(f"➖ Accès retiré user {user.id} du projet {project.id}")
                except Exception as e:
                    _logger.error(f"❌ Erreur envoi deleted user {user.id}: {str(e)}")
        
        return res

    def unlink(self):
        """Déclencher WebSocket quand on supprime un projet"""
        # ✅ Sauvegarder les infos AVANT suppression
        projects_info = []
        for project in self:
            authorized_users = project._get_authorized_users()
            projects_info.append({
                'id': project.id,
                'name': project.name,
                'display_name': project.display_name if hasattr(project, 'display_name') else project.name,
                'authorized_users': authorized_users,
            })
        
        # ✅ Supprimer le projet (cela supprimera aussi les tâches en cascade)
        res = super(ProjectProject, self.with_context(deleting_project=True)).unlink()
        
        # ✅ Émettre DELETED vers tous les utilisateurs qui avaient accès
        for info in projects_info:
            payload = {
                'model': 'project.project',
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
                        f"❌ Erreur émission WebSocket deleted projet {info['id']} "
                        f"vers user {user.id}: {str(e)}"
                    )
        
        return res
