from odoo import models, api
import logging

_logger = logging.getLogger(__name__)


class HrExpenseAccountMove(models.Model):
    _inherit = 'hr.expense.account.move'

    def _send_cashbox_expense_update(self, event_type='created'):
        """
        Émet un événement WebSocket vers le canal privé de la caisse
        Canal: geo_lambert_expense_caisse_{case_id}_{user_id}
        """
        for move in self:
            try:
                # ✅ Récupérer case_id (hr.expense.account)
                case_id = False
                user_id = False

                # Essayer d'obtenir case_id depuis différents champs possibles
                if hasattr(move, 'caisse_id') and move.caisse_id:
                    case_id = move.caisse_id.id
                    # Récupérer user_id depuis l'employé de la caisse
                    if move.caisse_id.employee_id and move.caisse_id.employee_id.user_id:
                        user_id = move.caisse_id.employee_id.user_id.id
                elif hasattr(move, 'expense_account_id') and move.expense_account_id:
                    case_id = move.expense_account_id.id
                    # Récupérer user_id depuis l'employé
                    if move.expense_account_id.employee_id and move.expense_account_id.employee_id.user_id:
                        user_id = move.expense_account_id.employee_id.user_id.id

                # Fallback: utiliser l'employé direct si disponible
                if not user_id and hasattr(move, 'employee_id') and move.employee_id:
                    if move.employee_id.user_id:
                        user_id = move.employee_id.user_id.id

                # Fallback: utiliser create_uid
                if not user_id and move.create_uid:
                    user_id = move.create_uid.id

                if not case_id or not user_id:
                    _logger.warning(
                        f"💸 WebSocket Cashbox: case_id={case_id} ou user_id={user_id} manquant "
                        f"pour expense_move {move.id}"
                    )
                    continue

                # ✅ Construire le canal privé
                channel = f"geo_lambert_expense_caisse_{case_id}_{user_id}"

                # ✅ Préparer le payload avec event_type inclus
                payload = {
                    'event_type': event_type,
                    'id': move.id,
                    'name': move.name or '',
                    'display_name': move.display_name or '',
                    'solde_amount': move.solde_amount if hasattr(move, 'solde_amount') else 0.0,
                    'balance': move.balance if hasattr(move, 'balance') else 0.0,
                    'expense_move_type': move.expense_move_type if hasattr(move, 'expense_move_type') else 'spent',
                    'date': move.date.isoformat() if move.date else False,
                    'description': move.description if move.description else False,
                    'create_date': move.create_date.isoformat() if move.create_date else False,
                    'write_date': move.write_date.isoformat() if move.write_date else False,
                }
                
                # ✅ Ajouter l'utilisateur s'il existe
                if hasattr(move, 'user_id') and move.user_id:
                    payload['user_id'] = [
                        move.user_id.id,
                        move.user_id.name
                    ]

                # ✅ Ajouter task_id si disponible (array d'objets comme l'API)
                if hasattr(move, 'task_id') and move.task_id:
                    payload['task_id'] = [{
                        'id': move.task_id.id,
                        'name': move.task_id.name,
                        'display_name': move.task_id.display_name,
                    }]
                else:
                    payload['task_id'] = []

                # ✅ Émettre via ws.notifier
                self.env["ws.notifier"].send(channel, payload)

                _logger.info(
                    f"✅ WebSocket Cashbox émis: {channel} - "
                    f"event={event_type}, expense_id={move.id}"
                )

            except Exception as e:
                _logger.error(
                    f"❌ Erreur émission WebSocket Cashbox pour expense_move {move.id}: {str(e)}",
                    exc_info=True
                )
                continue

    @api.model_create_multi
    def create(self, vals_list):
        """Déclencher WebSocket quand on crée une dépense de caisse"""
        moves = super(HrExpenseAccountMove, self).create(vals_list)

        for move in moves:
            # ✅ 1. Envoyer vers le canal privé de la caisse
            move._send_cashbox_expense_update(event_type='created')

            # ✅ 2. Notifier aussi via le projet/tâche (pour la liste des projets)
            # Si la dépense est liée à une tâche, notifier via le projet
            if move.task_id and move.task_id.project_id:
                move.task_id._send_project_update(event_type='updated')
            # Sinon, si liée directement au projet
            elif move.project_id:
                move.project_id.get_project_data_for_websocket(event_type='updated')

        return moves

    def write(self, vals):
        """Déclencher WebSocket quand on modifie une dépense de caisse"""
        # Sauvegarder les anciennes valeurs
        old_tasks = self.mapped('task_id')
        old_projects = self.mapped('project_id')

        # Effectuer la modification
        res = super(HrExpenseAccountMove, self).write(vals)

        # ✅ 1. Envoyer vers le canal privé de la caisse pour chaque dépense modifiée
        for move in self:
            move._send_cashbox_expense_update(event_type='updated')

        # ✅ 2. Récupérer les nouvelles valeurs
        new_tasks = self.mapped('task_id')
        new_projects = self.mapped('project_id')

        # Notifier toutes les tâches concernées (anciennes et nouvelles)
        all_tasks = old_tasks | new_tasks
        for task in all_tasks:
            if task and task.exists() and task.project_id:
                task._send_project_update(event_type='updated')

        # Notifier tous les projets concernés (anciens et nouveaux)
        all_projects = old_projects | new_projects
        for project in all_projects:
            if project and project.exists():
                project.get_project_data_for_websocket(event_type='updated')

        return res

    def unlink(self):
        """Déclencher WebSocket quand on supprime une dépense de caisse"""
        # ✅ Sauvegarder les infos AVANT suppression
        expense_info = []
        for move in self:
            case_id = False
            user_id = False

            if hasattr(move, 'caisse_id') and move.caisse_id:
                case_id = move.caisse_id.id
                if move.caisse_id.employee_id and move.caisse_id.employee_id.user_id:
                    user_id = move.caisse_id.employee_id.user_id.id
            elif hasattr(move, 'expense_account_id') and move.expense_account_id:
                case_id = move.expense_account_id.id
                if move.expense_account_id.employee_id and move.expense_account_id.employee_id.user_id:
                    user_id = move.expense_account_id.employee_id.user_id.id

            if not user_id and hasattr(move, 'employee_id') and move.employee_id:
                if move.employee_id.user_id:
                    user_id = move.employee_id.user_id.id

            if not user_id and move.create_uid:
                user_id = move.create_uid.id

            if case_id and user_id:
                expense_info.append({
                    'id': move.id,
                    'case_id': case_id,
                    'user_id': user_id,
                    'name': move.name or '',
                    'display_name': move.display_name or '',
                })

        # Sauvegarder les tâches et projets AVANT suppression
        tasks_to_notify = self.mapped('task_id').filtered(lambda t: t.exists())
        projects_to_notify = self.mapped('project_id').filtered(lambda p: p.exists())

        # Supprimer les dépenses
        res = super(HrExpenseAccountMove, self).unlink()

        # ✅ 1. Émettre vers le canal privé de la caisse APRÈS suppression
        for info in expense_info:
            try:
                channel = f"geo_lambert_expense_caisse_{info['case_id']}_{info['user_id']}"
                payload = {
                    'event_type': 'deleted',
                    'id': info['id'],
                    'name': info['name'],
                    'display_name': info['display_name'],
                }
                self.env["ws.notifier"].send(channel, payload)
                _logger.info(
                    f"✅ WebSocket Cashbox émis (deleted): {channel} - expense_id={info['id']}"
                )
            except Exception as e:
                _logger.error(
                    f"❌ Erreur émission WebSocket Cashbox (deleted) pour expense {info['id']}: {str(e)}"
                )

        # ✅ 2. Notifier les tâches et projets APRÈS suppression
        for task in tasks_to_notify:
            if task.exists() and task.project_id and task.project_id.exists():
                task._send_project_update(event_type='updated')

        for project in projects_to_notify:
            if project.exists():
                project.get_project_data_for_websocket(event_type='updated')

        return res
