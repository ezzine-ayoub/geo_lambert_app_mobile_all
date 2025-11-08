from odoo import models, fields, api
import logging

_logger = logging.getLogger(__name__)


class ProjectTask(models.Model):
    _inherit = 'project.task'

    # ✅ Champs timer
    timer_start = fields.Datetime(
        string='Timer Start',
        help='Start time of the timer'
    )
    timer_stop = fields.Datetime(
        string='Timer Stop',
        help='Stop time of the timer'
    )

    def _get_assigned_users(self):
        """
        Récupère tous les utilisateurs assignés à cette tâche
        
        Returns:
            recordset: res.users assignés via user_ids
        """
        self.ensure_one()
        
        # ✅ Récupérer les utilisateurs assignés depuis user_ids
        assigned_users = self.user_ids if hasattr(self, 'user_ids') and self.user_ids else self.env['res.users']
        
        _logger.info(
            f"📋 Tâche {self.id} ({self.name}) - "
            f"{len(assigned_users)} utilisateurs assignés"
        )
        
        return assigned_users

    def _send_task_to_users(self, user_ids, event_type='updated'):
        """
        Émet la tâche vers les utilisateurs spécifiés via leurs channels privés
        
        Args:
            user_ids: recordset res.users
            event_type: 'created', 'updated', ou 'deleted'
        """
        self.ensure_one()
        
        if not user_ids:
            _logger.warning(
                f"⚠️ Tâche {self.id} ({self.name}) - Aucun utilisateur à notifier"
            )
            return
        
        try:
            # ✅ 1. Préparer le payload UNE SEULE FOIS
            payload = self._prepare_task_payload(event_type=event_type)
            
            # ✅ 2. Émettre vers le channel privé de chaque utilisateur
            channels_sent = []
            for user in user_ids:
                try:
                    # 🔐 Canal privé par utilisateur
                    channel = f"geo_lambert_category_projects_{user.id}"
                    
                    self.env["ws.notifier"].send(channel, payload)
                    channels_sent.append(channel)
                    
                except Exception as e:
                    _logger.error(
                        f"❌ Erreur émission WebSocket tâche vers {user.name} (user_id={user.id}): {str(e)}"
                    )
                    continue
            
            _logger.info(
                f"✅ Tâche {self.id} ({self.name}) - WebSocket émis vers {len(channels_sent)} users - "
                f"event={event_type}"
            )
            
        except Exception as e:
            _logger.error(
                f"❌ Erreur globale émission WebSocket tâche {self.id}: {str(e)}",
                exc_info=True
            )

    def _prepare_task_payload(self, event_type='updated'):
        """
        Prépare le payload de la tâche pour WebSocket
        """
        self.ensure_one()
        
        # ✅ Préparer la liste des utilisateurs assignés
        user_list = []
        for user in self.user_ids if hasattr(self, 'user_ids') else []:
            user_list.append({
                'id': user.id,
                'display_name': user.display_name,
                'name': user.name,
            })
        
        # ✅ Préparer la liste des timesheets
        timesheet_list = []
        try:
            timesheets = self.env['account.analytic.line'].search([
                ('task_id', '=', self.id)
            ], order='date desc')
            for timesheet in timesheets:
                try:
                    timesheet_list.append({
                        'id': timesheet.id,
                        'name': timesheet.name or 'Timesheet',
                        'date': timesheet.date.isoformat() if timesheet.date else False,
                        'unit_amount': timesheet.unit_amount or 0.0,
                        'amount': timesheet.amount or 0.0,
                        'employee_id': [timesheet.employee_id.id, timesheet.employee_id.name] if timesheet.employee_id else [],
                        'project_id': [timesheet.project_id.id, timesheet.project_id.name] if timesheet.project_id else [],
                        'task_id': [self.id, self.name],
                        'start_datetime': timesheet.start_datetime.isoformat() if timesheet.start_datetime else False,
                        'stop_datetime': timesheet.stop_datetime.isoformat() if timesheet.stop_datetime else False,
                        'start_longitude': timesheet.start_longitude if hasattr(timesheet, 'start_longitude') else False,
                        'start_latitude': timesheet.start_latitude if hasattr(timesheet, 'start_latitude') else False,
                        'stop_longitude': timesheet.stop_longitude if hasattr(timesheet, 'stop_longitude') else False,
                        'stop_latitude': timesheet.stop_latitude if hasattr(timesheet, 'stop_latitude') else False,
                    })
                except Exception:
                    continue
        except Exception:
            pass
        
        # ✅ Préparer la liste des dépenses de caisse
        expense_move_list = []
        try:
            expense_moves = self.env['hr.expense.account.move'].search([
                ('task_id', '=', self.id)
            ], order='date desc')
            
            for expense_move in expense_moves:
                try:
                    expense_move_list.append({
                        'id': expense_move.id,
                        'name': expense_move.name or 'Dépense',
                        'designation': expense_move.designation or '',
                        'date': expense_move.date.isoformat() if expense_move.date else False,
                        'total_amount': expense_move.total_amount or 0.0,
                        'solde_amount': expense_move.solde_amount if hasattr(expense_move, 'solde_amount') else (expense_move.total_amount or 0.0),
                        'balance': expense_move.balance if hasattr(expense_move, 'balance') else (expense_move.total_amount or 0.0),
                        'amount': expense_move.amount if hasattr(expense_move, 'amount') else (expense_move.total_amount or 0.0),
                        'expense_move_type': expense_move.expense_move_type or 'spent',
                        'expense_category_id': {
                            'id': expense_move.expense_category_id.id,
                            'display_name': expense_move.expense_category_id.display_name,
                            'name': expense_move.expense_category_id.name,
                        } if expense_move.expense_category_id else None,
                        'expense_type_id': {
                            'id': expense_move.expense_type_id.id,
                            'display_name': expense_move.expense_type_id.display_name,
                            'name': expense_move.expense_type_id.name,
                        } if expense_move.expense_type_id else None,
                        'employee_id': {
                            'id': expense_move.employee_id.id,
                            'display_name': expense_move.employee_id.display_name,
                            'name': expense_move.employee_id.name,
                        } if expense_move.employee_id else None,
                        'expense_account_id': {
                            'id': expense_move.expense_account_id.id,
                            'display_name': expense_move.expense_account_id.display_name,
                            'name': expense_move.expense_account_id.name,
                        } if expense_move.expense_account_id else None,
                        'project_id': {
                            'id': self.project_id.id,
                            'display_name': self.project_id.display_name,
                            'name': self.project_id.name,
                        } if self.project_id else None,
                        'task_id': {
                            'id': self.id,
                            'display_name': self.display_name,
                            'name': self.name,
                        },
                        'currency_id': {
                            'id': expense_move.currency_id.id,
                            'display_name': expense_move.currency_id.display_name,
                            'name': expense_move.currency_id.name,
                            'symbol': expense_move.currency_id.symbol,
                        } if expense_move.currency_id else None,
                    })
                except Exception:
                    continue
        except Exception:
            pass
        
        payload = {
            'model': 'project.task',
            'id': self.id,
            'user_ids': user_list,
            'timesheet_ids': timesheet_list,
            'expense_ids': expense_move_list,
            'display_name': self.display_name,
            'name': self.name,
            'partner_id': self.partner_id.id if self.partner_id else False,
            'state': self.state if hasattr(self, 'state') else False,
            'project_id': self.project_id.id if self.project_id else False,
            'event_type': event_type,
        }
        
        return payload

    def _send_project_update(self, event_type='updated', channel=None):
        """
        Notifie le projet parent que la tâche a changé
        """
        for task in self:
            if task.project_id:
                if event_type == 'deleted':
                    # ✅ Pour la suppression, passer l'ID de la tâche supprimée
                    task.project_id._send_project_to_authorized_users(
                        event_type='updated',
                        deleted_task_id=task.id
                    )
                else:
                    # ✅ Pour création/update, notifier normalement
                    task.project_id._send_project_to_authorized_users(event_type='updated')

    def get_task_data_for_websocket(self):
        """
        DEPRECATED: Conservé pour compatibilité backward
        """
        return self._prepare_task_payload(event_type='updated')

    @api.model_create_multi
    def create(self, vals_list):
        """Déclencher WebSocket quand on crée une tâche"""
        tasks = super(ProjectTask, self).create(vals_list)
        
        for task in tasks:
            # ✅ 1. Envoyer aux utilisateurs assignés
            assigned_users = task._get_assigned_users()
            if assigned_users:
                task._send_task_to_users(assigned_users, event_type='created')
            
            # ✅ 2. Notifier le projet parent
            task._send_project_update(event_type='created')
        
        return tasks

    def write(self, vals):
        """Déclencher WebSocket quand on modifie une tâche"""
        # ✅ 1. Sauvegarder les anciens utilisateurs assignés AVANT modification
        old_assigned_users_by_task = {}
        for task in self:
            old_assigned_users_by_task[task.id] = task._get_assigned_users()
        
        # ✅ 2. Effectuer la modification
        res = super(ProjectTask, self).write(vals)
        
        # ✅ 3. Pour chaque tâche modifiée
        for task in self:
            # Récupérer les nouveaux utilisateurs assignés
            new_assigned_users = task._get_assigned_users()
            old_assigned_users = old_assigned_users_by_task.get(task.id, self.env['res.users'])
            
            # 📤 Envoyer UPDATE aux utilisateurs toujours assignés
            users_still_assigned = new_assigned_users & old_assigned_users
            if users_still_assigned:
                task._send_task_to_users(users_still_assigned, event_type='updated')
            
            # 📬 Envoyer CREATED aux nouveaux utilisateurs assignés
            new_users = new_assigned_users - old_assigned_users
            if new_users:
                task._send_task_to_users(new_users, event_type='created')
                _logger.info(
                    f"➕ Nouveaux assignés à la tâche {task.id}: {[u.name for u in new_users]}"
                )
            
            # 🗑️ Envoyer DELETED aux utilisateurs désassignés
            removed_users = old_assigned_users - new_assigned_users
            for user in removed_users:
                try:
                    channel = f"geo_lambert_category_projects_{user.id}"
                    payload = {
                        'model': 'project.task',
                        'event_type': 'deleted',
                        'id': task.id,
                        'name': task.name,
                        'display_name': task.display_name,
                        'project_id': task.project_id.id if task.project_id else False,
                    }
                    self.env["ws.notifier"].send(channel, payload)
                    _logger.info(f"➖ Utilisateur {user.name} désassigné de la tâche {task.id}")
                except Exception as e:
                    _logger.error(f"❌ Erreur envoi deleted user {user.id}: {str(e)}")
            
            # ✅ 4. Notifier le projet parent
            task._send_project_update(event_type='updated')
        
        return res

    def action_timer_start(self):
        """Start the timer"""
        self.ensure_one()
        self.write({
            'timer_start': fields.Datetime.now()
        })
        # ✅ Le write() ci-dessus déclenche déjà les notifications WebSocket
        return True

    def action_timer_stop(self):
        """Stop the timer"""
        self.ensure_one()
        self.write({
            'timer_stop': fields.Datetime.now()
        })
        # ✅ Le write() ci-dessus déclenche déjà les notifications WebSocket
        return True

    def action_timer_start_button(self, id):
        """Button action to start the timer"""
        task = self.env['project.task'].browse([id])
        task.ensure_one()
        task.action_timer_start()

    def action_timer_stop_button(self, id):
        """Button action to stop the timer"""
        task = self.env['project.task'].browse(id)
        task.ensure_one()
        task.action_timer_stop()

    def unlink(self):
        """Déclencher WebSocket quand on supprime une tâche"""
        # ✅ Si on supprime le projet parent, ne pas envoyer d'événements
        if self.env.context.get('deleting_project'):
            return super(ProjectTask, self).unlink()
        
        # ✅ Sauvegarder les infos AVANT suppression
        tasks_info = []
        for task in self:
            assigned_users = task._get_assigned_users()
            tasks_info.append({
                'id': task.id,
                'name': task.name,
                'display_name': task.display_name,
                'project_id': task.project_id,
                'assigned_users': assigned_users,
            })
        
        # ✅ Supprimer les tâches
        res = super(ProjectTask, self).unlink()
        
        # ✅ Émettre les notifications APRÈS suppression
        for info in tasks_info:
            # 1. Envoyer DELETED aux utilisateurs assignés
            payload = {
                'model': 'project.task',
                'event_type': 'deleted',
                'id': info['id'],
                'name': info['name'],
                'display_name': info['display_name'],
                'project_id': info['project_id'].id if info['project_id'] else False,
            }
            
            for user in info['assigned_users']:
                try:
                    channel = f"geo_lambert_category_projects_{user.id}"
                    self.env["ws.notifier"].send(channel, payload)
                except Exception as e:
                    _logger.error(
                        f"❌ Erreur émission WebSocket deleted tâche {info['id']} "
                        f"vers user {user.id}: {str(e)}"
                    )
            
            # 2. Notifier le projet parent
            if info['project_id'] and info['project_id'].exists():
                info['project_id']._send_project_to_authorized_users(
                    event_type='updated',
                    deleted_task_id=info['id']
                )
        
        return res
