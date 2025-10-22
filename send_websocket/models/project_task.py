from odoo import models, fields, api

class ProjectProject(models.Model):
    _inherit = 'project.project'

    def get_project_data_for_websocket(self, event_type='updated', channel='geo_lambert_expenses', deleted_task_id=None, deleted_expense_id=None, task_id_with_deleted_expense=None):
        for project in self:
            task_list = []
            for task in project.tasks:
                task_list.append(task.get_task_data_for_websocket())

            # ✅ Récupérer les followers du projet
            follower_list = []
            for follower in project.message_follower_ids:
                follower_data = {
                    'id': follower.id,
                    # ✅ Format ARRAY comme l'API pour compatibilité avec le filtrage TypeScript
                    'partner_id': [{
                        'id': follower.partner_id.id,
                        'name': follower.partner_id.name,
                        'display_name': follower.partner_id.display_name,
                    }] if follower.partner_id else [],
                    'partner_name': follower.partner_id.name if follower.partner_id else False,
                    'partner_email': follower.partner_id.email if follower.partner_id else False,
                }
                follower_list.append(follower_data)

            # 🔍 Déboguer le nom exact du champ de catégorie
            import logging
            _logger = logging.getLogger(__name__)
            
            # Vérifier tous les champs possibles
            category_id = False
            category_field_name = None
            
            if hasattr(project, 'project_category_id') and project.project_category_id:
                category_id = project.project_category_id.id
                category_field_name = 'project_category_id'
            elif hasattr(project, 'category_id') and project.category_id:
                category_id = project.category_id.id
                category_field_name = 'category_id'
            elif hasattr(project, 'categ_id') and project.categ_id:
                category_id = project.categ_id.id
                category_field_name = 'categ_id'
            
            _logger.info(f"🔍 WebSocket Projet {project.id} ({project.name}):")
            _logger.info(f"   ➡️ Champ catégorie utilisé: {category_field_name}")
            _logger.info(f"   ➡️ Category ID: {category_id}")
            
            # Si aucun champ n'est trouvé, logger tous les champs disponibles contenant 'categ' ou 'category'
            if not category_id:
                available_fields = [f for f in dir(project) if 'categ' in f.lower() or 'category' in f.lower()]
                _logger.warning(f"⚠️ Aucun champ de catégorie trouvé! Champs disponibles: {available_fields}")

            payload = {
                'id': project.id,
                'name': project.name,
                'project_type': project.project_type if hasattr(project, 'project_type') else False,
                'partner_id': project.partner_id.id if project.partner_id else False,
                'date_start': project.date_start.isoformat() if project.date_start else False,
                'date': project.date.isoformat() if project.date else False,
                'tasks': task_list,
                'numero': project.numero if hasattr(project, 'numero') else False,
                'message_follower_ids': follower_list,
                'privacy_visibility': project.privacy_visibility if hasattr(project, 'privacy_visibility') else False,
                'event_type': event_type,
                'create_date': project.create_date.isoformat() if project.create_date else False,
                'write_date': project.write_date.isoformat() if project.write_date else False,
                'project_source': project.project_source if project.project_source else False,
                # ✅ Utiliser le category_id trouvé via le debug ci-dessus
                'category_id': category_id,
                # ✅ Ajouter type_ids pour l'affichage dans l'UI
                'type_ids': [{'id': t.id, 'name': t.name, 'display_name': t.display_name} for t in project.type_ids] if hasattr(project, 'type_ids') and project.type_ids else [],
            }

            # ✅ Ajouter l'ID de la tâche supprimée si applicable
            if deleted_task_id:
                payload['deleted_task_id'] = deleted_task_id

            # ✅ Ajouter l'ID de la dépense supprimée si applicable
            if deleted_expense_id:
                payload['deleted_expense_id'] = deleted_expense_id
                if task_id_with_deleted_expense:
                    payload['task_id_with_deleted_expense'] = task_id_with_deleted_expense

            self.env["ws.notifier"].send(channel, payload)

    @api.model_create_multi
    def create(self, vals_list):
        projects = super(ProjectProject, self).create(vals_list)
        projects.get_project_data_for_websocket(event_type='updated')
        return projects

    def write(self, vals):
        res = super(ProjectProject, self).write(vals)
        self.get_project_data_for_websocket(event_type='updated')
        return res

    def unlink(self):
        # 📢 Envoyer l'événement de suppression du projet
        self.get_project_data_for_websocket(event_type='deleted')

        # ✅ Ajouter un flag dans le contexte pour indiquer qu'on supprime un projet
        # Cela permettra aux tâches de ne pas envoyer d'événements lors de leur suppression en cascade
        return super(ProjectProject, self.with_context(deleting_project=True)).unlink()

