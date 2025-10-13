from odoo import models, fields, api

class ProjectProject(models.Model):
    _inherit = 'project.project'

    def get_project_data_for_websocket(self, event_type='updated', channel='geo_lambert_expenses', deleted_task_id=None, deleted_expense_id=None, task_id_with_deleted_expense=None):
        for project in self:
            task_list = []
            for task in project.task_ids:
                task_list.append(task.get_task_data_for_websocket())

            payload = {
                'id': project.id,
                'name': project.name,
                'project_type': project.project_type if hasattr(project, 'project_type') else False,
                'partner_id': project.partner_id.id if project.partner_id else False,
                'date_start': project.date_start.isoformat() if project.date_start else False,
                'date': project.date.isoformat() if project.date else False,
                'task_ids': task_list,
                'numero': project.numero if hasattr(project, 'numero') else False,
                'event_type': event_type,
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
        projects.get_project_data_for_websocket(event_type='created')
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

    def unlink(self):
        # ✅ Si on est dans une suppression de projet, ne PAS envoyer d'événement
        # Le projet a déjà envoyé son événement de suppression
        if not self.env.context.get('deleting_project'):
            # Suppression d'une tâche individuelle -> notifier le projet
            self._send_project_update(event_type='deleted')
        
        # ✅ Ajouter un flag pour indiquer qu'on supprime une tâche
        # Cela permettra aux dépenses de ne pas envoyer d'événements lors de leur suppression en cascade
        return super(ProjectTask, self.with_context(deleting_task=True)).unlink()

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
                        'expense_type_id': [{
                            'id': expense.expense_type_id.id,
                            'display_name': expense.expense_type_id.display_name,
                            'name': expense.expense_type_id.name,
                        }] if hasattr(expense, 'expense_type_id') and expense.expense_type_id else [],
                        'currency_id': [expense.currency_id.id, expense.currency_id.name] if expense.currency_id else [],
                    })
                except Exception:
                    # Si une erreur survient lors de la lecture d'une dépense, l'ignorer
                    continue

        return {
            'id': self.id,
            'timer_start': self.timer_start.isoformat() if self.timer_start else False,
            'timer_pause': self.timer_pause.isoformat() if self.timer_pause else False,
            'user_ids': user_list,
            'expense_ids': expense_list,
            'display_name': self.display_name,
            'name': self.name,
            'partner_id': self.partner_id.id if self.partner_id else False,
            'state': self.state if hasattr(self, 'state') else False,
            "advance_amount": self.advance_amount if self.advance_amount else False,
            'advance_date': self.advance_date.isoformat() if self.advance_date else False,
        }
