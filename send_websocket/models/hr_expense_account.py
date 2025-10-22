from odoo import models, api
import logging

_logger = logging.getLogger(__name__)


class HrExpenseAccount(models.Model):
    _inherit = 'hr.expense.account'

    def _prepare_account_payload(self):
        """
        Prépare le payload pour la notification WebSocket du compte de dépenses
        """
        self.ensure_one()
        
        # Récupérer les mois associés
        month_list = []
        if hasattr(self, 'month_ids') and self.month_ids:
            for month in self.month_ids:
                transactions_list = []
                
                # Récupérer les transactions du mois
                if hasattr(month, 'transaction_ids') and month.transaction_ids:
                    for transaction in month.transaction_ids:
                        trans_data = {
                            'id': transaction.id,
                            'name': transaction.name or '',
                            'display_name': transaction.display_name or '',
                            'balance': transaction.balance if hasattr(transaction, 'balance') else 0.0,
                            'solde_amount': transaction.solde_amount if hasattr(transaction, 'solde_amount') else 0.0,
                            'expense_move_type': transaction.expense_move_type if hasattr(transaction, 'expense_move_type') else 'spent',
                            'date': transaction.date.isoformat() if transaction.date else False,
                            'description': transaction.description if hasattr(transaction, 'description') else False,
                        }
                        
                        # Ajouter l'utilisateur s'il existe
                        if hasattr(transaction, 'user_id') and transaction.user_id:
                            trans_data['user_id'] = [
                                transaction.user_id.id,
                                transaction.user_id.name
                            ]
                        
                        # Ajouter les champs optionnels s'ils existent
                        if hasattr(transaction, 'expense_type_id') and transaction.expense_type_id:
                            trans_data['expense_type_id'] = [
                                transaction.expense_type_id.id,
                                transaction.expense_type_id.name
                            ]
                        
                        if hasattr(transaction, 'expense_category_id') and transaction.expense_category_id:
                            trans_data['expense_category_id'] = [
                                transaction.expense_category_id.id,
                                transaction.expense_category_id.name
                            ]
                        
                        if hasattr(transaction, 'project_id') and transaction.project_id:
                            trans_data['project_id'] = [
                                transaction.project_id.id,
                                transaction.project_id.name
                            ]
                        
                        if hasattr(transaction, 'task_id') and transaction.task_id:
                            trans_data['task_id'] = [
                                transaction.task_id.id,
                                transaction.task_id.name
                            ]
                        
                        transactions_list.append(trans_data)
                
                month_data = {
                    'id': month.id,
                    'name': month.name or '',
                    'display_name': month.display_name or '',
                    'caisse_id': [self.id, self.name] if self else False,
                    'sold': month.sold if hasattr(month, 'sold') else 0.0,
                    'solde_initial': month.solde_initial if hasattr(month, 'solde_initial') else 0.0,
                    'solde_final': month.solde_final if hasattr(month, 'solde_final') else 0.0,
                    'transaction_ids': transactions_list,
                }
                month_list.append(month_data)
        
        # Construire le payload principal
        return {
            'id': self.id,
            'name': self.name or '',
            'display_name': self.display_name or self.name or '',
            'employee_id': [self.employee_id.id, self.employee_id.name] if self.employee_id else False,
            'month_ids': month_list,
            'balance': self.balance if hasattr(self, 'balance') else 0.0,
            'description': self.description if hasattr(self, 'description') else False,
            'create_date': self.create_date.isoformat() if self.create_date else False,
            'write_date': self.write_date.isoformat() if self.write_date else False,
        }

    def _send_account_notification(self, event_type='updated'):
        """
        Envoie une notification WebSocket pour les changements de compte
        Canal privé: geo_lambert_expense_account_{case_id}_{user_id}
        """
        for account in self:
            try:
                # Récupérer user_id depuis l'employé
                user_id = False
                if account.employee_id and account.employee_id.user_id:
                    user_id = account.employee_id.user_id.id
                
                # Fallback: utiliser l'utilisateur actuel
                if not user_id:
                    user_id = self.env.user.id
                
                # Construire le canal privé
                channel = f"geo_lambert_expense_account_{account.id}_{user_id}"
                
                # Préparer le payload
                payload = account._prepare_account_payload()
                payload['event_type'] = event_type
                
                # Émettre via ws.notifier
                self.env["ws.notifier"].send(channel, payload)
                
                _logger.info(
                    f"✅ WebSocket Account émis: {channel} - "
                    f"event={event_type}, account_id={account.id}"
                )
                
            except Exception as e:
                _logger.error(
                    f"❌ Erreur émission WebSocket Account pour {account.id}: {str(e)}",
                    exc_info=True
                )
                continue

    @api.model_create_multi
    def create(self, vals_list):
        """Override create pour envoyer une notification WebSocket"""
        records = super(HrExpenseAccount, self).create(vals_list)
        
        for record in records:
            record._send_account_notification(event_type='created')
        
        return records

    def write(self, vals):
        """Override write pour envoyer une notification WebSocket"""
        result = super(HrExpenseAccount, self).write(vals)
        
        # Envoyer notification pour chaque compte modifié
        for record in self:
            record._send_account_notification(event_type='updated')
        
        return result

    def unlink(self):
        """Override unlink pour envoyer une notification WebSocket avant suppression"""
        # Sauvegarder les infos AVANT suppression
        account_info = []
        for account in self:
            user_id = False
            if account.employee_id and account.employee_id.user_id:
                user_id = account.employee_id.user_id.id
            
            if not user_id:
                user_id = self.env.user.id
            
            account_info.append({
                'id': account.id,
                'user_id': user_id,
                'name': account.name or '',
                'display_name': account.display_name or '',
            })
        
        # Supprimer les comptes
        result = super(HrExpenseAccount, self).unlink()
        
        # Émettre les notifications après suppression
        for info in account_info:
            try:
                channel = f"geo_lambert_expense_account_{info['id']}_{info['user_id']}"
                payload = {
                    'event_type': 'deleted',
                    'id': info['id'],
                    'name': info['name'],
                    'display_name': info['display_name'],
                }
                self.env["ws.notifier"].send(channel, payload)
                _logger.info(
                    f"✅ WebSocket Account émis (deleted): {channel} - account_id={info['id']}"
                )
            except Exception as e:
                _logger.error(
                    f"❌ Erreur émission WebSocket Account (deleted) pour {info['id']}: {str(e)}"
                )
        
        return result