class ProjectTask(models.Model):
    _inherit = 'project.task'

    def _send_project_update(self, event_type='updated', channel=None):
        for task in self:
            if task.project_id:
                # ✅ Si c'est une suppression de tâche, ajouter l'ID de la tâche supprimée
                if event_type == 'deleted':
                    # Envoyer le projet avec l'info de quelle tâche a été supprimée
                    if channel:
                        task.project_id.get_project_data_for_websocket(
                            event_type=event_type,
                            channel=channel,
                            deleted_task_id=task.id
                        )
                    else:
                        task.project_id.get_project_data_for_websocket(
                            event_type=event_type,
                            deleted_task_id=task.id
                        )
                else:
                    if channel:
                        task.project_id.get_project_data_for_websocket(event_type, channel)
                    else:
                        task.project_id.get_project_data_for_websocket(event_type)

    @api.model_create_multi
    def create(self, vals_list):
        tasks = super(ProjectTask, self).create(vals_list)
        tasks._send_project_update(event_type='created')
        return tasks

    def write(self, vals):
        # Any change to a task will trigger a websocket notification.
        # This includes changes to the timer-related fields (is_timer_running, timer_pause, timer_start).
        res = super(ProjectTask, self).write(vals)
        self._send_project_update(event_type='updated')
        return res

    def action_timer_start(self):
        res = super(ProjectTask, self).action_timer_start()
        channel = f'geo_lambert_tasks_user_id_{self.env.user.id}'
        self._send_project_update(channel=channel)
        return res

    def action_timer_pause(self):
        res = super(ProjectTask, self).action_timer_pause()
        channel = f'geo_lambert_tasks_user_id_{self.env.user.id}'
        self._send_project_update(channel=channel)
        return res

    def action_timer_stop(self):
        res = super(ProjectTask, self).action_timer_stop()
        channel = f'geo_lambert_tasks_user_id_{self.env.user.id}'
        self._send_project_update(channel=channel)
        return res

    def action_timer_resume(self):
        res = super(ProjectTask, self).action_timer_resume()
        channel = f'geo_lambert_tasks_user_id_{self.env.user.id}'
        self._send_project_update(channel=channel)
        return res

    def unlink(self):
        """Déclencher WebSocket quand on supprime une tâche"""
        # ✅ Si on est en train de supprimer un projet parent, ne pas envoyer d'événements
        if self.env.context.get('deleting_project'):
            return super(ProjectTask, self).unlink()

        # ✅ Sauvegarder les projets et IDs de tâches AVANT suppression
        tasks_data = [(task.id, task.project_id) for task in self if task.project_id and task.project_id.exists()]

        # Supprimer les tâches
        res = super(ProjectTask, self).unlink()

        # ✅ Notifier les projets APRÈS suppression avec l'ID de la tâche supprimée
        for task_id, project in tasks_data:
            if project.exists():
                project.get_project_data_for_websocket(
                    event_type='updated',
                    deleted_task_id=task_id
                )

        return res

    def get_task_data_for_websocket(self):
        self.ensure_one()
        user_list = []
        for user in self.user_ids:
            user_list.append({
                'id': user.id,
                'display_name': user.display_name,
                'name': user.name,
            })

        expense_list = []
        if hasattr(self, 'expense_ids'):
            # ✅ Filtrer uniquement les dépenses qui existent encore
            existing_expenses = self.expense_ids.exists()
            for expense in existing_expenses:
                try:
                    expense_list.append({
                        'id': expense.id,
                        'expense_date': expense.expense_date.isoformat() if expense.expense_date else False,
                        'amount': expense.amount,
                        'expense_category_id': [{
                            'id': expense.expense_category_id.id,
                            'display_name': expense.expense_category_id.display_name,
                            'name': expense.expense_category_id.name,
                        }] if expense.expense_category_id else [],
                        'display_name': expense.display_name,
                        'project_id': [self.project_id.id, self.project_id.name] if self.project_id else [],
                        'task_id': [self.id, self.name] if self else [],
                        'total_amount': expense.total_amount,
                        'solde_amount': expense.solde_amount,
                        'balance': expense.balance,
                        'expense_move_type': expense.expense_move_type,
                        'date': expense.date,
                        'description': expense.description,
                        'expense_type_id': [{
                            'id': expense.expense_type_id.id,
                            'display_name': expense.expense_type_id.display_name,
                            'name': expense.expense_type_id.name,
                        }] if hasattr(expense, 'expense_type_id') and expense.expense_type_id else [],
                        'currency_id': [expense.currency_id.id,
                                        expense.currency_id.name] if expense.currency_id else [],
                    })
                except Exception:
                    # Si une erreur survient lors de la lecture d'une dépense, l'ignorer
                    continue

        # ✅ Récupérer les timesheets (account.analytic.line)
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
                        'employee_id': [timesheet.employee_id.id,
                                        timesheet.employee_id.name] if timesheet.employee_id else [],
                        'project_id': [timesheet.project_id.id,
                                       timesheet.project_id.name] if timesheet.project_id else [],
                        'task_id': [self.id, self.name],
                    })
                except Exception:
                    # Si une erreur survient lors de la lecture d'un timesheet, l'ignorer
                    continue
        except Exception:
            # Si erreur globale, continuer avec une liste vide
            pass

        # ✅ Récupérer les dépenses de caisse (hr.expense.account.move)
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
                        # ✅ IMPORTANT: Ajouter solde_amount pour que TypeScript calcule correctement
                        'solde_amount': expense_move.solde_amount if hasattr(expense_move, 'solde_amount') else (
                                    expense_move.total_amount or 0.0),
                        # ✅ Ajouter balance aussi comme fallback
                        'balance': expense_move.balance if hasattr(expense_move, 'balance') else (
                                    expense_move.total_amount or 0.0),
                        # ✅ Ajouter amount comme fallback
                        'amount': expense_move.amount if hasattr(expense_move, 'amount') else (
                                    expense_move.total_amount or 0.0),
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
                    # Si une erreur survient lors de la lecture d'une dépense, l'ignorer
                    continue
        except Exception:
            # Si erreur globale, continuer avec une liste vide
            pass

        return {
            'id': self.id,
            'timer_start': self.timer_start.isoformat() if self.timer_start else False,
            'timer_pause': self.timer_pause.isoformat() if self.timer_pause else False,
            'user_ids': user_list,
            'timesheet_ids': timesheet_list,
            'expense_ids': expense_move_list,
            'display_name': self.display_name,
            'name': self.name,
            'partner_id': self.partner_id.id if self.partner_id else False,
            'state': self.state if hasattr(self, 'state') else False
        }